/**
 * Request Transformer — the heart of the extension.
 *
 * Hooks CHAT_COMPLETION_SETTINGS_READY (the final generate_data payload built
 * by SillyTavern right before it is POSTed to the backend) and translates the
 * unified prefill intent into provider-specific protocol fields.
 *
 * Guarantees:
 *   - OFF mode: never touches the request (no extra fields).
 *   - ONLY the current trailing assistant prefill is ever processed; history
 *     assistant messages are never modified (except the opt-in historical
 *     reasoning re-attach, which only writes to the outgoing request copy).
 *   - FAIL OPEN: any parse/adapter/validation error keeps the original
 *     request; the plugin never blocks or breaks a chat completion request.
 *   - NO DUPLICATE PROCESSING: each generate_data object is marked in a
 *     WeakSet after a successful pass (the marker never leaves the plugin).
 */

import { parsePrefill, hasReasoningStartTag } from './prefill-parser.js';
import { detectProvider, PROVIDERS } from './provider-detector.js';
import { AdapterRegistry } from '../adapters/index.js';
import { describeCapabilities } from './capabilities.js';
import { Logger } from './logger.js';

export const TRANSFORM_TYPES = new Set(['normal', 'regenerate', 'swipe', 'continue']);
export const MANUAL_INJECT_TYPES = new Set(['normal', 'regenerate', 'swipe']);

/** Internal marker so the same request object is never processed twice. */
const PROCESSED = new WeakSet();

/** Lazily-created default registry (shared across calls). */
let defaultRegistry = null;
function getDefaultRegistry(context) {
    if (!defaultRegistry) {
        defaultRegistry = new AdapterRegistry({
            getCustomProfile: () => (context.getCustomProfile ? context.getCustomProfile() : null),
        });
    }
    return defaultRegistry;
}

/**
 * @typedef {object} TransformerContext
 * @property {object} settings                The extension settings object
 * @property {() => string} [getGenerationType] Returns the current generation type
 * @property {() => any[]} [getChat]           Returns SillyTavern chat history (for historical reasoning)
 * @property {AdapterRegistry} [registry]      Adapter registry (injectable for tests)
 * @property {() => object|null} [getCustomProfile] Resolves the active custom profile
 * @property {Logger} [logger]                 Debug logger (redaction built in)
 */

/**
 * Processes one outgoing chat completion payload. Mutates the payload only
 * after every check has passed. Returns a result object for logging/tests.
 * @param {object} generateData SillyTavern `generate_data`
 * @param {TransformerContext} context
 * @returns {{changed: boolean, result?: object, skipped?: string, error?: string}}
 */
export function transformChatCompletionRequest(generateData, context = {}) {
    const logger = context.logger || new Logger(() => false);
    const registry = context.registry || getDefaultRegistry(context);

    try {
        if (!generateData || typeof generateData !== 'object' || !Array.isArray(generateData.messages) || generateData.messages.length === 0) {
            logger.debug('Skipped: no usable generate_data payload.');
            return { changed: false, skipped: 'No usable generate_data payload.' };
        }

        if (PROCESSED.has(generateData)) {
            logger.debug('Skipped: request already processed by this plugin.');
            return { changed: false, skipped: 'Request already processed by this plugin.' };
        }

        const settings = context.settings;
        if (!settings || settings.enabled === false) {
            // Debug-gated: with Debug Mode ON this reveals that the plugin is
            // alive but disabled (Enable unchecked) — the reason no processing
            // logs ever appear.
            logger.debug('Skipped: plugin disabled (Off mode). Enable the extension to process prefills.');
            return { changed: false, skipped: 'Plugin disabled (Off mode).' };
        }

        const type = context.getGenerationType ? (context.getGenerationType() || generateData.type || 'normal') : (generateData.type || 'normal');
        if (!TRANSFORM_TYPES.has(type)) {
            logger.debug('Skipped: generation type not eligible.', { type });
            return { changed: false, skipped: `Generation type '${type}' not eligible.` };
        }

        // ---------------------------------------------------------------
        // 1. Resolve the prefill intent (Auto vs Manual).
        // ---------------------------------------------------------------
        const mode = settings.mode === 'manual' ? 'manual' : 'auto';
        const messages = generateData.messages;
        const last = messages.length ? messages[messages.length - 1] : null;

        let prefill = null;
        let intent = null;

        if (mode === 'manual') {
            const reasoning = String(settings.manualReasoning || '').trim();
            const content = String(settings.manualContent || '').trim();
            if (!reasoning && !content) {
                return { changed: false, skipped: 'Manual mode: both prefills are empty.' };
            }
            if (!MANUAL_INJECT_TYPES.has(type)) {
                logger.debug('Skipped: manual prefill injection not allowed for generation type.', { type });
                return { changed: false, skipped: `Manual prefill injection not allowed for type '${type}'.` };
            }
            const isTrailingAssistant = Boolean(last && last.role === 'assistant' && typeof last.content === 'string');
            intent = {
                placement: isTrailingAssistant ? 'replace' : 'append',
                reasoning,
                content,
                mode: reasoning && content ? 'both' : (reasoning ? 'reasoning' : 'content'),
                source: 'manual',
            };
            // Manual config always wins over any ST prefill -> exactly one
            // prefill message in the outgoing payload.
        } else {
            // Auto: parse SillyTavern's generated reply prefix.
            if (!last || last.role !== 'assistant') {
                return { changed: false, skipped: 'Auto mode: last message is not an assistant prefill.' };
            }
            const raw = typeof last.content === 'string' ? last.content : '';
            if (!raw.trim()) {
                return { changed: false, skipped: 'Auto mode: empty assistant prefill.' };
            }
            if (!isCurrentPrefillMessage(last, type, settings)) {
                return { changed: false, skipped: 'Auto mode: last assistant message is not a current prefill.' };
            }
            prefill = parsePrefill(raw, {
                startTag: settings.reasoningStartTag,
                endTag: settings.reasoningEndTag,
            });
            if (!prefill) {
                logger.debug('Skipped: prefill parser failed (fail open).', { content: raw.slice(0, 120) });
                return { changed: false, skipped: 'Auto mode: malformed prefill (fail open).' };
            }
            if (prefill.matched === false && prefill.mode === 'content') {
                // Plain content prefill with no reasoning tags: the trailing
                // assistant message is already the correct OpenAI-style
                // content prefill, so leave the request exactly as ST built it.
                return { changed: false, skipped: 'Auto mode: plain content prefill needs no provider translation.' };
            }
            intent = {
                placement: 'replace',
                reasoning: prefill.reasoning,
                content: prefill.content,
                mode: prefill.mode,
                source: 'start-reply-with',
            };
        }

        // ---------------------------------------------------------------
        // 2. Provider detection + adapter selection.
        // ---------------------------------------------------------------
        const detection = detectProvider({
            providerSetting: settings.provider,
            chatCompletionSource: generateData.chat_completion_source,
            customUrl: generateData.custom_url,
            model: generateData.model,
        });
        // Attach request facts for adapters (URL checks, model-specific caps).
        detection.model = generateData.model;
        detection.chatCompletionSource = generateData.chat_completion_source;
        detection.customUrl = generateData.custom_url;

        const adapter = registry.resolve(detection);
        if (!adapter) {
            logger.debug('Skipped: no adapter for provider.', { provider: detection.provider });
            return { changed: false, skipped: `No adapter for provider '${detection.provider}'.` };
        }

        const capabilities = adapter.getCapabilities(detection);

        // ---------------------------------------------------------------
        // 3. Validate against capabilities (tools / structured / intent).
        //    On failure: fail open — nothing is mutated.
        // ---------------------------------------------------------------
        const validation = adapter.validate(detection, generateData, {
            reasoning: intent.reasoning,
            content: intent.content,
            mode: intent.mode,
            source: intent.source,
        });
        if (!validation.ok) {
            logger.debug('Skipped by validation:', validation.skippedReason, ...(validation.warnings || []));
            return { changed: false, skipped: validation.skippedReason };
        }

        // ---------------------------------------------------------------
        // 4. Transform on a working copy, then commit only on success.
        // ---------------------------------------------------------------
        const workingCopy = buildWorkingCopy(generateData, intent);
        const options = {
            forceThinkingEnabled: Boolean(settings.forceThinkingEnabled),
            deepseekAutoBetaEndpoint: Boolean(settings.deepseekAutoBetaEndpoint),
            logger,
        };
        const result = adapter.transformRequest(workingCopy, {
            reasoning: intent.reasoning,
            content: intent.content,
            mode: intent.mode,
            source: intent.source,
        }, detection, options);

        if (!result || result.applied !== true) {
            logger.debug('Adapter did not apply a transformation:', result?.skippedReason);
            return { changed: false, skipped: result?.skippedReason || 'Adapter did not apply a transformation.' };
        }

        // ---------------------------------------------------------------
        // 5. Commit (only now is the real payload touched).
        // ---------------------------------------------------------------
        commitWorkingCopy(generateData, workingCopy, result);

        // ---------------------------------------------------------------
        // 6. Opt-in: preserve historical reasoning on prior assistant messages.
        // ---------------------------------------------------------------
        if (settings.preserveHistoricalReasoning && context.getChat) {
            attachHistoricalReasoning(generateData, adapter, detection, {
                getChat: context.getChat,
                forceThinkingEnabled: Boolean(settings.forceThinkingEnabled),
                logger,
            });
        }

        PROCESSED.add(generateData);

        logger.debug(
            'Provider:', detection.provider, '| via:', detection.via,
            '| Mode:', mode,
            '| Adapter:', adapter.constructor?.name || adapter.label,
            '| Capabilities:', describeCapabilities(capabilities),
            '| Intent:', intent.mode, '| Warnings:', result.warnings || [],
        );

        return {
            changed: true,
            result: {
                provider: detection.provider,
                via: detection.via,
                mode,
                adapter: adapter.constructor?.name || adapter.label,
                capabilities,
                intent: { mode: intent.mode, source: intent.source },
                messageTransform: result.messageTransform || null,
                requestFields: result.requestFields || {},
                warnings: result.warnings || [],
            },
        };
    } catch (error) {
        // Fail open: the original request was not mutated (all mutations are
        // deferred to commitWorkingCopy after every validation).
        logger.error('Transform error (failing open):', error);
        return { changed: false, error: String(error && error.message || error) };
    }
}

// ----------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------

/**
 * Detects whether the trailing assistant message of an outgoing payload is
 * the CURRENT assistant prefill (never a historical message).
 */
export function isCurrentPrefillMessage(last, type, settings) {
    if (!last || last.role !== 'assistant') return false;
    // Explicit marker, when SillyTavern / other extensions provide one.
    if (last.is_prefill === true) return true;
    // For normal / regenerate / swipe, SillyTavern never ends the payload on
    // an assistant message unless something injected a prefill.
    if (MANUAL_INJECT_TYPES.has(type)) return true;
    // Continue ends on the message being continued — only treat it as a
    // prefill when it explicitly carries a reasoning-block prefix.
    if (type === 'continue') {
        return hasReasoningStartTag(typeof last.content === 'string' ? last.content : '', {
            startTag: settings?.reasoningStartTag,
        });
    }
    return false;
}

/**
 * Builds a working copy of the request for adapter transformations:
 * history messages kept by reference, trailing message (and manual append)
 * cloned so a failed transform never touches the real payload.
 */
function buildWorkingCopy(generateData, intent) {
    const messages = generateData.messages;
    const cloned = {
        ...generateData,
        messages: messages.slice(),
    };

    const base = {
        role: 'assistant',
        content: intent.content,
    };

    if (intent.placement === 'replace') {
        cloned.messages[cloned.messages.length - 1] = { ...base };
    } else {
        cloned.messages.push({ ...base });
    }
    return cloned;
}

function commitWorkingCopy(generateData, workingCopy, result) {
    generateData.messages = workingCopy.messages;
    if (workingCopy.custom_url !== undefined && workingCopy.custom_url !== generateData.custom_url) {
        generateData.custom_url = workingCopy.custom_url;
    }
    if (result.requestFields && typeof result.requestFields === 'object') {
        Object.assign(generateData, result.requestFields);
    }
}

/** Reasoning field each adapter uses to echo historical reasoning. */
export function reasoningFieldForAdapter(adapter) {
    switch (adapter?.id) {
        case 'moonshot':
        case 'deepseek':
            return 'reasoning_content';
        case 'ollama':
            return 'reasoning';
        case 'custom':
            return String(adapter.profile?.reasoningField || 'reasoning_content');
        default:
            return null;
    }
}

/**
 * Opt-in historical reasoning re-attach: copies stored reasoning
 * (`extra.reasoning` on chat messages) onto the matching assistant entries
 * of the outgoing request. Gated by a dedicated setting, OFF by default.
 */
function attachHistoricalReasoning(generateData, adapter, detection, { getChat, forceThinkingEnabled, logger }) {
    try {
        const field = reasoningFieldForAdapter(adapter);
        if (!field || !adapter.supports(detection)) return;
        const chat = getChat();
        if (!Array.isArray(chat)) return;

        const chatAssistantMsgs = chat.filter((m) => m && !m.is_user && !m.is_system);
        const outgoingAssistantMsgs = generateData.messages.filter((m) => m && m.role === 'assistant');

        let attached = 0;
        const count = Math.min(chatAssistantMsgs.length, outgoingAssistantMsgs.length);
        for (let i = 0; i < count; i++) {
            const reason = chatAssistantMsgs[i]?.extra?.reasoning ?? chatAssistantMsgs[i]?.reasoning;
            if (reason && typeof reason === 'string' && reason.trim() && !outgoingAssistantMsgs[i][field]) {
                outgoingAssistantMsgs[i][field] = reason;
                attached++;
            }
        }

        if (attached > 0) {
            if (forceThinkingEnabled && !generateData.include_reasoning) {
                generateData.include_reasoning = true;
            }
            logger.debug(`Attached historical reasoning to ${attached} assistant message(s) via field '${field}'.`);
        }
    } catch (error) {
        logger.warn('Historical reasoning attach failed (ignored):', error);
    }
}

export { detectProvider, PROVIDERS };
