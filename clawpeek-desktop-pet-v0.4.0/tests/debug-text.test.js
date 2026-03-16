import test from 'node:test';
import assert from 'node:assert/strict';

import { debugLabelForEvent, debugLabelForState } from '../src/core/debug-text.js';

test('debugLabelForEvent returns stable english labels for raw events and chat final', () => {
  assert.equal(
    debugLabelForEvent({ type: 'RAW_EVENT', detail: 'agent.assistant', label: '鏀跺埌 agent.assistant 浜嬩欢' }),
    'Received agent.assistant event',
  );

  assert.equal(
    debugLabelForEvent({ type: 'CHAT_FINAL', label: '瀹屾垚锛歔object Object]' }),
    'Completed',
  );
});

test('debugLabelForState replaces garbled internal labels with english phase labels', () => {
  assert.equal(
    debugLabelForState({ phase: 'idle', label: '绌洪棽涓?' }),
    'Idle',
  );

  assert.equal(
    debugLabelForState({ phase: 'tool', activityKind: 'search_web', label: '鑱旂綉鎼滅储锛歨efei weather' }),
    'Searching web',
  );
});
