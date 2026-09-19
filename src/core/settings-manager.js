/**
 * Settings Manager.
 *
 * All plugin settings are persisted in SillyTavern's official extension
 * settings storage (`extension_settings[EXTENSION_NAME]`). This class wraps a
 * plain "namespace" object so it works both in the browser (fed with
 * `extension_settings[EXTENSION_NAME]`) and in unit tests (fed with a plain
 * object).
 *
 * Persistence itself (saveSettingsDebounced) is done by the caller in
 * index.js through `onSave` — this module never touches SillyTavern globals.
 */

export const SETTINGS_KEY = 'TavernPrefillAdapter';

export const DEFAULT_SETTINGS = Object.freeze({
    // Master switch. Off mode = SillyTavern raw behavior, no extra fields.
    enabled: true,

    // 'auto' | 'ollama' | 'moonshot' | 'deepseek' | 'generic' | 'custom'
    provider: 'auto',

    // 'auto' | 'manual'
    mode: 'auto',

    // Auto parsing tags.
    reasoningStartTag: '<think>',
    reasoningEndTag: '<content>',

    // Manual mode prefills.
    manualReasoning: '',
    manualContent: '',

    // Custom profile management.
    selectedCustomProfileId: null,
    customProfiles: [],

    // Advanced.
    preserveHistoricalReasoning: false,
    // When applying a reasoning prefill, make sure the request actually asks
    // for thinking (include_reasoning). Mirrors KimiThinkingPrefill behavior.
    forceThinkingEnabled: true,
    // Allow silently adjusting api.deepseek.com (non-beta) custom URLs to the
    // beta endpoint required for prefix completion. Off by default.
    deepseekAutoBetaEndpoint: false,

    // Debug.
    debug: false,
});

export class SettingsManager {
    /**
     * @param {object} store The namespace object to read/write settings from.
     *                       In ST: extension_settings[SETTINGS_KEY] (created if missing).
     * @param {(fn?: (settings:object)=>void) => void} [onSave] Called when settings change;
     *                       default no-op (browser wires saveSettingsDebounced here).
     */
    constructor(store, onSave = () => {}) {
        this.store = store || {};
        this.onSave = onSave;
        this.listeners = new Set();
        this.applyDefaults();
    }

    /** Creates a fresh SettingsManager over a new empty object (tests / defaults). */
    static createDefault(onSave = () => {}) {
        return new SettingsManager({}, onSave);
    }

    /** Ensures every default key is present. Preserves existing user values. */
    applyDefaults() {
        if (!this.store || typeof this.store !== 'object') {
            this.store = {};
        }
        let changed = false;
        for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
            if (!Object.prototype.hasOwnProperty.call(this.store, key)) {
                this.store[key] = structuredClone(value);
                changed = true;
            }
        }
        if (changed) {
            this.notify();
        }
        return this;
    }

    /**
     * Returns the whole settings object when called without arguments, or a
     * single key's value when called with a key.
     */
    get(key) {
        if (arguments.length === 0 || key === undefined) {
            return this.store;
        }
        return this.store[key];
    }

    /** Sets a single key and persists. */
    set(key, value) {
        if (this.store[key] === value) {
            return this;
        }
        this.store[key] = value;
        this.persist();
        return this;
    }

    /** Sets several keys at once and persists once. */
    setAll(values) {
        let changed = false;
        for (const [key, value] of Object.entries(values)) {
            const old = this.store[key];
            const next = typeof value === 'object' && value !== null ? structuredClone(value) : value;
            if (JSON.stringify(old) !== JSON.stringify(next)) {
                this.store[key] = next;
                changed = true;
            }
        }
        if (changed) {
            this.persist();
        }
        return this;
    }

    /** Replaces the whole settings object (used by the clean-data hook). */
    resetToDefaults() {
        for (const key of Object.keys(this.store)) {
            delete this.store[key];
        }
        this.applyDefaults();
        this.persist();
        return this;
    }

    /** Persists current state (delegates to the browser save callback). */
    persist() {
        this.notify();
        try {
            this.onSave(this.store);
        } catch (error) {
            console.error('[Tavern Prefill Adapter] Settings save failed:', error);
        }
        return this;
    }

    /** Subscribes to settings changes. Returns an unsubscribe function. */
    subscribe(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    notify() {
        for (const listener of this.listeners) {
            try {
                listener(this.store);
            } catch (error) {
                console.error('[Tavern Prefill Adapter] Settings listener error:', error);
            }
        }
    }
}
