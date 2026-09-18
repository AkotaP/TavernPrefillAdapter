/**
 * Provider Auto Detection.
 *
 * Priority (highest wins):
 *   1. Explicit provider setting in the extension UI (manual override).
 *   2. Base URL heuristics (custom_url / reverse proxy hosts).
 *   3. SillyTavern `chat_completion_source`.
 *
 * A model id is NEVER used to decide the provider: ids like "deepseek-v4" or
 * "kimi-k3" can come from the official APIs, OpenRouter, relays (NewAPI/
 * OneAPI), Ollama or any gateway, and model naming changes too quickly to be
 * a reliable signal.
 */

export const PROVIDERS = Object.freeze({
    AUTO: 'auto',
    OLLAMA: 'ollama',
    MOONSHOT: 'moonshot',
    DEEPSEEK: 'deepseek',
    GENERIC: 'generic',
    CUSTOM: 'custom',
    CLAUDE: 'claude',
    SKIP: 'skip',
});

/** SillyTavern chat_completion_source values from public/scripts/openai.js */
export const ST_CHAT_COMPLETION_SOURCES = Object.freeze({
    OPENAI: 'openai',
    CLAUDE: 'claude',
    OPENROUTER: 'openrouter',
    AI21: 'ai21',
    MAKERSUITE: 'makersuite',
    VERTEXAI: 'vertexai',
    MISTRALAI: 'mistralai',
    CUSTOM: 'custom',
    COHERE: 'cohere',
    PERPLEXITY: 'perplexity',
    GROQ: 'groq',
    ELECTRONHUB: 'electronhub',
    CHUTES: 'chutes',
    NANOGPT: 'nanogpt',
    DEEPSEEK: 'deepseek',
    AIMLAPI: 'aimlapi',
    XAI: 'xai',
    POLLINATIONS: 'pollinations',
    MOONSHOT: 'moonshot',
    FIREWORKS: 'fireworks',
    COMETAPI: 'cometapi',
    AZURE_OPENAI: 'azure_openai',
    ZAI: 'zai',
    SILICONFLOW: 'siliconflow',
    WORKERS_AI: 'workers_ai',
    MINIMAX: 'minimax',
});

/**
 * @typedef {object} DetectionContext
 * @property {string} [providerSetting]  Extension provider override ('auto' by default)
 * @property {string} [chatCompletionSource] SillyTavern chat completion source id
 * @property {string} [customUrl]       Base URL for the Custom source (may contain credentials!)
 * @property {string} [model]            Model id
 */

/**
 * @typedef {object} DetectionResult
 * @property {string} provider One of PROVIDERS
 * @property {string} via      'setting' | 'url' | 'source' | 'model' | 'default'
 * @property {string} [detail] Human-readable explanation (safe, no secrets)
 * @property {string} [matchedUrlHost] Host used for URL matching (safe)
 */

/** @type {Record<string,string>} */
const URL_RULES = [
    // Ollama: local server or Ollama Cloud.
    { test: (host, port) => host === 'ollama.com' || host === 'www.ollama.com' || host.includes('.ollama.com') || (host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0') && /(^|\D)11434(\D|$)/.test(String(port)), provider: PROVIDERS.OLLAMA },
    { test: (host) => host.includes('moonshot') || host.includes('kimi'), provider: PROVIDERS.MOONSHOT },
    { test: (host) => host.includes('deepseek'), provider: PROVIDERS.DEEPSEEK },
];

/**
 * Resolves which provider a given request belongs to.
 * @param {DetectionContext} context
 * @returns {DetectionResult}
 */
export function detectProvider(context = {}) {
    const {
        providerSetting,
        chatCompletionSource,
        customUrl,
        model,
    } = context;

    // 1. Explicit manual override.
    if (providerSetting && providerSetting !== PROVIDERS.AUTO) {
        const provider = String(providerSetting).toLowerCase();
        if (Object.values(PROVIDERS).includes(provider)) {
            return { provider, via: 'setting', detail: 'Manual provider override in extension settings.' };
        }
    }

    // 2. Base URL heuristics.
    if (typeof customUrl === 'string' && customUrl.trim()) {
        const parsed = safeParseUrl(customUrl);
        if (parsed) {
            const host = (parsed.hostname || '').toLowerCase();
            const port = parsed.port || (parsed.protocol === 'https:' ? '443' : '80');
            for (const rule of URL_RULES) {
                if (rule.test(host, port)) {
                    return { provider: rule.provider, via: 'url', detail: 'Detected from base URL host.', matchedUrlHost: host };
                }
            }
        }
    }

    // 3. SillyTavern source.
    if (chatCompletionSource) {
        const src = String(chatCompletionSource).toLowerCase();
        switch (src) {
            case ST_CHAT_COMPLETION_SOURCES.MOONSHOT:
                return { provider: PROVIDERS.MOONSHOT, via: 'source', detail: 'SillyTavern source is Moonshot.' };
            case ST_CHAT_COMPLETION_SOURCES.DEEPSEEK:
                return { provider: PROVIDERS.DEEPSEEK, via: 'source', detail: 'SillyTavern source is DeepSeek.' };
            case ST_CHAT_COMPLETION_SOURCES.CLAUDE:
                return { provider: PROVIDERS.CLAUDE, via: 'source', detail: 'Claude handled by SillyTavern core.' };
            default:
                break;
        }
    }

    // Fallback: Custom source without recognizable URL, or any other source.
    if (chatCompletionSource === ST_CHAT_COMPLETION_SOURCES.CUSTOM) {
        return { provider: PROVIDERS.GENERIC, via: 'default', detail: 'Custom source without a recognizable base URL; using generic OpenAI adapter.' };
    }

    return { provider: PROVIDERS.GENERIC, via: 'default', detail: 'No provider hints; using generic OpenAI adapter.' };
}

function safeParseUrl(url) {
    try {
        const parsed = new URL(url);
        if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
            return parsed;
        }
        // e.g. "localhost:11434" parses as scheme "localhost" — treat as a bare host.
        return new URL('http://' + url);
    } catch {
        try {
            // Accept bare hosts like "localhost:11434" or "ollama.com" without scheme.
            return new URL('http://' + url);
        } catch {
            return null;
        }
    }
}

export const PROVIDER_LABELS = Object.freeze({
    [PROVIDERS.AUTO]: 'Auto Detect',
    [PROVIDERS.OLLAMA]: 'Ollama',
    [PROVIDERS.MOONSHOT]: 'Moonshot / Kimi',
    [PROVIDERS.DEEPSEEK]: 'DeepSeek Official',
    [PROVIDERS.GENERIC]: 'Generic OpenAI',
    [PROVIDERS.CUSTOM]: 'Custom',
});
