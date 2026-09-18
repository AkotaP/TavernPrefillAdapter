/**
 * Settings panel UI (main controls, dynamic state).
 *
 * Dynamic state rules (reference design §47):
 *   - Provider = Custom → show the Custom Profile section, hide otherwise.
 *   - Mode = Manual → show Manual Prefill inputs, hide Auto parsing section
 *     (and vice versa).
 *   - Capability warnings: when the effective adapter (for an explicit
 *     provider) does not support reasoning prefill, the Manual Reasoning
 *     textarea shows an "Unsupported by current adapter" notice.
 */

import { PROVIDERS, PROVIDER_LABELS } from '../core/provider-detector.js';
import { AdapterRegistry } from '../adapters/index.js';

export class SettingsUI {
    /**
     * @param {object} deps
     * @param {import('../core/settings-manager.js').SettingsManager} deps.settingsManager
     * @param {import('../profiles/profile-manager.js').ProfileManager} deps.profileManager
     * @param {AdapterRegistry} deps.registry
     * @param {object} deps.logger
     * @param {() => string} [deps.getChatCompletionSource] Reads the current ST source (for hints)
     * @param {() => string} [deps.getModel] Reads the current ST model id (for hints)
     */
    constructor({ settingsManager, profileManager, registry, logger, getChatCompletionSource, getModel }) {
        this.sm = settingsManager;
        this.pm = profileManager;
        this.registry = registry;
        this.logger = logger || { debug() {}, warn() {}, error() {} };
        this.getChatCompletionSource = getChatCompletionSource || (() => '');
        this.getModel = getModel || (() => '');
        this.root = null;
    }

    mount(rootSelector) {
        this.root = $(rootSelector);
        this.bind();
        this.load();
        this.updateDynamicState();
    }

    bind() {
        this.root.find('#tpa_enabled').on('change', (e) => {
            this.sm.set('enabled', $(e.target).prop('checked'));
            this.updateDynamicState();
        });
        this.root.find('#tpa_provider').on('change', (e) => {
            this.sm.set('provider', String($(e.target).val()));
            this.updateDynamicState();
        });
        this.root.find('#tpa_mode').on('change', (e) => {
            this.sm.set('mode', String($(e.target).val()));
            this.updateDynamicState();
        });
        this.root.find('#tpa_reasoning_start_tag').on('input', (e) => this.sm.set('reasoningStartTag', String($(e.target).val())));
        this.root.find('#tpa_reasoning_end_tag').on('input', (e) => this.sm.set('reasoningEndTag', String($(e.target).val())));
        this.root.find('#tpa_manual_reasoning').on('input', (e) => this.sm.set('manualReasoning', String($(e.target).val())));
        this.root.find('#tpa_manual_content').on('input', (e) => this.sm.set('manualContent', String($(e.target).val())));
        this.root.find('#tpa_preserve_reasoning').on('change', (e) => this.sm.set('preserveHistoricalReasoning', $(e.target).prop('checked')));
        this.root.find('#tpa_force_thinking').on('change', (e) => this.sm.set('forceThinkingEnabled', $(e.target).prop('checked')));
        this.root.find('#tpa_deepseek_beta').on('change', (e) => this.sm.set('deepseekAutoBetaEndpoint', $(e.target).prop('checked')));
        this.root.find('#tpa_debug').on('change', (e) => this.sm.set('debug', $(e.target).prop('checked')));

        this.sm.subscribe(() => this.updateDynamicState());
        this.pm.subscribe(() => this.updateDynamicState());
    }

    load() {
        const s = this.sm.get();
        this.root.find('#tpa_enabled').prop('checked', s.enabled);
        this.root.find('#tpa_provider').val(s.provider || 'auto');
        this.root.find('#tpa_mode').val(s.mode || 'auto');
        this.root.find('#tpa_reasoning_start_tag').val(s.reasoningStartTag);
        this.root.find('#tpa_reasoning_end_tag').val(s.reasoningEndTag);
        this.root.find('#tpa_manual_reasoning').val(s.manualReasoning);
        this.root.find('#tpa_manual_content').val(s.manualContent);
        this.root.find('#tpa_preserve_reasoning').prop('checked', s.preserveHistoricalReasoning);
        this.root.find('#tpa_force_thinking').prop('checked', s.forceThinkingEnabled);
        this.root.find('#tpa_deepseek_beta').prop('checked', s.deepseekAutoBetaEndpoint);
        this.root.find('#tpa_debug').prop('checked', s.debug);
    }

    updateDynamicState() {
        if (!this.root) return;
        const s = this.sm.get();

        // Section visibility.
        const provider = s.provider || 'auto';
        const mode = s.mode || 'auto';

        this.root.find('#tpa_auto_section').toggle(mode === 'auto');
        this.root.find('#tpa_manual_section').toggle(mode === 'manual');
        this.root.find('#tpa_custom_section').toggle(provider === PROVIDERS.CUSTOM);

        // Capability-aware manual hints.
        const warn = this.root.find('#tpa_manual_warn');
        warn.addClass('hidden');
        if (provider === PROVIDERS.MOONSHOT || provider === PROVIDERS.OLLAMA || provider === PROVIDERS.DEEPSEEK || provider === PROVIDERS.GENERIC) {
            const detection = {
                provider,
                model: this.getModel(),
                chatCompletionSource: this.getChatCompletionSource(),
            };
            const adapter = this.registry.resolve(detection);
            if (adapter) {
                const caps = adapter.getCapabilities(detection);
                const notes = [];
                if (!caps.supportsReasoningPrefill) {
                    notes.push('Reasoning prefill: Unsupported by the current adapter.');
                }
                if (caps.reasoningContinuationExperimental) {
                    notes.push('Reasoning-only prefill (reasoning continuation) is experimental for this provider/model.');
                }
                if (!caps.supportsToolsWithPrefill) {
                    notes.push('Prefill will be skipped while tools / function calling are active.');
                }
                if (!caps.supportsStructuredOutputWithPrefill) {
                    notes.push('Prefill will be skipped while structured output / JSON schema is active.');
                }
                if (notes.length) {
                    warn.html(notes.join('\n'));
                    warn.removeClass('hidden');
                }
                if (provider === PROVIDERS.DEEPSEEK) {
                    const extra = $('<div class="tpa-muted"></div>').text("Note: DeepSeek prefix completion requires the /beta endpoint. SillyTavern's DeepSeek source already targets https://api.deepseek.com/beta; for Custom-source relays enable the beta-adjust setting below if needed.");
                    if (!warn.find('.tpa-deepseek-note').length) warn.append(extra.addClass('tpa-deepseek-note'));
                }
            }
        }
    }
}
