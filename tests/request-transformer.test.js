import { test } from 'node:test';
import assert from 'node:assert/strict';

import { transformChatCompletionRequest } from '../src/core/request-transformer.js';
import { AdapterRegistry } from '../src/adapters/index.js';
import { makeSettings, makeGenerateData, deepClone } from './helpers.js';

function run(generateData, settings, extra = {}) {
    const registry = extra.registry || new AdapterRegistry({ getCustomProfile: () => extra.profile || null });
    return transformChatCompletionRequest(generateData, {
        settings,
        getGenerationType: () => extra.type || generateData.type || 'normal',
        getChat: () => extra.chat || [],
        getCustomProfile: () => extra.profile || null,
        registry,
        logger: extra.logger,
    });
}

test('Off mode: request is byte-for-byte identical (no extra fields)', () => {
    const settings = makeSettings({ enabled: false, provider: 'moonshot', mode: 'manual', manualReasoning: 'x', manualContent: 'y' });
    const gd = makeGenerateData({ messages: [{ role: 'user', content: 'Hi' }] });
    const before = deepClone(gd);
    const out = run(gd, settings.get(), { type: 'normal' });
    assert.equal(out.changed, false);
    assert.deepEqual(gd, before);
});

test('Auto mode: moonshot trailing tagged prefill is transformed', () => {
    const settings = makeSettings({ provider: 'moonshot', mode: 'auto', forceThinkingEnabled: true });
    const gd = makeGenerateData({
        chat_completion_source: 'moonshot',
        model: 'kimi-k3',
        messages: [
            { role: 'system', content: 'sys' },
            { role: 'user', content: 'Hi' },
            { role: 'assistant', content: '<think>\n先分析一下\n<content>\n她犹豫了一下，' },
        ],
    });
    const out = run(gd, settings.get(), { type: 'normal' });
    assert.equal(out.changed, true);
    const last = gd.messages.at(-1);
    assert.equal(last.reasoning_content, '先分析一下');
    assert.equal(last.content, '她犹豫了一下，');
    assert.equal(last.partial, true);
    assert.equal(gd.include_reasoning, true);
    // History messages untouched
    assert.equal(gd.messages[0].content, 'sys');
    assert.equal(gd.messages[1].content, 'Hi');
});

test('Auto mode: plain content prefill needs no provider translation (request unchanged)', () => {
    const settings = makeSettings({ provider: 'moonshot', mode: 'auto' });
    const gd = makeGenerateData({
        chat_completion_source: 'moonshot',
        messages: [
            { role: 'user', content: 'Hi' },
            { role: 'assistant', content: '她轻轻推开门，' },
        ],
    });
    const before = deepClone(gd);
    const out = run(gd, settings.get(), { type: 'normal' });
    assert.equal(out.changed, false);
    assert.deepEqual(gd, before);
});

test('Auto mode: historical assistant messages with tags are NOT touched', () => {
    const settings = makeSettings({ provider: 'moonshot', mode: 'auto' });
    const gd = makeGenerateData({
        chat_completion_source: 'moonshot',
        messages: [
            { role: 'user', content: 'Hi' },
            // "history" assistant message that mentions the tag mid-text
            { role: 'assistant', content: 'HTML 里可以使用 <think> 标签。' },
        ],
    });
    const before = deepClone(gd);
    const out = run(gd, settings.get(), { type: 'normal' });
    assert.equal(out.changed, false);
    assert.deepEqual(gd, before);
});

test('Manual mode: ollama injection appends exactly one prefill message', () => {
    const settings = makeSettings({
        provider: 'ollama', mode: 'manual',
        manualReasoning: '先分析一下', manualContent: '她沉默了一会儿，',
    });
    const gd = makeGenerateData({
        chat_completion_source: 'custom',
        custom_url: 'http://localhost:11434/v1',
        model: 'qwen3:8b',
        messages: [
            { role: 'system', content: 'sys' },
            { role: 'user', content: 'Hi' },
        ],
    });
    const before = deepClone(gd);
    const out = run(gd, settings.get(), { type: 'normal' });
    assert.equal(out.changed, true);
    const assistantMsgs = gd.messages.filter((m) => m.role === 'assistant');
    assert.equal(assistantMsgs.length, 1, 'exactly one assistant prefill, never duplicated');
    assert.equal(assistantMsgs[0].reasoning, '先分析一下');
    assert.equal(assistantMsgs[0].content, '她沉默了一会儿，');
    // system + user unchanged
    assert.equal(gd.messages[0].content, before.messages[0].content);
    assert.equal(gd.messages[1].content, before.messages[1].content);
});

test('Manual mode: replaces an existing trailing assistant prefill (no duplication)', () => {
    const settings = makeSettings({ provider: 'moonshot', mode: 'manual', manualReasoning: 'R', manualContent: 'C' });
    const gd = makeGenerateData({
        chat_completion_source: 'moonshot',
        messages: [
            { role: 'user', content: 'Hi' },
            { role: 'assistant', content: 'st-prefill-content' },
        ],
    });
    const before = deepClone(gd);
    const out = run(gd, settings.get(), { type: 'normal' });
    assert.equal(out.changed, true);
    assert.equal(gd.messages.length, before.messages.length, 'replaced, not appended');
    const last = gd.messages.at(-1);
    assert.equal(last.content, 'C');
    assert.equal(last.reasoning_content, 'R');
});

test('Manual mode: custom profile maps fields and request extras', () => {
    const profile = {
        version: 1, id: 'p1', name: 'OpenRouter Kimi',
        reasoningField: 'reasoning_content', contentField: 'content',
        assistantFields: { partial: true },
        requestFields: { include_reasoning: true },
        capabilities: {
            supportsContentPrefill: true, supportsReasoningPrefill: true,
            supportsCombinedPrefill: true, supportsReasoningContinuation: false,
            reasoningContinuationExperimental: false,
            supportsToolsWithPrefill: false, supportsStructuredOutputWithPrefill: false,
        },
    };
    const settings = makeSettings({ provider: 'custom', mode: 'manual', manualReasoning: 'AAA', manualContent: 'BBB' });
    const gd = makeGenerateData({
        chat_completion_source: 'custom',
        custom_url: 'https://openrouter.ai/api/v1',
        messages: [{ role: 'user', content: 'Hi' }],
    });
    const out = run(gd, settings.get(), { type: 'normal', profile });
    assert.equal(out.changed, true);
    const last = gd.messages.at(-1);
    assert.deepEqual(last, { role: 'assistant', content: 'BBB', reasoning_content: 'AAA', partial: true });
    assert.equal(gd.include_reasoning, true);
});

test('Tools guard: prefill is skipped, request untouched', () => {
    const settings = makeSettings({ provider: 'moonshot', mode: 'manual', manualReasoning: 'R', manualContent: 'C' });
    const gd = makeGenerateData({
        chat_completion_source: 'moonshot',
        tools: [{ type: 'function', function: { name: 'f' } }],
        messages: [{ role: 'user', content: 'Hi' }],
    });
    const before = deepClone(gd);
    const out = run(gd, settings.get(), { type: 'normal' });
    assert.equal(out.changed, false);
    assert.deepEqual(gd, before);
    assert.match(out.skipped || '', /tools/i);
});

test('Structured output guard: prefill skipped', () => {
    const settings = makeSettings({ provider: 'moonshot', mode: 'manual', manualReasoning: 'R', manualContent: 'C' });
    const gd = makeGenerateData({
        chat_completion_source: 'moonshot',
        json_schema: { name: 'x', value: {} },
        messages: [{ role: 'user', content: 'Hi' }],
    });
    const before = deepClone(gd);
    const out = run(gd, settings.get(), { type: 'normal' });
    assert.equal(out.changed, false);
    assert.deepEqual(gd, before);
});

test('quiet generation type is skipped', () => {
    const settings = makeSettings({ provider: 'moonshot', mode: 'manual', manualReasoning: 'R', manualContent: 'C' });
    const gd = makeGenerateData({ chat_completion_source: 'moonshot', messages: [{ role: 'user', content: 'Hi' }] });
    const before = deepClone(gd);
    const out = run(gd, settings.get(), { type: 'quiet' });
    assert.equal(out.changed, false);
    assert.deepEqual(gd, before);
});

test('continue without reasoning tag is not treated as a prefill', () => {
    const settings = makeSettings({ provider: 'moonshot', mode: 'auto' });
    const gd = makeGenerateData({
        chat_completion_source: 'moonshot',
        messages: [
            { role: 'user', content: 'Hi' },
            { role: 'assistant', content: '她轻轻推开门，' },
        ],
    });
    const before = deepClone(gd);
    const out = run(gd, settings.get(), { type: 'continue' });
    assert.equal(out.changed, false);
    assert.deepEqual(gd, before);
});

test('continue with reasoning tag is transformed (continue-prefill compatibility)', () => {
    const settings = makeSettings({ provider: 'moonshot', mode: 'auto' });
    const gd = makeGenerateData({
        chat_completion_source: 'moonshot',
        messages: [
            { role: 'user', content: 'Hi' },
            { role: 'assistant', content: '<think>\n先分析一下' },
        ],
    });
    const out = run(gd, settings.get(), { type: 'continue' });
    assert.equal(out.changed, true);
    const last = gd.messages.at(-1);
    assert.equal(last.reasoning_content, '先分析一下');
    assert.equal(last.partial, true);
});

test('duplicate processing is prevented by the WeakSet marker', () => {
    const settings = makeSettings({ provider: 'moonshot', mode: 'manual', manualReasoning: 'R', manualContent: 'C' });
    const gd = makeGenerateData({ chat_completion_source: 'moonshot', messages: [{ role: 'user', content: 'Hi' }] });
    const out1 = run(gd, settings.get(), { type: 'normal' });
    assert.equal(out1.changed, true);
    const messagesAfterFirst = deepClone(gd.messages);
    const out2 = run(gd, settings.get(), { type: 'normal' });
    assert.equal(out2.changed, false);
    assert.match(out2.skipped || '', /already processed/i);
    // Not applied twice
    assert.deepEqual(gd.messages, messagesAfterFirst);
});

test('adapter errors fail open with the original request intact', () => {
    const settings = makeSettings({ provider: 'moonshot', mode: 'manual', manualReasoning: 'R', manualContent: 'C' });
    const gd = makeGenerateData({ chat_completion_source: 'moonshot', messages: [{ role: 'user', content: 'Hi' }] });
    const before = deepClone(gd);

    const registry = new AdapterRegistry({ getCustomProfile: () => null });
    const originalResolve = registry.resolve.bind(registry);
    registry.resolve = () => ({
        id: 'broken',
        getCapabilities: () => ({ supportsContentPrefill: true, supportsReasoningPrefill: true, supportsCombinedPrefill: true, supportsReasoningContinuation: true, reasoningContinuationExperimental: false, supportsToolsWithPrefill: true, supportsStructuredOutputWithPrefill: true }),
        validate: () => ({ ok: true, skippedReason: null, warnings: [] }),
        transformRequest: () => { throw new Error('boom'); },
        supports: () => true,
        label: 'Broken',
    });

    const out = run(gd, settings.get(), { type: 'normal', registry });
    assert.equal(out.changed, false);
    assert.match(out.error || '', /boom/);
    assert.deepEqual(gd, before);
});

test('historical reasoning re-attach (opt-in) works for moonshot', () => {
    const settings = makeSettings({
        provider: 'moonshot', mode: 'manual',
        manualContent: 'C', manualReasoning: '',
        preserveHistoricalReasoning: true, forceThinkingEnabled: true,
    });
    const chat = [
        { is_user: true, mes: 'hi' },
        { is_user: false, mes: 'first reply', extra: { reasoning: '历史思考一' } },
        { is_user: false, mes: 'second reply', extra: { reasoning: '历史思考二' } },
    ];
    const gd = makeGenerateData({
        chat_completion_source: 'moonshot',
        messages: [
            { role: 'system', content: 'sys' },
            { role: 'assistant', content: 'first reply' },
            { role: 'assistant', content: 'second reply' },
            { role: 'user', content: 'Hi' },
        ],
    });
    const out = run(gd, settings.get(), { type: 'normal', chat });
    assert.equal(out.changed, true);
    const assistants = gd.messages.filter((m) => m.role === 'assistant');
    // The two historical assistants (prefill is appended at the end for manual content-only)
    assert.equal(assistants[0].reasoning_content, '历史思考一');
    assert.equal(assistants[1].reasoning_content, '历史思考二');
    assert.equal(gd.include_reasoning, true);
});

test('historical reasoning re-attach stays OFF by default', () => {
    const settings = makeSettings({ provider: 'moonshot', mode: 'manual', manualContent: 'C' });
    const chat = [
        { is_user: false, mes: 'first reply', extra: { reasoning: '隐藏思考' } },
    ];
    const gd = makeGenerateData({
        chat_completion_source: 'moonshot',
        messages: [
            { role: 'assistant', content: 'first reply' },
            { role: 'user', content: 'Hi' },
        ],
    });
    const out = run(gd, settings.get(), { type: 'normal', chat });
    assert.equal(out.changed, true);
    const assistants = gd.messages.filter((m) => m.role === 'assistant');
    assert.equal(assistants[0].reasoning_content, undefined);
});

test('deepseek via custom URL: beta warning emitted, request otherwise intact when setting off', () => {
    const settings = makeSettings({
        provider: 'deepseek', mode: 'manual', manualReasoning: 'R', manualContent: 'C',
        deepseekAutoBetaEndpoint: false,
    });
    const gd = makeGenerateData({
        chat_completion_source: 'custom',
        custom_url: 'https://api.deepseek.com/v1',
        model: 'deepseek-v4-pro',
        messages: [{ role: 'user', content: 'Hi' }],
    });
    const out = run(gd, settings.get(), { type: 'normal' });
    assert.equal(out.changed, true);
    assert.equal(gd.custom_url, 'https://api.deepseek.com/v1');
    assert.ok(out.result.warnings.some((w) => /beta/i.test(w)));
    assert.equal(gd.messages.at(-1).prefix, true);
});

test('result object carries debug-friendly info', () => {
    const settings = makeSettings({ provider: 'ollama', mode: 'manual', manualReasoning: 'R', manualContent: 'C' });
    const gd = makeGenerateData({
        chat_completion_source: 'custom',
        custom_url: 'http://localhost:11434/v1',
        model: 'qwen3:8b',
        messages: [{ role: 'user', content: 'Hi' }],
    });
    const out = run(gd, settings.get(), { type: 'normal' });
    assert.equal(out.changed, true);
    assert.equal(out.result.provider, 'ollama');
    assert.equal(out.result.mode, 'manual');
    assert.equal(out.result.adapter, 'OllamaAdapter');
    assert.equal(typeof out.result.capabilities.supportsContentPrefill, 'boolean');
});
