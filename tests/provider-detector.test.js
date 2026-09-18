import { test } from 'node:test';
import assert from 'node:assert/strict';

import { detectProvider, PROVIDERS } from '../src/core/provider-detector.js';

test('Ollama local via base URL', () => {
    const res = detectProvider({ chatCompletionSource: 'custom', customUrl: 'http://localhost:11434/v1', model: 'qwen3:8b' });
    assert.equal(res.provider, PROVIDERS.OLLAMA);
    assert.equal(res.via, 'url');
});

test('Ollama local via 127.0.0.1', () => {
    const res = detectProvider({ chatCompletionSource: 'custom', customUrl: 'http://127.0.0.1:11434/v1' });
    assert.equal(res.provider, PROVIDERS.OLLAMA);
});

test('Ollama cloud via base URL', () => {
    const res = detectProvider({ chatCompletionSource: 'custom', customUrl: 'https://ollama.com/v1', model: 'qwen3:8b' });
    assert.equal(res.provider, PROVIDERS.OLLAMA);
});

test('Ollama cloud www host', () => {
    const res = detectProvider({ chatCompletionSource: 'custom', customUrl: 'https://www.ollama.com/v1' });
    assert.equal(res.provider, PROVIDERS.OLLAMA);
});

test('Moonshot via base URL', () => {
    const res = detectProvider({ chatCompletionSource: 'custom', customUrl: 'https://api.moonshot.cn/v1', model: 'kimi-k3' });
    assert.equal(res.provider, PROVIDERS.MOONSHOT);
    assert.equal(res.via, 'url');
});

test('DeepSeek via base URL (beta)', () => {
    const res = detectProvider({ chatCompletionSource: 'custom', customUrl: 'https://api.deepseek.com/beta', model: 'deepseek-chat' });
    assert.equal(res.provider, PROVIDERS.DEEPSEEK);
});

test('Moonshot via SillyTavern source', () => {
    const res = detectProvider({ chatCompletionSource: 'moonshot', model: 'kimi-k3' });
    assert.equal(res.provider, PROVIDERS.MOONSHOT);
    assert.equal(res.via, 'source');
});

test('DeepSeek via SillyTavern source', () => {
    const res = detectProvider({ chatCompletionSource: 'deepseek', model: 'deepseek-reasoner' });
    assert.equal(res.provider, PROVIDERS.DEEPSEEK);
    assert.equal(res.via, 'source');
});

test('Claude via SillyTavern source is not touched by this plugin', () => {
    const res = detectProvider({ chatCompletionSource: 'claude' });
    assert.equal(res.provider, PROVIDERS.CLAUDE);
});

test('Unknown OpenAI-compatible custom endpoint defaults to generic', () => {
    const res = detectProvider({ chatCompletionSource: 'custom', customUrl: 'https://my-gateway.example.com/v1', model: 'something' });
    assert.equal(res.provider, PROVIDERS.GENERIC);
});

test('OpenAI source defaults to generic', () => {
    const res = detectProvider({ chatCompletionSource: 'openai', model: 'gpt-5' });
    assert.equal(res.provider, PROVIDERS.GENERIC);
});

test('Manual provider override beats everything', () => {
    const res = detectProvider({ providerSetting: 'ollama', chatCompletionSource: 'deepseek', customUrl: 'https://api.moonshot.cn/v1', model: 'kimi-k3' });
    assert.equal(res.provider, PROVIDERS.OLLAMA);
    assert.equal(res.via, 'setting');
});

test('Model id is only a weak hint (kimi on openrouter)', () => {
    const res = detectProvider({ chatCompletionSource: 'openrouter', model: 'moonshotai/kimi-k3' });
    assert.equal(res.provider, PROVIDERS.MOONSHOT);
    assert.equal(res.via, 'model');
});

test('Model id hint does not override base URL', () => {
    const res = detectProvider({ chatCompletionSource: 'openrouter', customUrl: 'https://ollama.com/v1', model: 'kimi-k3' });
    assert.equal(res.provider, PROVIDERS.OLLAMA);
    assert.equal(res.via, 'url');
});

test('deepseek model id hint works only without stronger signals', () => {
    const res = detectProvider({ chatCompletionSource: 'custom', model: 'deepseek-v4' });
    assert.equal(res.provider, PROVIDERS.DEEPSEEK);
    assert.equal(res.via, 'model');
});

test('generic fallback for unknown source', () => {
    const res = detectProvider({ chatCompletionSource: 'groq', model: 'llama-4' });
    assert.equal(res.provider, PROVIDERS.GENERIC);
});

test('bare host URL without scheme is tolerated', () => {
    const res = detectProvider({ chatCompletionSource: 'custom', customUrl: 'localhost:11434' });
    assert.equal(res.provider, PROVIDERS.OLLAMA);
});
