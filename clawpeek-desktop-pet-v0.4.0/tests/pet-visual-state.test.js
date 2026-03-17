import test from 'node:test';
import assert from 'node:assert/strict';

import { derivePetViewModel } from '../src/pet/visual-state.js';
import { createInitialState } from '../src/core/reducer.js';

test('derivePetViewModel folds legacy tool state into thinking', () => {
  const result = derivePetViewModel({
    connection: 'connected',
    derived: {
      phase: 'tool',
      activityKind: 'read',
      label: 'Reading file: src/core/reducer.js',
    },
  });

  assert.equal(result.phase, 'thinking');
  assert.equal(result.activity, 'read');
  assert.equal(result.overlayIcon, '📖');
  assert.match(result.headline, /工作流/);
});

test('derivePetViewModel uses a sleep metaphor for offline', () => {
  const result = derivePetViewModel({
    connection: 'disconnected',
    derived: {
      phase: 'offline',
      activityKind: 'none',
      label: '',
    },
  });

  assert.equal(result.chipText, '休息中');
  assert.match(result.headline, /休息中/);
  assert.equal(result.connectionText, '休息中');
  assert.equal(result.showOverlay, false);
});

test('initial reducer state renders as resting before a real connection succeeds', () => {
  const result = derivePetViewModel(createInitialState());

  assert.equal(result.phase, 'offline');
  assert.equal(result.chipText, '休息中');
  assert.equal(result.connectionText, '休息中');
});
