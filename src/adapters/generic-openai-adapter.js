/**
 * Generic OpenAI-Compatible Adapter.
 *
 * Extremely conservative by design. The only transformation this adapter
 * guarantees is the standard assistant content prefill:
 *
 *   { "role": "assistant", "content": "..." }
 *
 * Reasoning prefill is treated as UNSUPPORTED:
 *   - reasoning-only prefill   → skipped (fail open, request untouched);
 *   - reasoning + content      → the reasoning part is dropped with a warning
 *                                and only the content prefill is kept.
 *
 * Never invent `reasoning_content`, `partial`, `prefix` or `thinking` for an
 * interface merely because it calls itself "OpenAI-compatible".
 */

import { BaseAdapter } from './base-adapter.js';

export class GenericOpenAIAdapter extends BaseAdapter {
    constructor() {
        super();
        this.id = 'generic';
        this.label = 'Generic OpenAI';
    }

    supports(detection) {
        return detection?.provider === 'generic';
    }

    getCapabilities(detection) {
        return this.normalizeCapabilities({
            supportsContentPrefill: true,
            supportsReasoningPrefill: false,
            supportsCombinedPrefill: false,
            supportsReasoningContinuation: false,
            reasoningContinuationExperimental: false,
            supportsToolsWithPrefill: false,
            supportsStructuredOutputWithPrefill: false,
        });
    }

    validate(detection, request, prefill) {
        const caps = this.getCapabilities(detection);
        const guard = this.validateGuards(detection, request, caps);
        if (!guard.ok) return guard;

        const mode = prefill?.mode;
        if (mode === 'reasoning') {
            return {
                ok: false,
                skippedReason: 'Reasoning prefill is not supported by generic OpenAI-compatible endpoints. Leaving the request untouched.',
                warnings: [],
            };
        }
        return { ok: true, skippedReason: null, warnings: [] };
    }

    transformRequest(request, prefill, detection, options = {}) {
        const warnings = [];
        const mode = prefill?.mode;

        if (mode === 'reasoning') {
            return {
                applied: false,
                skippedReason: 'Reasoning prefill is not supported by generic OpenAI-compatible endpoints.',
                warnings,
            };
        }

        const last = request.messages?.[request.messages.length - 1];
        if (!last || last.role !== 'assistant') {
            return { applied: false, skippedReason: 'No trailing assistant message to transform.', warnings };
        }

        if (mode === 'both') {
            warnings.push('This endpoint does not support reasoning prefill; only the content prefill is kept.');
        }

        // Content only (or content part of a combined prefill): the trailing
        // assistant message is already the content prefill — keep it clean.
        request.messages[request.messages.length - 1] = {
            role: 'assistant',
            content: prefill?.content ?? last.content,
        };

        return {
            applied: true,
            messageTransform: { role: 'assistant', content: '<content>' },
            requestFields: {},
            warnings,
        };
    }
}
