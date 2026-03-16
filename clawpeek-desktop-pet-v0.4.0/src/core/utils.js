export function nowTs() {
  return Date.now();
}

export function formatClock(ts) {
  const date = new Date(ts);
  return date.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hh = Math.floor(totalSeconds / 3600);
  const mm = Math.floor((totalSeconds % 3600) / 60);
  const ss = totalSeconds % 60;

  return hh > 0
    ? [hh, mm, ss].map((n) => String(n).padStart(2, '0')).join(':')
    : [mm, ss].map((n) => String(n).padStart(2, '0')).join(':');
}

export function clampArray(items, limit) {
  return items.slice(0, limit);
}

export function safeJsonParse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function truncate(text, max = 72) {
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

export function normalizeSessionRole(sessionKey, mainSessionKey = 'main') {
  return sessionKey === mainSessionKey ? 'Main' : 'Other';
}

export function pick(obj, path, fallback = undefined) {
  let cursor = obj;
  for (const segment of path) {
    if (cursor == null || typeof cursor !== 'object' || !(segment in cursor)) {
      return fallback;
    }
    cursor = cursor[segment];
  }
  return cursor;
}
