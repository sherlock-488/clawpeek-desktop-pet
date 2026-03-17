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

  assert.equal(event.type, 'RAW_EVENT');
  assert.equal(event.sessionKey, 'agent:main:main');
  assert.equal(event.runId, 'run1');
  assert.equal(event.detail, 'agent.assistant');
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
  assert.match(event.label, /Reading file/);
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

test('text protocol TOOLCALL markers are inferred as tool events', () => {
  const [event] = normalizeGatewayFrame({
    type: 'event',
    event: 'agent',
    payload: {
      sessionKey: 'agent:main:main',
      runId: 'run3',
      stream: 'assistant',
      data: {
        text: 'TOOLCALL>[{"name":"web_search","input":{"query":"北京下周天气"}}]',
      },
    },
  }, 1);

  assert.equal(event.type, 'TOOL_STARTED');
  assert.equal(event.activityKind, 'search_web');
  assert.equal(event.detail, 'web_search');
  assert.equal(event.syntheticSignature, 'toolcall:run3:web_search');
});

test('API result text produces synthetic tool events before chat final', () => {
  const events = normalizeGatewayFrame({
    type: 'event',
    event: 'chat',
    payload: {
      sessionKey: 'agent:main:main',
      runId: 'run4',
      state: 'final',
      message: {
        role: 'assistant',
        content: [
          {
            type: 'text',
            text: '已通过 Open-Meteo API 获取到北京未来一周天气预报。',
          },
        ],
      },
    },
  }, 1);

  assert.deepEqual(events.map((event) => event.type), ['TOOL_STARTED', 'TOOL_RESULT', 'CHAT_FINAL']);
  assert.equal(events[0].detail, 'Open-Meteo API');
  assert.equal(events[1].detail, 'Open-Meteo API');
  assert.match(events[2].label, /^完成/);
});

test('weather data result text also produces synthetic tool events before chat final', () => {
  const events = normalizeGatewayFrame({
    type: 'event',
    event: 'chat',
    payload: {
      sessionKey: 'agent:main:main',
      runId: 'run5',
      state: 'final',
      message: {
        role: 'assistant',
        content: [
          {
            type: 'text',
            text: '已获取到北京未来7天每小时的天气数据，以下是每天中午12:00的天气情况。',
          },
        ],
      },
    },
  }, 1);

  assert.deepEqual(events.map((event) => event.type), ['TOOL_STARTED', 'TOOL_RESULT', 'CHAT_FINAL']);
  assert.match(events[0].detail, /天气数据/);
  assert.match(events[1].detail, /天气数据/);
});
