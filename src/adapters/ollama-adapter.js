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
 * Thinking models (qwen3, deepseek-r1, gemma4, ...) are model-dependent:
 * capability declarations below relax for known thinking families.
 */

import { BaseAdapter } from './base-adapter.js';

const THINKING_MODEL_HINTS = [
    /qwen3/i,
    /deepseek-r1/i,
    /deepseek-r1/i,
    /gemma4/i,
    /gpt-oss/i,
    /thinking/i,
    /reasoning/i,
    /think/i,
];

export class OllamaAdapter extends BaseAdapter {
    constructor() {
        super();
        this.id = 'ollama';
        this.label = 'Ollama';
    }

    supports(detection) {
        return detection?.provider === 'ollama';
    }

    isThinkingModel(detection) {
        const model = String(detection?.model || '');
        return THINKING_MODEL_HINTS.some((re) => re.test(model));
    }

    getCapabilities(detection) {
        return this.normalizeCapabilities({
            supportsContentPrefill: true,
            // Reasoning prefill works with thinking-capable models; for plain
            // chat models the field may be ignored or rejected → model-gated.
            supportsReasoningPrefill: this.isThinkingModel(detection),
            supportsCombinedPrefill: this.isThinkingModel(detection),
            supportsReasoningContinuation: false,
            reasoningContinuationExperimental: this.isThinkingModel(detection),
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
        const caps = this.getCapabilities(detection);
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

        if (mode === 'reasoning') {
            if (!caps.supportsReasoningPrefill && !caps.supportsReasoningContinuation) {
                return { applied: false, skippedReason: 'Reasoning prefill is not supported for this model.', warnings };
            }
        }
        if (mode === 'both' && !caps.supportsCombinedPrefill) {
            return { applied: false, skippedReason: 'Combined prefill is not supported for this model.', warnings };
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
