/**
 * Prefill Parser — turns the raw text of a SillyTavern generated reply prefix
 * (e.g. "Start Reply With") into the provider-agnostic Prefill Model:
 *
 *   { reasoning: string, content: string, mode: 'content'|'reasoning'|'both' }
 *
 * The parser is deliberately strict about *structure* and lenient about
 * content. Any malformed / ambiguous input FAILS OPEN: the returned value is
 * null and the caller must keep the original request untouched.
 *
 * Tag syntax (both tags configurable):
 *
 *   <startTag>
 *   <reasoning text>
 *   <endTag>
 *   <content prefill text>
 *
 * Examples with the default tags (*thinking* / *response*):
 *
 *   "她轻轻推开门，"                                  -> { reasoning:'', content:'她轻轻推开门，' }
 *   "*thinking*\n先分析当前人物状态……"                -> { reasoning:'先分析当前人物状态……', content:'' }
 *   "*thinking*\n分析……\n*response*\n她犹豫了一下，"   -> { reasoning:'分析……', content:'她犹豫了一下，' }
 */

export const DEFAULT_START_TAG = '*thinking*';
export const DEFAULT_END_TAG = '*response*';

/**
 * @typedef {object} ParsedPrefill
 * @property {string} reasoning Thinking / CoT / scratchpad prefill text ('' when none)
 * @property {string} content Final assistant content prefill text ('' when none)
 * @property {'content'|'reasoning'|'both'} mode What the prefill expresses
 * @property {boolean} matched Whether the reasoning start tag was recognized
 */

/**
 * Parses raw prefill text into the unified prefill model.
 *
 * Rules:
 *  - CRLF line endings are normalized to LF.
 *  - The start tag must be the first non-whitespace token; leading whitespace
 *    before the tag is ignored.
 *  - Everything between the start tag and the FIRST occurrence of the end tag
 *    is the reasoning text (edges trimmed, internal whitespace preserved).
 *  - Everything after the end tag is the content prefill (edges trimmed).
 *  - If there is no end tag, everything after the start tag is reasoning and
 *    content is '' (Reasoning Continuation intent).
 *  - If there is no start tag, the whole text is a plain content prefill.
 *  - Degenerate inputs (empty / whitespace-only / tag-only with no text at
 *    all) return null -> the caller fails open.
 *
 * @param {string} text Raw reply prefix content
 * @param {object} [options]
 * @param {string} [options.startTag='*thinking*'] Reasoning start tag
 * @param {string} [options.endTag='*response*']   Reasoning end tag
 * @returns {ParsedPrefill|null}
 */
export function parsePrefill(text, { startTag = DEFAULT_START_TAG, endTag = DEFAULT_END_TAG } = {}) {
    if (typeof text !== 'string') {
        return null;
    }

    const normalized = text.replace(/\r\n/g, '\n');
    if (!normalized.trim()) {
        return null;
    }

    if (typeof startTag !== 'string' || !startTag.length) {
        // No start tag configured: nothing to parse, plain content prefill.
        return plainContentPrefill(normalized);
    }

    // Find the first non-whitespace character; the tag must begin there.
    const firstChar = normalized.search(/\S/);
    if (firstChar === -1) {
        return null;
    }

    if (!normalized.startsWith(startTag, firstChar)) {
        // Not a reasoning-block prefill at all -> plain content prefill.
        return plainContentPrefill(normalized);
    }

    const rest = normalized.slice(firstChar + startTag.length);

    let reasoning = '';
    let content = '';

    if (typeof endTag === 'string' && endTag.length) {
        const endIdx = rest.indexOf(endTag);
        if (endIdx !== -1) {
            reasoning = trimEdges(rest.slice(0, endIdx));
            content = trimEdges(rest.slice(endIdx + endTag.length));
        } else {
            reasoning = trimEdges(rest);
        }
    } else {
        reasoning = trimEdges(rest);
    }

    if (!reasoning && !content) {
        // Tag-only or empty-with-tags prefill -> malformed, fail open.
        return null;
    }

    return {
        reasoning,
        content,
        mode: reasoning && content ? 'both' : (reasoning ? 'reasoning' : 'content'),
        matched: true,
    };
}

/**
 * Detects whether a reasoning start tag appears at the head of the text.
 * Useful for cheap pre-filtering before parsing.
 */
export function hasReasoningStartTag(text, { startTag = DEFAULT_START_TAG } = {}) {
    if (typeof text !== 'string' || !text.trim() || typeof startTag !== 'string' || !startTag.length) {
        return false;
    }
    const normalized = text.replace(/\r\n/g, '\n');
    const firstChar = normalized.search(/\S/);
    if (firstChar === -1) {
        return false;
    }
    return normalized.startsWith(startTag, firstChar);
}

function plainContentPrefill(text) {
    const content = trimEdges(text);
    if (!content) {
        return null;
    }
    return {
        reasoning: '',
        content,
        mode: 'content',
        matched: false,
    };
}

function trimEdges(str) {
    // Edges trimmed, internal whitespace preserved.
    return str.replace(/^[\s\uFEFF\u00A0]+|[\s\uFEFF\u00A0]+$/g, '');
}

export const PREFILL_TAGS = Object.freeze({
    DEFAULT_START_TAG,
    DEFAULT_END_TAG,
});
