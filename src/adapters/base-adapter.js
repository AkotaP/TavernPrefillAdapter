/**
 * Base Prefill Adapter.
 *
 * Every provider adapter extends this class. The contract mirrors the
 * reference design:
 *
 *   class PrefillAdapter {
 *       detect(context) {}              // (here: supports())
 *       getCapabilities(context) {}     // explicit capability declaration
 *       validate(request, prefill, settings) {}
 *       transformRequest(request, prefill, settings) {}
 *   }
 *
 * Adapters must NEVER throw into the request path: the request transformer
 * wraps every call in try/catch and fails open (keeps the original request).
 */

import { DEFAULT_CAPABILITIES, normalizeCapabilities } from '../core/capabilities.js';

export class BaseAdapter {
    constructor() {
        this.id = 'base';
        this.label = 'Base Adapter';
    }

    /**
     * Whether this adapter claims the detected provider.
     * @param {object} detection DetectionContext result
     * @returns {boolean}
     */
    supports(detection) {
        return false;
    }

    /**
     * Explicit capability declaration (may depend on model id / family).
     * @param {object} detection
     * @returns {object}
     */
    getCapabilities(detection) {
        return { ...DEFAULT_CAPABILITIES };
    }

    /**
     * Validates whether a prefill can be applied to this request.
     * Checks capability conflicts (tools, structured output) and the
     * reasoning-continuation capability.
     *
     * @param {object} detection DetectionContext result
     * @param {object} request   The outgoing generate_data payload
     * @param {object} prefill   Unified prefill model { reasoning, content, mode, source }
     * @returns {{ok: boolean, skippedReason: string|null, warnings: string[]}}
     */
    validate(detection, request, prefill) {
        return { ok: true, skippedReason: null, warnings: [] };
    }

    /**
     * Applies the provider-specific payload translation IN PLACE on
     * `request.messages` (the trailing prefill message) and/or on top-level
     * request fields.
     *
     * @param {object} request  The outgoing generate_data payload (mutable)
     * @param {object} prefill   Unified prefill model
     * @param {object} detection DetectionContext result
     * @param {object} options  { forceThinkingEnabled, deepseekAutoBetaEndpoint }
     * @returns {{applied: boolean, skippedReason?: string, messageTransform?: object, requestFields?: object, warnings?: string[]}}
     */
    transformRequest(request, prefill, detection, options = {}) {
        return {
            applied: false,
            skippedReason: 'Adapter does not implement transformRequest.',
        };
    }

    // ------------------------------------------------------------------
    // Shared helpers
    // ------------------------------------------------------------------

    /** True if the request carries tools / tool calls. */
    hasTools(request) {
        if (!request) return false;
        if (Array.isArray(request.tools) && request.tools.length > 0) return true;
        if (request.tool_choice && typeof request.tool_choice === 'object' && Object.keys(request.tool_choice).length) return true;
        const messages = request.messages;
        if (Array.isArray(messages)) {
            return messages.some((m) => m && (m.role === 'tool' || (Array.isArray(m.tool_calls) && m.tool_calls.length > 0)));
        }
        return false;
    }

    /** True if the request asks for structured output / JSON schema. */
    hasStructuredOutput(request) {
        if (!request) return false;
        return Boolean(
            request.json_schema
            || request.response_format
            || (request.response_format_object && Object.keys(request.response_format_object).length),
        );
    }

    /**
     * Standard guard shared by adapters: skip when tools or structured output
     * are active and the adapter does not declare support for them.
     * @returns {{ok:boolean, skippedReason:string|null, warnings:string[]}}
     */
    validateGuards(detection, request, caps) {
        const warnings = [];
        if (this.hasTools(request)) {
            if (!caps.supportsToolsWithPrefill) {
                return {
                    ok: false,
                    skippedReason: 'Tools are active and the current adapter does not support prefill with tools.',
                    warnings,
                };
            }
            warnings.push('Tools are active; the adapter declares support for prefill with tools.');
        }
        if (this.hasStructuredOutput(request)) {
            if (!caps.supportsStructuredOutputWithPrefill) {
                return {
                    ok: false,
                    skippedReason: 'Structured output is active and the current adapter does not support prefill with structured output.',
                    warnings,
                };
            }
            warnings.push('Structured output is active; the adapter declares support for prefill with structured output.');
        }
        return { ok: true, skippedReason: null, warnings };
    }

    /**
     * Checks the prefill intent against capabilities.
     * @returns {{ok:boolean, skippedReason:string|null, warnings:string[]}}
     */
    validatePrefillAgainstCapabilities(prefill, caps) {
        const warnings = [];
        const mode = prefill && prefill.mode;

        if (caps.reasoningContinuationExperimental && (mode === 'reasoning' || mode === 'both')) {
            warnings.push('Reasoning continuation may not continue native reasoning on this provider/model; the reasoning may only be treated as context. Use with caution.');
        }

        if (mode === 'content') {
            if (!caps.supportsContentPrefill) {
                return { ok: false, skippedReason: 'Content prefill is not supported by the current adapter.', warnings };
            }
        } else if (mode === 'reasoning') {
            if (!caps.supportsReasoningPrefill && !caps.supportsReasoningContinuation) {
                return { ok: false, skippedReason: 'Reasoning prefill / reasoning continuation is not supported by the current adapter.', warnings };
            }
        } else if (mode === 'both') {
            if (!caps.supportsCombinedPrefill) {
                return { ok: false, skippedReason: 'Combined reasoning + content prefill is not supported by the current adapter.', warnings };
            }
        }
        return { ok: true, skippedReason: null, warnings };
    }

    normalizeCapabilities(caps) {
        return normalizeCapabilities(caps);
    }
}
