import { test } from 'node:test';
import assert from 'node:assert/strict';

import { OllamaAdapter } from '../src/adapters/ollama-adapter.js';
import { MoonshotAdapter } from '../src/adapters/moonshot-adapter.js';
import { DeepSeekAdapter } from '../src/adapters/deepseek-adapter.js';
import { GenericOpenAIAdapter } from '../src/adapters/generic-openai-adapter.js';
import { CustomAdapter } from '../src/adapters/custom-adapter.js';
import { describeCapabilities } from '../src/core/capabilities.js';

const BOTH = { reasoning: 'AAA', content: 'BBB', mode: 'both', source: 'manual' };
const REASON_ONLY = { reasoning: 'AAA', content: '', mode: 'reasoning', source: 'manual' };
const CONTENT_ONLY = { reasoning: '', content: 'BBB', mode: 'content', source: 'manual' };

function makeRequest(overrides = {}) {
    return Object.assign({
        type: 'normal',
        messages: [{ role: 'user', content: 'Hi' }, { role: 'assistant', content: 'prefill' }],
        include_reasoning: false,
    }, overrides);
}

// ---------------------------------------------------------------------
// Ollama
// ---------------------------------------------------------------------

test('Ollama: combined prefill -> reasoning + content fields', () => {
    const adapter = new OllamaAdapter();
    const req = makeRequest();
    const detection = { provider: 'ollama', model: 'qwen3:8b' };
    const res = adapter.transformRequest(req, BOTH, detection, {});
    assert.equal(res.applied, true);
    const last = req.messages.at(-1);
    assert.equal(last.reasoning, 'AAA');
    assert.equal(last.content, 'BBB');
    assert.equal(last.reasoning_content, undefined);
    assert.equal(last.partial, undefined);
});

test('Ollama: content-only prefill needs no transformation', () => {
    const adapter = new OllamaAdapter();
    const req = makeRequest();
    const res = adapter.transformRequest(req, CONTENT_ONLY, { provider: 'ollama', model: 'qwen3:8b' }, {});
    assert.equal(res.applied, false);
    assert.equal(req.messages.at(-1).content, 'prefill');
});

test('Ollama: reasoning-only prefill is applied regardless of model id', () => {
    const adapter = new OllamaAdapter();
    const req = makeRequest();
    const res = adapter.transformRequest(req, REASON_ONLY, { provider: 'ollama', model: 'local-custom-70b' }, {});
    assert.equal(res.applied, true);
    assert.deepEqual({ reasoning: req.messages.at(-1).reasoning, content: req.messages.at(-1).content }, { reasoning: 'AAA', content: '' });
    // Informational note about thinking support is surfaced either via logger or warnings
    assert.ok(res.warnings.some((w) => /reasoning-only prefill/i.test(w)));
});

test('Ollama: defaults are enabled for any model (no model-name gating)', () => {
    const adapter = new OllamaAdapter();
    const caps = adapter.getCapabilities({ provider: 'ollama', model: 'llama3' });
    assert.equal(caps.supportsReasoningPrefill, true);
    assert.equal(caps.supportsCombinedPrefill, true);
    assert.equal(caps.reasoningContinuationExperimental, true);
});

test('Ollama: validation skips when tools are present', () => {
    const adapter = new OllamaAdapter();
    const req = makeRequest({ tools: [{ type: 'function', function: { name: 'f' } }] });
    const v = adapter.validate({ provider: 'ollama', model: 'qwen3:8b' }, req, BOTH);
    assert.equal(v.ok, false);
    assert.match(v.skippedReason, /tools/i);
});

// ---------------------------------------------------------------------
// Moonshot / Kimi
// ---------------------------------------------------------------------

test('Moonshot: combined prefill -> reasoning_content + partial', () => {
    const adapter = new MoonshotAdapter();
    const req = makeRequest();
    const res = adapter.transformRequest(req, BOTH, { provider: 'moonshot' }, { forceThinkingEnabled: true });
    assert.equal(res.applied, true);
    const last = req.messages.at(-1);
    assert.equal(last.reasoning_content, 'AAA');
    assert.equal(last.content, 'BBB');
    assert.equal(last.partial, true);
    assert.deepEqual(res.requestFields, { include_reasoning: true });
});

test('Moonshot: content-only becomes partial prefill', () => {
    const adapter = new MoonshotAdapter();
    const req = makeRequest();
    const res = adapter.transformRequest(req, CONTENT_ONLY, { provider: 'moonshot' }, {});
    assert.equal(res.applied, true);
    const last = req.messages.at(-1);
    assert.equal(last.content, 'BBB');
    assert.equal(last.partial, true);
    assert.equal(last.reasoning_content, undefined);
});

test('Moonshot: reasoning-only prefill (experimental warning)', () => {
    const adapter = new MoonshotAdapter();
    const req = makeRequest();
    const res = adapter.transformRequest(req, REASON_ONLY, { provider: 'moonshot' }, { forceThinkingEnabled: false });
    assert.equal(res.applied, true);
    const last = req.messages.at(-1);
    assert.equal(last.content, '');
    assert.equal(last.reasoning_content, 'AAA');
    assert.equal(last.partial, true);
    assert.ok(res.warnings.some((w) => /experimental/i.test(w)));
});

test('Moonshot: validation skips when structured output is active', () => {
    const adapter = new MoonshotAdapter();
    const req = makeRequest({ json_schema: { name: 'x', value: {} } });
    const v = adapter.validate({ provider: 'moonshot' }, req, BOTH);
    assert.equal(v.ok, false);
    assert.match(v.skippedReason, /structured/i);
});

test('Moonshot: capability declaration is explicit', () => {
    const adapter = new MoonshotAdapter();
    const caps = adapter.getCapabilities({});
    assert.equal(caps.supportsContentPrefill, true);
    assert.equal(caps.supportsReasoningPrefill, true);
    assert.equal(caps.supportsCombinedPrefill, true);
    assert.equal(caps.supportsReasoningContinuation, false);
    assert.equal(caps.reasoningContinuationExperimental, true);
    assert.equal(caps.supportsToolsWithPrefill, false);
});

// ---------------------------------------------------------------------
// DeepSeek
// ---------------------------------------------------------------------

test('DeepSeek: combined prefill -> reasoning_content + prefix', () => {
    const adapter = new DeepSeekAdapter();
    const req = makeRequest();
    const res = adapter.transformRequest(req, BOTH, { provider: 'deepseek' }, { forceThinkingEnabled: false });
    assert.equal(res.applied, true);
    const last = req.messages.at(-1);
    assert.equal(last.reasoning_content, 'AAA');
    assert.equal(last.content, 'BBB');
    assert.equal(last.prefix, true);
});

test('DeepSeek: content-only prefill gets prefix=true', () => {
    const adapter = new DeepSeekAdapter();
    const req = makeRequest();
    const res = adapter.transformRequest(req, CONTENT_ONLY, { provider: 'deepseek' }, {});
    assert.equal(res.applied, true);
    assert.equal(req.messages.at(-1).prefix, true);
});

test('DeepSeek: warns when custom base URL is not the beta endpoint', () => {
    const adapter = new DeepSeekAdapter();
    const req = makeRequest({ custom_url: 'https://api.deepseek.com' });
    const res = adapter.transformRequest(req, BOTH, { provider: 'deepseek' }, { forceThinkingEnabled: false, deepseekAutoBetaEndpoint: false });
    assert.equal(res.applied, true);
    assert.ok(res.warnings.some((w) => /beta/i.test(w)));
    assert.equal(req.custom_url, 'https://api.deepseek.com'); // never silently changed
});

test('DeepSeek: auto-adjusts base URL to beta only when enabled', () => {
    const adapter = new DeepSeekAdapter();
    const req = makeRequest({ custom_url: 'https://api.deepseek.com/v1' });
    const res = adapter.transformRequest(req, BOTH, { provider: 'deepseek' }, { forceThinkingEnabled: false, deepseekAutoBetaEndpoint: true });
    assert.equal(req.custom_url, 'https://api.deepseek.com/beta/v1');
    assert.ok(res.warnings.some((w) => /beta endpoint/i.test(w)));
});

test('DeepSeek: native ST source (already beta) produces no URL warning', () => {
    const adapter = new DeepSeekAdapter();
    const req = makeRequest({ custom_url: 'https://api.deepseek.com/beta' });
    const res = adapter.transformRequest(req, BOTH, { provider: 'deepseek' }, { forceThinkingEnabled: false, deepseekAutoBetaEndpoint: true });
    assert.equal(req.custom_url, 'https://api.deepseek.com/beta');
    assert.equal(res.warnings.filter((w) => /beta/i.test(w)).length, 0);
});

// ---------------------------------------------------------------------
// Generic OpenAI
// ---------------------------------------------------------------------

test('Generic: content-only prefill is preserved cleanly', () => {
    const adapter = new GenericOpenAIAdapter();
    const req = makeRequest();
    const res = adapter.transformRequest(req, CONTENT_ONLY, { provider: 'generic' }, {});
    assert.equal(res.applied, true);
    const last = req.messages.at(-1);
    assert.deepEqual(last, { role: 'assistant', content: 'BBB' });
});

test('Generic: combined prefill keeps content only and warns', () => {
    const adapter = new GenericOpenAIAdapter();
    const req = makeRequest();
    const res = adapter.transformRequest(req, BOTH, { provider: 'generic' }, {});
    assert.equal(res.applied, true);
    assert.deepEqual(req.messages.at(-1), { role: 'assistant', content: 'BBB' });
    assert.ok(res.warnings.some((w) => /reasoning/i.test(w)));
});

test('Generic: reasoning-only prefill is skipped (unsupported)', () => {
    const adapter = new GenericOpenAIAdapter();
    const req = makeRequest();
    const res = adapter.transformRequest(req, REASON_ONLY, { provider: 'generic' }, {});
    assert.equal(res.applied, false);
    assert.match(res.skippedReason, /reasoning prefill is not supported/i);
});

test('Generic: validate() rejects reasoning prefill', () => {
    const adapter = new GenericOpenAIAdapter();
    const v = adapter.validate({ provider: 'generic' }, makeRequest(), REASON_ONLY);
    assert.equal(v.ok, false);
});

// ---------------------------------------------------------------------
// Custom
// ---------------------------------------------------------------------

const KIMI_PROFILE = {
    version: 1,
    id: 'p1',
    name: 'OpenRouter Kimi',
    reasoningField: 'reasoning_content',
    contentField: 'content',
    assistantFields: { partial: true },
    requestFields: { include_reasoning: true },
    capabilities: {
        supportsContentPrefill: true,
        supportsReasoningPrefill: true,
        supportsCombinedPrefill: true,
        supportsReasoningContinuation: false,
        reasoningContinuationExperimental: false,
        supportsToolsWithPrefill: false,
        supportsStructuredOutputWithPrefill: false,
    },
};

test('Custom: maps fields per profile for combined prefill', () => {
    const adapter = new CustomAdapter(KIMI_PROFILE);
    const req = makeRequest();
    const res = adapter.transformRequest(req, BOTH, { provider: 'custom' }, {});
    assert.equal(res.applied, true);
    const last = req.messages.at(-1);
    assert.deepEqual(last, { role: 'assistant', content: 'BBB', reasoning_content: 'AAA', partial: true });
    assert.deepEqual(res.requestFields, { include_reasoning: true });
});

test('Custom: request-level fields are applied to the payload', () => {
    const adapter = new CustomAdapter(KIMI_PROFILE);
    const req = makeRequest();
    adapter.transformRequest(req, BOTH, { provider: 'custom' }, {});
    assert.equal(req.include_reasoning, true);
});

test('Custom: skips when capabilities do not support the intent', () => {
    const profile = structuredClone(KIMI_PROFILE);
    profile.capabilities.supportsReasoningPrefill = false;
    profile.capabilities.supportsCombinedPrefill = false;
    const adapter = new CustomAdapter(profile);
    const req = makeRequest();
    const res = adapter.transformRequest(req, BOTH, { provider: 'custom' }, {});
    assert.equal(res.applied, false);
    assert.match(res.skippedReason, /combined prefill is not supported/i);
});

test('Custom: empty reasoning field is omitted', () => {
    const adapter = new CustomAdapter(KIMI_PROFILE);
    const req = makeRequest();
    const res = adapter.transformRequest(req, CONTENT_ONLY, { provider: 'custom' }, {});
    assert.equal(res.applied, true);
    const last = req.messages.at(-1);
    assert.equal(last.content, 'BBB');
    assert.equal(last.reasoning_content, undefined);
});

test('describeCapabilities renders a compact summary', () => {
    const adapter = new MoonshotAdapter();
    const summary = describeCapabilities(adapter.getCapabilities({}));
    assert.match(summary, /content:yes/);
    assert.match(summary, /reasoning:yes/);
    assert.match(summary, /continue:no*/);
});
