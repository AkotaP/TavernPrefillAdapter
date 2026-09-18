/**
 * Shared helpers for unit tests (pure Node, no browser deps).
 */

import { SettingsManager } from '../src/core/settings-manager.js';

/**
 * Builds a SettingsManager over a fresh store with defaults + overrides.
 * @param {object} [overrides]
 * @returns {SettingsManager}
 */
export function makeSettings(overrides = {}) {
    const sm = new SettingsManager({}, () => {});
    sm.setAll(overrides);
    return sm;
}

/**
 * Builds a minimal SillyTavern-style generate_data payload.
 * @param {object} [overrides]
 * @returns {object}
 */
export function makeGenerateData(overrides = {}) {
    return Object.assign({
        type: 'normal',
        chat_completion_source: 'custom',
        model: 'test-model',
        messages: [
            { role: 'system', content: 'sys' },
            { role: 'user', content: 'Hello' },
        ],
        stream: true,
        include_reasoning: false,
        max_tokens: 512,
    }, overrides);
}

/**
 * Deep-freeze helper for "must not change" assertions.
 */
export function deepClone(value) {
    return JSON.parse(JSON.stringify(value));
}

export function assertDeepEqual(actual, expected, message) {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a !== e) {
        throw new Error(`${message || 'deep equal failed'}\n  actual:   ${a}\n  expected: ${e}`);
    }
}
