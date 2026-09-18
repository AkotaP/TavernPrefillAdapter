/**
 * DeepSeek Official Adapter.
 *
 * DeepSeek's Chat Completions API (beta) supports:
 *   - assistant message field `prefix: true` — force the model to start its
 *     answer with the supplied content of that assistant message;
 *   - assistant message field `reasoning_content` — input CoT for the last
 *     assistant message (only together with `prefix: true`);
 *   - the `/beta` base URL is required for prefix completion.
 *
 * SillyTavern's own DeepSeek source already targets https://api.deepseek.com/beta
 * and the server marks trailing assistant messages with `prefix: true`
 * (src/endpoints/backends/chat-completions.js sendDeepSeekRequest).
 * This adapter therefore mainly adds `reasoning_content` — and adds
 * `prefix: true` itself when running through the Custom source (relay /
 * gateway) where ST does not add it.
 *
 * Beta endpoint handling follows the reference design:
 *   - detect the current base URL (custom_url),
 *   - warn loudly,
 *   - NEVER silently replace it, unless the user enables the explicit
 *     "deepseekAutoBetaEndpoint" setting (then api.deepseek.com/... without
 *     /beta is rewritten to api.deepseek.com/beta for this request).
 */

import { BaseAdapter } from './base-adapter.js';

export class DeepSeekAdapter extends BaseAdapter {
    constructor() {
        super();
        this.id = 'deepseek';
        this.label = 'DeepSeek Official';
    }

    supports(detection) {
        return detection?.provider === 'deepseek';
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
        const mode = prefill?.mode;

        // Beta endpoint / prefix sanity checks.
        const customUrl = typeof request.custom_url === 'string' ? request.custom_url : (detection?.customUrl || '');
        const host = safeHost(customUrl);
        const onDeepSeekHost = /deepseek/.test(host);
        const hasBeta = /\/beta(?:\/|$)/i.test(customUrl);
        if (onDeepSeekHost && !hasBeta) {
            warnings.push('DeepSeek prefix completion requires the /beta endpoint. Current base URL is not the beta endpoint.');
            if (options.deepseekAutoBetaEndpoint && customUrl) {
                const rewritten = rewriteToBeta(customUrl);
                if (rewritten) {
                    request.custom_url = rewritten;
                    warnings.push('Base URL was adjusted to the DeepSeek beta endpoint (deepseekAutoBetaEndpoint enabled).');
                }
            }
        }

        const last = request.messages?.[request.messages.length - 1];
        if (!last || last.role !== 'assistant') {
            return { applied: false, skippedReason: 'No trailing assistant message to transform.', warnings };
        }

        if (!mode || mode === 'content') {
            // Content prefill: mark as DeepSeek prefix (already done by ST for
            // the native source; required for Custom-source relays).
            request.messages[request.messages.length - 1] = {
                ...last,
                role: 'assistant',
                content: prefill?.content ?? last.content,
                prefix: true,
            };
            return {
                applied: true,
                messageTransform: { role: 'assistant', content: '<content>', prefix: true },
                requestFields: {},
                warnings,
            };
        }

        // reasoning / both.
        const transformed = {
            ...last,
            role: 'assistant',
            content: prefill.content,
            reasoning_content: prefill.reasoning,
            prefix: true,
        };
        delete transformed.reasoning;
        delete transformed.partial;

        request.messages[request.messages.length - 1] = transformed;

        const requestFields = {};
        if (options.forceThinkingEnabled) {
            requestFields.include_reasoning = true;
        }

        if (mode === 'reasoning') {
            warnings.push('DeepSeek reasoning-only prefill is experimental: prefix completion with empty content may not continue the native thinking chain.');
        }

        return {
            applied: true,
            messageTransform: { role: 'assistant', content: '<content>', reasoning_content: '<reasoning>', prefix: true },
            requestFields,
            warnings,
        };
    }
}

function safeHost(url) {
    try {
        return new URL(url).hostname.toLowerCase();
    } catch {
        return '';
    }
}

function rewriteToBeta(url) {
    try {
        const u = new URL(url);
        if (/deepseek/.test(u.hostname) && !/\/beta(?:\/|$)/i.test(u.pathname)) {
            u.pathname = '/beta' + (u.pathname.startsWith('/') ? u.pathname : '/' + u.pathname);
            if (u.pathname === '/beta/') u.pathname = '/beta';
            return u.toString();
        }
    } catch {
        // ignore
    }
    return null;
}
