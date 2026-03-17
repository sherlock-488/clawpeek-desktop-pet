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

function uniqueTextValues(values = []) {
  const seen = new Set();
  const ordered = [];

  for (const value of values) {
    const text = typeof value === 'string' ? value.trim() : '';
    if (!text || seen.has(text)) continue;
    seen.add(text);
    ordered.push(text);
  }

  return ordered.sort((left, right) => right.length - left.length);
}

function extractTextCandidates(payload = {}, data = {}) {
  const candidates = [];
  const push = (value) => {
    if (typeof value === 'string' && value.trim()) {
      candidates.push(value);
    }
  };

  push(data?.text);
  push(data?.delta);
  push(payload?.text);
  push(payload?.preview);

  if (typeof payload?.message === 'string') {
    push(payload.message);
  }

  if (payload?.message && typeof payload.message === 'object') {
    push(payload.message.text);

    if (Array.isArray(payload.message.content)) {
      for (const part of payload.message.content) {
        if (part?.type === 'text') {
          push(part.text);
        }
      }
    }
  }

  if (Array.isArray(data?.content)) {
    for (const part of data.content) {
      if (part?.type === 'text') {
        push(part.text);
      }
    }
  }

  return uniqueTextValues(candidates);
}

function extractToolNameFromJsonish(text = '') {
  const match = String(text).match(/"name"\s*:\s*"([^"]+)"/i);
  return match?.[1] || '';
}

function extractJsonishValue(text = '', key) {
  const match = String(text).match(new RegExp(`"${key}"\\s*:\\s*"([^"]+)"`, 'i'));
  return match?.[1] || '';
}

function tryParseToolCallPayload(text = '') {
  const raw = String(text || '').trim();
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function classifySyntheticTool(detail, toolName = '', args = {}) {
  if (toolName) {
    return classifyTool(toolName, args);
  }

  const normalizedDetail = lower(detail);
  if (
    normalizedDetail.includes('open-meteo')
    || normalizedDetail.includes('weather')
    || normalizedDetail.includes('search')
    || normalizedDetail.includes('meteo')
  ) {
    return classifyTool('web_search', { query: detail });
  }

  return classifyTool(detail || 'tool', args);
}

function buildSyntheticToolEvent(type, sessionKey, runId, detail, classified, syntheticSignature) {
  return {
    type,
    sessionKey,
    runId,
    activityKind: classified.activityKind,
    label: classified.label,
    detail,
    syntheticSignature,
  };
}

function extractWeatherDataDetail(text = '') {
  const match = String(text).match(/已获取到([^。；\n]{0,80}?(?:天气数据|天气预报|逐小时天气))/i);
  return match?.[1]?.trim() || '天气数据';
}

function inferTextToolEvents(payload = {}, data = {}, sessionKey, runId) {
  const texts = extractTextCandidates(payload, data);
  if (!texts.length) return [];

  for (const text of texts) {
    const toolCallMarker = text.match(/TOOLCALL>\s*([\s\S]+)/i);
    if (toolCallMarker) {
      const parsed = tryParseToolCallPayload(toolCallMarker[1]);
      const entry = Array.isArray(parsed) ? parsed[0] : parsed;
      const toolName = entry?.name || extractToolNameFromJsonish(toolCallMarker[1]);
      if (toolName) {
        const args = parseArgsLike(entry?.input || entry?.arguments || entry?.args || {
          query: extractJsonishValue(toolCallMarker[1], 'query'),
          q: extractJsonishValue(toolCallMarker[1], 'q'),
          url: extractJsonishValue(toolCallMarker[1], 'url'),
          path: extractJsonishValue(toolCallMarker[1], 'path'),
          command: extractJsonishValue(toolCallMarker[1], 'command'),
        });
        const classified = classifySyntheticTool(toolName, toolName, args);

        return [
          buildSyntheticToolEvent(
            'TOOL_STARTED',
            sessionKey,
            runId,
            toolName,
            classified,
            `toolcall:${runId || sessionKey}:${toolName}`,
          ),
        ];
      }
    }

    const successfulToolMatch = text.match(/(?:成功调用工具|已调用工具|successfully called tool|called tool)\s*[:：]\s*([A-Za-z0-9_.-]+)/i);
    if (successfulToolMatch) {
      const toolName = successfulToolMatch[1];
      const classified = classifySyntheticTool(toolName, toolName);

      return [
        buildSyntheticToolEvent(
          'TOOL_STARTED',
          sessionKey,
          runId,
          toolName,
          classified,
          `tool-success:${runId || sessionKey}:${toolName}`,
        ),
      ];
    }

    const apiResultMatch = text.match(/(?:已通过|通过)\s+([A-Za-z0-9][A-Za-z0-9 ._-]{1,64}?API)\s*(?:获取到|查询到|拿到)/i)
      || text.match(/(?:retrieved|fetched|obtained)\s+(?:data|results)?\s*(?:via|through|from)\s+([A-Za-z0-9][A-Za-z0-9 ._-]{1,64}?API)/i);
    if (apiResultMatch) {
      const apiName = apiResultMatch[1].trim();
      const classified = classifySyntheticTool(apiName);

      return [
        buildSyntheticToolEvent(
          'TOOL_STARTED',
          sessionKey,
          runId,
          apiName,
          classified,
          `api-tool-start:${runId || sessionKey}:${lower(apiName)}`,
        ),
        buildSyntheticToolEvent(
          'TOOL_RESULT',
          sessionKey,
          runId,
          apiName,
          classified,
          `api-tool-result:${runId || sessionKey}:${lower(apiName)}`,
        ),
      ];
    }

    const looksLikeWeatherData = /已获取到[^。；\n]{0,120}?(?:天气数据|天气预报|逐小时天气)/i.test(text)
      || /(?:retrieved|fetched|obtained)[^.\n]{0,120}?(?:weather data|weather forecast|hourly weather)/i.test(text);
    if (looksLikeWeatherData) {
      const detail = extractWeatherDataDetail(text);
      const classified = classifyTool('weather_api', { query: detail });

      return [
        buildSyntheticToolEvent(
          'TOOL_STARTED',
          sessionKey,
          runId,
          detail,
          classified,
          `weather-data-start:${runId || sessionKey}:${lower(detail)}`,
        ),
        buildSyntheticToolEvent(
          'TOOL_RESULT',
          sessionKey,
          runId,
          detail,
          classified,
          `weather-data-result:${runId || sessionKey}:${lower(detail)}`,
        ),
      ];
    }
  }

  return [];
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
  const inferredToolEvents = inferTextToolEvents(payload, data, sessionKey, runId);

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

  if (inferredToolEvents.length) {
    return inferredToolEvents.map((event) => ({
      ...event,
      ts,
    }));
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
  const inferredToolEvents = inferTextToolEvents(payload, payload.message || payload, sessionKey, runId)
    .map((event) => ({
      ...event,
      ts,
    }));

  if (['final', 'done', 'complete', 'completed'].includes(String(state).toLowerCase())) {
    const text = extractTextCandidates(payload, payload.message || payload)[0] || payload.text || payload.preview || '已完成';
    return [
      ...inferredToolEvents,
      {
        type: 'CHAT_FINAL',
        ts,
        sessionKey,
        runId,
        label: `完成：${truncate(text, 80)}`,
        detail: 'chat.final',
      },
    ];
  }

  return inferredToolEvents;
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
