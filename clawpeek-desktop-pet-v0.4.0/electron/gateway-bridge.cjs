const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const crypto = require('crypto');
const { EventEmitter } = require('events');

let NodeWebSocket = null;
try {
  NodeWebSocket = require('ws');
} catch {
  NodeWebSocket = null;
}

function randomId(prefix = 'id') {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeString(value) {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value).trim();
  return '';
}

function normalizeAuthPreference(value) {
  const normalized = normalizeString(value);
  return ['auto', 'shared-token', 'password', 'device-token'].includes(normalized) ? normalized : 'auto';
}

function safeJsonParse(text) {
  try {
    return JSON.parse(String(text ?? ''));
  } catch {
    return null;
  }
}

function createGatewayRequestError(error = {}, fallbackMessage = 'gateway request failed') {
  const message = normalizeString(error.message) || fallbackMessage;
  const requestError = new Error(message);
  requestError.code = normalizeString(error.code || error?.details?.code);
  requestError.details = error?.details || {};
  return requestError;
}

function toBase64Url(buffer) {
  return Buffer.from(buffer)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function fromBase64Url(value) {
  const normalized = String(value ?? '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  return Buffer.from(padded, 'base64');
}

function buildDeviceAuthPayload({
  deviceId,
  clientId,
  clientMode,
  role,
  scopes,
  signedAtMs,
  token,
  nonce,
}) {
  return [
    'v2',
    deviceId,
    clientId,
    clientMode,
    role,
    Array.isArray(scopes) ? scopes.join(',') : '',
    String(signedAtMs),
    token ?? '',
    nonce,
  ].join('|');
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function writeJsonFile(filePath, data) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function defaultIdentityFile() {
  return path.join(os.homedir(), '.openclaw', 'clawpeek-device.json');
}

function loadOrCreateDeviceState(filePath = defaultIdentityFile()) {
  const stored = readJsonFile(filePath);
  if (
    stored
    && typeof stored.deviceId === 'string'
    && typeof stored.publicKey === 'string'
    && typeof stored.privateKeyPkcs8 === 'string'
  ) {
    return stored;
  }

  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const jwk = publicKey.export({ format: 'jwk' });
  const publicKeyRaw = fromBase64Url(jwk.x);
  const privateKeyPkcs8 = privateKey.export({ type: 'pkcs8', format: 'der' });
  const deviceId = crypto.createHash('sha256').update(publicKeyRaw).digest('hex');

  const identity = {
    deviceId,
    publicKey: toBase64Url(publicKeyRaw),
    privateKeyPkcs8: toBase64Url(privateKeyPkcs8),
    deviceToken: normalizeString(stored?.deviceToken),
  };

  writeJsonFile(filePath, identity);
  return identity;
}

function persistDeviceToken(filePath, token) {
  const normalizedToken = normalizeString(token);
  if (!normalizedToken) return;

  const state = loadOrCreateDeviceState(filePath);
  if (state.deviceToken === normalizedToken) return;
  state.deviceToken = normalizedToken;
  writeJsonFile(filePath, state);
}

function signDevicePayload(identity, payload) {
  const privateKey = crypto.createPrivateKey({
    key: fromBase64Url(identity.privateKeyPkcs8),
    type: 'pkcs8',
    format: 'der',
  });

  const signature = crypto.sign(null, Buffer.from(String(payload ?? ''), 'utf8'), privateKey);
  return toBase64Url(signature);
}

function parseGatewaySocketTarget(gatewayUrl) {
  try {
    const url = new URL(normalizeString(gatewayUrl));
    const defaultPort = url.protocol === 'wss:' ? 443 : 80;
    return {
      host: url.hostname,
      port: Number.parseInt(url.port || String(defaultPort), 10),
      protocol: url.protocol,
    };
  } catch {
    return null;
  }
}

function probeGatewayPort(gatewayUrl, timeoutMs = 1200) {
  const target = parseGatewaySocketTarget(gatewayUrl);
  if (!target || !target.host || !Number.isFinite(target.port)) {
    return Promise.resolve({ ok: false, code: 'INVALID_URL', detail: 'invalid gateway url', target: null });
  }

  return new Promise((resolve) => {
    const socket = net.createConnection({ host: target.host, port: target.port });
    let settled = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({ ...result, target });
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish({ ok: true }));
    socket.once('timeout', () => finish({ ok: false, code: 'TIMEOUT', detail: 'connect timeout' }));
    socket.once('error', (error) => finish({
      ok: false,
      code: normalizeString(error?.code || 'ERROR'),
      detail: error instanceof Error ? error.message : String(error),
    }));
  });
}

function authFailureCode(error = {}) {
  const details = error?.details || {};
  return normalizeString(details.code || error.code).toUpperCase();
}

function isRetryableAuthFailure(error = {}) {
  const code = authFailureCode(error);
  return [
    'AUTH_TOKEN_MISMATCH',
    'AUTH_TOKEN_MISSING',
    'AUTH_PASSWORD_MISMATCH',
    'AUTH_PASSWORD_MISSING',
    'AUTH_INVALID',
    'INVALID_AUTH',
  ].includes(code);
}

function isExpectedNetworkErrorCode(code = '') {
  return [
    'ECONNREFUSED',
    'ECONNRESET',
    'EHOSTUNREACH',
    'ENETUNREACH',
    'EPIPE',
    'ETIMEDOUT',
    'TIMEOUT',
  ].includes(normalizeString(code).toUpperCase());
}

function computeOfflineReconnectDelayMs(attemptCount = 1) {
  const normalizedAttempt = Math.max(1, Number(attemptCount) || 1);
  return Math.min(20_000, 2_500 * (2 ** (normalizedAttempt - 1)));
}

function describeGatewayProbeFailure(probe = {}) {
  if (!probe?.target) {
    return {
      label: 'Gateway 地址无效',
      detail: `无法解析 Gateway 地址：${normalizeString(probe?.detail) || 'INVALID_URL'}`,
    };
  }

  const code = normalizeString(probe.code).toUpperCase();
  const endpoint = `${probe.target.host}:${probe.target.port}`;

  switch (code) {
    case 'ECONNREFUSED':
      return {
        label: 'OpenClaw 未启动，龙虾休息中',
        detail: `${endpoint} 当前没有监听，后台会继续等待 OpenClaw 启动。`,
      };
    case 'TIMEOUT':
    case 'ETIMEDOUT':
      return {
        label: 'Gateway 无响应，龙虾休息中',
        detail: `${endpoint} 连接超时，后台会继续重试。`,
      };
    default:
      return {
        label: 'OpenClaw 不在线，龙虾休息中',
        detail: `${endpoint} 当前不可达（${code || 'UNREACHABLE'}${probe.detail ? `: ${probe.detail}` : ''}），后台会继续重试。`,
      };
  }
}

function describeGatewayDisconnect(code, reason) {
  const normalizedReason = normalizeString(reason).toLowerCase();
  const detail = normalizedReason ? `code=${code} · ${normalizedReason}` : `code=${code}`;

  if (normalizedReason === 'manual-stop') {
    return {
      label: '已暂停连接，龙虾休息中',
      detail: 'manual-stop',
    };
  }

  if (normalizedReason.includes('shutdown')) {
    return {
      label: 'OpenClaw 已关闭，龙虾休息中',
      detail,
    };
  }

  if (normalizedReason.includes('restart')) {
    return {
      label: 'OpenClaw 重启中，龙虾休息中',
      detail,
    };
  }

  return {
    label: 'OpenClaw 已断开，龙虾休息中',
    detail,
  };
}

const DEBUG_SENSITIVE_PATH_PATTERN = /(token|password|secret|authorization|signature|privatekey|private_key|publickey|public_key)/i;
const DEBUG_INTERESTING_PATH_PATTERN = /(tool|function|call|command|url|path|search|browser|web|args?|input|output|message|text|content|delta|part|type|kind|name)/i;
const DEBUG_INTERESTING_VALUE_PATTERN = /(tool_call|tool_use|tool_result|function_call|function_call_output|search_query|web_search|browse|browser|https?:\/\/)/i;
const DEBUG_MAX_DEPTH = 4;
const DEBUG_MAX_ARRAY_ITEMS = 4;
const DEBUG_MAX_OBJECT_KEYS = 12;
const DEBUG_MAX_HINTS = 24;
const DEBUG_MAX_STRING_LENGTH = 160;

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

function buildFrameDebugSnapshot(frame = {}) {
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

const DIRECT_GATEWAY_CLIENT = Object.freeze({
  id: 'openclaw-control-ui',
  mode: 'webchat',
  displayName: 'ClawPeek',
  version: 'clawpeek-desktop-pet/0.4.0',
  caps: ['tool-events'],
});

const DIRECT_GATEWAY_ROLE = 'operator';
const DIRECT_GATEWAY_SCOPES = Object.freeze(['operator.read', 'operator.write']);

class GatewayBridge extends EventEmitter {
  constructor(options = {}) {
    super();
    this.identityFile = options.identityFile || defaultIdentityFile();
    this.debugLog = typeof options.debugLog === 'function' ? options.debugLog : null;
    this.socket = null;
    this.settings = {};
    this.shouldRun = false;
    this.connectSent = false;
    this.challengeTimer = null;
    this.reconnectTimer = null;
    this.retryWithDeviceToken = false;
    this.retryWithPassword = false;
    this.activeAuthSource = 'none';
    this.connectAttemptSeq = 0;
    this.pendingRequests = new Map();
    this.offlineRetryCount = 0;
    this.logThrottleMap = new Map();
    this.statusThrottleMap = new Map();
  }

  start(settings = {}) {
    this.settings = { ...this.settings, ...settings };
    this.shouldRun = true;
    void this.connectNow();
  }

  update(settings = {}) {
    this.settings = { ...this.settings, ...settings };
    if (this.shouldRun) {
      this.restart();
    }
  }

  restart() {
    this.clearReconnect();
    this.cleanupSocket(1000, 'restart');
    if (this.shouldRun) {
      this.scheduleReconnect(200);
    }
  }

  stop() {
    this.shouldRun = false;
    this.retryWithDeviceToken = false;
    this.retryWithPassword = false;
    this.activeAuthSource = 'none';
    this.markGatewayReachable();
    this.clearChallengeTimer();
    this.clearReconnect();
    this.cleanupSocket(1000, 'manual-stop');
    this.emitStatus({
      type: 'SYSTEM_DISCONNECTED',
      ts: Date.now(),
      ...describeGatewayDisconnect(1000, 'manual-stop'),
    });
  }

  isActive() {
    return Boolean(this.shouldRun);
  }

  clearChallengeTimer() {
    if (this.challengeTimer) {
      clearTimeout(this.challengeTimer);
      this.challengeTimer = null;
    }
  }

  clearReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  markGatewayReachable() {
    this.offlineRetryCount = 0;
  }

  cleanupSocket(code, reason) {
    const socket = this.socket;
    this.socket = null;
    this.connectSent = false;
    this.rejectPendingRequests(new Error(reason || 'socket closed'));

    if (!socket) return;

    try {
      if (typeof socket.removeAllListeners === 'function') {
        socket.removeAllListeners();
      }
      if (typeof socket.terminate === 'function' && code === 1006) {
        socket.terminate();
      } else if (typeof socket.close === 'function') {
        socket.close(code, reason);
      }
    } catch {
      // ignore shutdown race
    }
  }

  scheduleReconnect(delayMs = 5000) {
    if (!this.shouldRun || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connectNow();
    }, delayMs);
  }

  shouldThrottle(map, key, minIntervalMs = 0) {
    if (!key || minIntervalMs <= 0) return false;

    const now = Date.now();
    const lastAt = map.get(key) || 0;
    if (now - lastAt < minIntervalMs) {
      return true;
    }

    map.set(key, now);
    return false;
  }

  emitStatusThrottled(status, key, minIntervalMs = 0) {
    if (this.shouldThrottle(this.statusThrottleMap, key, minIntervalMs)) {
      return false;
    }

    this.emitStatus(status);
    return true;
  }

  logThrottled(key, message, payload, minIntervalMs = 0, options = {}) {
    if (this.shouldThrottle(this.logThrottleMap, key, minIntervalMs)) {
      return false;
    }

    this.log(message, payload, options);
    return true;
  }

  emitStatus(status) {
    this.emit('status', status);
  }

  emitFrame(frame) {
    this.emit('frame', frame);
  }

  rejectPendingRequests(error) {
    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pendingRequests.clear();
  }

  log(message, payload, options = {}) {
    this.debugLog?.('gateway-bridge', message, payload, options);
  }

  currentAuth() {
    const settingsToken = normalizeString(this.settings.gatewayToken);
    const settingsPassword = normalizeString(this.settings.gatewayPassword);
    const deviceState = loadOrCreateDeviceState(this.identityFile);
    const deviceToken = normalizeString(deviceState.deviceToken);
    const preference = normalizeAuthPreference(this.settings.authPreference);

    if (preference === 'shared-token' && settingsToken) {
      return { token: settingsToken, source: 'shared-token', mode: 'token' };
    }

    if (preference === 'password' && settingsPassword) {
      return { password: settingsPassword, source: 'password', mode: 'password' };
    }

    if (preference === 'device-token' && deviceToken) {
      return { token: deviceToken, source: 'device-token', mode: 'token' };
    }

    if (preference !== 'auto') {
      return { source: 'none', mode: 'none' };
    }

    if (this.retryWithDeviceToken && deviceToken) {
      return { token: deviceToken, source: 'device-token', mode: 'token' };
    }

    if (this.retryWithPassword && settingsPassword) {
      return { password: settingsPassword, source: 'password', mode: 'password' };
    }

    if (settingsToken) {
      return { token: settingsToken, source: 'shared-token', mode: 'token' };
    }

    if (settingsPassword) {
      return { password: settingsPassword, source: 'password', mode: 'password' };
    }

    if (deviceToken) {
      return { token: deviceToken, source: 'device-token', mode: 'token' };
    }

    return { source: 'none', mode: 'none' };
  }

  maybeRetryWithAlternateAuth(error = {}) {
    if (normalizeAuthPreference(this.settings.authPreference) !== 'auto') return;

    const details = error?.details || {};
    const recommended = normalizeString(details.recommendedNextStep);
    const canRetryDeviceToken = Boolean(details.canRetryWithDeviceToken) || recommended === 'retry_with_device_token';
    const currentSource = this.activeAuthSource || this.currentAuth().source;
    const settingsPassword = normalizeString(this.settings.gatewayPassword);
    const deviceState = loadOrCreateDeviceState(this.identityFile);
    const deviceToken = normalizeString(deviceState.deviceToken);

    if (currentSource === 'shared-token' && settingsPassword && !this.retryWithPassword && isRetryableAuthFailure(error)) {
      this.retryWithPassword = true;
      this.emitStatus({
        type: 'SYSTEM_ERROR',
        ts: Date.now(),
        label: 'Token 认证失败，尝试 Password 重连',
        detail: authFailureCode(error) || 'AUTH_TOKEN_MISMATCH',
      });
      this.restart();
      return;
    }

    if (deviceToken && !this.retryWithDeviceToken && (canRetryDeviceToken || isRetryableAuthFailure(error))) {
      this.retryWithDeviceToken = true;
      this.retryWithPassword = false;
      this.emitStatus({
        type: 'SYSTEM_ERROR',
        ts: Date.now(),
        label: '尝试设备 Token 重连',
        detail: authFailureCode(error) || 'AUTH_RETRY_WITH_DEVICE_TOKEN',
      });
      this.restart();
    }
  }

  async connectNow() {
    const attemptId = ++this.connectAttemptSeq;
    if (!this.shouldRun) return;

    if (!NodeWebSocket) {
      this.emitStatus({
        type: 'SYSTEM_ERROR',
        ts: Date.now(),
        label: '缺少 ws 依赖',
        detail: '请在插件目录执行 npm install',
      });
      return;
    }

    const url = normalizeString(this.settings.gatewayUrl);
    if (!url) {
      this.emitStatus({
        type: 'SYSTEM_ERROR',
        ts: Date.now(),
        label: '未配置 Gateway URL',
        detail: '请填写 gatewayUrl',
      });
      return;
    }

    this.clearChallengeTimer();
    this.clearReconnect();
    this.cleanupSocket(1000, 'reconnect');

    const auth = this.currentAuth();
    const preference = normalizeAuthPreference(this.settings.authPreference);
    if (preference !== 'auto' && auth.source === 'none') {
      this.emitStatus({
        type: 'SYSTEM_ERROR',
        ts: Date.now(),
        label: '未找到手动指定的认证方式',
        detail: preference,
      });
      return;
    }

    const probe = await probeGatewayPort(url);
    if (!this.shouldRun || attemptId !== this.connectAttemptSeq) return;

    if (!probe.ok) {
      this.offlineRetryCount += 1;
      const offlineStatus = describeGatewayProbeFailure(probe);
      const retryDelayMs = computeOfflineReconnectDelayMs(this.offlineRetryCount);
      const dedupeKey = `probe:${probe?.target?.host || 'invalid'}:${probe?.target?.port || '0'}:${normalizeString(probe.code).toUpperCase() || 'UNKNOWN'}`;
      this.logThrottled(dedupeKey, 'gateway-offline', {
        gatewayUrl: url,
        attempt: this.offlineRetryCount,
        code: normalizeString(probe.code).toUpperCase() || 'UNKNOWN',
        retryDelayMs,
        detail: offlineStatus.detail,
      }, 30_000, { console: false });
      this.emitStatusThrottled({
        type: 'SYSTEM_DISCONNECTED',
        ts: Date.now(),
        ...offlineStatus,
      }, dedupeKey, 30_000);
      if (this.shouldRun) {
        this.scheduleReconnect(retryDelayMs);
      }
      return;
    }

    this.markGatewayReachable();
    const headers = {
      Origin: normalizeString(this.settings.connectOrigin) || 'http://127.0.0.1:18789',
      'User-Agent': normalizeString(this.settings.userAgent) || `clawpeek-desktop-pet/${process.versions.electron || process.version}`,
    };

    this.log('connectNow', {
      gatewayUrl: url,
      origin: headers.Origin,
      authPreference: preference,
      authSource: auth.source,
    });

    this.emitStatus({
      type: 'SYSTEM_CONNECTING',
      ts: Date.now(),
      label: '连接 OpenClaw',
      detail: `gateway=${url} · auth=${auth.source || 'none'} · mode=${preference}`,
    });

    const socket = new NodeWebSocket(url, { headers, handshakeTimeout: 10000, perMessageDeflate: false });
    this.socket = socket;

    socket.on('open', () => {
      this.markGatewayReachable();
      this.log('socket-open');
      this.connectSent = false;
      this.clearChallengeTimer();
      this.challengeTimer = setTimeout(() => {
        this.sendConnect('').catch((error) => this.handleInternalError('发送 connect 握手失败', error));
      }, 1200);
    });

    socket.on('message', (data) => {
      const frame = safeJsonParse(Buffer.isBuffer(data) ? data.toString('utf8') : String(data ?? ''));
      if (!frame) return;

      let pendingMethod = '';
      if (frame.type === 'res' && typeof frame.id === 'string' && this.pendingRequests.has(frame.id)) {
        const pending = this.pendingRequests.get(frame.id);
        this.pendingRequests.delete(frame.id);
        clearTimeout(pending.timer);
        pendingMethod = pending.method;
        if (frame.ok) {
          pending.resolve(frame.payload);
        } else {
          pending.reject(createGatewayRequestError(frame.error, `${pending.method} failed`));
        }
      }

      if (frame.type === 'event' && ['agent', 'chat', 'exec.approval.requested', 'error', 'connect.challenge'].includes(frame.event)) {
        this.log('frame', buildFrameDebugSnapshot(frame));
      }

      this.emitFrame(frame);

      if (frame.type === 'event' && frame.event === 'connect.challenge') {
        this.sendConnect(frame.payload?.nonce || '').catch((error) => this.handleInternalError('发送 connect 握手失败', error));
        return;
      }

      if (frame.type === 'res' && frame.ok && frame.payload?.type === 'hello-ok') {
        this.markGatewayReachable();
        this.log('hello-ok', {
          protocol: frame.payload.protocol,
          authType: frame.payload?.auth?.type || '',
          authSource: this.activeAuthSource,
          hasDeviceToken: Boolean(frame.payload?.auth?.deviceToken),
        });
        this.retryWithPassword = false;
        this.retryWithDeviceToken = false;
        const deviceToken = normalizeString(frame.payload?.auth?.deviceToken);
        if (deviceToken) {
          persistDeviceToken(this.identityFile, deviceToken);
        }
      }

      if (frame.type === 'res' && frame.ok === false) {
        this.log('response-error', {
          method: pendingMethod,
          authSource: this.activeAuthSource,
          ...(frame.error || {}),
        });
        this.maybeRetryWithAlternateAuth(frame.error);
      }
    });

    socket.on('close', (code, reasonBuffer) => {
      const reason = Buffer.isBuffer(reasonBuffer) ? reasonBuffer.toString('utf8') : String(reasonBuffer ?? '');
      if (socket !== this.socket) return;
      this.socket = null;
      this.connectSent = false;
      this.clearChallengeTimer();
      this.rejectPendingRequests(new Error(reason || `socket closed (${code})`));
      const disconnectStatus = describeGatewayDisconnect(code, reason);
      this.emitStatus({
        type: 'SYSTEM_DISCONNECTED',
        ts: Date.now(),
        ...disconnectStatus,
      });
      this.log('socket-close', { code, reason });
      if (this.shouldRun) {
        this.scheduleReconnect(this.retryWithDeviceToken || this.retryWithPassword ? 300 : 5000);
      }
    });

    socket.on('error', (error) => {
      const code = normalizeString(error?.code).toUpperCase();
      const detail = error instanceof Error ? error.message : String(error);
      if (isExpectedNetworkErrorCode(code)) {
        this.logThrottled(`socket-error:${url}:${code || 'UNKNOWN'}`, 'gateway-socket-offline', {
          gatewayUrl: url,
          code: code || 'UNKNOWN',
          detail,
        }, 30_000, { console: false });
        return;
      }
      this.log('socket-error', {
        code,
        detail,
      });
      this.emitStatus({
        type: 'SYSTEM_ERROR',
        ts: Date.now(),
        label: 'WebSocket 错误',
        detail,
      });
    });
  }

  handleInternalError(label, error) {
    const code = normalizeString(error?.code).toUpperCase();
    const detail = error instanceof Error ? error.message : String(error);

    this.log('internal-error', {
      label,
      code,
      detail,
    });

    if (isExpectedNetworkErrorCode(code)) {
      this.emitStatus({
        type: 'SYSTEM_DISCONNECTED',
        ts: Date.now(),
        label: 'OpenClaw 暂时不可用，龙虾休息中',
        detail,
      });
    } else {
      this.emitStatus({
        type: 'SYSTEM_ERROR',
        ts: Date.now(),
        label,
        detail,
      });
    }

    this.cleanupSocket(1008, 'connect failed');
    if (this.shouldRun) {
      this.scheduleReconnect(3000);
    }
  }

  async sendConnect(nonce = '') {
    if (!this.socket || this.socket.readyState !== NodeWebSocket.OPEN || this.connectSent) return;

    this.connectSent = true;
    this.clearChallengeTimer();

    const request = await this.buildConnectRequest(nonce);
    this.activeAuthSource = request._authSource || 'none';
    this.log('send-connect', {
      nonce: nonce || '',
      authMode: request?.params?.auth?.token ? 'token' : request?.params?.auth?.password ? 'password' : 'none',
      authSource: this.activeAuthSource,
      clientMode: request?.params?.client?.mode || '',
      caps: request?.params?.caps || [],
    });
    this.request(request.method, request.params, { timeoutMs: 10000 }).catch((error) => {
      this.handleInternalError('发送 connect 握手失败', error);
    });
  }

  request(method, params = {}, options = {}) {
    const socket = this.socket;
    if (!socket || socket.readyState !== NodeWebSocket.OPEN) {
      return Promise.reject(new Error('gateway not connected'));
    }

    const requestId = randomId(normalizeString(method) || 'req');
    const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 12000;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(`${method} timeout`));
      }, timeoutMs);

      this.pendingRequests.set(requestId, {
        method,
        resolve,
        reject,
        timer,
      });

      try {
        socket.send(JSON.stringify({
          type: 'req',
          id: requestId,
          method,
          params,
        }));
      } catch (error) {
        clearTimeout(timer);
        this.pendingRequests.delete(requestId);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  async buildConnectRequest(nonce = '') {
    const auth = this.currentAuth();
    const identity = loadOrCreateDeviceState(this.identityFile);
    const signedAt = Date.now();
    const tokenOrDeviceToken = normalizeString(auth.token);
    const payload = buildDeviceAuthPayload({
      deviceId: identity.deviceId,
      clientId: DIRECT_GATEWAY_CLIENT.id,
      clientMode: DIRECT_GATEWAY_CLIENT.mode,
      role: DIRECT_GATEWAY_ROLE,
      scopes: DIRECT_GATEWAY_SCOPES,
      signedAtMs: signedAt,
      token: tokenOrDeviceToken || null,
      nonce,
    });

    return {
      type: 'req',
      id: randomId('connect'),
      method: 'connect',
      _authSource: auth.source,
      params: {
        minProtocol: 3,
        maxProtocol: 3,
        client: {
          id: DIRECT_GATEWAY_CLIENT.id,
          displayName: DIRECT_GATEWAY_CLIENT.displayName,
          version: DIRECT_GATEWAY_CLIENT.version,
          platform: normalizeString(this.settings.clientPlatform) || process.platform,
          mode: DIRECT_GATEWAY_CLIENT.mode,
          ...(normalizeString(this.settings.instanceId) ? { instanceId: normalizeString(this.settings.instanceId) } : {}),
        },
        role: DIRECT_GATEWAY_ROLE,
        scopes: [...DIRECT_GATEWAY_SCOPES],
        caps: [...DIRECT_GATEWAY_CLIENT.caps],
        auth: auth.token ? { token: auth.token } : auth.password ? { password: auth.password } : undefined,
        locale: normalizeString(this.settings.locale) || 'zh-CN',
        userAgent: normalizeString(this.settings.userAgent) || `clawpeek-desktop-pet/${process.versions.electron || process.version}`,
        device: {
          id: identity.deviceId,
          publicKey: identity.publicKey,
          signature: signDevicePayload(identity, payload),
          signedAt,
          nonce,
        },
      },
    };
  }
}

function createGatewayBridge(options) {
  return new GatewayBridge(options);
}

module.exports = {
  createGatewayBridge,
  loadOrCreateDeviceState,
  buildDeviceAuthPayload,
  buildFrameDebugSnapshot,
  computeOfflineReconnectDelayMs,
  describeGatewayProbeFailure,
  describeGatewayDisconnect,
};
