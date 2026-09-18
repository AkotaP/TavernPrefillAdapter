/**
 * Debug logger with mandatory secret redaction.
 *
 * Security rule (reference design §42): NEVER print authorization headers,
 * API keys, bearer tokens, cookies, secrets — or raw request bodies that may
 * contain them (e.g. custom_url can embed credentials). Everything logged
 * goes through redact() first.
 */

export const SENSITIVE_KEYS = new Set([
    'authorization',
    'auth',
    'api_key',
    'apikey',
    'api-key',
    'key',
    'token',
    'access_token',
    'secret',
    'password',
    'proxy_password',
    'cookie',
    'x-api-key',
    'authorization-header',
    'custom_include_headers',
    'custom_include_body',
    'custom_exclude_body',
    'reverse_proxy',
    'azure_base_url',
    'secret_id',
]);

const SENSITIVE_KEY_RE = /(key|token|secret|password|auth|cookie|bearer)/i;

export function isSensitiveKey(key) {
    return SENSITIVE_KEYS.has(String(key).toLowerCase()) || SENSITIVE_KEY_RE.test(String(key));
}

/**
 * Recursively builds a log-safe deep copy of a value.
 * - sensitive keys → "[REDACTED]"
 * - functions / symbols → "[fn]" / "[symbol]"
 * - cycles → "[circular]"
 * @param {any} value
 * @param {WeakSet} [seen]
 * @returns {any}
 */
export function redact(value, seen = new WeakSet()) {
    if (value === null || value === undefined) return value;
    const t = typeof value;
    if (t === 'function') return '[fn]';
    if (t === 'symbol') return '[symbol]';
    if (t !== 'object') return value;
    if (seen.has(value)) return '[circular]';
    seen.add(value);
    try {
        if (Array.isArray(value)) {
            return value.map((item) => redact(item, seen));
        }
        const out = {};
        for (const key of Object.keys(value)) {
            // Keep the key, redact the VALUE for sensitive fields (an API key
            // is a value, not a key name).
            out[key] = isSensitiveKey(key) ? '[REDACTED]' : redact(value[key], seen);
        }
        return out;
    } finally {
        seen.delete(value);
    }
}

export class Logger {
    /**
     * @param {() => boolean} isEnabled
     * @param {...string} prefix
     */
    constructor(isEnabled, prefix = '[Tavern Prefill Adapter]') {
        this.isEnabled = isEnabled;
        this.prefix = prefix;
    }

    enabled() {
        try {
            return Boolean(this.isEnabled && this.isEnabled());
        } catch {
            return false;
        }
    }

    debug(...args) {
        if (!this.enabled()) return;
        // eslint-disable-next-line no-console
        console.log(this.prefix, ...args);
    }

    warn(...args) {
        // eslint-disable-next-line no-console
        console.warn(this.prefix, ...args);
    }

    error(...args) {
        // eslint-disable-next-line no-console
        console.error(this.prefix, ...args);
    }

    debugSafe(label, value) {
        if (!this.enabled()) return;
        // eslint-disable-next-line no-console
        console.log(this.prefix, label, safeStringify(value));
    }
}

export function safeStringify(value) {
    try {
        return JSON.stringify(redact(value), null, 2);
    } catch {
        return String(value);
    }
}
