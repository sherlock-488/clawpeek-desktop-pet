import { normalizeGatewayFrame } from './event-normalizer.js';
import { debugLabelForEvent } from '../core/debug-text.js';

const DIRECT_GATEWAY_CLIENT = Object.freeze({
  id: 'openclaw-control-ui',
  mode: 'webchat',
  displayName: 'ClawPeek',
  version: 'clawpeek-desktop-pet/0.4.0',
});

const DEBUG_SENSITIVE_PATH_PATTERN = /(token|password|secret|authorization|signature|privatekey|private_key|publickey|public_key)/i;
const DEBUG_INTERESTING_PATH_PATTERN = /(tool|function|call|command|url|path|search|browser|web|args?|input|output|message|text|content|delta|part|type|kind|name)/i;
const DEBUG_INTERESTING_VALUE_PATTERN = /(tool_call|tool_use|tool_result|function_call|function_call_output|search_query|web_search|browse|browser|https?:\/\/)/i;
const DEBUG_MAX_DEPTH = 4;
const DEBUG_MAX_ARRAY_ITEMS = 4;
const DEBUG_MAX_OBJECT_KEYS = 12;
const DEBUG_MAX_HINTS = 24;
const DEBUG_MAX_STRING_LENGTH = 160;

export function buildConnectClientInfo(settings = {}, env = {}) {
  const instanceId = String(settings.instanceId || settings.clientId || '').trim();

  return {
    id: DIRECT_GATEWAY_CLIENT.id,
    displayName: DIRECT_GATEWAY_CLIENT.displayName,
    version: String(env.version || DIRECT_GATEWAY_CLIENT.version),
    platform: String(env.platform || 'desktop-main'),
    mode: DIRECT_GATEWAY_CLIENT.mode,
    ...(instanceId ? { instanceId } : {}),
  };
}

function summarizeFrame(frame = {}) {
  const payload = frame.payload || {};
  const data = payload.data && typeof payload.data === 'object' ? payload.data : {};

  return {
    type: frame.type,
    event: frame.event || '',
    ok: frame.ok,
    sessionKey: payload.sessionKey || payload.session || '',
    runId: payload.runId || payload.id || '',
    stream: payload.stream || payload.kind || data.stream || '',
    payloadType: payload.type || payload.kind || '',
    dataType: data.type || data.kind || data.event || '',
    toolName: data.name || data.toolName || payload.name || payload.toolName || '',
    state: data.state || payload.state || '',
  };
}

function truncateDebugText(value, maxLength = DEBUG_MAX_STRING_LENGTH) {
  const text = String(value ?? '');
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
}

function redactDebugValue(value) {
  if (typeof value === 'string') return `[redacted:${value.length}]`;
  if (Array.isArray(value)) return `[redacted:array(${value.length})]`;
  if (value && typeof value === 'object') return '[redacted:object]';
  return '[redacted]';
}

function sanitizeDebugValue(value, path = '', depth = 0) {
  if (path && DEBUG_SENSITIVE_PATH_PATTERN.test(path)) {
    return redactDebugValue(value);
  }

  if (value == null || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    return truncateDebugText(value);
  }

  if (typeof value === 'bigint') {
    return `${value}n`;
  }

  if (typeof value === 'function' || typeof value === 'symbol') {
    return `[${typeof value}]`;
  }

  if (Array.isArray(value)) {
    if (depth >= DEBUG_MAX_DEPTH) {
      return `[array(${value.length})]`;
    }

    const items = value
      .slice(0, DEBUG_MAX_ARRAY_ITEMS)
      .map((item, index) => sanitizeDebugValue(item, `${path}[${index}]`, depth + 1));

    if (value.length > DEBUG_MAX_ARRAY_ITEMS) {
      items.push(`[+${value.length - DEBUG_MAX_ARRAY_ITEMS} more items]`);
    }

    return items;
  }

  if (typeof value === 'object') {
    const keys = Object.keys(value);
    if (depth >= DEBUG_MAX_DEPTH) {
      const previewKeys = keys.slice(0, 6);
      return `[object keys=${previewKeys.join(',')}${keys.length > previewKeys.length ? ` +${keys.length - previewKeys.length} more` : ''}]`;
    }

    const result = {};
    for (const key of keys.slice(0, DEBUG_MAX_OBJECT_KEYS)) {
      result[key] = sanitizeDebugValue(value[key], path ? `${path}.${key}` : key, depth + 1);
    }

    if (keys.length > DEBUG_MAX_OBJECT_KEYS) {
      result.__truncatedKeys = keys.length - DEBUG_MAX_OBJECT_KEYS;
    }

    return result;
  }

  return String(value);
}

function previewDebugScalar(value) {
  if (value == null) return 'null';
  if (typeof value === 'string') return truncateDebugText(value, 100);
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  return `[${typeof value}]`;
}

function pushDebugHint(hints, hint) {
  if (hints.length >= DEBUG_MAX_HINTS) return;
  hints.push(hint);
}

function collectDebugHints(value, path = 'payload', depth = 0, hints = []) {
  if (hints.length >= DEBUG_MAX_HINTS || depth > DEBUG_MAX_DEPTH + 1) {
    return hints;
  }

  if (path && DEBUG_SENSITIVE_PATH_PATTERN.test(path)) {
    if (DEBUG_INTERESTING_PATH_PATTERN.test(path)) {
      pushDebugHint(hints, { path, type: 'redacted' });
    }
    return hints;
  }

  if (Array.isArray(value)) {
    if (depth <= 1 || DEBUG_INTERESTING_PATH_PATTERN.test(path)) {
      pushDebugHint(hints, {
        path,
        type: 'array',
        length: value.length,
        itemTypes: [...new Set(value.slice(0, DEBUG_MAX_ARRAY_ITEMS).map((item) => (
          Array.isArray(item) ? 'array' : item === null ? 'null' : typeof item
        )))],
      });
    }

    value.slice(0, DEBUG_MAX_ARRAY_ITEMS).forEach((item, index) => {
      collectDebugHints(item, `${path}[${index}]`, depth + 1, hints);
    });
    return hints;
  }

  if (value && typeof value === 'object') {
    const keys = Object.keys(value);
    const interestingKeys = keys.filter((key) => DEBUG_INTERESTING_PATH_PATTERN.test(key)).slice(0, 8);

    if (depth <= 1 || interestingKeys.length > 0) {
      pushDebugHint(hints, {
        path,
        type: 'object',
        keys: keys.slice(0, 8),
        ...(interestingKeys.length > 0 ? { interestingKeys } : {}),
      });
    }

    keys.slice(0, DEBUG_MAX_OBJECT_KEYS).forEach((key) => {
      collectDebugHints(value[key], `${path}.${key}`, depth + 1, hints);
    });
    return hints;
  }

  if (
    DEBUG_INTERESTING_PATH_PATTERN.test(path)
    || (typeof value === 'string' && DEBUG_INTERESTING_VALUE_PATTERN.test(value))
  ) {
    pushDebugHint(hints, {
      path,
      type: value == null ? 'null' : typeof value,
      preview: previewDebugScalar(value),
    });
  }

  return hints;
}

export function buildFrameDebugSnapshot(frame = {}) {
  const payload = frame.payload || {};
  const data = payload.data && typeof payload.data === 'object' ? payload.data : {};
  const summary = summarizeFrame(frame);
  const payloadHints = collectDebugHints(payload, 'payload');
  const errorHints = frame.error ? collectDebugHints(frame.error, 'error') : [];

  return {
    ...summary,
    payloadKeys: Object.keys(payload).slice(0, DEBUG_MAX_OBJECT_KEYS),
    dataKeys: Object.keys(data).slice(0, DEBUG_MAX_OBJECT_KEYS),
    payloadPreview: sanitizeDebugValue(payload, 'payload'),
    ...(payloadHints.length ? { payloadHints } : {}),
    ...(frame.error ? { errorPreview: sanitizeDebugValue(frame.error, 'error') } : {}),
    ...(errorHints.length ? { errorHints } : {}),
  };
}

function summarizeEvent(event = {}) {
  return {
    type: event.type,
    sessionKey: event.sessionKey || '',
    runId: event.runId || '',
    activityKind: event.activityKind || '',
    label: debugLabelForEvent(event),
    detail: event.detail || '',
  };
}

export function dedupeSyntheticEvents(events = [], memory = new Set()) {
  const filtered = [];

  for (const event of events) {
    const key = typeof event?.syntheticSignature === 'string' ? event.syntheticSignature : '';
    if (!key) {
      filtered.push(event);
      continue;
    }

    if (memory.has(key)) {
      continue;
    }

    memory.add(key);
    filtered.push(event);

    while (memory.size > 512) {
      const oldest = memory.values().next().value;
      if (!oldest) break;
      memory.delete(oldest);
    }
  }

  return filtered;
}

export function cleanupSyntheticEventMemory(memory = new Set(), events = []) {
  if (!memory.size) return;

  for (const event of events) {
    if (event.type === 'SYSTEM_DISCONNECTED' || event.type === 'SYSTEM_ERROR') {
      memory.clear();
      return;
    }

    if (!['CHAT_FINAL', 'RUN_ERROR'].includes(event.type)) {
      continue;
    }

    const scope = String(event.runId || event.sessionKey || '').trim();
    if (!scope) {
      continue;
    }

    const needle = `:${scope}:`;
    for (const key of [...memory]) {
      if (key.includes(needle)) {
        memory.delete(key);
      }
    }
  }
}

function shouldLogFrame(frame = {}, normalizedEvents = []) {
  if (normalizedEvents.some((event) => ['TOOL_STARTED', 'TOOL_RESULT', 'APPROVAL_REQUESTED'].includes(event.type))) {
    return true;
  }

  return frame?.type === 'event' && [
    'agent',
    'chat',
    'exec.approval.requested',
    'error',
  ].includes(frame.event);
}

function emitDebugLog(scope, payload) {
  try {
    window?.desktopPetAPI?.debugLog?.(scope, payload);
  } catch {
    // Ignore debug logging failures.
  }
}

export class BaseClient {
  constructor() {
    this.listeners = new Set();
    this.statusListeners = new Set();
  }

  onEvent(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onStatus(listener) {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  emitEvent(event) {
    for (const listener of this.listeners) listener(event);
  }

  emitStatus(status) {
    for (const listener of this.statusListeners) listener(status);
  }

  async connect() {
    throw new Error('connect() not implemented');
  }

  async disconnect() {
    throw new Error('disconnect() not implemented');
  }
}

export class MainProcessGatewayClient extends BaseClient {
  constructor(settings = {}) {
    super();
    this.settings = settings;
    this.unsubscribeStatus = null;
    this.unsubscribeFrame = null;
    this.syntheticEventKeys = new Set();
  }

  async connect() {
    if (!window?.desktopPetAPI) {
      throw new Error('desktopPetAPI is unavailable');
    }

    if (!this.unsubscribeStatus) {
      this.unsubscribeStatus = window.desktopPetAPI.onGatewayStatus((status) => {
        this.emitStatus(status);
      });
    }

    if (!this.unsubscribeFrame) {
      this.unsubscribeFrame = window.desktopPetAPI.onGatewayFrame((frame) => {
        const normalizedEvents = dedupeSyntheticEvents(
          normalizeGatewayFrame(frame, Date.now()),
          this.syntheticEventKeys,
        );

        if (shouldLogFrame(frame, normalizedEvents)) {
          emitDebugLog('gateway-client', {
            frame: buildFrameDebugSnapshot(frame),
            normalized: normalizedEvents.map(summarizeEvent),
          });
        }

        for (const event of normalizedEvents) {
          this.emitEvent(event);
        }

        cleanupSyntheticEventMemory(this.syntheticEventKeys, normalizedEvents);
      });
    }

    await window.desktopPetAPI.startGatewayBridge({
      mainSessionKey: this.settings.mainSessionKey,
    });
  }

  async disconnect() {
    this.unsubscribeStatus?.();
    this.unsubscribeStatus = null;
    this.unsubscribeFrame?.();
    this.unsubscribeFrame = null;
    this.syntheticEventKeys.clear();
    await window.desktopPetAPI.stopGatewayBridge();
  }
}

export function createClient(settings) {
  return new MainProcessGatewayClient(settings);
}
