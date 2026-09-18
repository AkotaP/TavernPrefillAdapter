/**
 * Profile Schema + Validation.
 *
 * Custom Adapter profiles are plain JSON objects with a schema version so the
 * plugin can migrate them later. Validation is strict on import and on save:
 * an invalid profile must NEVER overwrite existing configuration.
 */

import { CAPABILITY_KEYS } from '../core/capabilities.js';

export const PROFILE_SCHEMA_VERSION = 1;

export const PROFILE_DEFAULTS = Object.freeze({
    version: PROFILE_SCHEMA_VERSION,
    id: null,
    name: 'New Profile',
    reasoningField: 'reasoning_content',
    contentField: 'content',
    assistantFields: {},
    requestFields: {},
    capabilities: {
        supportsContentPrefill: true,
        supportsReasoningPrefill: true,
        supportsCombinedPrefill: true,
        supportsReasoningContinuation: false,
        reasoningContinuationExperimental: false,
        supportsToolsWithPrefill: false,
        supportsStructuredOutputWithPrefill: false,
    },
});

/**
 * Validates a raw imported/loaded profile object.
 * @param {unknown} raw
 * @returns {{ ok: boolean, errors: string[], profile: object|null }} On ok,
 *          profile is the NORMALIZED deep copy safe to store.
 */
export function validateProfile(raw) {
    const errors = [];

    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
        return { ok: false, errors: ['Profile must be a JSON object.'], profile: null };
    }

    if (typeof raw.version !== 'number' || raw.version < 1) {
        errors.push('Profile is missing a numeric schema "version".');
    }

    if (typeof raw.name !== 'string' || !raw.name.trim()) {
        errors.push('Profile name must be a non-empty string.');
    }

    if (raw.reasoningField !== undefined && typeof raw.reasoningField !== 'string') {
        errors.push('reasoningField must be a string.');
    }
    if (raw.contentField !== undefined && typeof raw.contentField !== 'string') {
        errors.push('contentField must be a string.');
    }

    if (raw.assistantFields !== undefined && (typeof raw.assistantFields !== 'object' || raw.assistantFields === null || Array.isArray(raw.assistantFields))) {
        errors.push('assistantFields must be an object.');
    }
    if (raw.requestFields !== undefined && (typeof raw.requestFields !== 'object' || raw.requestFields === null || Array.isArray(raw.requestFields))) {
        errors.push('requestFields must be an object.');
    }

    if (raw.capabilities !== undefined && (typeof raw.capabilities !== 'object' || raw.capabilities === null || Array.isArray(raw.capabilities))) {
        errors.push('capabilities must be an object.');
    } else if (raw.capabilities) {
        for (const key of CAPABILITY_KEYS) {
            if (raw.capabilities[key] !== undefined && typeof raw.capabilities[key] !== 'boolean') {
                errors.push(`capabilities.${key} must be a boolean.`);
            }
        }
    }

    if (raw.id !== undefined && raw.id !== null && typeof raw.id !== 'string') {
        errors.push('id must be a string.');
    }

    if (errors.length) {
        return { ok: false, errors, profile: null };
    }

    return { ok: true, errors: [], profile: normalizeProfile(raw) };
}

/**
 * Normalizes a (validated) profile to the canonical full shape.
 * @param {object} raw
 * @returns {object} Deep copy with defaults filled in.
 */
export function normalizeProfile(raw) {
    const caps = {};
    for (const key of CAPABILITY_KEYS) {
        caps[key] = typeof raw.capabilities?.[key] === 'boolean'
            ? raw.capabilities[key]
            : PROFILE_DEFAULTS.capabilities[key];
    }
    return {
        version: typeof raw.version === 'number' ? raw.version : PROFILE_SCHEMA_VERSION,
        id: typeof raw.id === 'string' && raw.id ? raw.id : null,
        name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : 'New Profile',
        reasoningField: typeof raw.reasoningField === 'string' && raw.reasoningField ? raw.reasoningField : 'reasoning_content',
        contentField: typeof raw.contentField === 'string' && raw.contentField ? raw.contentField : 'content',
        assistantFields: { ...(raw.assistantFields || {}) },
        requestFields: { ...(raw.requestFields || {}) },
        capabilities: caps,
    };
}
