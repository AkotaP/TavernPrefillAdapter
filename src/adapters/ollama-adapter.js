/**
 * Ollama Adapter.
 *
 * Covers Ollama Local, Ollama Cloud and any Ollama instance exposed through
 * the OpenAI-compatible endpoint (/v1/chat/completions) — i.e. a SillyTavern
 * "Custom (OpenAI-compatible)" source pointed at http://localhost:11434/v1,
 * http://127.0.0.1:11434/v1 or https://ollama.com/v1.
 *
 * Protocol (verified against ollama/openai.go FromChatRequest):
 *   - assistant message field `reasoning` is accepted in requests and mapped
 *     by Ollama to its native "thinking" content.
 *   - responses expose thinking through `message.reasoning` / streaming
 *     `delta.reasoning`.
 *
 * Semantics:
 *   - content-only prefill  → plain assistant content (already correct).
 *   - reasoning + content   → { role:'assistant', reasoning, content }.
 *     Ollama treats an assistant message carrying both as "thinking done,
 *     answer started, continue from content".
 *   - reasoning-only        → { role:'assistant', reasoning, content:'' }.
 *     Whether the model continues the native reasoning chain from there is
 *     NOT guaranteed (it may merely treat it as history context), so the
 *     reasoning-continuation capability is marked experimental.
 *
 * Reasoning prefill is ON BY DEFAULT for every model. We deliberately do NOT
 * match model ids to decide support: model families change too quickly and a
 * non-thinking model that simply ignores the `reasoning` field degrades
 * gracefully (the field is treated as plain context) rather than failing the
 * request. If the provider rejects the field, the request fails open and the
 * log entry below tells the user what happened.
 */

import { BaseAdapter } from './base-adapter.js';

export class OllamaAdapter extends BaseAdapter {
    constructor() {
        super();
        this.id = 'ollama';
        this.label = 'Ollama';
    }

    supports(detection) {
        return detection?.provider === 'ollama';
    }

    getCapabilities(detection) {
        return this.normalizeCapabilities({
            supportsContentPrefill: true,
            supportsReasoningPrefill: true,
            supportsCombinedPrefill: true,
            supportsReasoningContinuation: false,
            reasoningContinuationExperimental: true,
            supportsToolsWithPrefill: false,
            supportsStructuredOutputWithPrefill: false,
        });
    }

    validate(detection, request, prefill) {
        const caps = this.getCapabilities(detection);
        const guard = this.validateGuards(detection, request, caps);
        if (!guard.ok) return guard;
        return this.validatePrefillAgainstCapabilities(prefill, caps);
    }

    transformRequest(request, prefill, detection, options = {}) {
        const warnings = [];

        // Only act when the user expressed reasoning intent. Plain content
        // prefill is already correct for Ollama (trailing assistant message).
        const mode = prefill?.mode;
        if (!mode || mode === 'content') {
            return {
                applied: false,
                skippedReason: 'Plain content prefill needs no Ollama-specific transformation.',
                warnings,
            };
        }

        const last = request.messages?.[request.messages.length - 1];
        if (!last || last.role !== 'assistant') {
            return { applied: false, skippedReason: 'No trailing assistant message to transform.', warnings };
        }

        const transformed = {
            ...last,
            role: 'assistant',
            reasoning: prefill.reasoning,
            content: prefill.content,
        };
        // Remove fields from other provider dialects that Ollama does not use
        // and that could confuse generic proxies.
        delete transformed.reasoning_content;
        delete transformed.partial;
        delete transformed.prefix;

        request.messages[request.messages.length - 1] = transformed;

        // Informational log: the provider may ignore `reasoning` on models
        // without native thinking support (graceful degradation) or reject it
        // (fail open — the original request semantics are already applied).
        const log = options.logger;
        if (log?.debug) {
            log.debug(
                'Ollama reasoning prefill applied. The `reasoning` field maps to native thinking; on models without thinking support it may be ignored or rejected (see provider response).',
                { model: String(detection?.model || '') },
            );
        } else {
            warnings.push('Ollama reasoning prefill applied; models without native thinking support may ignore the reasoning field.');
        }

        if (mode === 'reasoning') {
            warnings.push('Ollama reasoning-only prefill: the model may continue from the reasoning tail or merely treat it as context (experimental).');
        }

        return {
            applied: true,
            messageTransform: { role: 'assistant', reasoning: '<reasoning>', content: '<content>' },
            requestFields: {},
            warnings,
        };
    }
}
