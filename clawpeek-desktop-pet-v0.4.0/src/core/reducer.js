import { ACTIVITY, CONFIDENCE, CONNECTION, PHASE, PET_BADGES, THRESHOLDS } from './constants.js';
import { formatDuration, normalizeSessionRole, nowTs } from './utils.js';

function baseSession(sessionKey, mainSessionKey, ts = nowTs()) {
  return {
    sessionKey,
    role: normalizeSessionRole(sessionKey, mainSessionKey),
    runId: null,
    phase: PHASE.IDLE,
    activityKind: ACTIVITY.NONE,
    label: '空闲中',
    confidence: CONFIDENCE.UNKNOWN,
    updatedAt: ts,
    startedAt: null,
    lastProgressAt: ts,
    waitingReason: null,
    error: null,
  };
}

function ensureSession(state, sessionKey, ts = nowTs()) {
  if (state.sessions[sessionKey]) return state.sessions[sessionKey];
  return baseSession(sessionKey, state.settings.mainSessionKey, ts);
}

function withSession(state, sessionKey, updater, ts = nowTs()) {
  const session = ensureSession(state, sessionKey, ts);
  const nextSession = updater(session);
  return {
    ...state,
    sessions: {
      ...state.sessions,
      [sessionKey]: nextSession,
    },
  };
}

function logEvent(state, event) {
  const entry = {
    id: `${event.type}-${event.ts}-${Math.random().toString(36).slice(2, 9)}`,
    ts: event.ts,
    type: event.type,
    sessionKey: event.sessionKey ?? null,
    runId: event.runId ?? null,
    label: event.label ?? event.type,
    detail: event.detail ?? '',
  };
  return {
    ...state,
    recentEvents: [entry, ...state.recentEvents].slice(0, THRESHOLDS.eventLogLimit),
  };
}

function markActiveSession(state, sessionKey, ts) {
  if (!sessionKey) return state;
  return {
    ...state,
    ui: {
      ...state.ui,
      lastActiveSessionKey: sessionKey,
      lastStateChangeAt: ts,
    },
  };
}

function sessionDone(session, event) {
  return {
    ...session,
    phase: PHASE.DONE,
    label: event.label || '已完成',
    confidence: CONFIDENCE.CONFIRMED,
    updatedAt: event.ts,
    lastProgressAt: event.ts,
    error: null,
    waitingReason: null,
  };
}

function sessionIdle(session, ts) {
  return {
    ...session,
    runId: null,
    phase: PHASE.IDLE,
    activityKind: ACTIVITY.NONE,
    label: '空闲中',
    confidence: CONFIDENCE.UNKNOWN,
    updatedAt: ts,
    startedAt: null,
    lastProgressAt: ts,
    waitingReason: null,
    error: null,
  };
}

function sessionOffline(session, ts, label = '休息中') {
  return {
    ...session,
    phase: PHASE.OFFLINE,
    label,
    confidence: CONFIDENCE.UNKNOWN,
    updatedAt: ts,
    waitingReason: null,
  };
}

function inferRawEventPhase(event, session) {
  const detail = String(event.detail || '').toLowerCase();
  const label = String(event.label || '').toLowerCase();

  if (detail.includes('approval') || label.includes('授权')) {
    return PHASE.WAITING;
  }

  if (detail.includes('tool') || label.includes('tool')) {
    return PHASE.TOOL;
  }

  if (session.phase !== PHASE.IDLE && session.phase !== PHASE.OFFLINE) {
    return session.phase;
  }

  return PHASE.THINKING;
}

function inferRawEventLabel(event, phase) {
  switch (phase) {
    case PHASE.WAITING:
      return '等待你的授权';
    case PHASE.TOOL:
      return '正在调用工具';
    case PHASE.THINKING:
      return '正在处理任务';
    default:
      return event.label || '收到新的会话事件';
  }
}

function displaySessionKey(state) {
  const mainKey = state.settings.mainSessionKey;
  const main = state.sessions[mainKey];

  if (main && ![PHASE.IDLE, PHASE.OFFLINE].includes(main.phase)) {
    return mainKey;
  }

  const remembered = state.ui.lastActiveSessionKey;
  if (remembered && state.sessions[remembered] && state.sessions[remembered].phase !== PHASE.IDLE) {
    return remembered;
  }

  const mostRecent = Object.values(state.sessions)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .find((session) => session.phase !== PHASE.IDLE);

  return mostRecent?.sessionKey ?? mainKey;
}

function computeDerivedState(state, ts = nowTs()) {
  const nextSessions = { ...state.sessions };

  for (const [sessionKey, session] of Object.entries(nextSessions)) {
    let next = session;

    if (session.phase === PHASE.DONE && session.updatedAt && ts - session.updatedAt > THRESHOLDS.doneTtlMs) {
      next = sessionIdle(next, ts);
    }

    nextSessions[sessionKey] = next;
  }

  const currentDisplaySessionKey = displaySessionKey({ ...state, sessions: nextSessions });
  const display = nextSessions[currentDisplaySessionKey]
    || baseSession(state.settings.mainSessionKey, state.settings.mainSessionKey, ts);
  const elapsedMs = display.startedAt ? ts - display.startedAt : 0;

  return {
    ...state,
    sessions: nextSessions,
    ui: {
      ...state.ui,
      currentDisplaySessionKey,
    },
    derived: {
      ...display,
      elapsedMs,
      elapsedText: formatDuration(elapsedMs),
      connectionText: connectionText(state.connection),
      badge: PET_BADGES[display.phase] ?? '🦞',
    },
  };
}

function connectionText(connection) {
  switch (connection) {
    case CONNECTION.CONNECTING:
      return '连接中';
    case CONNECTION.CONNECTED:
      return '已连接';
    case CONNECTION.ERROR:
      return '连接失败';
    default:
      return '休息中';
  }
}

export function createInitialState(overrides = {}) {
  const settings = {
    mainSessionKey: 'main',
    ...overrides.settings,
  };

  const initialTs = nowTs();
  const restingMainSession = sessionOffline(baseSession(settings.mainSessionKey, settings.mainSessionKey, initialTs), initialTs);

  const seed = {
    connection: CONNECTION.DISCONNECTED,
    connectionError: null,
    sessions: {
      [settings.mainSessionKey]: restingMainSession,
    },
    recentEvents: [],
    ui: {
      panelOpen: false,
      compact: false,
      settingsOpen: false,
      currentDisplaySessionKey: settings.mainSessionKey,
      lastActiveSessionKey: settings.mainSessionKey,
      lastStateChangeAt: initialTs,
    },
    settings,
    derived: restingMainSession,
  };

  return computeDerivedState(seed);
}

export function reducer(state, event) {
  const ts = event.ts ?? nowTs();
  let next = state;

  switch (event.type) {
    case 'SYSTEM_CONNECTING':
      next = { ...state, connection: CONNECTION.CONNECTING, connectionError: null };
      break;

    case 'SYSTEM_CONNECTED':
      next = {
        ...state,
        connection: CONNECTION.CONNECTED,
        connectionError: null,
        sessions: Object.fromEntries(
          Object.entries(state.sessions).map(([key, session]) => [
            key,
            session.phase === PHASE.OFFLINE ? sessionIdle(session, ts) : session,
          ])
        ),
      };
      break;

    case 'SYSTEM_DISCONNECTED':
      next = {
        ...state,
        connection: CONNECTION.DISCONNECTED,
        connectionError: event.detail ?? null,
        sessions: Object.fromEntries(
          Object.entries(state.sessions).map(([key, session]) => [
            key,
            sessionOffline(session, ts),
          ])
        ),
      };
      break;

    case 'SYSTEM_ERROR':
      next = {
        ...state,
        connection: CONNECTION.ERROR,
        connectionError: event.detail ?? event.label ?? '未知错误',
        sessions: Object.fromEntries(
          Object.entries(state.sessions).map(([key, session]) => [
            key,
            sessionOffline(session, ts),
          ])
        ),
      };
      break;

    case 'SET_MAIN_SESSION_KEY':
      next = {
        ...state,
        settings: { ...state.settings, mainSessionKey: event.mainSessionKey || 'main' },
      };
      break;

    case 'UI_TOGGLE_PANEL':
      next = {
        ...state,
        ui: {
          ...state.ui,
          panelOpen: !state.ui.panelOpen,
          settingsOpen: !state.ui.panelOpen ? state.ui.settingsOpen : false,
        },
      };
      break;

    case 'UI_TOGGLE_COMPACT':
      next = { ...state, ui: { ...state.ui, compact: !state.ui.compact } };
      break;

    case 'UI_SET_PANEL_OPEN':
      next = {
        ...state,
        ui: {
          ...state.ui,
          panelOpen: Boolean(event.open),
          settingsOpen: event.open ? state.ui.settingsOpen : false,
        },
      };
      break;

    case 'UI_TOGGLE_SETTINGS':
      next = {
        ...state,
        ui: {
          ...state.ui,
          panelOpen: true,
          settingsOpen: !state.ui.settingsOpen,
        },
      };
      break;

    case 'UI_SET_SETTINGS_OPEN':
      next = {
        ...state,
        ui: {
          ...state.ui,
          panelOpen: state.ui.panelOpen || Boolean(event.open),
          settingsOpen: Boolean(event.open),
        },
      };
      break;

    case 'RUN_STARTED':
      next = withSession(state, event.sessionKey, (session) => ({
        ...session,
        sessionKey: event.sessionKey,
        role: normalizeSessionRole(event.sessionKey, state.settings.mainSessionKey),
        runId: event.runId ?? session.runId,
        phase: PHASE.QUEUED,
        activityKind: ACTIVITY.NONE,
        label: event.label || '已接收任务',
        confidence: CONFIDENCE.CONFIRMED,
        updatedAt: ts,
        startedAt: session.startedAt ?? ts,
        lastProgressAt: ts,
        waitingReason: null,
        error: null,
      }), ts);
      next = markActiveSession(next, event.sessionKey, ts);
      break;

    case 'JOB_STATE':
      next = withSession(state, event.sessionKey, (session) => {
        const phase = event.state === 'done'
          ? PHASE.DONE
          : event.state === 'error'
            ? PHASE.ERROR
            : PHASE.THINKING;

        const label = event.label || (
          event.state === 'streaming'
            ? '正在思考'
            : event.state === 'started'
              ? '开始处理任务'
              : event.state === 'done'
                ? '已完成'
                : '运行出错'
        );

        return {
          ...session,
          runId: event.runId ?? session.runId,
          phase,
          activityKind: phase === PHASE.THINKING ? ACTIVITY.NONE : session.activityKind,
          label,
          confidence: CONFIDENCE.CONFIRMED,
          updatedAt: ts,
          startedAt: session.startedAt ?? ts,
          lastProgressAt: ts,
          error: phase === PHASE.ERROR ? label : null,
        };
      }, ts);
      next = markActiveSession(next, event.sessionKey, ts);
      break;

    case 'TOOL_STARTED':
      next = withSession(state, event.sessionKey, (session) => ({
        ...session,
        runId: event.runId ?? session.runId,
        phase: PHASE.TOOL,
        activityKind: event.activityKind ?? ACTIVITY.TOOL,
        label: event.label || '正在调用工具',
        confidence: CONFIDENCE.CONFIRMED,
        updatedAt: ts,
        startedAt: session.startedAt ?? ts,
        lastProgressAt: ts,
        waitingReason: null,
        error: null,
      }), ts);
      next = markActiveSession(next, event.sessionKey, ts);
      break;

    case 'TOOL_RESULT':
      next = withSession(state, event.sessionKey, (session) => ({
        ...session,
        runId: event.runId ?? session.runId,
        phase: PHASE.THINKING,
        activityKind: event.activityKind ?? session.activityKind,
        label: event.label || '工具已返回，继续处理中',
        confidence: CONFIDENCE.CONFIRMED,
        updatedAt: ts,
        lastProgressAt: ts,
      }), ts);
      next = markActiveSession(next, event.sessionKey, ts);
      break;

    case 'APPROVAL_REQUESTED':
      next = withSession(state, event.sessionKey, (session) => ({
        ...session,
        runId: event.runId ?? session.runId,
        phase: PHASE.WAITING,
        activityKind: session.activityKind,
        label: event.label || '等待你的授权',
        confidence: CONFIDENCE.CONFIRMED,
        updatedAt: ts,
        lastProgressAt: ts,
        waitingReason: event.detail ?? 'approval',
      }), ts);
      next = markActiveSession(next, event.sessionKey, ts);
      break;

    case 'CHAT_FINAL':
      next = withSession(state, event.sessionKey, (session) => sessionDone(session, event), ts);
      next = markActiveSession(next, event.sessionKey, ts);
      break;

    case 'RUN_ERROR':
      next = withSession(state, event.sessionKey, (session) => ({
        ...session,
        runId: event.runId ?? session.runId,
        phase: PHASE.ERROR,
        label: event.label || '出错了',
        confidence: CONFIDENCE.CONFIRMED,
        updatedAt: ts,
        lastProgressAt: ts,
        error: event.detail ?? event.label ?? 'unknown',
      }), ts);
      next = markActiveSession(next, event.sessionKey, ts);
      break;

    case 'RAW_EVENT':
      if (!event.sessionKey) {
        next = state;
        break;
      }

      next = withSession(state, event.sessionKey, (session) => {
        const phase = inferRawEventPhase(event, session);

        return {
          ...session,
          runId: event.runId ?? session.runId,
          phase,
          activityKind: phase === PHASE.TOOL ? ACTIVITY.TOOL : session.activityKind,
          label: inferRawEventLabel(event, phase),
          confidence: CONFIDENCE.INFERRED,
          updatedAt: ts,
          startedAt: session.startedAt ?? ts,
          lastProgressAt: ts,
        };
      }, ts);
      next = markActiveSession(next, event.sessionKey, ts);
      break;

    case 'SESSION_IDLE':
      next = withSession(state, event.sessionKey, (session) => sessionIdle(session, ts), ts);
      break;

    case 'TICK':
      next = state;
      break;

    case 'CLEAR_EVENTS':
      next = { ...state, recentEvents: [] };
      break;

    default:
      next = state;
      break;
  }

  if (![
    'TICK',
    'UI_TOGGLE_PANEL',
    'UI_SET_PANEL_OPEN',
    'UI_TOGGLE_SETTINGS',
    'UI_SET_SETTINGS_OPEN',
    'UI_TOGGLE_COMPACT',
    'CLEAR_EVENTS',
  ].includes(event.type)) {
    next = logEvent(next, event);
  }

  return computeDerivedState(next, ts);
}
