import { test } from 'node:test';
import assert from 'node:assert/strict';

import { redact, isSensitiveKey, safeStringify } from '../src/core/logger.js';

test('redacts API keys and tokens', () => {
    const input = {
        headers: { Authorization: 'Bearer sk-123', 'X-Api-Key': 'my-secret' },
        body: { api_key: 'abc', token: 'xyz', password: 'pwd', fine: 'ok' },
    };
    const out = redact(input);
    assert.equal(out.headers.Authorization, '[REDACTED]');
    assert.equal(out.headers['X-Api-Key'], '[REDACTED]');
    assert.equal(out.body.api_key, '[REDACTED]');
    assert.equal(out.body.token, '[REDACTED]');
    assert.equal(out.body.password, '[REDACTED]');
    assert.equal(out.body.fine, 'ok');
});

test('redacts deep nested secrets', () => {
    const out = redact({ a: { b: { c: { secret: 'shh' } } } });
    assert.equal(out.a.b.c.secret, '[REDACTED]');
});

test('handles circular references and functions', () => {
    const obj = { x: 1 };
    obj.self = obj;
    const out = redact(obj);
    assert.equal(out.self, '[circular]');

    const out2 = redact({ fn: () => {} });
    assert.equal(out2.fn, '[fn]');
});

test('isSensitiveKey', () => {
    assert.equal(isSensitiveKey('Authorization'), true);
    assert.equal(isSensitiveKey('custom_include_headers'), true);
    assert.equal(isSensitiveKey('cookie'), true);
    assert.equal(isSensitiveKey('proxy_password'), true);
    assert.equal(isSensitiveKey('content'), false);
});

test('safeStringify never throws on weird input', () => {
    const s = safeStringify({ headers: { Authorization: 'Bearer X' }, fn: () => {} });
    assert.match(s, /[REDACTED]/);
    assert.doesNotThrow(() => safeStringify(undefined));
});
