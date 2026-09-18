import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SettingsManager } from '../src/core/settings-manager.js';
import { ProfileManager } from '../src/profiles/profile-manager.js';

function makeManager() {
    const sm = new SettingsManager({}, () => {});
    let seq = 0;
    const pm = new ProfileManager(sm, { generateId: () => 'id-' + (++seq) });
    return { sm, pm };
}

const KIMI = {
    version: 1, id: 'id-1', name: 'OpenRouter Kimi',
    reasoningField: 'reasoning_content',
    contentField: 'content',
    assistantFields: { partial: true },
    requestFields: { include_reasoning: true },
    capabilities: { supportsContentPrefill: true, supportsReasoningPrefill: true },
};

test('create + save persists and selects the profile', () => {
    const { sm, pm } = makeManager();
    pm.beginEdit();
    assert.equal(pm.isDirty(), true);
    pm.updateDraft({ name: 'New Profile' });
    const res = pm.save();
    assert.equal(res.ok, true);
    assert.equal(sm.get('selectedCustomProfileId'), 'id-1');
    assert.equal(sm.get('customProfiles').length, 1);
    assert.equal(pm.isDirty(), false);
});

test('save validates and refuses invalid drafts', () => {
    const { pm } = makeManager();
    pm.beginEdit();
    pm.updateDraft({ assistantFields: [1, 2] });
    const res = pm.save();
    assert.equal(res.ok, false);
    assert.ok(res.errors.length > 0);
    // Nothing persisted
    assert.equal(pm.profiles().length, 0);
});

test('saveAs creates a second profile from the current draft', () => {
    const { pm } = makeManager();
    pm.beginEdit();
    pm.updateDraft(KIMI);
    pm.save();
    const res = pm.saveAs('Another');
    assert.equal(res.ok, true);
    assert.equal(res.profile.id, 'id-2');
    assert.equal(pm.profiles().length, 2);
    assert.equal(smGet(pm, 'selectedCustomProfileId'), 'id-2');
});

function smGet(pm, key) {
    return pm.settings.get(key);
}

test('rename works on the draft and keeps name on save', () => {
    const { pm } = makeManager();
    pm.beginEdit();
    pm.updateDraft(KIMI);
    pm.save();
    pm.beginEdit('id-1');
    const res = pm.rename('Renamed');
    assert.equal(res.ok, true);
    assert.equal(pm.getDraft().name, 'Renamed');
    pm.save();
    assert.equal(pm.getActiveProfile().name, 'Renamed');
});

test('duplicate copies the profile with a new id', () => {
    const { pm } = makeManager();
    pm.beginEdit();
    pm.updateDraft(KIMI);
    pm.save();
    const res = pm.duplicate();
    assert.equal(res.ok, true);
    assert.equal(res.profile.id, 'id-2');
    assert.equal(pm.profiles().length, 2);
    assert.notEqual(pm.profiles()[0].id, pm.profiles()[1].id);
});

test('delete removes a profile', () => {
    const { pm } = makeManager();
    pm.beginEdit();
    pm.updateDraft(KIMI);
    pm.save();
    const res = pm.delete('id-1');
    assert.equal(res.ok, true);
    assert.equal(pm.profiles().length, 0);
});

test('deleting the active profile falls back to Generic (no crash)', () => {
    const { pm } = makeManager();
    pm.beginEdit();
    pm.updateDraft(KIMI);
    pm.save();
    assert.equal(smGet(pm, 'selectedCustomProfileId'), 'id-1');
    const res = pm.delete('id-1');
    assert.equal(res.ok, true);
    assert.equal(smGet(pm, 'selectedCustomProfileId'), null);
    assert.equal(pm.getActiveProfile(), null);
});

test('switch selects another profile', () => {
    const { pm } = makeManager();
    pm.beginEdit();
    pm.updateDraft(KIMI);
    pm.save();
    pm.saveAs('Second');
    pm.select('id-1');
    assert.equal(smGet(pm, 'selectedCustomProfileId'), 'id-1');
    assert.equal(pm.getActiveProfile().name, 'OpenRouter Kimi');
});

test('dirty state is tracked', () => {
    const { pm } = makeManager();
    pm.beginEdit();
    pm.updateDraft(KIMI);
    pm.save();
    assert.equal(pm.isDirty(), false);
    pm.beginEdit('id-1');
    assert.equal(pm.isDirty(), false);
    pm.updateDraft({ name: 'Changed but not saved' });
    assert.equal(pm.isDirty(), true);
    pm.discardEdit();
    // discarding reloads the committed profile; name change is gone
    assert.equal(pm.isDirty(), false);
    // The edit was NOT persisted
    assert.notEqual(pm.getActiveProfile().name, 'Changed but not saved');
});

test('import: invalid JSON fails safely', () => {
    const { pm } = makeManager();
    const res = pm.importProfile('{not json');
    assert.equal(res.ok, false);
    assert.equal(pm.profiles().length, 0);
});

test('import: missing version fails safe', () => {
    const { pm } = makeManager();
    const res = pm.importProfile(JSON.stringify({ name: 'X' }));
    assert.equal(res.ok, false);
    assert.equal(pm.profiles().length, 0);
});

test('import: valid profile lands, id conflict gets a fresh id', () => {
    const { pm } = makeManager();
    pm.beginEdit();
    pm.updateDraft(KIMI);
    pm.save();

    const res = pm.importProfile(JSON.stringify(KIMI));
    assert.equal(res.ok, true);
    assert.notEqual(res.profile.id, 'id-1'); // conflict -> new id
    assert.equal(pm.profiles().length, 2);
    // Original untouched
    assert.ok(pm.profiles().some((p) => p.id === 'id-1' && p.name === 'OpenRouter Kimi'));
});

test('import: overrideId permits replacing on conflict', () => {
    const { pm } = makeManager();
    pm.beginEdit();
    pm.updateDraft(KIMI);
    pm.save();

    const kimi2 = { ...KIMI, name: 'Kimi v2' };
    const res = pm.importProfile(JSON.stringify(kimi2), { overrideId: true });
    assert.equal(res.ok, true);
    assert.equal(res.profile.id, 'id-1');
    assert.equal(pm.profiles().length, 1);
    assert.equal(pm.profiles()[0].name, 'Kimi v2');
});

test('export returns JSON and round-trips', () => {
    const { pm } = makeManager();
    pm.beginEdit();
    pm.updateDraft(KIMI);
    pm.save();
    const json = pm.exportProfile('id-1');
    const parsed = JSON.parse(json);
    assert.equal(parsed.name, 'OpenRouter Kimi');
});

test('export all / import all', () => {
    const { pm } = makeManager();
    pm.beginEdit();
    pm.updateDraft(KIMI);
    pm.save();
    pm.saveAs('Second');

    const { pm: pm2 } = makeManager();
    const res = pm2.importAllProfiles(pm.exportAllProfiles());
    assert.equal(res.ok, true);
    assert.equal(pm2.profiles().length, 2);
});

test('persistence survives a "restart" (new manager over the same store)', () => {
    const { sm, pm } = makeManager();
    pm.beginEdit();
    pm.updateDraft(KIMI);
    pm.save();

    // Simulate a browser reload: the store object is the same underlying
    // storage (extension_settings namespace).
    const pm2 = new ProfileManager(sm, { generateId: () => 'new-id' });
    assert.equal(pm2.profiles().length, 1);
    assert.equal(pm2.getActiveProfile().id, 'id-1');
});

test('getActiveProfileForRequest returns committed data, not unsaved drafts', () => {
    const { pm } = makeManager();
    pm.beginEdit();
    pm.updateDraft(KIMI);
    pm.save();
    pm.beginEdit('id-1');
    pm.updateDraft({ name: 'UNSAVED' });
    const forRequest = pm.getActiveProfileForRequest();
    assert.notEqual(forRequest.name, 'UNSAVED');
    assert.equal(forRequest.name, 'OpenRouter Kimi');
});
