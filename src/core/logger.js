/**
 * Debug logger with mandatory secret redaction.
 *
 * Security rule (reference design §42): NEVER print authorization headers,
 * API keys, bearer tokens, cookies, secrets — or raw request bodies that may
 * contain them (e.g. custom_url can embed credentials). Everything logged
 * goes through redact() first.
 *
 * Besides console output, the logger keeps an in-memory ring buffer and can
 * push formatted, redacted entries to UI subscribers, so debug logs are also
 * visible inside the SillyTavern settings panel (no browser console needed).
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

/**
 * @typedef {object} LogEntry
 * @property {'debug'|'warn'|'error'} level
 * @property {string} time  Locale time string
 * @property {string} text  Formatted, redacted single-line text
 */

export class Logger {
    /**
     * @param {() => boolean} isEnabled
     * @param {...string} prefix
     * @param {object} [options]
     * @param {number} [options.maxBuffer=500] Ring buffer size for the in-panel log
     */
    constructor(isEnabled, prefix = '[Tavern Prefill Adapter]', { maxBuffer = 500 } = {}) {
        this.isEnabled = isEnabled;
        this.prefix = prefix;
        this.maxBuffer = maxBuffer;
        /** @type {LogEntry[]} */
        this.buffer = [];
        /** @type {Set<(entry: LogEntry) => void>} */
        this.subscribers = new Set();
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
        this.push('debug', args);
    }

    warn(...args) {
        // eslint-disable-next-line no-console
        console.warn(this.prefix, ...args);
        // In-panel collection is debug-gated: with Debug Mode off nothing is
        // cached or pushed to the panel (warn/error still reach the console).
        if (this.enabled()) {
            this.push('warn', args);
        }
    }

    error(...args) {
        // eslint-disable-next-line no-console
        console.error(this.prefix, ...args);
        if (this.enabled()) {
            this.push('error', args);
        }
    }

    debugSafe(label, value) {
        this.debug(label, safeStringify(value));
    }

    // ------------------------------------------------------------------
    // In-panel log support (ring buffer + subscribers)
    // ------------------------------------------------------------------

    /**
     * Subscribes to new log entries. Entries are only produced while debug
     * mode is enabled (all levels); with Debug Mode off nothing is cached or
     * delivered. Returns an unsubscribe fn.
     * @param {(entry: LogEntry) => void} listener
     * @returns {() => void}
     */
    subscribe(listener) {
        this.subscribers.add(listener);
        return () => this.subscribers.delete(listener);
    }

    /** @returns {LogEntry[]} Snapshot of the current ring buffer. */
    getBuffer() {
        return this.buffer.slice();
    }

    /** Clears the in-panel log buffer. */
    clear() {
        this.buffer = [];
    }

    push(level, args) {
        const entry = {
            level,
            time: new Date().toLocaleTimeString([], { hour12: false }),
            text: this.formatArgs(args),
        };
        this.buffer.push(entry);
        if (this.buffer.length > this.maxBuffer) {
            this.buffer.splice(0, this.buffer.length - this.maxBuffer);
        }
        for (const listener of this.subscribers) {
            try {
                listener(entry);
            } catch (error) {
                // eslint-disable-next-line no-console
                console.error('[Tavern Prefill Adapter] Log subscriber error:', error);
            }
        }
        return entry;
    }

    /**
     * Formats log arguments into a single redacted line: strings pass through,
     * objects are JSON-stringified through redact().
     */
    formatArgs(args) {
        return args.map((arg) => {
            if (typeof arg === 'string') return arg;
            if (arg === undefined) return 'undefined';
            if (arg === null) return 'null';
            if (typeof arg === 'object') {
                try {
                    return JSON.stringify(redact(arg));
                } catch {
                    return String(arg);
                }
            }
            return String(arg);
        }).join(' ');
    }
}

export function safeStringify(value) {
    try {
        return JSON.stringify(redact(value), null, 2);
    } catch {
        return String(value);
    }
}
