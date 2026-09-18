/**
 * Custom Profile editor UI.
 *
 * Implements the profile management buttons (New / Save / Save As / Rename /
 * Duplicate / Delete / Switch / Import / Export) with a Dirty State workflow:
 * unsaved edits are never dropped silently — switching shows
 * Save / Discard / Cancel.
 *
 * This module is browser-only (uses jQuery + DOM). It talks to the pure
 * ProfileManager, which does all the validation and persistence.
 */

import { CAPABILITY_KEYS } from '../core/capabilities.js';

const CAP_LABELS = Object.freeze({
    supportsContentPrefill: 'Supports Content Prefill',
    supportsReasoningPrefill: 'Supports Reasoning Prefill',
    supportsCombinedPrefill: 'Supports Combined Prefill',
    supportsReasoningContinuation: 'Supports Reasoning Continuation',
    reasoningContinuationExperimental: 'Reasoning Continuation Experimental',
    supportsToolsWithPrefill: 'Supports Tools with Prefill',
    supportsStructuredOutputWithPrefill: 'Supports Structured Output with Prefill',
});

export class ProfileEditor {
    /**
     * @param {object} deps
     * @param {import('../profiles/profile-manager.js').ProfileManager} deps.profileManager
     * @param {object} deps.logger
     */
    constructor({ profileManager, logger }) {
        this.pm = profileManager;
        this.logger = logger || { debug() {}, warn() {}, error() {} };
        this.root = null;
        this.sel = null;
    }

    mount(rootSelector) {
        this.root = $(rootSelector);
        this.bind();
        this.refresh();
    }

    bind() {
        const $ = window.$ || globalThis.$;
        this.sel = this.root.find('#tpa_custom_profile_select');

        this.sel.on('change', () => this.onProfileSelect(String(this.sel.val() || '')));

        this.root.find('#tpa_profile_new').on('click', () => this.onNew());
        this.root.find('#tpa_profile_save').on('click', () => this.onSave());
        this.root.find('#tpa_profile_save_as').on('click', () => this.onSaveAs());
        this.root.find('#tpa_profile_rename').on('click', () => this.onRename());
        this.root.find('#tpa_profile_duplicate').on('click', () => this.onDuplicate());
        this.root.find('#tpa_profile_delete').on('click', () => this.onDelete());
        this.root.find('#tpa_profile_import').on('click', () => this.onImport());
        this.root.find('#tpa_profile_export').on('click', () => this.onExport());

        // Draft field inputs.
        const inputMap = {
            '#tpa_profile_reasoning_field': (v) => ({ reasoningField: v }),
            '#tpa_profile_content_field': (v) => ({ contentField: v }),
            '#tpa_profile_assistant_fields': (v) => this.parseJsonPatch(v, 'assistantFields'),
            '#tpa_profile_request_fields': (v) => this.parseJsonPatch(v, 'requestFields'),
        };
        for (const [selector, makePatch] of Object.entries(inputMap)) {
            this.root.find(selector).on('input', (e) => {
                const patch = makePatch($(e.target).val());
                if (patch && this.dirtyOk()) {
                    this.pm.updateDraft(patch);
                    this.updateDirtyUI();
                }
            });
        }

        // Capability checkboxes are rendered dynamically in renderDraft().
    }

    parseJsonPatch(value, key) {
        const trimmed = String(value || '').trim();
        if (!trimmed) {
            return { [key]: {} };
        }
        try {
            const parsed = JSON.parse(trimmed);
            if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
                throw new Error('must be an object');
            }
            return { [key]: parsed };
        } catch (error) {
            this.showWarn(`${key} is not valid JSON: ${error.message}`);
            return null;
        }
    }

    dirtyOk() {
        // While editing a JSON field with a parse error we simply don't apply;
        // the request path still uses the last committed profile.
        return true;
    }

    // ------------------------------------------------------------------
    // Rendering
    // ------------------------------------------------------------------

    refresh() {
        this.refreshSelect();
        this.renderDraft();
        this.updateDirtyUI();
    }

    refreshSelect() {
        const profiles = this.pm.profiles();
        const activeId = this.pm.settings.get('selectedCustomProfileId');
        const options = profiles.map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`).join('');
        this.sel.html(options || '<option value="">(no profiles)</option>');
        if (activeId && profiles.some((p) => p.id === activeId)) {
            this.sel.val(activeId);
        } else {
            this.sel.val('');
        }
    }

    renderDraft() {
        const draft = this.pm.getDraft();
        this.root.find('#tpa_profile_reasoning_field').val(draft?.reasoningField ?? '');
        this.root.find('#tpa_profile_content_field').val(draft?.contentField ?? '');
        this.root.find('#tpa_profile_assistant_fields').val(prettyJson(draft?.assistantFields));
        this.root.find('#tpa_profile_request_fields').val(prettyJson(draft?.requestFields));

        const capsBox = this.root.find('#tpa_profile_capabilities');
        capsBox.empty();
        if (!draft) {
            capsBox.html('<div class="tpa-muted">Select or create a profile to edit capabilities.</div>');
            return;
        }
        const caps = draft.capabilities || {};
        for (const key of CAPABILITY_KEYS) {
            const checked = caps[key] === true;
            const row = $(`<div class="tpa-cap-row">
                <input type="checkbox" id="tpa_cap_${key}" ${checked ? 'checked' : ''} />
                <span class="tpa-cap-label">${CAP_LABELS[key] || key}</span>
                <span class="tpa-cap-badge">${key === 'reasoningContinuationExperimental' && caps.reasoningContinuationExperimental ? 'experimental' : ''}</span>
            </div>`);
            row.find('input').on('change', (e) => {
                const patch = { capabilities: { [key]: $(e.target).prop('checked') } };
                this.pm.updateDraft(patch);
                this.updateDirtyUI();
            });
            capsBox.append(row);
        }
    }

    updateDirtyUI() {
        const dirty = this.pm.isDirty();
        this.root.find('#tpa_profile_save').prop('disabled', !dirty);
        const nameEl = this.root.find('#tpa_profile_rename');
        // rename button acts on the draft; keep enabled when a draft exists
        nameEl.prop('disabled', !this.pm.getDraft());
        // Save As / Duplicate only make sense with an existing draft
        this.root.find('#tpa_profile_save_as').prop('disabled', !this.pm.getDraft());
        this.root.find('#tpa_profile_duplicate').prop('disabled', !this.pm.getDraft());
        // Show a dirty star next to the profile select label.
        const label = this.root.find('label').filter((i, el) => $(el).find('span').text().trim() === 'Custom Profile').first();
        label.find('.tpa-dirty-star').remove();
        if (dirty) {
            label.append('<span class="tpa-dirty-star"> *</span>');
        }
    }

    showWarn(message) {
        const el = this.root.find('#tpa_custom_warn');
        el.text(message);
        el.removeClass('hidden');
        clearTimeout(this._warnTimer);
        this._warnTimer = setTimeout(() => el.addClass('hidden'), 6000);
    }

    // ------------------------------------------------------------------
    // Actions
    // ------------------------------------------------------------------

    async onProfileSelect(id) {
        if (!id) {
            this.pm.select(null);
            this.refresh();
            return;
        }
        if (this.pm.isDirty()) {
            const decision = await this.askSaveDiscardCancel();
            if (decision === 'cancel') {
                this.refreshSelect(); // revert select
                return;
            }
            if (decision === 'save') {
                const res = this.pm.save();
                if (!res.ok) {
                    this.showWarn('Cannot save current profile before switching: ' + res.errors.join('; '));
                    this.refreshSelect();
                    return;
                }
            }
            // 'discard': continue
        }
        this.pm.select(id);
        this.refresh();
    }

    onNew() {
        this.pm.beginEdit(null);
        this.refreshSelect();
        this.renderDraft();
        this.updateDirtyUI();
    }

    onSave() {
        const res = this.pm.save();
        if (!res.ok) {
            this.showWarn('Save failed: ' + res.errors.join('; '));
            return;
        }
        this.refresh();
        this.logger.debug('Profile saved:', res.profile?.name);
    }

    async onSaveAs() {
        const name = await this.askName('Save As — profile name', this.pm.getDraft()?.name || 'New Profile');
        if (name === null) return;
        const res = this.pm.saveAs(name);
        if (!res.ok) {
            this.showWarn('Save As failed: ' + res.errors.join('; '));
            return;
        }
        this.refresh();
    }

    async onRename() {
        const draft = this.pm.getDraft();
        if (!draft) return;
        const name = await this.askName('Rename profile', draft.name);
        if (name === null) return;
        const res = this.pm.rename(name);
        if (!res.ok) {
            this.showWarn('Rename failed: ' + res.errors.join('; '));
            return;
        }
        this.refresh();
    }

    onDuplicate() {
        const res = this.pm.duplicate();
        if (!res.ok) {
            this.showWarn('Duplicate failed: ' + (res.errors || ['unknown']).join('; '));
            return;
        }
        this.refresh();
    }

    async onDelete() {
        const currentId = this.sel.val();
        if (!currentId) return;
        const ok = await this.askConfirm('Delete profile?', 'This profile will be removed. If this was the active profile, the plugin falls back to Generic.');
        if (!ok) return;
        const res = this.pm.delete(currentId);
        if (!res.ok) {
            this.showWarn('Delete failed: ' + (res.errors || []).join('; '));
            return;
        }
        this.refresh();
    }

    async onImport() {
        const json = await this.askJson('Import profile (JSON)', '');
        if (json === null) return;
        const res = this.pm.importProfile(json);
        if (!res.ok) {
            this.showWarn('Import failed: ' + res.errors.join('; '));
            return;
        }
        this.pm.select(res.profile.id);
        this.refresh();
        this.logger.debug('Profile imported:', res.profile.name);
    }

    async onExport() {
        const json = this.pm.exportProfile(this.sel.val() || undefined);
        if (json === null) {
            this.showWarn('Nothing to export.');
            return;
        }
        await this.askJson('Export profile (copy the JSON below)', json, true);
    }

    // ------------------------------------------------------------------
    // Dialogs (tiny jQuery modals — no ST Popup dependency)
    // ------------------------------------------------------------------

    askName(title, value) {
        return this.openModal({ title, body: `<input type="text" id="tpa_modal_input" class="text_pole" value="${escapeHtml(value || '')}" />`, buttons: [{ label: 'OK', value: 'ok', primary: true }, { label: 'Cancel', value: 'cancel' }] })
            .then((res) => res?.button === 'ok' ? (res.value || '').trim() : null);
    }

    askConfirm(title, message) {
        return this.openModal({ title, body: `<div>${escapeHtml(message)}</div>`, buttons: [{ label: 'Delete', value: 'yes' }, { label: 'Cancel', value: 'no' }] })
            .then((res) => res?.button === 'yes');
    }

    askSaveDiscardCancel() {
        return this.openModal({
            title: 'Unsaved profile changes',
            body: '<div>The current profile has unsaved changes. What do you want to do?</div>',
            buttons: [
                { label: 'Save', value: 'save', primary: true },
                { label: 'Discard', value: 'discard' },
                { label: 'Cancel', value: 'cancel' },
            ],
        }).then((res) => res?.button || 'cancel');
    }

    askJson(title, value, readOnly = false) {
        return this.openModal({
            title,
            body: `<textarea id="tpa_modal_json" rows="12" style="width:100%;font-family:monospace;" ${readOnly ? 'readonly' : ''}>${escapeHtml(value)}</textarea>`,
            buttons: [{ label: readOnly ? 'Close' : 'Import', value: 'ok', primary: true }, ...(readOnly ? [] : [{ label: 'Cancel', value: 'cancel' }])],
        }).then((res) => res?.button === 'ok' ? String(res?.value || '') : null);
    }

    /** Minimal modal; resolves with {button, value}. */
    openModal({ title, body, buttons }) {
        return new Promise((resolve) => {
            const overlay = $('<div class="tpa-modal-overlay"></div>');
            const box = $('<div class="tpa-modal"></div>');
            box.append(`<div class="tpa-modal-title">${escapeHtml(title)}</div>`);
            box.append(`<div class="tpa-modal-body">${body}</div>`);
            const btnRow = $('<div class="tpa-modal-buttons"></div>');
            for (const btn of buttons) {
                const el = $(`<button class="tpa-modal-btn tpa-btn menu_button ${btn.primary ? 'primary' : ''}">${escapeHtml(btn.label)}</button>`);
                el.on('click', () => {
                    let value;
                    const input = box.find('#tpa_modal_input').val();
                    const textarea = box.find('#tpa_modal_json').val();
                    value = textarea !== undefined && box.find('#tpa_modal_json').length ? textarea : input;
                    close({ button: btn.value, value: value ?? '' });
                });
                btnRow.append(el);
            }
            box.append(btnRow);
            overlay.append(box);
            overlay.on('click', (e) => { if (e.target === overlay[0]) close({ button: 'cancel', value: '' }); });
            $('body').append(overlay);
            box.find('input, textarea').first().trigger('focus');

            function close(result) {
                overlay.remove();
                resolve(result);
            }
        });
    }
}

function escapeHtml(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function prettyJson(obj) {
    if (obj === undefined || obj === null) return '';
    try {
        return JSON.stringify(obj, null, 2);
    } catch {
        return String(obj);
    }
}
