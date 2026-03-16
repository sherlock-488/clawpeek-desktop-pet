import test from 'node:test';
import assert from 'node:assert/strict';

import { buildFrameDebugSnapshot } from '../src/bridge/gateway-client.js';

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
