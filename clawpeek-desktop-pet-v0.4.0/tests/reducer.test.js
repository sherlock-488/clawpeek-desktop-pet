import test from 'node:test';
import assert from 'node:assert/strict';

import { createInitialState, reducer } from '../src/core/reducer.js';
import { PHASE } from '../src/core/constants.js';

function run(events) {
  return events.reduce((state, event) => reducer(state, event), createInitialState());
}

test('initial state is resting until Gateway handshake succeeds', () => {
  const state = createInitialState();

  assert.equal(state.connection, 'disconnected');
  assert.equal(state.derived.phase, PHASE.OFFLINE);
  assert.equal(state.derived.label, 'Resting');
  assert.equal(state.derived.connectionText, 'Resting');
});

test('SYSTEM_CONNECTED promotes resting state into idle', () => {
  const state = run([
    { type: 'SYSTEM_CONNECTED', ts: 1, label: 'Handshake complete' },
  ]);

  assert.equal(state.connection, 'connected');
  assert.equal(state.derived.phase, PHASE.IDLE);
  assert.equal(state.derived.label, 'Idle');
});

test('SYSTEM_DISCONNECTED sends an active pet back to resting mode', () => {
  const state = run([
    { type: 'SYSTEM_CONNECTED', ts: 1, label: 'Handshake complete' },
    { type: 'RUN_STARTED', sessionKey: 'main', runId: 'run1', ts: 2, label: 'start' },
    { type: 'SYSTEM_DISCONNECTED', ts: 3, label: 'Connection paused', detail: 'shutdown' },
  ]);

  assert.equal(state.connection, 'disconnected');
  assert.equal(state.derived.phase, PHASE.OFFLINE);
  assert.equal(state.derived.label, 'Resting');
  assert.equal(state.derived.connectionText, 'Resting');
});

test('main session keeps priority when active', () => {
  const state = run([
    { type: 'RUN_STARTED', sessionKey: 'research', runId: 'a', ts: 1, label: 'research task' },
    { type: 'TOOL_STARTED', sessionKey: 'research', runId: 'a', ts: 2, activityKind: 'browse', label: 'Browsing page: docs' },
    { type: 'RUN_STARTED', sessionKey: 'main', runId: 'b', ts: 3, label: 'main task' },
    { type: 'JOB_STATE', sessionKey: 'main', runId: 'b', ts: 4, state: 'streaming', label: 'main thinking' },
  ]);

  assert.equal(state.derived.sessionKey, 'main');
  assert.equal(state.derived.phase, PHASE.THINKING);
});

test('waiting state is triggered by approval requests', () => {
  const state = run([
    { type: 'RUN_STARTED', sessionKey: 'main', runId: 'run1', ts: 1, label: 'start' },
    { type: 'APPROVAL_REQUESTED', sessionKey: 'main', runId: 'run1', ts: 2, label: 'Waiting for approval: npm test' },
  ]);

  assert.equal(state.derived.phase, PHASE.WAITING);
  assert.match(state.derived.label, /Waiting for approval/);
});

test('tool events keep the pet in thinking while preserving activity', () => {
  const state = run([
    { type: 'RUN_STARTED', sessionKey: 'main', runId: 'run1', ts: 1, label: 'start' },
    { type: 'TOOL_STARTED', sessionKey: 'main', runId: 'run1', ts: 2, activityKind: 'exec', label: 'Running command: npm test' },
    { type: 'TICK', ts: 15_000 },
  ]);

  assert.equal(state.derived.phase, PHASE.THINKING);
  assert.equal(state.derived.activityKind, 'exec');
  assert.equal(state.derived.confidence, 'confirmed');
});

test('done returns to idle after ttl', () => {
  const state = run([
    { type: 'RUN_STARTED', sessionKey: 'main', runId: 'run1', ts: 1, label: 'start' },
    { type: 'CHAT_FINAL', sessionKey: 'main', runId: 'run1', ts: 2, label: 'Completed: fixed it' },
    { type: 'TICK', ts: 5_000 },
  ]);

  assert.equal(state.derived.phase, PHASE.IDLE);
});

test('raw agent events move the display session into an inferred active state', () => {
  const state = run([
    {
      type: 'RAW_EVENT',
      sessionKey: 'agent:main:main',
      runId: 'run1',
      ts: 1,
      label: 'Received agent.assistant event',
      detail: 'agent.assistant',
    },
  ]);

  assert.equal(state.derived.sessionKey, 'agent:main:main');
  assert.equal(state.derived.phase, PHASE.THINKING);
  assert.equal(state.derived.label, 'Processing task');
  assert.equal(state.derived.confidence, 'inferred');
});
