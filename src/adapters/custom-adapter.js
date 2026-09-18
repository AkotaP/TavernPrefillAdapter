/**
 * Custom Adapter.
 *
 * Drives the user-defined Custom Profile system: users declare the reasoning
 * field name, content field name, assistant-level extra fields,
 * request-level extra fields and capabilities for any unknown provider.
 *
 * Example profile:
 *
 *   {
 *     reasoningField: "reasoning_content",
 *     contentField: "content",
 *     assistantFields: { partial: true },
 *     requestFields: { include_reasoning: true },
 *     capabilities: { supportsContentPrefill: true, ... },
 *   }
 *
 * produces:
 *
 *   messages: [{ role:"assistant", reasoning_content:"...", content:"...", partial:true }],
 *   include_reasoning: true
 *
 * Capability declarations are more important than field mapping: a field can
 * be *sent* without the provider actually honoring its *semantics*.
 */

import { BaseAdapter } from './base-adapter.js';

export class CustomAdapter extends BaseAdapter {
    constructor(profile = {}) {
        super();
        this.id = 'custom';
        this.label = 'Custom';
        this.profile = profile;
    }

    supports(detection) {
        return detection?.provider === 'custom';
    }

    /** @returns {object} A deep copy of the profile capabilities. */
    getCapabilities(detection) {
        return this.normalizeCapabilities(this.profile.capabilities || {});
    }

    validate(detection, request, prefill) {
        const caps = this.getCapabilities(detection);
        const guard = this.validateGuards(detection, request, caps);
        if (!guard.ok) return guard;
        return this.validatePrefillAgainstCapabilities(prefill, caps);
    }

    transformRequest(request, prefill, detection, options = {}) {
        const warnings = [];
        const caps = this.getCapabilities(detection);
        const mode = prefill?.mode;
        if (!mode) {
            return { applied: false, skippedReason: 'Nothing to prefill.', warnings };
        }

        if (mode === 'content' && !caps.supportsContentPrefill) {
            return { applied: false, skippedReason: 'Content prefill is not supported by this custom profile.', warnings };
        }
        if (mode === 'reasoning' && !caps.supportsReasoningPrefill && !caps.supportsReasoningContinuation) {
            return { applied: false, skippedReason: 'Reasoning prefill is not supported by this custom profile.', warnings };
        }
        if (mode === 'both' && !caps.supportsCombinedPrefill) {
            return { applied: false, skippedReason: 'Combined prefill is not supported by this custom profile.', warnings };
        }

        const profile = this.profile || {};
        const reasoningField = String(profile.reasoningField || 'reasoning_content');
        const contentField = String(profile.contentField || 'content');
        const assistantFields = (profile.assistantFields && typeof profile.assistantFields === 'object')
            ? { ...profile.assistantFields }
            : {};
        const requestFields = (profile.requestFields && typeof profile.requestFields === 'object')
            ? { ...profile.requestFields }
            : {};

        const message = { role: 'assistant' };
        // Only set non-empty fields to avoid invalid payloads.
        if (prefill.content) {
            message[contentField] = prefill.content;
        }
        if (prefill.reasoning) {
            message[reasoningField] = prefill.reasoning;
        }
        Object.assign(message, assistantFields);

        const last = request.messages?.[request.messages.length - 1];
        if (!last || last.role !== 'assistant') {
            return { applied: false, skippedReason: 'No trailing assistant message to transform.', warnings };
        }
        request.messages[request.messages.length - 1] = message;

        // Apply request-level extra fields.
        Object.assign(request, requestFields);

        if (mode === 'reasoning' && caps.reasoningContinuationExperimental) {
            warnings.push('This custom profile marks reasoning continuation as experimental; the provider may not continue the reasoning tail.');
        }

        const description = {};
        if (prefill.content) description[contentField] = '<content>';
        if (prefill.reasoning) description[reasoningField] = '<reasoning>';
        Object.assign(description, Object.fromEntries(Object.entries(assistantFields).map(([k, v]) => [k, JSON.stringify(v)])));

        return {
            applied: true,
            messageTransform: description,
            requestFields,
            warnings,
        };
    }
}
