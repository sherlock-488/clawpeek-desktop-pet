import { classifyTool } from '../core/activity.js';
import { pick, truncate } from '../core/utils.js';

const IGNORED_GATEWAY_EVENTS = new Set([
  'health',
  'heartbeat',
  'presence',
  'tick',
]);

function formatGatewayError(error = {}) {
  const message = error?.message || 'unknown error';
  const detailCode = typeof error?.details?.code === 'string' ? error.details.code : '';
  return detailCode ? `${message} (${detailCode})` : message;
}

function labelFromSystemRunPlan(plan = {}) {
  const raw = plan.rawCommand || plan.command || (Array.isArray(plan.argv) ? plan.argv.join(' ') : '');
  return raw ? `等待授权：${truncate(raw, 72)}` : '等待你的授权';
}

function lower(value) {
  return String(value ?? '').toLowerCase();
}

function normalizeToolPhase(value) {
  const phase = lower(value);

  if (
    phase.includes('result')
    || phase.includes('output')
    || phase.includes('finish')
    || phase.includes('done')
    || phase.includes('complete')
    || phase === 'function_call_output'
    || phase === 'tool_result'
  ) {
    return 'result';
  }

  return 'start';
}

function parseArgsLike(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value;
  }

  if (typeof value !== 'string') {
    return {};
  }

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function extractToolEvent(payload, data, stream) {
  const typeHint = lower(data?.type || data?.kind || data?.event || payload?.type || payload?.kind || stream);
  const toolName = data?.name
    || data?.toolName
    || data?.tool?.name
    || payload?.name
    || payload?.toolName
    || payload?.tool?.name
    || '';
  const args = data?.args
    || data?.arguments
    || data?.input
    || data?.params
    || payload?.args
    || payload?.arguments
    || payload?.input
    || payload?.params
    || {};
  const meta = {
    ...(data?.meta && typeof data.meta === 'object' ? data.meta : {}),
    ...(payload?.meta && typeof payload.meta === 'object' ? payload.meta : {}),
  };

  const hasToolFields = Boolean(
    toolName
    || data?.callId
    || data?.toolCallId
    || payload?.callId
    || payload?.toolCallId
    || data?.command
    || data?.path
    || data?.url
    || payload?.command
    || payload?.path
    || payload?.url
  );
  const looksLikeTool =
    stream === 'tool'
    || typeHint.includes('tool')
    || typeHint.includes('function_call')
    || typeHint.includes('tool_use')
    || typeHint.includes('tool_call')
    || hasToolFields;

  if (!looksLikeTool) return null;

  const normalizedArgs = { ...parseArgsLike(args) };

  if (!('command' in normalizedArgs) && (data?.command || payload?.command)) {
    normalizedArgs.command = data?.command || payload?.command;
  }

  if (!('path' in normalizedArgs) && (data?.path || payload?.path)) {
    normalizedArgs.path = data?.path || payload?.path;
  }

  if (!('url' in normalizedArgs) && (data?.url || payload?.url)) {
    normalizedArgs.url = data?.url || payload?.url;
  }

  if (!meta.mode && typeHint.includes('read')) meta.mode = 'read';
  if (!meta.mode && typeHint.includes('write')) meta.mode = 'write';

  const classified = classifyTool(toolName || typeHint || 'tool', normalizedArgs, meta);

  return {
    type: normalizeToolPhase(data?.phase || payload?.phase || data?.type || data?.kind || payload?.type || payload?.kind) === 'result'
      ? 'TOOL_RESULT'
      : 'TOOL_STARTED',
    activityKind: classified.activityKind,
    label: classified.label,
    detail: toolName || typeHint || 'tool',
  };
}

function normalizeAgentEvent(frame, ts) {
  const payload = frame.payload || {};
  const sessionKey = payload.sessionKey || payload.session || 'main';
  const runId = payload.runId || payload.id || null;
  const stream = payload.stream || payload.kind || pick(payload, ['data', 'stream']);
  const data = payload.data || payload;
  const toolEvent = extractToolEvent(payload, data, stream);

  if (stream === 'job') {
    const state = data.state || payload.state || 'started';
    return [{
      type: 'JOB_STATE',
      ts,
      sessionKey,
      runId,
      state,
      label: state === 'streaming'
        ? '正在思考'
        : state === 'started'
          ? '开始处理任务'
          : state === 'done'
            ? '已完成'
            : '运行出错',
      detail: frame.event,
    }];
  }

  if (toolEvent) {
    return [{
      type: toolEvent.type,
      ts,
      sessionKey,
      runId,
      activityKind: toolEvent.activityKind,
      label: toolEvent.label,
      detail: toolEvent.detail,
    }];
  }

  return [{
    type: 'RAW_EVENT',
    ts,
    sessionKey,
    runId,
    label: `收到 agent.${stream || 'unknown'} 事件`,
    detail: `agent.${stream || 'unknown'}`,
  }];
}

function normalizeChatEvent(frame, ts) {
  const payload = frame.payload || {};
  const sessionKey = payload.sessionKey || payload.session || 'main';
  const runId = payload.runId || payload.id || null;
  const state = payload.state || payload.kind || payload.type || '';

  if (['final', 'done', 'complete', 'completed'].includes(String(state).toLowerCase())) {
    const text = payload.text || payload.message || payload.preview || '已完成';
    return [{
      type: 'CHAT_FINAL',
      ts,
      sessionKey,
      runId,
      label: `完成：${truncate(text, 80)}`,
      detail: 'chat.final',
    }];
  }

  return [];
}

function normalizeApprovalEvent(frame, ts) {
  const payload = frame.payload || {};
  const sessionKey = payload.sessionKey || pick(payload, ['systemRunPlan', 'sessionKey']) || 'main';
  const runId = payload.runId || pick(payload, ['systemRunPlan', 'runId']) || null;
  const label = labelFromSystemRunPlan(payload.systemRunPlan || {});

  return [{
    type: 'APPROVAL_REQUESTED',
    ts,
    sessionKey,
    runId,
    label,
    detail: payload.approvalId || 'approval',
  }];
}

function normalizeError(frame, ts) {
  const payload = frame.payload || {};
  const sessionKey = payload.sessionKey || 'main';
  const runId = payload.runId || null;
  const label = payload.message || payload.error || '运行出错';

  return [{
    type: 'RUN_ERROR',
    ts,
    sessionKey,
    runId,
    label,
    detail: typeof payload === 'string' ? payload : JSON.stringify(payload),
  }];
}

export function normalizeGatewayFrame(frame, ts = Date.now()) {
  if (!frame || typeof frame !== 'object') return [];

  if (frame.type === 'res' && frame.ok && frame.payload?.type === 'hello-ok') {
    return [{ type: 'SYSTEM_CONNECTED', ts, label: '握手成功', detail: `protocol=${frame.payload.protocol}` }];
  }

  if (frame.type === 'res' && frame.ok === false) {
    return [{
      type: 'SYSTEM_ERROR',
      ts,
      label: formatGatewayError(frame.error),
      detail: JSON.stringify(frame.error?.details || {}),
    }];
  }

  if (frame.type !== 'event') return [];

  if (IGNORED_GATEWAY_EVENTS.has(frame.event)) {
    return [];
  }

  switch (frame.event) {
    case 'connect.challenge':
      return [{ type: 'HANDSHAKE_CHALLENGE', ts, label: '收到握手 challenge', detail: 'connect.challenge' }];
    case 'agent':
      return normalizeAgentEvent(frame, ts);
    case 'chat':
      return normalizeChatEvent(frame, ts);
    case 'exec.approval.requested':
      return normalizeApprovalEvent(frame, ts);
    case 'shutdown':
      return [{ type: 'SYSTEM_DISCONNECTED', ts, label: 'Gateway 已关闭', detail: 'shutdown' }];
    case 'error':
      return normalizeError(frame, ts);
    default:
      return [{
        type: 'RAW_EVENT',
        ts,
        sessionKey: frame.payload?.sessionKey || null,
        runId: frame.payload?.runId || null,
        label: `收到 ${frame.event} 事件`,
        detail: frame.event,
      }];
  }
}
