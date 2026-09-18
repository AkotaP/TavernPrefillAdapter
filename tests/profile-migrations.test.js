import { test } from 'node:test';
import assert from 'node:assert/strict';

import { migrateProfile } from '../src/profiles/profile-migrations.js';
import { PROFILE_SCHEMA_VERSION } from '../src/profiles/profile-validator.js';

test('migrateProfile leaves current-version profiles untouched', () => {
    const profile = { version: PROFILE_SCHEMA_VERSION, id: 'a', name: 'X' };
    const out = migrateProfile(profile);
    assert.equal(out.version, PROFILE_SCHEMA_VERSION);
    assert.equal(out.name, 'X');
});

test('migrateProfile upgrades legacy (no version) to v1', () => {
    const out = migrateProfile({ name: 'Legacy', reasoningField: 'thinking' });
    assert.equal(out.version, 1);
    assert.equal(out.reasoningField, 'thinking');
});

test('migrateProfile does not touch newer versions (fail safe)', () => {
    const profile = { version: 99, name: 'future' };
    const out = migrateProfile(profile);
    assert.equal(out.version, 99);
});

test('migrateProfile handles garbage input', () => {
    assert.equal(migrateProfile(null), null);
    assert.equal(migrateProfile('x'), 'x');
    assert.equal(migrateProfile(undefined), undefined);
});
