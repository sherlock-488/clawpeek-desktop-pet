const fs = require('fs');
const path = require('path');

function safeSerialize(value) {
  if (typeof value === 'string') return value;

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function createDebugLogger({ resolveBaseDir } = {}) {
  let filePath = null;

  function resolveFilePath() {
    if (filePath) return filePath;

    const baseDir = typeof resolveBaseDir === 'function'
      ? resolveBaseDir()
      : process.cwd();
    filePath = path.join(baseDir, 'clawpeek-debug.log');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    return filePath;
  }

  function log(scope, message, payload, options = {}) {
    const writeToConsole = options.console !== false;
    const line = [
      `[${new Date().toISOString()}]`,
      `[${String(scope || 'debug')}]`,
      String(message || ''),
      payload == null ? '' : safeSerialize(payload),
    ].filter(Boolean).join(' ');

    if (writeToConsole) {
      console.log(line);
    }

    try {
      fs.appendFileSync(resolveFilePath(), `${line}\n`, 'utf8');
    } catch {
      // Ignore file logging failures and keep console logging alive.
    }
  }

  return {
    log,
    getFilePath: () => resolveFilePath(),
  };
}

module.exports = {
  createDebugLogger,
};
