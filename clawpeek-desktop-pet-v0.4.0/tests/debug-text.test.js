import test from 'node:test';
import assert from 'node:assert/strict';

import { debugLabelForEvent, debugLabelForState } from '../src/core/debug-text.js';

test('debugLabelForEvent returns stable english labels for raw events and chat final', () => {
  assert.equal(
    debugLabelForEvent({ type: 'RAW_EVENT', detail: 'agent.assistant', label: '乱码标签' }),
    'Received agent.assistant event',
  );

  assert.equal(
    debugLabelForEvent({ type: 'CHAT_FINAL', label: '乱码 [object Object]' }),
    'Completed',
  );
});

test('debugLabelForState replaces unreadable labels with phase labels', () => {
  assert.equal(
    debugLabelForState({ phase: 'idle', label: '乱码' }),
    'Idle',
  );

  assert.equal(
    debugLabelForState({ phase: 'thinking', activityKind: 'search_web', label: '乱码' }),
    'Processing task',
  );
});
