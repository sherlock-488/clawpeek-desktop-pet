import { createInitialState } from '../src/core/reducer.js';
import { render } from '../src/ui/render.js';

const api = window.desktopPetAPI;

const nodes = {
  pageTitle: document.getElementById('page-title'),
  statusSectionLabel: document.getElementById('status-section-label'),
  statusSectionTitle: document.getElementById('status-section-title'),
  eventsSectionLabel: document.getElementById('events-section-label'),
  eventsSectionTitle: document.getElementById('events-section-title'),
  footerQuote: document.getElementById('footer-quote'),
  langSwitch: document.getElementById('lang-switch'),
  langButtons: Array.from(document.querySelectorAll('.lang-button')),
};

const LOCALE_STORAGE_KEY = 'clawpeek.dashboard.locale';
const USAGE_REFRESH_MS = 5000;
const EVENT_LIMIT = 48;

const QUOTES = Object.freeze([
  {
    zh: { text: '想象力比知识更重要。', author: '阿尔伯特·爱因斯坦' },
    en: { text: 'Imagination is more important than knowledge.', author: 'Albert Einstein' },
  },
  {
    zh: { text: '你不能只是问顾客想要什么，然后照着做。', author: '史蒂夫·乔布斯' },
    en: { text: 'You cannot just ask customers what they want and then try to give that to them.', author: 'Steve Jobs' },
  },
  {
    zh: { text: '生活中没有什么可怕的，只有需要理解的东西。', author: '玛丽·居里' },
    en: { text: 'Nothing in life is to be feared, it is only to be understood.', author: 'Marie Curie' },
  },
  {
    zh: { text: '简洁是终极的复杂。', author: '列奥纳多·达·芬奇' },
    en: { text: 'Simplicity is the ultimate sophistication.', author: 'Leonardo da Vinci' },
  },
  {
    zh: { text: '预测未来最好的方式，就是去创造它。', author: '彼得·德鲁克' },
    en: { text: 'The best way to predict the future is to create it.', author: 'Peter Drucker' },
  },
]);

const COPY = Object.freeze({
  zh: {
    htmlLang: 'zh-CN',
    documentTitle: 'ClawPeek 控制面板',
    pageTitle: '控制面板',
    statusSectionLabel: '当前状态',
    statusSectionTitle: '状态与使用信息',
    eventsSectionLabel: '最近日志',
    eventsSectionTitle: '事件流',
    metricApi: 'API / 模型',
    metricTools: '工具配置',
    metricUsage: 'Token 使用',
    fallback: 'OpenClaw 未透传',
    disconnected: 'Gateway 休息中',
    languageSwitch: '语言切换',
  },
  en: {
    htmlLang: 'en',
    documentTitle: 'ClawPeek Control Panel',
    pageTitle: 'Control Panel',
    statusSectionLabel: 'Current Status',
    statusSectionTitle: 'State and Usage',
    eventsSectionLabel: 'Recent Log',
    eventsSectionTitle: 'Event Stream',
    metricApi: 'API / Model',
    metricTools: 'Tool Profile',
    metricUsage: 'Token Usage',
    fallback: 'OpenClaw did not expose it',
    disconnected: 'Gateway resting',
    languageSwitch: 'Language switch',
  },
});

let bootstrap = null;
let latestSnapshot = null;
let usageRequest = null;
let lastUsageRefreshAt = 0;
let lastUsageKey = '';
let currentLocale = readStoredLocale();
let currentQuoteIndex = randomQuoteIndex();
let usageInfo = {
  tokenText: '',
  model: '',
  provider: '',
};

function readStoredLocale() {
  try {
    return localStorage.getItem(LOCALE_STORAGE_KEY) === 'en' ? 'en' : 'zh';
  } catch {
    return 'zh';
  }
}

function writeStoredLocale(locale) {
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Ignore storage failures.
  }
}

function randomQuoteIndex() {
  if (!QUOTES.length) return 0;
  return Math.floor(Math.random() * QUOTES.length);
}

function getCopy() {
  return COPY[currentLocale] || COPY.zh;
}

function debugUsage(payload) {
  try {
    api.debugLog?.('dashboard-usage', payload);
  } catch {
    // Ignore debug logging failures.
  }
}

function prettifyProviderName(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return '';

  const aliases = {
    anthropic: 'Anthropic',
    openai: 'OpenAI',
    openrouter: 'OpenRouter',
    gemini: 'Gemini',
    google: 'Google',
    xai: 'xAI',
    mistral: 'Mistral',
    ollama: 'Ollama',
    azure: 'Azure',
  };

  return aliases[normalized] || normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function apiText() {
  const copy = getCopy();
  const provider = prettifyProviderName(usageInfo.provider) || prettifyProviderName(bootstrap?.apiProvider);
  const model = String(usageInfo.model || bootstrap?.apiModel || '').trim();

  if (provider && model) {
    return `${provider} / ${model}`;
  }

  return provider || model || copy.fallback;
}

function toolConfigText() {
  const copy = getCopy();
  const configured = String(bootstrap?.toolConfig || '').trim();
  return configured || copy.fallback;
}

function coerceNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function trimTrailingZeros(value) {
  return String(value).replace(/\.0$/, '');
}

function formatCompactTokens(value) {
  const number = coerceNumber(value);
  if (number === null) return '';

  const absolute = Math.abs(number);
  if (absolute >= 1_000_000_000) {
    return `${trimTrailingZeros((number / 1_000_000_000).toFixed(1))}B`;
  }

  if (absolute >= 1_000_000) {
    return `${trimTrailingZeros((number / 1_000_000).toFixed(1))}M`;
  }

  if (absolute >= 1_000) {
    return `${trimTrailingZeros((number / 1_000).toFixed(1))}k`;
  }

  return String(Math.round(number));
}

function fallbackTokenUsageText(snapshot) {
  const candidates = [
    snapshot?.derived?.label,
    ...(snapshot?.recentEvents || []).flatMap((event) => [event.label, event.detail]),
  ].map((value) => String(value || '').trim()).filter(Boolean);

  const usagePattern = /tokens?\s+([0-9.]+\s*[kKmMbB]?\/[0-9.]+\s*[kKmMbB]?\s*(?:\(\d+%?\))?)/i;
  const compactPattern = /\b([0-9.]+\s*[kKmMbB]?\/[0-9.]+\s*[kKmMbB]?\s*(?:\(\d+%?\))?)\b/;

  for (const text of candidates) {
    const direct = text.match(usagePattern);
    if (direct?.[1]) {
      return `tokens ${direct[1].replace(/\s+/g, ' ').trim()}`;
    }

    if (!/token/i.test(text)) continue;
    const compact = text.match(compactPattern);
    if (compact?.[1]) {
      return `tokens ${compact[1].replace(/\s+/g, ' ').trim()}`;
    }
  }

  return '';
}

function buildSessionCandidates(snapshot) {
  const rawCandidates = [
    snapshot?.derived?.sessionKey,
    bootstrap?.mainSessionKey,
    'main',
  ];

  const candidates = [];
  const seen = new Set();

  for (const value of rawCandidates) {
    const raw = String(value || '').trim();
    if (!raw) continue;

    const variants = [raw];
    if (raw.startsWith('agent:main:')) {
      variants.push(raw.slice('agent:main:'.length));
    } else if (raw === 'main' || raw === String(bootstrap?.mainSessionKey || '').trim()) {
      variants.push('agent:main:main');
    } else if (!raw.includes(':')) {
      variants.push(`agent:main:${raw}`);
    }

    for (const variant of variants) {
      if (!variant || seen.has(variant)) continue;
      seen.add(variant);
      candidates.push(variant);
    }
  }

  return candidates;
}

function collectSessionKeys(session = {}) {
  return [
    session.key,
    session.sessionKey,
    session.id,
    session.name,
    session.session?.key,
  ].map((value) => String(value || '').trim()).filter(Boolean);
}

function listSessions(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.sessions)) return payload.sessions;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.data?.sessions)) return payload.data.sessions;
  return [];
}

function selectUsageSession(payload, candidates) {
  const sessions = listSessions(payload);
  if (!sessions.length) return null;

  for (const candidate of candidates) {
    const match = sessions.find((session) => collectSessionKeys(session).includes(candidate));
    if (match) return match;
  }

  return sessions.length === 1 ? sessions[0] : null;
}

function extractUsageInfo(session = {}) {
  const usage = session?.usage && typeof session.usage === 'object' ? session.usage : {};

  const inputTokens = coerceNumber(session.inputTokens ?? usage.inputTokens ?? usage.promptTokens);
  const outputTokens = coerceNumber(session.outputTokens ?? usage.outputTokens ?? usage.completionTokens);
  const totalTokens = coerceNumber(
    session.totalTokens
    ?? usage.totalTokens
    ?? ((inputTokens ?? 0) + (outputTokens ?? 0))
  );
  const contextTokens = coerceNumber(session.contextTokens ?? usage.contextTokens ?? usage.maxContextTokens);

  let tokenText = '';
  if (totalTokens !== null && contextTokens !== null && contextTokens > 0) {
    const percent = Math.max(0, Math.round((totalTokens / contextTokens) * 100));
    tokenText = `tokens ${formatCompactTokens(totalTokens)} / ${formatCompactTokens(contextTokens)} (${percent}%)`;
  } else if (inputTokens !== null && outputTokens !== null) {
    tokenText = `${formatCompactTokens(inputTokens)} in / ${formatCompactTokens(outputTokens)} out`;
  } else if (totalTokens !== null) {
    tokenText = `${formatCompactTokens(totalTokens)} total`;
  }

  return {
    tokenText,
    model: String(session.model || usage.model || '').trim(),
    provider: String(session.modelProvider || session.provider || usage.modelProvider || usage.provider || '').trim(),
  };
}

function currentTokenUsageText(snapshot) {
  const copy = getCopy();
  const liveText = String(usageInfo.tokenText || '').trim();
  if (liveText) {
    return liveText;
  }

  if (snapshot?.connection !== 'connected') {
    return copy.disconnected;
  }

  return fallbackTokenUsageText(snapshot) || copy.fallback;
}

function buildMetrics(snapshot) {
  const copy = getCopy();
  const apiValue = apiText();
  const toolConfig = toolConfigText();
  const tokenUsage = currentTokenUsageText(snapshot);

  return [
    {
      label: copy.metricApi,
      value: apiValue,
      muted: apiValue === copy.fallback,
    },
    {
      label: copy.metricTools,
      value: toolConfig,
      muted: toolConfig === copy.fallback,
    },
    {
      label: copy.metricUsage,
      value: tokenUsage,
      mono: true,
      muted: tokenUsage === copy.fallback || tokenUsage === copy.disconnected,
    },
  ];
}

function quoteForCurrentView() {
  const quote = QUOTES[currentQuoteIndex] || QUOTES[0];
  return quote[currentLocale] || quote.zh;
}

function escapeHtml(text) {
  return String(text ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderFooterQuote() {
  const quote = quoteForCurrentView();

  nodes.footerQuote.innerHTML = `
    <div class="footer-quote-shell">
      <blockquote class="footer-quote-text">"${escapeHtml(quote.text)}"</blockquote>
      <p class="footer-quote-author">- ${escapeHtml(quote.author)}</p>
    </div>
  `;
}

function applyStaticCopy() {
  const copy = getCopy();

  document.documentElement.lang = copy.htmlLang;
  document.title = copy.documentTitle;
  nodes.pageTitle.textContent = copy.pageTitle;
  nodes.statusSectionLabel.textContent = copy.statusSectionLabel;
  nodes.statusSectionTitle.textContent = copy.statusSectionTitle;
  nodes.eventsSectionLabel.textContent = copy.eventsSectionLabel;
  nodes.eventsSectionTitle.textContent = copy.eventsSectionTitle;
  nodes.langSwitch.setAttribute('aria-label', copy.languageSwitch);

  for (const button of nodes.langButtons) {
    const isActive = button.dataset.lang === currentLocale;
    button.classList.toggle('is-active', isActive);
    button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  }
}

function renderSnapshot(snapshot) {
  const state = snapshot || createInitialState();

  render(state, {
    metrics: buildMetrics(state),
    eventLimit: EVENT_LIMIT,
    locale: currentLocale,
  });

  renderFooterQuote();
}

async function refreshUsage(force = false) {
  const snapshot = latestSnapshot;
  if (!snapshot || snapshot.connection !== 'connected') {
    usageInfo = {
      tokenText: '',
      model: '',
      provider: '',
    };
    return;
  }

  const candidates = buildSessionCandidates(snapshot);
  const usageKey = candidates.join('|');
  const now = Date.now();

  if (usageRequest) return usageRequest;
  if (!force && usageKey === lastUsageKey && now - lastUsageRefreshAt < USAGE_REFRESH_MS) {
    return;
  }

  lastUsageKey = usageKey;
  lastUsageRefreshAt = now;

  usageRequest = api.requestGateway('sessions.list', {})
    .then((payload) => {
      const session = selectUsageSession(payload, candidates);
      const nextUsage = session ? extractUsageInfo(session) : null;

      usageInfo = nextUsage || {
        tokenText: fallbackTokenUsageText(snapshot) || '',
        model: '',
        provider: '',
      };

      debugUsage({
        ok: true,
        method: 'sessions.list',
        candidates,
        matchedSession: session ? collectSessionKeys(session)[0] || '' : '',
        tokenText: usageInfo.tokenText,
        model: usageInfo.model,
      });
    })
    .catch((error) => {
      usageInfo = {
        tokenText: fallbackTokenUsageText(snapshot) || '',
        model: '',
        provider: '',
      };
      debugUsage({
        ok: false,
        method: 'sessions.list',
        candidates,
        detail: error instanceof Error ? error.message : String(error),
      });
    })
    .finally(() => {
      usageRequest = null;
      renderSnapshot(latestSnapshot);
    });

  return usageRequest;
}

function applySnapshot(snapshot) {
  latestSnapshot = snapshot;
  if (!snapshot || snapshot.connection !== 'connected') {
    usageInfo = {
      tokenText: '',
      model: '',
      provider: '',
    };
  }

  renderSnapshot(snapshot);
  void refreshUsage();
}

function setLocale(locale) {
  currentLocale = locale === 'en' ? 'en' : 'zh';
  writeStoredLocale(currentLocale);
  applyStaticCopy();
  renderSnapshot(latestSnapshot);
}

function bindLanguageSwitch() {
  for (const button of nodes.langButtons) {
    button.addEventListener('click', () => {
      setLocale(button.dataset.lang || 'zh');
    });
  }
}

bootstrap = await api.getBootstrapConfig();
applyStaticCopy();
bindLanguageSwitch();
renderSnapshot(null);
applySnapshot(await api.getLatestSnapshot());
api.onStateSnapshot((snapshot) => {
  applySnapshot(snapshot);
});
