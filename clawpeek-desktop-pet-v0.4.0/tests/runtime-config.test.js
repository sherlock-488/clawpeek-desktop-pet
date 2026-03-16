import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  parseJson5Like,
  discoverOpenClawConfigPath,
  discoverWslOpenClawExecutable,
  normalizeChatSessionKey,
  buildControlUiChatUrl,
  resolveGatewayConnectOrigin,
  buildCliTuiCommand,
  resolveGatewayToken,
  resolveConfiguredControlUiBaseUrl,
  resolveConfiguredToolConfig,
} = require('../electron/runtime.cjs');

test('parseJson5Like accepts JSON5-ish OpenClaw config text', () => {
  const parsed = parseJson5Like(`
    {
      // comment
      gateway: {
        auth: {
          token: 'abc123',
        },
      },
    }
  `);

  assert.equal(parsed.gateway.auth.token, 'abc123');
});

test('normalizeChatSessionKey maps bare main session to OpenClaw direct-chat key', () => {
  assert.equal(normalizeChatSessionKey('main', 'main'), 'agent:main:main');
  assert.equal(normalizeChatSessionKey('', 'main'), 'agent:main:main');
  assert.equal(normalizeChatSessionKey('agent:main:openai-user:test', 'main'), 'agent:main:openai-user:test');
});

test('buildControlUiChatUrl emits chat URL with session and token fragment', () => {
  const url = buildControlUiChatUrl({
    gatewayUrl: 'ws://127.0.0.1:18789',
    sessionKey: 'main',
    token: 'secret-token',
  });

  assert.match(url, /^http:\/\/127\.0\.0\.1:18789\/chat\?session=agent%3Amain%3Amain#token=secret-token$/);
});

test('buildControlUiChatUrl adds gatewayUrl when using an external control UI base', () => {
  const url = buildControlUiChatUrl({
    gatewayUrl: 'wss://gateway.example.com',
    controlUiBaseUrl: 'http://localhost:5173/',
    sessionKey: 'agent:main:openai-user:demo',
  });

  assert.match(url, /^http:\/\/localhost:5173\/chat\?session=agent%3Amain%3Aopenai-user%3Ademo&gatewayUrl=wss%3A%2F%2Fgateway\.example\.com$/);
});


test('buildControlUiChatUrl keeps configured basePath when present', () => {
  const url = buildControlUiChatUrl({
    gatewayUrl: 'ws://127.0.0.1:18789',
    controlUiBaseUrl: 'http://127.0.0.1:18789/openclaw',
    sessionKey: 'main',
  });

  assert.equal(url, 'http://127.0.0.1:18789/openclaw/chat?session=agent%3Amain%3Amain');
});

test('resolveGatewayConnectOrigin prefers the control-ui origin when present', () => {
  assert.equal(
    resolveGatewayConnectOrigin({
      gatewayUrl: 'ws://127.0.0.1:18789',
      controlUiBaseUrl: 'http://localhost:5173/dev/',
    }),
    'http://localhost:5173'
  );
});

test('resolveGatewayConnectOrigin falls back to the gateway http origin', () => {
  assert.equal(
    resolveGatewayConnectOrigin({ gatewayUrl: 'wss://claw.example.com/ws' }),
    'https://claw.example.com'
  );
});

test('buildCliTuiCommand emits a token-based TUI command by default', () => {
  const command = buildCliTuiCommand({
    executable: 'openclaw',
    gatewayUrl: 'ws://127.0.0.1:18789',
    sessionKey: 'main',
    token: 'abc123',
  });

  assert.equal(command, 'openclaw tui --session agent:main:main --url ws://127.0.0.1:18789 --token abc123');
});

test('resolveGatewayToken resolves env SecretRef instead of stringifying the object', () => {
  process.env.TEST_GATEWAY_TOKEN = 'resolved-from-env-ref';
  const result = resolveGatewayToken({
    loadedConfig: {
      path: '/tmp/openclaw.json',
      data: {
        gateway: {
          auth: {
            token: {
              source: 'env',
              provider: 'default',
              id: 'TEST_GATEWAY_TOKEN',
            },
          },
        },
      },
    },
  });
  delete process.env.TEST_GATEWAY_TOKEN;

  assert.equal(result.token, 'resolved-from-env-ref');
  assert.match(result.source, /^config:/);
});

test('resolveGatewayToken resolves ${ENV_VAR} substitution from config strings', () => {
  process.env.TEST_GATEWAY_TOKEN = 'resolved-from-placeholder';
  const result = resolveGatewayToken({
    loadedConfig: {
      path: '/tmp/openclaw.json',
      data: {
        gateway: {
          auth: {
            token: '${TEST_GATEWAY_TOKEN}',
          },
        },
      },
    },
  });
  delete process.env.TEST_GATEWAY_TOKEN;

  assert.equal(result.token, 'resolved-from-placeholder');
});

test('resolveConfiguredControlUiBaseUrl honors gateway.controlUi.basePath from config', () => {
  const base = resolveConfiguredControlUiBaseUrl({
    gatewayUrl: 'ws://127.0.0.1:18789',
    loadedConfig: {
      path: '/tmp/openclaw.json',
      data: {
        gateway: {
          controlUi: {
            basePath: '/openclaw',
          },
        },
      },
    },
  });

  assert.equal(base, 'http://127.0.0.1:18789/openclaw');
});

test('resolveConfiguredToolConfig summarizes tools profile and web search provider', () => {
  const toolConfig = resolveConfiguredToolConfig({
    path: '/tmp/openclaw.json',
    data: {
      tools: {
        profile: 'coding',
        web: {
          search: {
            enabled: true,
            provider: 'brave',
          },
        },
      },
    },
  });

  assert.equal(toolConfig, 'coding · Brave Search');
});

test('discoverOpenClawConfigPath falls back to WSL config on Windows hosts', () => {
  const configPath = discoverOpenClawConfigPath({
    platform: 'win32',
    env: {},
    fileExistsFn: () => false,
    shellCaptureFn: () => '',
    discoverWslConfigPathFn: () => 'wsl:/home/demo/.openclaw/openclaw.json',
  });

  assert.equal(configPath, 'wsl:/home/demo/.openclaw/openclaw.json');
});

test('discoverWslOpenClawExecutable finds WSL node entrypoint under npm-global', () => {
  const executable = discoverWslOpenClawExecutable({
    platform: 'win32',
    commandExistsFn: () => true,
    configPath: 'wsl:/home/demo/.openclaw/openclaw.json',
    shellCaptureWslFn: (commandScript) => {
      if (commandScript.includes('/home/demo/.npm-global/lib/node_modules')) {
        return '/home/demo/.npm-global/lib/node_modules/.openclaw-abc123/openclaw.mjs';
      }
      return '';
    },
  });

  assert.equal(executable, "node '/home/demo/.npm-global/lib/node_modules/.openclaw-abc123/openclaw.mjs'");
});

test('resolveGatewayToken reads token from WSL OpenClaw config', () => {
  const result = resolveGatewayToken({
    configPath: 'wsl:/home/demo/.openclaw/openclaw.json',
    readWslTextFileFn: (filePath) => {
      if (filePath === 'wsl:/home/demo/.openclaw/openclaw.json') {
        return `{
          gateway: {
            auth: {
              token: "token-from-wsl-config",
            },
          },
        }`;
      }
      return '';
    },
  });

  assert.equal(result.token, 'token-from-wsl-config');
  assert.equal(result.source, 'config:wsl:/home/demo/.openclaw/openclaw.json');
});

test('resolveGatewayToken expands WSL .env values referenced by config', () => {
  const result = resolveGatewayToken({
    configPath: 'wsl:/home/demo/.openclaw/openclaw.json',
    readWslTextFileFn: (filePath) => {
      if (filePath === 'wsl:/home/demo/.openclaw/openclaw.json') {
        return `{
          gateway: {
            auth: {
              token: "\${OPENCLAW_GATEWAY_TOKEN}",
            },
          },
        }`;
      }
      if (filePath === 'wsl:/home/demo/.openclaw/.env') {
        return 'OPENCLAW_GATEWAY_TOKEN=token-from-wsl-dotenv';
      }
      return '';
    },
  });

  assert.equal(result.token, 'token-from-wsl-dotenv');
});
