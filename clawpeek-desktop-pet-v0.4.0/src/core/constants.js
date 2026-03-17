export const CONNECTION = Object.freeze({
  DISCONNECTED: 'disconnected',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  ERROR: 'error',
});

export const PHASE = Object.freeze({
  OFFLINE: 'offline',
  IDLE: 'idle',
  QUEUED: 'queued',
  THINKING: 'thinking',
  WAITING: 'waiting',
  DONE: 'done',
  ERROR: 'error',
});

export const CONFIDENCE = Object.freeze({
  CONFIRMED: 'confirmed',
  INFERRED: 'inferred',
  UNKNOWN: 'unknown',
});

export const ACTIVITY = Object.freeze({
  LIST: 'list',
  EXEC: 'exec',
  READ: 'read',
  SEARCH_CODE: 'search_code',
  SEARCH_WEB: 'search_web',
  WRITE: 'write',
  EDIT: 'edit',
  ATTACH: 'attach',
  BROWSE: 'browse',
  TOOL: 'tool',
  OTHER: 'other',
  NONE: 'none',
});

export const THRESHOLDS = Object.freeze({
  doneTtlMs: 2_500,
  eventLogLimit: 60,
});

export const PET_BADGES = Object.freeze({
  [PHASE.OFFLINE]: '💤',
  [PHASE.IDLE]: '🦞',
  [PHASE.QUEUED]: '⏳',
  [PHASE.THINKING]: '🧠',
  [PHASE.WAITING]: '✋',
  [PHASE.DONE]: '✅',
  [PHASE.ERROR]: '⚠️',
});
