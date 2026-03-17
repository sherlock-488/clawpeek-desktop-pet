import test from 'node:test';
import assert from 'node:assert/strict';

import { ACTIVITY } from '../src/core/constants.js';
import { classifyTool } from '../src/core/activity.js';

test('classifyTool detects directory listing actions', () => {
  const result = classifyTool('system.run', { command: 'Get-ChildItem -Path src' });

  assert.equal(result.activityKind, ACTIVITY.LIST);
  assert.match(result.label, /Listing files:/);
});

test('classifyTool detects file reads from JSON string arguments', () => {
  const result = classifyTool('read_file', '{"path":"/home/sherlock/test_openclaw/demo.txt"}');

  assert.equal(result.activityKind, ACTIVITY.READ);
  assert.match(result.label, /Reading file:/);
  assert.match(result.label, /demo\.txt/);
});

test('classifyTool detects project search commands', () => {
  const result = classifyTool('system.run', { command: 'rg -n "ClawPeek" src' });

  assert.equal(result.activityKind, ACTIVITY.SEARCH_CODE);
  assert.match(result.label, /Searching code:/);
});

test('classifyTool detects web searches', () => {
  const result = classifyTool('search_query', { query: 'OpenClaw gateway protocol' });

  assert.equal(result.activityKind, ACTIVITY.SEARCH_WEB);
  assert.match(result.label, /Searching web:/);
});

test('classifyTool detects browser navigation', () => {
  const result = classifyTool('browser.open', { url: 'https://docs.openclaw.ai/gateway/protocol' });

  assert.equal(result.activityKind, ACTIVITY.BROWSE);
  assert.match(result.label, /Browsing page:/);
});
