import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';

const require = createRequire(import.meta.url);
const net = require('net');
const {
  createGatewayBridge,
  loadOrCreateDeviceState,
  buildFrameDebugSnapshot,
  computeOfflineReconnectDelayMs,
  describeGatewayDisconnect,
} = require('../electron/gateway-bridge.cjs');

test('auto auth fallback prefers device token after password retry has already failed', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clawpeek-gateway-bridge-'));
  const identityFile = path.join(tempDir, 'device.json');
  const identity = loadOrCreateDeviceState(identityFile);

  fs.writeFileSync(identityFile, JSON.stringify({
    ...identity,
    deviceToken: 'device-token-value',
  }, null, 2), 'utf8');

  const bridge = createGatewayBridge({ identityFile });
  bridge.settings = {
    gatewayToken: 'shared-token-value',
    gatewayPassword: 'gateway-password',
    authPreference: 'auto',
  };
  bridge.retryWithPassword = true;
  bridge.retryWithDeviceToken = true;

  const auth = bridge.currentAuth();

  assert.deepEqual(auth, {
    token: 'device-token-value',
    source: 'device-token',
    mode: 'token',
  });
});

test('password preference selects password auth when available', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clawpeek-gateway-bridge-'));
  const identityFile = path.join(tempDir, 'device.json');

  const bridge = createGatewayBridge({ identityFile });
  bridge.settings = {
    gatewayPassword: 'gateway-password',
    authPreference: 'password',
  };

  assert.deepEqual(bridge.currentAuth(), {
    password: 'gateway-password',
    source: 'password',
    mode: 'password',
  });
});

test('buildConnectRequest sends password auth when password mode is active', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clawpeek-gateway-bridge-'));
  const identityFile = path.join(tempDir, 'device.json');

  const bridge = createGatewayBridge({ identityFile });
  bridge.settings = {
    gatewayPassword: 'gateway-password',
    authPreference: 'password',
    locale: 'en',
  };

  const request = await bridge.buildConnectRequest('nonce-1');

  assert.deepEqual(request.params.auth, {
    password: 'gateway-password',
  });
  assert.equal(Object.hasOwn(request.params.auth, 'token'), false);
});

test('offline gateway probe keeps the pet in resting mode without console-grade error logging', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clawpeek-gateway-bridge-'));
  const identityFile = path.join(tempDir, 'device.json');
  const originalCreateConnection = net.createConnection;

  net.createConnection = () => {
    const socket = new EventEmitter();
    socket.setTimeout = () => {};
    socket.destroy = () => {};

    queueMicrotask(() => {
      const error = new Error('connect ECONNREFUSED 127.0.0.1:18789');
      error.code = 'ECONNREFUSED';
      socket.emit('error', error);
    });

    return socket;
  };

  try {
    const debugEntries = [];
    const bridge = createGatewayBridge({
      identityFile,
      debugLog: (...args) => debugEntries.push(args),
    });

    const status = await new Promise((resolve) => {
      bridge.on('status', (event) => {
        if (event.type === 'SYSTEM_DISCONNECTED') {
          resolve(event);
        }
      });

      bridge.start({
        gatewayUrl: 'ws://127.0.0.1:18789',
      });
    });

    bridge.stop();

    assert.match(status.label, /休息|rest/i);
    assert.match(status.detail, /127\.0\.0\.1:18789/);

    const offlineLog = debugEntries.find((entry) => entry[1] === 'gateway-offline');
    assert.ok(offlineLog, 'expected a gateway-offline debug entry');
    assert.equal(offlineLog[3]?.console, false);
    assert.equal(Object.hasOwn(offlineLog[2], 'rawDetail'), false);
  } finally {
    net.createConnection = originalCreateConnection;
  }
});

test('offline reconnect backoff slows down repeated probe failures', () => {
  assert.equal(computeOfflineReconnectDelayMs(1), 2_500);
  assert.equal(computeOfflineReconnectDelayMs(2), 5_000);
  assert.equal(computeOfflineReconnectDelayMs(3), 10_000);
  assert.equal(computeOfflineReconnectDelayMs(4), 20_000);
  assert.equal(computeOfflineReconnectDelayMs(8), 20_000);
});

test('gateway shutdown is described as a resting disconnect', () => {
  const result = describeGatewayDisconnect(1012, 'shutdown');

  assert.match(result.label, /休息|rest/i);
  assert.match(result.detail, /1012/);
});

test('gateway bridge debug snapshot exposes nested tool hints and redacts auth fields', () => {
  const snapshot = buildFrameDebugSnapshot({
    type: 'event',
    event: 'chat',
    payload: {
      sessionKey: 'agent:main:main',
      runId: 'run-2',
      state: 'final',
      message: {
        type: 'rich-text',
        parts: [
          { type: 'text', text: 'I am searching the web now.' },
          {
            type: 'tool_call',
            name: 'web_search',
            arguments: {
              query: 'weather in Hefei tomorrow',
            },
          },
        ],
      },
      auth: {
        token: 'device-token',
      },
    },
  });

  assert.match(snapshot.payloadPreview.auth.token, /^\[redacted:/);
  assert.equal(
    snapshot.payloadHints.some((hint) => hint.path === 'payload.message.parts[1].type' && hint.preview === 'tool_call'),
    true,
  );
  assert.equal(
    snapshot.payloadHints.some((hint) => hint.path === 'payload.message.parts[1].name' && hint.preview === 'web_search'),
    true,
  );
  assert.equal(
    snapshot.payloadHints.some((hint) => hint.path === 'payload.message.parts[1].arguments.query' && /Hefei/.test(hint.preview)),
    true,
  );
});
