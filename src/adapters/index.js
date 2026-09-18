/**
 * Adapter registry — resolves the concrete adapter for a detected provider.
 * Kept separate from the transformer so the adapter list is easy to extend.
 */

import { OllamaAdapter } from './ollama-adapter.js';
import { MoonshotAdapter } from './moonshot-adapter.js';
import { DeepSeekAdapter } from './deepseek-adapter.js';
import { GenericOpenAIAdapter } from './generic-openai-adapter.js';
import { CustomAdapter } from './custom-adapter.js';
import { PROVIDERS } from '../core/provider-detector.js';

export class AdapterRegistry {
    /**
     * @param {object} [options]
     * @param {() => object|null} [options.getCustomProfile] Provider of the
     *        currently selected custom profile (called lazily per request).
     */
    constructor(options = {}) {
        this.ollamaAdapter = new OllamaAdapter();
        this.moonshotAdapter = new MoonshotAdapter();
        this.deepseekAdapter = new DeepSeekAdapter();
        this.genericAdapter = new GenericOpenAIAdapter();
        this.getCustomProfile = options.getCustomProfile || (() => null);
        this.customAdapters = new WeakMap();
    }

    /**
     * Resolves the adapter for a detection result.
     * Returns null when no adapter should act (e.g. Claude, which SillyTavern
     * core already handles via its own assistant_prefill mechanism).
     * @param {object} detection Result of detectProvider()
     * @returns {object|null}
     */
    resolve(detection) {
        switch (detection?.provider) {
            case PROVIDERS.OLLAMA:
                return this.ollamaAdapter;
            case PROVIDERS.MOONSHOT:
                return this.moonshotAdapter;
            case PROVIDERS.DEEPSEEK:
                return this.deepseekAdapter;
            case PROVIDERS.GENERIC:
                return this.genericAdapter;
            case PROVIDERS.CUSTOM: {
                const profile = this.getCustomProfile();
                if (!profile) {
                    return this.genericAdapter;
                }
                // Cache by profile object identity so each request uses the
                // same adapter instance for a given committed profile.
                if (!this.customAdapters.has(profile)) {
                    this.customAdapters.set(profile, new CustomAdapter(profile));
                }
                return this.customAdapters.get(profile);
            }
            case PROVIDERS.CLAUDE:
            case PROVIDERS.SKIP:
            default:
                return null;
        }
    }

    /** All known adapters (used by the UI to render capability info). */
    all() {
        return [
            this.ollamaAdapter,
            this.moonshotAdapter,
            this.deepseekAdapter,
            this.genericAdapter,
        ];
    }
}
