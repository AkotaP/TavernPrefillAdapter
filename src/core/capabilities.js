/**
 * Capability system for Tavern Prefill Adapter.
 *
 * Every Provider Adapter explicitly declares what it can and cannot do.
 * The UI uses these declarations to disable unsupported widgets and to show
 * warnings; the request transformer uses them to decide whether a prefill
 * intent can be honored and to fail open (keep the original request) when it
 * cannot.
 */

export const CAPABILITY_KEYS = Object.freeze([
    'supportsContentPrefill',
    'supportsReasoningPrefill',
    'supportsCombinedPrefill',
    'supportsReasoningContinuation',
    'reasoningContinuationExperimental',
    'supportsToolsWithPrefill',
    'supportsStructuredOutputWithPrefill',
]);

/** The most conservative capability set. Used as the base for unknown adapters. */
export const DEFAULT_CAPABILITIES = Object.freeze({
    supportsContentPrefill: true,
    supportsReasoningPrefill: false,
    supportsCombinedPrefill: false,
    supportsReasoningContinuation: false,
    reasoningContinuationExperimental: false,
    supportsToolsWithPrefill: false,
    supportsStructuredOutputWithPrefill: false,
});

/**
 * Normalizes an arbitrary partial capability object into a full capability
 * object with boolean values. Unknown keys are dropped.
 * @param {object} [caps] Partial capability declaration
 * @returns {object} Full capability object
 */
export function normalizeCapabilities(caps = {}) {
    const result = { ...DEFAULT_CAPABILITIES };
    if (caps && typeof caps === 'object') {
        for (const key of CAPABILITY_KEYS) {
            if (typeof caps[key] === 'boolean') {
                result[key] = caps[key];
            }
        }
    }
    return result;
}

/**
 * Merges several capability objects (later wins for the same key).
 * @param {...object} caps Capability objects
 * @returns {object} Combined capability object
 */
export function mergeCapabilities(...caps) {
    const result = {};
    for (const c of caps) {
        Object.assign(result, normalizeCapabilities(c));
    }
    return normalizeCapabilities(result);
}

/**
 * Builds a short human-readable summary of a capability object, e.g. for
 * debug logs and for the settings panel capability legend.
 * @param {object} caps Capability object
 * @returns {string} e.g. "content:yes reasoning:yes combined:yes cont:no* tools:no structured:no"
 */
export function describeCapabilities(caps) {
    const c = normalizeCapabilities(caps);
    const flags = [
        ['content', c.supportsContentPrefill],
        ['reasoning', c.supportsReasoningPrefill],
        ['combined', c.supportsCombinedPrefill],
        ['continue', c.supportsReasoningContinuation],
        ['tools', c.supportsToolsWithPrefill],
        ['structured', c.supportsStructuredOutputWithPrefill],
    ];
    const parts = flags.map(([name, ok]) => ok ? name + ':yes' : name + ':no');
    if (c.reasoningContinuationExperimental) {
        const exp = parts.findIndex(x => x.startsWith('continue'));
        if (exp !== -1) parts[exp] += '*';
    }
    return parts.join(' ');
}
