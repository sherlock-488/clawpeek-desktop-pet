import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildFrameDebugSnapshot,
  cleanupSyntheticEventMemory,
  dedupeSyntheticEvents,
} from '../src/bridge/gateway-client.js';

test('client debug snapshot exposes nested tool hints and redacts auth payloads', () => {
  const snapshot = buildFrameDebugSnapshot({
    type: 'event',
    event: 'agent',
    payload: {
      sessionKey: 'agent:main:main',
      runId: 'run-1',
      stream: 'assistant',
      auth: {
        password: 'secret-pass',
      },
      data: {
        content: [
          {
            type: 'tool_call',
            name: 'web_search',
            input: {
              query: 'Jack Ma biography',
              url: 'https://example.com/search?q=jack+ma',
            },
          },
        ],
        auth: {
          token: 'shared-token-value',
        },
      },
    },
  });

  assert.equal(snapshot.sessionKey, 'agent:main:main');
  assert.match(snapshot.payloadPreview.auth.password, /^\[redacted:/);
  assert.match(snapshot.payloadPreview.data.auth.token, /^\[redacted:/);
  assert.equal(
    snapshot.payloadHints.some((hint) => hint.path === 'payload.data.content[0].type' && hint.preview === 'tool_call'),
    true,
  );
  assert.equal(
    snapshot.payloadHints.some((hint) => hint.path === 'payload.data.content[0].name' && hint.preview === 'web_search'),
    true,
  );
  assert.equal(
    snapshot.payloadHints.some((hint) => hint.path === 'payload.data.content[0].input.url' && /example\.com/.test(hint.preview)),
    true,
  );
});

test('synthetic tool events are deduplicated across streaming deltas and released after final', () => {
  const memory = new Set();
  const events = [
    {
      type: 'TOOL_STARTED',
      runId: 'run-1',
      sessionKey: 'agent:main:main',
      detail: 'Open-Meteo API',
      syntheticSignature: 'api-tool-start:run-1:open-meteo api',
    },
    {
      type: 'TOOL_STARTED',
      runId: 'run-1',
      sessionKey: 'agent:main:main',
      detail: 'Open-Meteo API',
      syntheticSignature: 'api-tool-start:run-1:open-meteo api',
    },
    {
      type: 'TOOL_RESULT',
      runId: 'run-1',
      sessionKey: 'agent:main:main',
      detail: 'Open-Meteo API',
      syntheticSignature: 'api-tool-result:run-1:open-meteo api',
    },
  ];

  const firstPass = dedupeSyntheticEvents(events, memory);
  assert.deepEqual(firstPass.map((event) => event.type), ['TOOL_STARTED', 'TOOL_RESULT']);

  const secondPass = dedupeSyntheticEvents(events, memory);
  assert.equal(secondPass.length, 0);

  cleanupSyntheticEventMemory(memory, [{
    type: 'CHAT_FINAL',
    runId: 'run-1',
    sessionKey: 'agent:main:main',
  }]);

  const thirdPass = dedupeSyntheticEvents(events, memory);
  assert.deepEqual(thirdPass.map((event) => event.type), ['TOOL_STARTED', 'TOOL_RESULT']);
});
