/**
 * Tavern Prefill Adapter — extension entry point.
 *
 * Hooks:
 *   - CHAT_COMPLETION_SETTINGS_READY: fires with the FINAL generate_data
 *     payload right before SillyTavern POSTs it to the backend
 *     (public/scripts/openai.js sendOpenAIRequest). This is the exact
 *     "request built, not yet sent" moment the extension targets.
 *   - GENERATION_STARTED / GENERATION_ENDED / GENERATION_STOPPED: tracks the
 *     generation type ('normal' | 'regenerate' | 'swipe' | 'continue' |
 *     'impersonate' | 'quiet' ...) so the transformer can decide which
 *     requests may carry a prefill.
 *
 * The transformer mutates ONLY the outgoing request copy — never the chat
 * history — and fails open on any error. When the extension is disabled the
 * handler returns before touching anything.
 */

import { extension_settings } from '../../../extensions.js';
import { saveSettingsDebounced } from '../../../../script.js';

import { SettingsManager } from './src/core/settings-manager.js';
import { Logger } from './src/core/logger.js';
import { transformChatCompletionRequest } from './src/core/request-transformer.js';
import { AdapterRegistry } from './src/adapters/index.js';
import { ProfileManager } from './src/profiles/profile-manager.js';
import { SettingsUI } from './src/ui/settings.js';
import { ProfileEditor } from './src/ui/profile-editor.js';

export const extensionName = 'TavernPrefillAdapter';
export const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`;

// ----------------------------------------------------------------------
// Settings / profiles / registry
// ----------------------------------------------------------------------

extension_settings[extensionName] ??= {};

const settingsManager = new SettingsManager(extension_settings[extensionName], () => {
    saveSettingsDebounced();
});

const profileManager = new ProfileManager(settingsManager);

const registry = new AdapterRegistry({
    getCustomProfile: () => profileManager.getActiveProfileForRequest(),
});

const logger = new Logger(() => Boolean(settingsManager.get('debug')));

// ----------------------------------------------------------------------
// Generation-type tracking
// ----------------------------------------------------------------------

let lastGenerationType = null;

// ----------------------------------------------------------------------
// Chat completion request hook
// ----------------------------------------------------------------------

/**
 * CHAT_COMPLETION_SETTINGS_READY handler.
 * @param {object} generateData The final outgoing payload
 */
function onChatCompletionSettingsReady(generateData) {
    transformChatCompletionRequest(generateData, {
        settings: settingsManager.get(),
        getGenerationType: () => lastGenerationType,
        getChat: () => {
            try {
                return SillyTavern.getContext().chat;
            } catch {
                return [];
            }
        },
        getCustomProfile: () => profileManager.getActiveProfileForRequest(),
        registry,
        logger,
    });
}

function onGenerationStarted(type) {
    lastGenerationType = typeof type === 'string' ? type : null;
}

function onGenerationStopped() {
    lastGenerationType = null;
}

// ----------------------------------------------------------------------
// Lifecycle hooks (manifest.json hooks → exported functions)
// ----------------------------------------------------------------------

export function onActivate() {
    // Nothing to do synchronously; the jQuery ready block wires the UI.
}

export function onEnable() {
    // Keep lastGenerationType consistent.
    lastGenerationType = null;
}

export function onDisable() {
    lastGenerationType = null;
}

export function onClean() {
    // Clean extension data button: reset to defaults.
    settingsManager.resetToDefaults();
}

// ----------------------------------------------------------------------
// UI bootstrap
// ----------------------------------------------------------------------

jQuery(async () => {
    settingsManager.applyDefaults();
    // Open the editing draft only when a profile is actually selected;
    // otherwise the editor starts blank (New Profile is created on demand).
    const selectedProfileId = settingsManager.get('selectedCustomProfileId');
    if (selectedProfileId && profileManager.findCommitted(selectedProfileId)) {
        profileManager.beginEdit(selectedProfileId);
    }

    const settingsHtml = await $.get(`${extensionFolderPath}/settings.html`);
    $('#extensions_settings').append(settingsHtml);

    const uiRoot = $('.tpa-settings').first();

    const settingsUI = new SettingsUI({
        settingsManager,
        profileManager,
        registry,
        logger,
        getChatCompletionSource: () => {
            try {
                return String(SillyTavern.getContext().chatCompletionSettings?.chat_completion_source || '');
            } catch {
                return '';
            }
        },
        getModel: () => {
            try {
                return String(SillyTavern.getContext().chatCompletionSettings?.openai_model || SillyTavern.getContext().chatCompletionSettings?.custom_model || '');
            } catch {
                return '';
            }
        },
    });
    settingsUI.mount(uiRoot);

    const profileEditor = new ProfileEditor({ profileManager, logger });
    profileEditor.mount(uiRoot);

    // ------------------------------------------------------------------
    // In-panel debug log viewer (visible inside the ST settings panel)
    // ------------------------------------------------------------------
    const logView = uiRoot.find('#tpa_log_view');
    const logPanel = uiRoot.find('#tpa_log_panel');
    const logDrawer = uiRoot.closest('.inline-drawer');
    const MAX_UI_LOG_LINES = 300;

    // Renders every buffered entry into the log view. Safe to call while the
    // drawer is collapsed (the container is simply display:none).
    const renderLogLine = (entry) => {
        const line = $('<div class="tpa-log-line"></div>').addClass('tpa-log-' + entry.level);
        $('<span class="tpa-log-time"></span>').text(entry.time).appendTo(line);
        // text() escapes HTML — log lines are never injected as markup.
        $('<span class="tpa-log-text"></span>').text(entry.text).appendTo(line);
        logView.append(line);
    };

    const renderLogBuffer = () => {
        if (!logView.length) return;
        logView.empty();
        const entries = logger.getBuffer().slice(-MAX_UI_LOG_LINES);
        for (const entry of entries) {
            renderLogLine(entry);
        }
        logView[0].scrollTop = logView[0].scrollHeight;
    };

    const renderLogVisibility = () => {
        logPanel.toggle(Boolean(settingsManager.get('debug')));
        if (settingsManager.get('debug')) {
            renderLogBuffer();
        }
    };

    logger.subscribe((entry) => {
        // Live path: only render while the panel is actually visible; the
        // buffer always keeps the entry, and renderLogBuffer() recovers it
        // whenever the panel becomes visible again.
        if (!logPanel.is(':visible') || !logView.length) {
            return;
        }
        renderLogLine(entry);
        while (logView.children().length > MAX_UI_LOG_LINES) {
            logView.children().first().remove();
        }
        logView[0].scrollTop = logView[0].scrollHeight;
    });
    settingsManager.subscribe(renderLogVisibility);
    // ST fires 'inline-drawer-toggle' when the settings drawer is expanded /
    // collapsed — re-render the full buffer so history appears after expanding.
    if (logDrawer.length) {
        logDrawer.on('inline-drawer-toggle', () => {
            if (settingsManager.get('debug')) {
                renderLogBuffer();
            }
        });
    }
    uiRoot.find('#tpa_log_clear').on('click', () => {
        logger.clear();
        logView.empty();
    });
    renderLogVisibility();
    // Initial render of buffered entries that arrived before the UI mounted.
    if (settingsManager.get('debug')) {
        renderLogBuffer();
    }

    const context = SillyTavern.getContext();
    const { eventSource, event_types } = context;

    eventSource.on(event_types.CHAT_COMPLETION_SETTINGS_READY, onChatCompletionSettingsReady);
    eventSource.on(event_types.GENERATION_STARTED, onGenerationStarted);
    eventSource.on(event_types.GENERATION_ENDED, onGenerationStopped);
    eventSource.on(event_types.GENERATION_STOPPED, onGenerationStopped);

    if (typeof context.registerDebugFunction === 'function') {
        context.registerDebugFunction(
            extensionName,
            'Tavern Prefill Adapter',
            'Enable Debug Mode; debug logs only ever show redacted payloads.',
            () => {
                settingsManager.set('debug', true);
                toastr.info('Tavern Prefill Adapter Debug Mode enabled. Logs are redacted.', extensionName);
            },
        );
    }

    logger.debug('Loaded.');
});
