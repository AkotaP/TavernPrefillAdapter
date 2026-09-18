/**
 * Custom Profile Manager.
 *
 * Multiple named, saved, switchable Custom Adapter profiles. All profiles are
 * persisted in SillyTavern Extension Settings (never memory-only).
 *
 * Editing model (Dirty State):
 *   - UI edits go into a `draft` (a deep copy of the committed profile).
 *   - `save()` validates the draft (strict!) and commits it back into
 *     settings.customProfiles.
 *   - Switching profiles while the draft is dirty requires a decision from
 *     the caller (Save / Discard / Cancel) — nothing is silently dropped.
 */

import { PROFILE_SCHEMA_VERSION } from './profile-validator.js';
import { migrateProfile } from './profile-migrations.js';
import { validateProfile, normalizeProfile } from './profile-validator.js';

function defaultId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return 'profile-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

export class ProfileManager {
    /**
     * @param {import('../core/settings-manager.js').SettingsManager} settingsManager
     * @param {object} [options]
     * @param {() => string} [options.generateId]
     */
    constructor(settingsManager, options = {}) {
        this.settings = settingsManager;
        this.generateId = options.generateId || defaultId;
        this.listeners = new Set();
        // Active editing draft. null when no profile is open.
        this.draft = null;
    }

    // ------------------------------------------------------------------
    // Read access
    // ------------------------------------------------------------------

    /** @returns {object[]} All committed profiles (deep copies). */
    profiles() {
        const list = this.settings.get('customProfiles') || [];
        return list.map((p) => structuredClone(p));
    }

    /** @returns {object|null} The committed active profile. */
    getActiveProfile() {
        const id = this.settings.get('selectedCustomProfileId');
        if (!id) return null;
        const list = this.settings.get('customProfiles') || [];
        const found = list.find((p) => p && p.id === id);
        return found ? structuredClone(found) : null;
    }

    /** @returns {object|null} Current editable draft (deep copy). */
    getDraft() {
        return this.draft ? structuredClone(this.draft) : null;
    }

    /** True when the draft differs from the committed profile (never silently lost). */
    isDirty() {
        if (!this.draft) return false;
        const committed = this.findCommitted(this.draft.id);
        if (!committed) return true; // new, unsaved profile
        return JSON.stringify(committed) !== JSON.stringify(this.draft);
    }

    findCommitted(id) {
        const list = this.settings.get('customProfiles') || [];
        return list.find((p) => p && p.id === id) || null;
    }

    // ------------------------------------------------------------------
    // Editing session
    // ------------------------------------------------------------------

    /** Opens an editing draft for the given profile id (or a new profile). */
    beginEdit(id = null) {
        if (id) {
            const committed = this.findCommitted(id);
            this.draft = committed ? structuredClone(committed) : this.createEmptyProfile();
        } else {
            this.draft = this.createEmptyProfile();
        }
        this.notify();
        return this.getDraft();
    }

    /** Updates draft (caller passes partial values; deep-merged). */
    updateDraft(patch) {
        if (!this.draft) {
            this.draft = this.createEmptyProfile();
        }
        Object.assign(this.draft, structuredClone(patch));
        this.notify();
        return this.getDraft();
    }

    /** Reloads the draft from committed data (Discard). */
    discardEdit() {
        const id = this.draft?.id || this.settings.get('selectedCustomProfileId');
        this.beginEdit(id);
        return this.getDraft();
    }

    // ------------------------------------------------------------------
    // Lifecycle operations
    // ------------------------------------------------------------------

    createEmptyProfile() {
        return {
            version: PROFILE_SCHEMA_VERSION,
            id: this.generateId(),
            name: 'New Profile',
            reasoningField: 'reasoning_content',
            contentField: 'content',
            assistantFields: {},
            requestFields: {},
            capabilities: normalizeProfile({}).capabilities,
        };
    }

    /**
     * Validates and commits the current draft. On failure returns
     * { ok:false, errors } and persists nothing.
     * @returns {{ok:boolean, errors?: string[], profile?: object}}
     */
    save() {
        if (!this.draft) {
            return { ok: false, errors: ['No profile is being edited.'] };
        }
        const validation = validateProfile(this.draft);
        if (!validation.ok) {
            return { ok: false, errors: validation.errors };
        }
        const profile = validation.profile;
        this.upsertCommitted(profile);
        this.settings.set('selectedCustomProfileId', profile.id);
        this.draft = structuredClone(profile);
        this.notify();
        return { ok: true, profile: structuredClone(profile) };
    }

    /** Creates a NEW profile from the current draft (Save As). */
    saveAs(name = '') {
        if (!this.draft) {
            return { ok: false, errors: ['Nothing to save.'] };
        }
        const snapshot = structuredClone(this.draft);
        snapshot.id = this.generateId();
        if (String(name).trim()) {
            snapshot.name = String(name).trim();
        }
        const validation = validateProfile(snapshot);
        if (!validation.ok) {
            return { ok: false, errors: validation.errors };
        }
        const profile = validation.profile;
        this.appendCommitted(profile);
        this.settings.set('selectedCustomProfileId', profile.id);
        this.draft = structuredClone(profile);
        this.notify();
        return { ok: true, profile: structuredClone(profile) };
    }

    /** Renames the active draft (immediate, no validation barrier). */
    rename(name) {
        if (!this.draft) return { ok: false, errors: ['Nothing to rename.'] };
        const trimmed = String(name || '').trim();
        if (!trimmed) {
            return { ok: false, errors: ['Name must be non-empty.'] };
        }
        this.draft.name = trimmed;
        this.notify();
        return { ok: true, draft: this.getDraft() };
    }

    /** Duplicates the current draft into a new profile (same fields, new id). */
    duplicate() {
        if (!this.draft) {
            return { ok: false, errors: ['Nothing to duplicate.'] };
        }
        const copy = structuredClone(this.draft);
        copy.id = this.generateId();
        copy.name = copy.name + ' (Copy)';
        this.appendCommitted(copy);
        this.settings.set('selectedCustomProfileId', copy.id);
        this.draft = structuredClone(copy);
        this.notify();
        return { ok: true, profile: structuredClone(copy) };
    }

    /**
     * Deletes a profile. Deleting the currently selected profile safely falls
     * back to no custom profile (Generic) — never a crash.
     * @returns {{ok:boolean, errors?: string[]}}
     */
    delete(id = this.settings.get('selectedCustomProfileId')) {
        const list = (this.settings.get('customProfiles') || []).slice();
        const idx = list.findIndex((p) => p && p.id === id);
        if (idx === -1) {
            return { ok: false, errors: ['Profile not found.'] };
        }
        list.splice(idx, 1);
        this.settings.set('customProfiles', list);
        if (this.settings.get('selectedCustomProfileId') === id) {
            this.settings.set('selectedCustomProfileId', null);
        }
        if (this.draft?.id === id) {
            this.draft = null;
        }
        this.notify();
        return { ok: true };
    }

    /** Switches the active profile. */
    select(id) {
        if (id && !this.findCommitted(id)) {
            return { ok: false, errors: ['Profile not found.'] };
        }
        this.settings.set('selectedCustomProfileId', id || null);
        this.beginEdit(id || this.settings.get('selectedCustomProfileId'));
        this.notify();
        return { ok: true };
    }

    // ------------------------------------------------------------------
    // Import / Export
    // ------------------------------------------------------------------

    /**
     * Imports a profile from a JSON string.
     * 1) parse, 2) validate schema, 3) check version, 4) check name/types,
     * 5) migrate. On id conflict a NEW id is generated instead of overwriting
     *    (unless overrideId=true).
     * @returns {{ok:boolean, errors?: string[], profile?: object}}
     */
    importProfile(json, { overrideId = false } = {}) {
        let raw;
        try {
            raw = JSON.parse(json);
        } catch {
            return { ok: false, errors: ['Invalid JSON: could not parse the profile.'] };
        }

        const validation = validateProfile(raw);
        if (!validation.ok) {
            return { ok: false, errors: validation.errors };
        }

        let profile = migrateProfile(validation.profile);
        // Re-validate the migrated result defensively.
        const migratedValidation = validateProfile(profile);
        if (!migratedValidation.ok) {
            return { ok: false, errors: ['Profile failed after migration.', ...migratedValidation.errors] };
        }
        profile = migratedValidation.profile;

        const conflict = this.findCommitted(profile.id);
        if (conflict && !overrideId) {
            // ID conflict: generate a NEW id instead of overwriting.
            profile.id = this.generateId();
            this.appendCommitted(profile);
        } else if (conflict && overrideId) {
            // Explicit user choice to overwrite.
            this.upsertCommitted(profile);
        } else {
            this.appendCommitted(profile);
        }
        this.notify();
        return { ok: true, profile: structuredClone(profile) };
    }

    /** @returns {string} JSON string of a committed profile (or of the draft). */
    exportProfile(id = this.settings.get('selectedCustomProfileId')) {
        const profile = id ? this.findCommitted(id) : this.draft;
        if (!profile) return null;
        return JSON.stringify(profile, null, 2);
    }

    /** Exports ALL profiles as a JSON array string (future-friendly). */
    exportAllProfiles() {
        return JSON.stringify(this.profiles(), null, 2);
    }

    /** Imports ALL profiles from a JSON array string. */
    importAllProfiles(json) {
        let raw;
        try {
            raw = JSON.parse(json);
        } catch {
            return { ok: false, errors: ['Invalid JSON: could not parse the profiles.'] };
        }
        if (!Array.isArray(raw)) {
            return { ok: false, errors: ['Expected a JSON array of profiles.'] };
        }
        const errors = [];
        let imported = 0;
        for (const entry of raw) {
            const validation = validateProfile(entry);
            if (!validation.ok) {
                errors.push(...validation.errors.map((e) => `${entry?.name || '(unnamed)'}: ${e}`));
                continue;
            }
            let profile = migrateProfile(validation.profile);
            if (this.findCommitted(profile.id)) {
                profile.id = this.generateId();
            }
            this.appendCommitted(profile);
            imported++;
        }
        this.notify();
        return { ok: imported > 0, errors, imported };
    }

    // ------------------------------------------------------------------
    // Internal persistence helpers
    // ------------------------------------------------------------------

    upsertCommitted(profile) {
        const list = (this.settings.get('customProfiles') || []).slice();
        const idx = list.findIndex((p) => p && p.id === profile.id);
        if (idx === -1) {
            list.push(profile);
        } else {
            list[idx] = profile;
        }
        this.settings.set('customProfiles', list);
    }

    appendCommitted(profile) {
        const list = (this.settings.get('customProfiles') || []).slice();
        list.push(profile);
        this.settings.set('customProfiles', list);
    }

    /** @returns {object|null} The draft to be used by requests (never the live settings draft). */
    getActiveProfileForRequest() {
        // Important: the adapter must see the last COMMITTED profile, not the
        // edited-but-unsaved draft, so unsaved edits never leak into requests.
        return this.getActiveProfile();
    }

    subscribe(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    notify() {
        for (const listener of this.listeners) {
            try {
                listener(this);
            } catch (error) {
                console.error('[Tavern Prefill Adapter] Profile listener error:', error);
            }
        }
    }
}
