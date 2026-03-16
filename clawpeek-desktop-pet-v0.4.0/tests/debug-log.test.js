import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createDebugLogger } = require('../electron/debug-log.cjs');

test('debug logger can keep expected offline noise out of the console while still writing the file', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clawpeek-debug-log-'));
  const originalConsoleLog = console.log;
  const consoleLines = [];
  console.log = (line) => {
    consoleLines.push(line);
  };

  try {
    const logger = createDebugLogger({
      resolveBaseDir: () => tempDir,
    });

    logger.log('gateway-bridge', 'gateway-offline', { code: 'ECONNREFUSED' }, { console: false });

    assert.deepEqual(consoleLines, []);
    assert.match(fs.readFileSync(logger.getFilePath(), 'utf8'), /gateway-offline/);
  } finally {
    console.log = originalConsoleLog;
  }
});
