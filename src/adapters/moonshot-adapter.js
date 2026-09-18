/**
 * Moonshot / Kimi Adapter.
 *
 * Covers the direct Moonshot source as well as any OpenRouter / relay /
 * gateway that honors Moonshot's "Partial Mode":
 *
 *   messages.push({
 *       role: 'assistant',
 *       content: '<content prefill>',
 *       reasoning_content: '<thinking prefill>',   // required by thinking mode
 *       partial: true,                            // Partial Mode marker
 *   });
 *
 * Reference:
 *   - Kimi API Platform: "Use Partial Mode" guide
 *     (partial:true assistant message at the end, content = continuation seed,
 *      reasoning_content passback required for thinking models).
 *   - KimiThinkingPrefill (Rurijian/KimiThinkingPrefill): hooks
 *     CHAT_COMPLETION_SETTINGS_READY, moves a leading think block into
 *     `reasoning_content` and flags the message `partial: true`.
 *
 * Reasoning-only prefill (empty content) is Experimental: Moonshot docs note
 * that an empty content prefix restarts generation instead of continuing, so
 * "continue thinking from the tail" is not a verified behavior.
 */

import { BaseAdapter } from './base-adapter.js';

export class MoonshotAdapter extends BaseAdapter {
    constructor() {
        super();
        this.id = 'moonshot';
        this.label = 'Moonshot / Kimi';
    }

    supports(detection) {
        return detection?.provider === 'moonshot';
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
        if (!mode || mode === 'content') {
            // Plain content prefill: mark it Partial so Moonshot forces
            // continuation from that exact content.
            const last = request.messages?.[request.messages.length - 1];
            if (last && last.role === 'assistant') {
                request.messages[request.messages.length - 1] = {
                    ...last,
                    role: 'assistant',
                    content: prefill?.content ?? last.content,
                    partial: true,
                };
                return {
                    applied: true,
                    messageTransform: { role: 'assistant', content: '<content>', partial: true },
                    requestFields: {},
                    warnings,
                };
            }
            return { applied: false, skippedReason: 'No trailing assistant message to transform.', warnings };
        }

        const last = request.messages?.[request.messages.length - 1];
        if (!last || last.role !== 'assistant') {
            return { applied: false, skippedReason: 'No trailing assistant message to transform.', warnings };
        }

        const transformed = {
            ...last,
            role: 'assistant',
            content: prefill.content,
            reasoning_content: prefill.reasoning,
            partial: true,
        };
        delete transformed.reasoning;
        delete transformed.prefix;

        request.messages[request.messages.length - 1] = transformed;

        const requestFields = {};
        if (options.forceThinkingEnabled && mode !== 'content') {
            requestFields.include_reasoning = true;
        }

        if (mode === 'reasoning') {
            warnings.push('Kimi reasoning-only prefill is experimental: with empty content the model may restart generation instead of continuing the thinking chain.');
        }

        return {
            applied: true,
            messageTransform: { role: 'assistant', content: '<content>', reasoning_content: '<reasoning>', partial: true },
            requestFields,
            warnings,
        };
    }
}
