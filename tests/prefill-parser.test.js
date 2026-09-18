import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parsePrefill, hasReasoningStartTag } from '../src/core/prefill-parser.js';

test('plain content prefill (Case A)', () => {
    const res = parsePrefill('她轻轻推开门，');
    assert.deepEqual(res, { reasoning: '', content: '她轻轻推开门，', mode: 'content', matched: false });
});

test('unclosed reasoning prefill (Case B)', () => {
    const res = parsePrefill('*thinking*\n先分析当前人物状态……');
    assert.deepEqual(res, { reasoning: '先分析当前人物状态……', content: '', mode: 'reasoning', matched: true });
});

test('reasoning + content prefill (Case C)', () => {
    const res = parsePrefill('*thinking*\n先分析一下\n*response*\n正文开始');
    assert.deepEqual(res, { reasoning: '先分析一下', content: '正文开始', mode: 'both', matched: true });
});

test('reasoning + content with blank line after end tag', () => {
    const res = parsePrefill('*thinking*\n先分析人物当前状态……\n*response*\n\n她犹豫了一下，');
    assert.deepEqual(res, { reasoning: '先分析人物当前状态……', content: '她犹豫了一下，', mode: 'both', matched: true });
});

test('custom tags (<scratchpad>)', () => {
    const res = parsePrefill('<scratchpad>\nABC\n</scratchpad>\nDEF', {
        startTag: '<scratchpad>',
        endTag: '</scratchpad>',
    });
    assert.deepEqual(res, { reasoning: 'ABC', content: 'DEF', mode: 'both', matched: true });
});

test('custom tags, unclosed scratchpad', () => {
    const res = parsePrefill('<scratchpad>\nABC\n', { startTag: '<scratchpad>', endTag: '</scratchpad>' });
    assert.deepEqual(res, { reasoning: 'ABC', content: '', mode: 'reasoning', matched: true });
});

test('CRLF line endings are normalized', () => {
    const res = parsePrefill('*thinking*\r\n先分析一下\r\n*response*\r\n正文开始');
    assert.deepEqual(res, { reasoning: '先分析一下', content: '正文开始', mode: 'both', matched: true });
});

test('leading whitespace before the tag is ignored', () => {
    const res = parsePrefill('  \n  *thinking*\n先分析一下');
    assert.deepEqual(res, { reasoning: '先分析一下', content: '', mode: 'reasoning', matched: true });
});

test('internal whitespace in reasoning is preserved', () => {
    const res = parsePrefill('*thinking*\n第一行\n  第二行缩进\n*response*\n内容');
    assert.deepEqual(res, { reasoning: '第一行\n  第二行缩进', content: '内容', mode: 'both', matched: true });
});

test('empty reasoning with content is a content prefill', () => {
    const res = parsePrefill('*thinking*\n*response*\n正文开始');
    assert.equal(res.mode, 'content');
    assert.equal(res.reasoning, '');
    assert.equal(res.content, '正文开始');
});

test('empty content with reasoning is a reasoning prefill', () => {
    const res = parsePrefill('*thinking*\n先分析一下*response*');
    assert.equal(res.mode, 'reasoning');
    assert.equal(res.reasoning, '先分析一下');
    assert.equal(res.content, '');
});

test('end tag without start tag is NOT a reasoning block', () => {
    const res = parsePrefill('*response* 结尾而已');
    assert.equal(res.matched, false);
    assert.equal(res.mode, 'content');
    assert.equal(res.content, '*response* 结尾而已');
});

test('tag-only input fails open (null)', () => {
    assert.equal(parsePrefill('*thinking*'), null);
    assert.equal(parsePrefill('*thinking*\n*response*'), null);
});

test('degenerate inputs fail open (null)', () => {
    assert.equal(parsePrefill(''), null);
    assert.equal(parsePrefill('   \n  '), null);
    assert.equal(parsePrefill(null), null);
    assert.equal(parsePrefill(undefined), null);
    assert.equal(parsePrefill(42), null);
});

test('non-matching plain content keeps the original text intact', () => {
    const res = parsePrefill('  她轻轻推开门，  ');
    assert.deepEqual(res, { reasoning: '', content: '她轻轻推开门，', mode: 'content', matched: false });
});

test('hasReasoningStartTag', () => {
    assert.equal(hasReasoningStartTag('*thinking*\nxx'), true);
    assert.equal(hasReasoningStartTag('   *thinking*xx'), true);
    assert.equal(hasReasoningStartTag('随便说说 *thinking*'), false);
    assert.equal(hasReasoningStartTag('<s>', { startTag: '<s>' }), true);
    assert.equal(hasReasoningStartTag(''), false);
});

test('no start tag configured treats everything as content', () => {
    const res = parsePrefill('xxx', { startTag: '', endTag: '' });
    assert.equal(res.mode, 'content');
    assert.equal(res.content, 'xxx');
});
