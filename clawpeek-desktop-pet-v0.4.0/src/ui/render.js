import { glyphForActivity } from '../core/activity.js';
import { formatClock } from '../core/utils.js';

if (typeof document === 'undefined') {
  throw new Error('ClawPeek renderer must run in a browser. Use `node .` or `npm run dev`.');
}

function qs(id) {
  return document.getElementById(id);
}

const nodes = {
  connectionPill: qs('connection-pill'),
  statusSummary: qs('status-summary'),
  statusMetrics: qs('status-metrics'),
  eventLog: qs('event-log'),
};

const UI_STRINGS = Object.freeze({
  zh: {
    phases: {
      offline: '休息中',
      idle: '空闲中',
      queued: '排队',
      thinking: '思考中',
      waiting: '等待中',
      done: '已完成',
      error: '出错',
    },
    connections: {
      connected: '已连接',
      connecting: '连接中',
      error: '连接失败',
      disconnected: '休息中',
    },
    summaries: {
      offline: '还没有确认连上 Gateway，龙虾先休息。',
      idle: '已经确认连上 Gateway，当前没有活跃任务。',
      queued: '任务已经进入队列，马上开始。',
      thinking: '会话正在分析并组织输出。',
      waiting: '当前在等待你的输入或授权。',
      done: '最近一步已经完成。',
      error: '最近一次运行报告了错误。',
    },
    hints: {
      offline: '先检查 Gateway 端口、Token / Password 和 OpenClaw 进程。',
      idle: '系统稳定，可以直接开始下一条任务。',
      queued: '排队通常很短，下一步会很快推进。',
      thinking: '思考态不一定会调用工具，也可能只是模型在组织回答。',
      waiting: '给它一个明确输入，或者批准下一步执行。',
      done: '结果已经落地，现在适合继续下一步。',
      error: '先看右侧最近日志，通常能直接定位问题。',
    },
    roles: {
      Main: '主会话',
      Other: '其他会话',
    },
    eventTypes: {
      SYSTEM_CONNECTING: '连接中',
      SYSTEM_CONNECTED: '已连接',
      SYSTEM_DISCONNECTED: '休息中',
      SYSTEM_ERROR: '系统错误',
      HANDSHAKE_CHALLENGE: '握手挑战',
      RUN_STARTED: '开始',
      JOB_STATE: '状态',
      TOOL_STARTED: '工具开始',
      TOOL_RESULT: '工具返回',
      APPROVAL_REQUESTED: '等待授权',
      CHAT_FINAL: '完成',
      RUN_ERROR: '运行错误',
      RAW_EVENT: '原始事件',
      SESSION_IDLE: '回到空闲',
    },
    emptyEvents: '还没有事件。',
    fallbackUnknown: '未知',
    configuredGateway: 'Gateway 已配置',
    connectingToOpenClaw: '正在连接 OpenClaw',
    handshakeComplete: '握手完成',
    connectionClosed: '连接已暂停',
    handshakeChallenge: '收到握手 challenge',
    jobStateUpdate: '任务状态更新',
    approvalRequired: '等待授权',
    responseCompleted: '回答完成',
    usingToolPrefix: '调用工具：',
    toolResultPrefix: '工具返回：',
    receivedEventPrefix: '收到',
    receivedEventSuffix: '事件',
  },
  en: {
    phases: {
      offline: 'Resting',
      idle: 'Idle',
      queued: 'Queued',
      thinking: 'Thinking',
      waiting: 'Waiting',
      done: 'Done',
      error: 'Error',
    },
    connections: {
      connected: 'Connected',
      connecting: 'Connecting',
      error: 'Connection Failed',
      disconnected: 'Resting',
    },
    summaries: {
      offline: 'The pet has not confirmed a live Gateway yet, so it is resting.',
      idle: 'The Gateway handshake succeeded and there is no active task right now.',
      queued: 'The task is queued and about to start.',
      thinking: 'The session is reasoning and preparing output.',
      waiting: 'The session is waiting for your input or approval.',
      done: 'The latest step has completed.',
      error: 'The latest run reported an error.',
    },
    hints: {
      offline: 'Check the Gateway port, token/password, and OpenClaw process first.',
      idle: 'The system is stable and ready for the next task.',
      queued: 'Queue time is usually short before the run advances.',
      thinking: 'Thinking does not always mean a tool call happened.',
      waiting: 'Give it a clear reply, or approve the next action.',
      done: 'The result is in place and ready for the next step.',
      error: 'Start with the recent log on the right to narrow it down.',
    },
    roles: {
      Main: 'Main Session',
      Other: 'Other Session',
    },
    eventTypes: {
      SYSTEM_CONNECTING: 'Connecting',
      SYSTEM_CONNECTED: 'Connected',
      SYSTEM_DISCONNECTED: 'Resting',
      SYSTEM_ERROR: 'System Error',
      HANDSHAKE_CHALLENGE: 'Handshake',
      RUN_STARTED: 'Started',
      JOB_STATE: 'State',
      TOOL_STARTED: 'Tool Start',
      TOOL_RESULT: 'Tool Result',
      APPROVAL_REQUESTED: 'Approval Needed',
      CHAT_FINAL: 'Completed',
      RUN_ERROR: 'Run Error',
      RAW_EVENT: 'Raw Event',
      SESSION_IDLE: 'Back to Idle',
    },
    emptyEvents: 'No events yet.',
    fallbackUnknown: 'unknown',
    configuredGateway: 'Gateway configured',
    connectingToOpenClaw: 'Connecting to OpenClaw',
    handshakeComplete: 'Handshake complete',
    connectionClosed: 'Connection paused',
    handshakeChallenge: 'Received handshake challenge',
    jobStateUpdate: 'Job state update',
    approvalRequired: 'Approval required',
    responseCompleted: 'Response completed',
    usingToolPrefix: 'Using tool: ',
    toolResultPrefix: 'Tool result: ',
    receivedEventPrefix: 'Received ',
    receivedEventSuffix: ' event',
  },
});

function stringsFor(locale = 'zh') {
  return UI_STRINGS[locale] || UI_STRINGS.zh;
}

function pillClass(base, value) {
  return `${base} ${String(value || 'neutral').toLowerCase()}`;
}

function escapeHtml(text) {
  return String(text ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function hasCjk(text = '') {
  return /[\u3400-\u9fff]/.test(String(text));
}

function phaseText(derived, strings) {
  return strings.phases[derived?.phase] || derived?.phase || strings.phases.idle;
}

function summaryText(derived, strings) {
  return strings.summaries[derived?.phase] || strings.summaries.idle;
}

function hintText(derived, strings) {
  return strings.hints[derived?.phase] || strings.hints.idle;
}

function roleText(role, strings) {
  return strings.roles[role] || strings.roles.Other;
}

function eventTypeText(type, strings) {
  return strings.eventTypes[type] || type;
}

const EN_DETAIL_REPLACEMENTS = Object.freeze([
  [/当前没有监听，后台会继续等待 OpenClaw 启动。?/g, 'is not listening yet. The app will keep waiting for OpenClaw to start.'],
  [/连接超时，后台会继续重试。?/g, 'connection timed out. The app will keep retrying in the background.'],
  [/当前不可达（([^）]+)），后台会继续重试。?/g, 'is currently unreachable ($1). The app will keep retrying in the background.'],
  [/当前不可达（([^）]+)）/g, 'is currently unreachable ($1)'],
  [/Gateway 地址无效/g, 'Invalid Gateway URL'],
  [/无法解析 Gateway 地址[:：]\s*/g, 'Could not parse the Gateway URL: '],
  [/请在插件目录执行 npm install/g, 'Run npm install in the plugin directory.'],
  [/请填写 gatewayUrl/g, 'Provide gatewayUrl.'],
  [/未找到手动指定的认证方式/g, 'The requested auth mode is not available.'],
]);

export function localizeDetailText(detail, locale = 'zh') {
  const rawDetail = String(detail || '').trim();
  if (!rawDetail || locale === 'zh') {
    return rawDetail;
  }

  let localized = rawDetail
    .replace(/\u8ba4\u8bc1\u6765\u6e90[:：]\s*/g, 'Auth source: ')
    .replace(/\u8fde\u63a5\u6765\u6e90[:：]\s*/g, 'Connection source: ')
    .replace(/\u7f51\u5173[:：]\s*/g, 'Gateway: ');
  for (const [pattern, replacement] of EN_DETAIL_REPLACEMENTS) {
    localized = localized.replace(pattern, replacement);
  }

  return localized;
}

function eventDetailText(event, locale) {
  return localizeDetailText(event?.detail, locale);
}

function eventLabelText(event, locale, strings) {
  const rawLabel = String(event?.label || '').trim();
  const detail = eventDetailText(event, locale);
  const toolDetail = detail || strings.fallbackUnknown;
  const looksLikeConfiguredGateway = /^wss?:\/\//i.test(detail) && /(auth source:|\u8ba4\u8bc1\u6765\u6e90[:：])/i.test(detail);

  switch (event?.type) {
    case 'SYSTEM_CONNECTING':
      return strings.connectingToOpenClaw;
    case 'SYSTEM_CONNECTED':
      return strings.handshakeComplete;
    case 'SYSTEM_DISCONNECTED':
      return looksLikeConfiguredGateway ? strings.configuredGateway : strings.connectionClosed;
    case 'HANDSHAKE_CHALLENGE':
      return strings.handshakeChallenge;
    case 'JOB_STATE':
      return strings.jobStateUpdate;
    case 'TOOL_STARTED':
      return `${strings.usingToolPrefix}${toolDetail}`;
    case 'TOOL_RESULT':
      return `${strings.toolResultPrefix}${toolDetail}`;
    case 'APPROVAL_REQUESTED':
      return strings.approvalRequired;
    case 'CHAT_FINAL':
      return strings.responseCompleted;
    case 'RAW_EVENT':
      return `${strings.receivedEventPrefix}${detail || strings.fallbackUnknown}${strings.receivedEventSuffix}`;
    default:
      if (locale === 'en' && hasCjk(rawLabel)) {
        return eventTypeText(event?.type, strings);
      }
      return rawLabel || eventTypeText(event?.type, strings);
  }
}

function renderSummary(derived, locale) {
  const strings = stringsFor(locale);
  const statusText = phaseText(derived, strings);
  const glyph = derived.badge || glyphForActivity(derived.activityKind);

  nodes.statusSummary.innerHTML = `
    <article class="summary-card">
      <div class="summary-glyph">${escapeHtml(glyph)}</div>
      <div class="summary-copy">
        <p class="summary-kicker">${escapeHtml(roleText(derived.role, strings))}</p>
        <strong>${escapeHtml(statusText)}</strong>
        <p class="description">${escapeHtml(summaryText(derived, strings))}</p>
        <p class="hint-copy">${escapeHtml(hintText(derived, strings))}</p>
      </div>
    </article>
  `;
}

function renderMetrics(metrics = []) {
  if (!metrics.length) {
    nodes.statusMetrics.innerHTML = '';
    return;
  }

  nodes.statusMetrics.innerHTML = metrics.map((metric) => `
    <dl class="metric">
      <dt>${escapeHtml(metric.label)}</dt>
      <dd class="${metric.mono ? 'mono' : ''}${metric.muted ? ' muted' : ''}">${escapeHtml(metric.value)}</dd>
    </dl>
  `).join('');
}

function renderEventList(container, events, limit, locale, strings) {
  const visibleEvents = events.slice(0, limit);
  if (visibleEvents.length === 0) {
    container.innerHTML = `<li class="event-empty">${escapeHtml(strings.emptyEvents)}</li>`;
    return;
  }

  container.innerHTML = visibleEvents.map((event) => {
    const detail = eventDetailText(event, locale);
    return `
      <li>
        <div class="event-title">${escapeHtml(eventLabelText(event, locale, strings))}</div>
        ${detail && detail !== event.label ? `<div class="detail">${escapeHtml(detail)}</div>` : ''}
        <div class="meta">
          <span>${escapeHtml(formatClock(event.ts))}</span>
          <span>${escapeHtml(eventTypeText(event.type, strings))}</span>
          ${event.sessionKey ? `<span>${escapeHtml(event.sessionKey)}</span>` : ''}
        </div>
      </li>
    `;
  }).join('');
}

export function render(state, options = {}) {
  const locale = options.locale || 'zh';
  const strings = stringsFor(locale);
  const derived = state?.derived || {};

  if (nodes.connectionPill) {
    nodes.connectionPill.className = pillClass('pill', state?.connection);
    nodes.connectionPill.textContent = strings.connections[state?.connection] || strings.connections.disconnected;
  }

  renderSummary(derived, locale);
  renderMetrics(options.metrics || []);
  renderEventList(nodes.eventLog, state?.recentEvents || [], options.eventLimit ?? 18, locale, strings);
}
