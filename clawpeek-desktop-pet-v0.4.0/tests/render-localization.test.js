import test from 'node:test';
import assert from 'node:assert/strict';

test('localizeDetailText converts known Gateway offline copy for the English dashboard', async () => {
  const originalDocument = globalThis.document;
  globalThis.document = {
    getElementById() {
      return null;
    },
  };

  try {
    const { localizeDetailText } = await import('../src/ui/render.js');

    assert.equal(
      localizeDetailText('127.0.0.1:18789 当前没有监听，后台会继续等待 OpenClaw 启动。', 'en'),
      '127.0.0.1:18789 is not listening yet. The app will keep waiting for OpenClaw to start.'
    );
  } finally {
    globalThis.document = originalDocument;
  }
});
