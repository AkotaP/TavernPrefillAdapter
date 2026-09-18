import { test } from 'node:test';
import assert from 'node:assert/strict';

import { validateProfile } from '../src/profiles/profile-validator.js';

test('valid profile passes and normalizes', () => {
    const { ok, errors, profile } = validateProfile({
        version: 1,
        id: 'abc',
        name: 'OpenRouter Kimi',
        reasoningField: 'reasoning_content',
        contentField: 'content',
        assistantFields: { partial: true },
        requestFields: { include_reasoning: true },
        capabilities: { supportsContentPrefill: true },
    });
    assert.equal(ok, true);
    assert.deepEqual(errors, []);
    assert.equal(profile.name, 'OpenRouter Kimi');
    // Missing capability keys get defaults
    assert.equal(profile.capabilities.supportsContentPrefill, true);
    // Custom profiles are user-declared: defaults are permissive.
    assert.equal(profile.capabilities.supportsReasoningPrefill, true);
});

test('non-object input fails', () => {
    assert.equal(validateProfile(null).ok, false);
    assert.equal(validateProfile('nope').ok, false);
    assert.equal(validateProfile([]).ok, false);
    assert.equal(validateProfile(undefined).ok, false);
});

test('missing version fails', () => {
    const { ok, errors } = validateProfile({ name: 'X' });
    assert.equal(ok, false);
    assert.ok(errors.some((e) => /version/i.test(e)));
});

test('invalid capabilities type fails', () => {
    const { ok, errors } = validateProfile({ version: 1, name: 'X', capabilities: 'yes' });
    assert.equal(ok, false);
    assert.ok(errors.some((e) => /capabilities/i.test(e)));
});

test('non-boolean capability value fails', () => {
    const { ok, errors } = validateProfile({
        version: 1, name: 'X',
        capabilities: { supportsContentPrefill: 'true' },
    });
    assert.equal(ok, false);
    assert.ok(errors.some((e) => /capabilities\.supportsContentPrefill/i.test(e)));
});

test('assistantFields not an object fails', () => {
    const { ok, errors } = validateProfile({ version: 1, name: 'X', assistantFields: [1] });
    assert.equal(ok, false);
    assert.ok(errors.some((e) => /assistantFields/i.test(e)));
});

test('requestFields not an object fails', () => {
    const { ok } = validateProfile({ version: 1, name: 'X', requestFields: 'nope' });
    assert.equal(ok, false);
});

test('reasoningField not a string fails', () => {
    const { ok, errors } = validateProfile({ version: 1, name: 'X', reasoningField: 42 });
    assert.equal(ok, false);
    assert.ok(errors.some((e) => /reasoningField/i.test(e)));
});

test('missing name fails', () => {
    const { ok } = validateProfile({ version: 1, name: '  ' });
    assert.equal(ok, false);
});
