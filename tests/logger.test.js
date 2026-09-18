import { test } from 'node:test';
import assert from 'node:assert/strict';

import { redact, isSensitiveKey, safeStringify, Logger } from '../src/core/logger.js';

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

// ---------------------------------------------------------------------
// In-panel log ring buffer / subscribers
// ---------------------------------------------------------------------

test('debug entries only arrive while debug mode is enabled', () => {
    const logger = new Logger(() => false);
    const seen = [];
    logger.subscribe((entry) => seen.push(entry));
    logger.debug('hidden', { api_key: 'x' });
    logger.warn('visible warning');
    logger.error('visible error');
    assert.equal(seen.length, 2); // warn + error only
    assert.equal(seen[0].level, 'warn');
    assert.equal(seen[1].level, 'error');
});

test('debug entries arrive when enabled and payloads are redacted', () => {
    let enabled = false;
    const logger = new Logger(() => enabled);
    const seen = [];
    logger.subscribe((entry) => seen.push(entry));
    enabled = true;
    logger.debug('request', { headers: { Authorization: 'Bearer sk-secret' } });
    assert.equal(seen.length, 1);
    assert.equal(seen[0].level, 'debug');
    assert.equal(seen[0].text.includes('sk-secret'), false);
    assert.equal(seen[0].text.includes('[REDACTED]'), true);
});

test('ring buffer keeps a bounded snapshot and supports clear()', () => {
    const logger = new Logger(() => true, '[t]', { maxBuffer: 3 });
    logger.warn('1');
    logger.warn('2');
    logger.warn('3');
    logger.warn('4');
    const buf = logger.getBuffer();
    assert.equal(buf.length, 3);
    assert.equal(buf[0].text, '2');
    logger.clear();
    assert.equal(logger.getBuffer().length, 0);
});

test('formatArgs renders strings, objects and primitives', () => {
    const logger = new Logger(() => true);
    assert.equal(logger.formatArgs(['hello', 42, { a: 1 }, null, undefined]), 'hello 42 {"a":1} null undefined');
});
