import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeGatewayFrame } from '../src/bridge/event-normalizer.js';
import { buildConnectClientInfo } from '../src/bridge/gateway-client.js';

test('connect.challenge is logged as handshake metadata, not as a run start', () => {
  const [event] = normalizeGatewayFrame({
    type: 'event',
    event: 'connect.challenge',
    payload: { nonce: 'abc123' },
  }, 1);

  assert.equal(event.type, 'HANDSHAKE_CHALLENGE');
  assert.equal(event.label.includes('challenge'), true);
});

test('gateway errors surface the real message from the response frame', () => {
  const [event] = normalizeGatewayFrame({
    type: 'res',
    ok: false,
    error: {
      message: 'invalid connect params',
      details: { code: 'INVALID_REQUEST' },
    },
  }, 1);

  assert.equal(event.type, 'SYSTEM_ERROR');
  assert.match(event.label, /invalid connect params/);
  assert.match(event.detail, /INVALID_REQUEST/);
});

test('direct gateway client uses official browser-compatible client id and mode', () => {
  const info = buildConnectClientInfo({ instanceId: 'clawpeek-browser' }, { platform: 'Win32' });

  assert.deepEqual(info, {
    id: 'openclaw-control-ui',
    displayName: 'ClawPeek',
    version: 'clawpeek-desktop-pet/0.4.0',
    platform: 'Win32',
    mode: 'webchat',
    instanceId: 'clawpeek-browser',
  });
});

test('assistant stream events are preserved as raw session events', () => {
  const [event] = normalizeGatewayFrame({
    type: 'event',
    event: 'agent',
    payload: {
      sessionKey: 'agent:main:main',
      runId: 'run1',
      stream: 'assistant',
    },
  }, 1);

  assert.deepEqual(event, {
    type: 'RAW_EVENT',
    ts: 1,
    sessionKey: 'agent:main:main',
    runId: 'run1',
    label: '收到 agent.assistant 事件',
    detail: 'agent.assistant',
  });
});

test('assistant function calls are normalized as tool events', () => {
  const [event] = normalizeGatewayFrame({
    type: 'event',
    event: 'agent',
    payload: {
      sessionKey: 'agent:main:main',
      runId: 'run2',
      stream: 'assistant',
      data: {
        type: 'function_call',
        name: 'read_file',
        arguments: {
          path: '/home/sherlock/test_openclaw/demo.txt',
        },
      },
    },
  }, 1);

  assert.equal(event.type, 'TOOL_STARTED');
  assert.equal(event.activityKind, 'read');
  assert.match(event.label, /读取文件：/);
  assert.match(event.label, /demo\.txt/);
});

test('assistant function call outputs are normalized as tool results', () => {
  const [event] = normalizeGatewayFrame({
    type: 'event',
    event: 'agent',
    payload: {
      sessionKey: 'agent:main:main',
      runId: 'run2',
      stream: 'assistant',
      data: {
        type: 'function_call_output',
        name: 'read_file',
        output: 'ClawPeek one',
      },
    },
  }, 1);

  assert.equal(event.type, 'TOOL_RESULT');
  assert.equal(event.activityKind, 'read');
});
