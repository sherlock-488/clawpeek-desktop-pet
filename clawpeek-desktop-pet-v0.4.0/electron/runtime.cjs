const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { execFileSync, spawnSync } = require('child_process');

function boolEnv(value, fallback) {
  if (value == null || value === '') return fallback;
  return String(value).toLowerCase() !== 'false';
}

function intEnv(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (Number.isNaN(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function normalizeString(value) {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value).trim();
  return '';
}

function stripAnsi(text) {
  return String(text ?? '').replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, '');
}

function captureCommandOutput(command, args, { multiline = false } = {}) {
  try {
    const output = execFileSync(command, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
      env: {
        ...process.env,
        NO_COLOR: '1',
      },
    });

    const cleaned = stripAnsi(output);
    if (multiline) {
      return cleaned.trim();
    }

    return normalizeString(cleaned.split(/\r?\n/).find(Boolean) || '');
  } catch {
    return '';
  }
}

function shellCapture(command, args) {
  return captureCommandOutput(command, args);
}

function commandExists(command) {
  try {
    const probe = process.platform === 'win32' ? 'where' : 'which';
    const result = spawnSync(probe, [command], { stdio: 'ignore', windowsHide: true });
    return result.status === 0;
  } catch {
    return false;
  }
}

function canUseWsl(options = {}) {
  const platform = normalizeString(options.platform) || process.platform;
  const commandExistsFn = options.commandExistsFn || commandExists;
  return platform === 'win32' && commandExistsFn('wsl.exe');
}

function shellCaptureWsl(commandScript, options = {}) {
  if (!canUseWsl(options)) return '';
  const capture = options.captureCommandFn || captureCommandOutput;
  return capture('wsl.exe', ['-e', 'sh', '-lc', commandScript], {
    multiline: Boolean(options.multiline),
  });
}

function quotePosixShellString(value) {
  return `'${String(value ?? '').replace(/'/g, `'\"'\"'`)}'`;
}

function isWslPath(filePath) {
  return normalizeString(filePath).startsWith('wsl:');
}

function fromWslPath(filePath) {
  const normalized = normalizeString(filePath);
  return normalized ? `wsl:${normalized}` : '';
}

function toWslPath(filePath) {
  const normalized = normalizeString(filePath);
  return normalized.startsWith('wsl:') ? normalized.slice(4) : normalized;
}

function dirnameForPath(filePath) {
  const normalized = normalizeString(filePath);
  if (!normalized) return '';
  return isWslPath(normalized)
    ? fromWslPath(path.posix.dirname(toWslPath(normalized)))
    : path.dirname(normalized);
}

function deriveWslHomeFromConfigPath(configPath = '') {
  const normalizedPath = toWslPath(configPath);
  const marker = '/.openclaw/';
  const index = normalizedPath.indexOf(marker);
  if (index > 0) {
    return normalizedPath.slice(0, index);
  }
  return '';
}

function resolvePathFromConfigDir(baseDir, target) {
  const normalizedTarget = normalizeString(target);
  if (!normalizedTarget) return '';
  if (isWslPath(normalizedTarget)) return normalizedTarget;

  const normalizedBase = normalizeString(baseDir);
  if (isWslPath(normalizedBase)) {
    const resolved = normalizedTarget.startsWith('/')
      ? normalizedTarget
      : path.posix.resolve(toWslPath(normalizedBase) || '/', normalizedTarget);
    return fromWslPath(resolved);
  }

  return normalizedTarget.startsWith('/') || normalizedTarget.includes(path.sep)
    ? path.resolve(normalizedTarget)
    : path.resolve(normalizedBase || os.homedir(), normalizedTarget);
}

function readWslTextFile(filePath, options = {}) {
  const customReader = options.readWslTextFileFn;
  if (typeof customReader === 'function') {
    return normalizeString(customReader(filePath, options));
  }

  const normalizedPath = toWslPath(filePath);
  if (!normalizedPath) return '';

  const startMarker = '__CLAWPEEK_WSL_FILE_BEGIN__';
  const endMarker = '__CLAWPEEK_WSL_FILE_END__';
  const quotedPath = quotePosixShellString(normalizedPath);
  const output = shellCaptureWsl(
    `if [ -f ${quotedPath} ]; then printf '%s\\n' '${startMarker}'; cat ${quotedPath}; printf '\\n%s\\n' '${endMarker}'; fi`,
    { ...options, multiline: true }
  );

  if (!output) return '';

  const startIndex = output.indexOf(startMarker);
  const endIndex = output.lastIndexOf(endMarker);
  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
    return '';
  }

  return output
    .slice(startIndex + startMarker.length, endIndex)
    .replace(/^\r?\n/, '')
    .replace(/\r?\n$/, '');
}

function discoverWslOpenClawConfigPath(options = {}) {
  if (!canUseWsl(options)) return '';

  const envPath = shellCaptureWsl(
    'if [ -n "$OPENCLAW_CONFIG_PATH" ] && [ -f "$OPENCLAW_CONFIG_PATH" ]; then printf %s "$OPENCLAW_CONFIG_PATH"; fi',
    options
  );
  if (envPath) return fromWslPath(envPath);

  const cliPath = shellCaptureWsl(
    'if command -v openclaw >/dev/null 2>&1; then p="$(openclaw config file 2>/dev/null)"; elif command -v clawdbot >/dev/null 2>&1; then p="$(clawdbot config file 2>/dev/null)"; else p=""; fi; if [ -n "$p" ] && [ -f "$p" ]; then printf %s "$p"; fi',
    options
  );
  if (cliPath) return fromWslPath(cliPath);

  const fallbackPath = shellCaptureWsl(
    'if [ -f ~/.openclaw/openclaw.json ]; then printf %s ~/.openclaw/openclaw.json; fi',
    options
  );
  return fallbackPath ? fromWslPath(fallbackPath) : '';
}

function discoverWslOpenClawExecutable(options = {}) {
  if (!canUseWsl(options)) return '';

  const shellCaptureWslFn = options.shellCaptureWslFn || shellCaptureWsl;
  const configPath = normalizeString(options.configPath || options.loadedConfig?.path || '');
  const homeDir = deriveWslHomeFromConfigPath(configPath);
  const searchRoots = [
    homeDir ? `${homeDir}/.npm-global/lib/node_modules` : '',
    '/usr/local/lib/node_modules',
    '/usr/lib/node_modules',
  ].filter(Boolean);

  for (const root of searchRoots) {
    const scriptPath = shellCaptureWslFn(
      `if [ -d ${quotePosixShellString(root)} ]; then find ${quotePosixShellString(root)} -maxdepth 2 \\( -path '*/openclaw.mjs' -o -path '*/clawdbot.mjs' \\) 2>/dev/null | head -n 1; fi`,
      options
    );
    if (scriptPath) {
      return `node ${quotePosixShellString(scriptPath)}`;
    }
  }

  return 'openclaw';
}

function discoverOpenClawExecutable() {
  for (const command of ['openclaw', 'clawdbot']) {
    if (commandExists(command)) return command;
  }
  return 'openclaw';
}

function discoverOpenClawConfigPath(options = {}) {
  const env = options.env || process.env;
  const fileExists = options.fileExistsFn || fs.existsSync;
  const capture = options.shellCaptureFn || shellCapture;
  const wslConfigPath = options.discoverWslConfigPathFn || discoverWslOpenClawConfigPath;
  const envPath = normalizeString(env.OPENCLAW_CONFIG_PATH);
  if (envPath && fileExists(envPath)) return envPath;

  for (const command of ['openclaw', 'clawdbot']) {
    const discovered = capture(command, ['config', 'file']);
    if (discovered && fileExists(discovered)) return discovered;
  }

  const guesses = [
    path.join(os.homedir(), '.openclaw', 'openclaw.json'),
    env.USERPROFILE ? path.join(env.USERPROFILE, '.openclaw', 'openclaw.json') : '',
    env.APPDATA ? path.join(env.APPDATA, 'OpenClaw', 'openclaw.json') : '',
  ].filter(Boolean);

  return guesses.find((file) => fileExists(file)) || wslConfigPath(options) || '';
}

function parseJson5Like(text) {
  const source = String(text ?? '').trim();
  if (!source) return null;

  try {
    return JSON.parse(source);
  } catch {
    try {
      return vm.runInNewContext(`(${source})`, Object.create(null), { timeout: 50 });
    } catch {
      return null;
    }
  }
}

function readOpenClawConfig(configPath = discoverOpenClawConfigPath(), options = {}) {
  if (!configPath) return { path: '', data: null };

  if (isWslPath(configPath)) {
    const raw = readWslTextFile(configPath, options);
    return {
      path: configPath,
      data: parseJson5Like(raw),
    };
  }

  if (!fs.existsSync(configPath)) return { path: '', data: null };

  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    return {
      path: configPath,
      data: parseJson5Like(raw),
    };
  } catch {
    return { path: configPath, data: null };
  }
}

function parseDotEnv(text) {
  const values = {};
  for (const rawLine of String(text ?? '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const cleaned = line.startsWith('export ') ? line.slice(7).trim() : line;
    const match = cleaned.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;

    let [, key, value] = match;
    value = value.trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, '');
    }

    values[key] = value;
  }
  return values;
}

function readOpenClawEnvFiles(configPath = discoverOpenClawConfigPath(), options = {}) {
  const envMap = {};

  if (isWslPath(configPath)) {
    const candidates = [
      resolvePathFromConfigDir(dirnameForPath(configPath), '.env'),
    ];
    const homeEnvFile = shellCaptureWsl(
      'if [ -f ~/.openclaw/.env ]; then printf %s ~/.openclaw/.env; fi',
      options
    );
    if (homeEnvFile) {
      candidates.push(fromWslPath(homeEnvFile));
    }

    for (const file of [...new Set(candidates.filter(Boolean))]) {
      try {
        const text = readWslTextFile(file, options);
        if (!text) continue;
        Object.assign(envMap, parseDotEnv(text));
      } catch {
        // ignore malformed env files and keep going
      }
    }

    return envMap;
  }

  const configDir = configPath ? path.dirname(configPath) : path.join(os.homedir(), '.openclaw');
  const candidates = [
    path.join(configDir, '.env'),
    path.join(os.homedir(), '.openclaw', '.env'),
    process.env.USERPROFILE ? path.join(process.env.USERPROFILE, '.openclaw', '.env') : '',
  ].filter(Boolean);

  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    try {
      Object.assign(envMap, parseDotEnv(fs.readFileSync(file, 'utf8')));
    } catch {
      // ignore malformed env files and keep going
    }
  }
  return envMap;
}

function mergeEnvMaps(...maps) {
  return Object.assign({}, ...maps.filter((map) => map && typeof map === 'object'));
}

function resolveEnvValue(name, envMap = process.env) {
  const key = normalizeString(name);
  if (!key) return '';
  const value = envMap?.[key];
  return normalizeString(value);
}

function expandEnvSubstitutions(value, envMap = process.env) {
  const raw = normalizeString(value);
  if (!raw) return '';

  return raw.replace(/\$\{([A-Z_][A-Z0-9_]*)\}/g, (_match, key) => {
    const resolved = resolveEnvValue(key, envMap);
    return resolved || '';
  }).trim();
}

function readSecretsPayload(configPath = discoverOpenClawConfigPath(), options = {}) {
  const configDir = configPath ? dirnameForPath(configPath) : path.join(os.homedir(), '.openclaw');
  const payloadPath = isWslPath(configDir)
    ? resolvePathFromConfigDir(configDir, 'secrets.json')
    : path.join(configDir, 'secrets.json');

  if (isWslPath(payloadPath)) {
    const raw = readWslTextFile(payloadPath, options);
    if (!raw) return { path: '', data: null };
    return {
      path: payloadPath,
      data: parseJson5Like(raw),
    };
  }

  if (!fs.existsSync(payloadPath)) return { path: '', data: null };

  try {
    return {
      path: payloadPath,
      data: parseJson5Like(fs.readFileSync(payloadPath, 'utf8')),
    };
  } catch {
    return { path: payloadPath, data: null };
  }
}

function getByPointer(payload, pointer) {
  const raw = normalizeString(pointer);
  if (!raw || !payload || typeof payload !== 'object') return '';

  const segments = raw.split('/').filter(Boolean).map((segment) => segment.replace(/~1/g, '/').replace(/~0/g, '~'));
  let current = payload;
  for (const segment of segments) {
    if (!current || typeof current !== 'object' || !(segment in current)) return '';
    current = current[segment];
  }

  return normalizeString(current);
}

function resolveSecretRefValue(ref, options = {}) {
  if (!ref || typeof ref !== 'object' || Array.isArray(ref)) return '';

  const envMap = options.envMap || process.env;
  const source = normalizeString(ref.source).toLowerCase();
  const id = normalizeString(ref.id || ref.name || ref.key);
  if (!source || !id) return '';

  if (source === 'env') {
    return resolveEnvValue(id, envMap);
  }

  if (source === 'file') {
    const maybeFile = resolvePathFromConfigDir(options.configDir || os.homedir(), id);

    if (isWslPath(maybeFile)) {
      try {
        return normalizeString(readWslTextFile(maybeFile, options));
      } catch {
        return '';
      }
    }

    if (fs.existsSync(maybeFile) && fs.statSync(maybeFile).isFile()) {
      try {
        return normalizeString(fs.readFileSync(maybeFile, 'utf8'));
      } catch {
        return '';
      }
    }

    if (options.secretsPayload?.data) {
      return getByPointer(options.secretsPayload.data, id);
    }
  }

  return '';
}

function resolveConfiguredSecret(value, options = {}) {
  if (typeof value === 'string') {
    return expandEnvSubstitutions(value, options.envMap || process.env);
  }

  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return resolveSecretRefValue(value, options);
  }

  return '';
}

function lookupConfigAuthValue(data, field, options = {}) {
  return resolveConfiguredSecret(data?.gateway?.auth?.[field], options);
}

function resolveGatewayToken(options = {}) {
  const loadedConfig = options.loadedConfig || readOpenClawConfig(options.configPath, options);
  const envFileValues = options.envFileValues || readOpenClawEnvFiles(loadedConfig.path || options.configPath, options);
  const envMap = mergeEnvMaps(envFileValues, process.env);
  const configDir = loadedConfig.path ? dirnameForPath(loadedConfig.path) : path.join(os.homedir(), '.openclaw');
  const secretsPayload = options.secretsPayload || readSecretsPayload(loadedConfig.path || options.configPath, options);
  const secretOptions = { envMap, configDir, secretsPayload };

  const explicitToken = normalizeString(options.explicitToken);
  if (explicitToken) {
    return { token: explicitToken, source: 'env:PET_GATEWAY_TOKEN' };
  }

  const explicitTokenFile = normalizeString(options.explicitTokenFile);
  if (explicitTokenFile && fs.existsSync(explicitTokenFile)) {
    try {
      const fileToken = normalizeString(fs.readFileSync(explicitTokenFile, 'utf8'));
      if (fileToken) {
        return { token: fileToken, source: `file:${explicitTokenFile}` };
      }
    } catch {
      // ignore
    }
  }

  const openClawEnvToken = resolveEnvValue('OPENCLAW_GATEWAY_TOKEN', envMap);
  if (openClawEnvToken) {
    return { token: openClawEnvToken, source: envFileValues.OPENCLAW_GATEWAY_TOKEN ? 'dotenv:OPENCLAW_GATEWAY_TOKEN' : 'env:OPENCLAW_GATEWAY_TOKEN' };
  }

  for (const command of ['openclaw', 'clawdbot']) {
    const token = shellCapture(command, ['config', 'get', 'gateway.auth.token']);
    if (token && !token.startsWith('{') && !token.startsWith('[')) {
      return { token: expandEnvSubstitutions(token, envMap), source: `cli:${command} config get gateway.auth.token` };
    }
  }

  const configToken = lookupConfigAuthValue(loadedConfig.data, 'token', secretOptions);
  if (configToken) {
    return { token: configToken, source: `config:${loadedConfig.path || 'openclaw.json'}` };
  }

  return { token: '', source: 'none' };
}

function resolveGatewayPassword(options = {}) {
  const loadedConfig = options.loadedConfig || readOpenClawConfig(options.configPath, options);
  const envFileValues = options.envFileValues || readOpenClawEnvFiles(loadedConfig.path || options.configPath, options);
  const envMap = mergeEnvMaps(envFileValues, process.env);
  const configDir = loadedConfig.path ? dirnameForPath(loadedConfig.path) : path.join(os.homedir(), '.openclaw');
  const secretsPayload = options.secretsPayload || readSecretsPayload(loadedConfig.path || options.configPath, options);
  const secretOptions = { envMap, configDir, secretsPayload };

  const explicitPassword = normalizeString(options.explicitPassword);
  if (explicitPassword) {
    return { password: explicitPassword, source: 'env:PET_GATEWAY_PASSWORD' };
  }

  const explicitPasswordFile = normalizeString(options.explicitPasswordFile);
  if (explicitPasswordFile && fs.existsSync(explicitPasswordFile)) {
    try {
      const filePassword = normalizeString(fs.readFileSync(explicitPasswordFile, 'utf8'));
      if (filePassword) {
        return { password: filePassword, source: `file:${explicitPasswordFile}` };
      }
    } catch {
      // ignore
    }
  }

  const openClawEnvPassword = resolveEnvValue('OPENCLAW_GATEWAY_PASSWORD', envMap);
  if (openClawEnvPassword) {
    return { password: openClawEnvPassword, source: envFileValues.OPENCLAW_GATEWAY_PASSWORD ? 'dotenv:OPENCLAW_GATEWAY_PASSWORD' : 'env:OPENCLAW_GATEWAY_PASSWORD' };
  }

  for (const command of ['openclaw', 'clawdbot']) {
    const password = shellCapture(command, ['config', 'get', 'gateway.auth.password']);
    if (password && !password.startsWith('{') && !password.startsWith('[')) {
      return { password: expandEnvSubstitutions(password, envMap), source: `cli:${command} config get gateway.auth.password` };
    }
  }

  const configPassword = lookupConfigAuthValue(loadedConfig.data, 'password', secretOptions);
  if (configPassword) {
    return { password: configPassword, source: `config:${loadedConfig.path || 'openclaw.json'}` };
  }

  return { password: '', source: 'none' };
}

function wsOriginToHttpOrigin(gatewayUrl) {
  const source = normalizeString(gatewayUrl);
  if (!source) return 'http://127.0.0.1:18789';

  try {
    const url = new URL(source);
    url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
    url.pathname = '/';
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return 'http://127.0.0.1:18789';
  }
}

function normalizeBaseUrl(baseUrl) {
  const source = normalizeString(baseUrl);
  if (!source) return '';

  try {
    const url = new URL(source);
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/+$/, '/') || '';
  } catch {
    return '';
  }
}

function resolveConfiguredGatewayUrl(options = {}) {
  const explicitUrl = normalizeString(options.explicitUrl);
  if (explicitUrl) return explicitUrl;

  const loadedConfig = options.loadedConfig || readOpenClawConfig(options.configPath, options);
  const remoteUrl = normalizeString(loadedConfig.data?.gateway?.remote?.url);
  if (remoteUrl) return remoteUrl;

  const configuredPort = Number.parseInt(normalizeString(loadedConfig.data?.gateway?.port), 10);
  const port = Number.isFinite(configuredPort) && configuredPort > 0 ? configuredPort : 18789;
  const tlsEnabled = Boolean(loadedConfig.data?.gateway?.tls?.enabled);
  return `${tlsEnabled ? 'wss' : 'ws'}://127.0.0.1:${port}`;
}

function resolveConfiguredControlUiBaseUrl(options = {}) {
  const explicitBase = normalizeBaseUrl(options.explicitBaseUrl);
  if (explicitBase) return explicitBase;

  const loadedConfig = options.loadedConfig || readOpenClawConfig(options.configPath, options);
  const gatewayUrl = resolveConfiguredGatewayUrl({ explicitUrl: options.gatewayUrl, loadedConfig });
  const basePath = normalizeString(loadedConfig.data?.gateway?.controlUi?.basePath);
  if (!basePath) return '';

  try {
    return new URL(basePath.replace(/^\/*/, '/'), wsOriginToHttpOrigin(gatewayUrl)).toString().replace(/\/+$/, '/') || '';
  } catch {
    return '';
  }
}

function prettifyProviderName(value) {
  const normalized = normalizeString(value).toLowerCase();
  if (!normalized) return '';

  const labels = {
    brave: 'Brave',
    openrouter: 'OpenRouter',
    openai: 'OpenAI',
    'openai-codex': 'OpenAI Codex',
    anthropic: 'Anthropic',
    google: 'Google',
    gemini: 'Gemini',
    azure: 'Azure OpenAI',
  };

  return labels[normalized] || normalized;
}

function resolveConfiguredApiModel(loadedConfig = {}) {
  return normalizeString(loadedConfig.data?.agents?.defaults?.model?.primary);
}

function resolveConfiguredApiProvider(loadedConfig = {}) {
  const model = resolveConfiguredApiModel(loadedConfig);
  const alias = normalizeString(loadedConfig.data?.agents?.defaults?.models?.[model]?.alias);
  if (alias) return alias;

  const fromModel = normalizeString(model.split('/')[0]);
  if (fromModel) return prettifyProviderName(fromModel);

  const profiles = loadedConfig.data?.auth?.profiles;
  if (profiles && typeof profiles === 'object') {
    const firstProfile = Object.values(profiles).find((entry) => entry && typeof entry === 'object');
    const provider = normalizeString(firstProfile?.provider);
    if (provider) return prettifyProviderName(provider);
  }

  return '';
}

function resolveConfiguredToolConfig(loadedConfig = {}) {
  const profile = normalizeString(loadedConfig.data?.tools?.profile);
  const webSearch = loadedConfig.data?.tools?.web?.search;
  const searchEnabled = Boolean(webSearch?.enabled);
  const searchProvider = prettifyProviderName(webSearch?.provider);

  const parts = [];
  if (profile) {
    parts.push(profile);
  }

  if (searchEnabled) {
    parts.push(searchProvider ? `${searchProvider} Search` : 'Web Search');
  }

  return parts.join(' · ');
}

function resolveGatewayConnectOrigin({ gatewayUrl, controlUiBaseUrl = '' } = {}) {
  const preferredBase = normalizeBaseUrl(controlUiBaseUrl);
  if (preferredBase) {
    try {
      return new URL(preferredBase).origin;
    } catch {
      // ignore and fall back to the gateway origin
    }
  }

  try {
    return new URL(wsOriginToHttpOrigin(gatewayUrl)).origin;
  } catch {
    return 'http://127.0.0.1:18789';
  }
}

function normalizeChatSessionKey(sessionKey, mainSessionKey = 'main') {
  const raw = normalizeString(sessionKey || mainSessionKey);
  if (!raw || raw === 'main' || raw === mainSessionKey) {
    return 'agent:main:main';
  }

  return raw;
}

function buildControlUiChatUrl({ gatewayUrl, controlUiBaseUrl = '', sessionKey = 'main', mainSessionKey = 'main', token = '' } = {}) {
  const gatewayHttpOrigin = wsOriginToHttpOrigin(gatewayUrl);
  const base = normalizeBaseUrl(controlUiBaseUrl) || gatewayHttpOrigin;
  const baseUrl = new URL(base.endsWith('/') ? base : `${base}/`);
  const target = new URL(baseUrl.toString());
  const joinedPath = `${baseUrl.pathname.replace(/\/+$/, '')}/chat`.replace(/\/+/g, '/');
  target.pathname = joinedPath.startsWith('/') ? joinedPath : `/${joinedPath}`;
  target.search = '';
  target.hash = '';
  target.searchParams.set('session', normalizeChatSessionKey(sessionKey, mainSessionKey));

  const normalizedGatewayOrigin = new URL(gatewayHttpOrigin);
  if (baseUrl.origin !== normalizedGatewayOrigin.origin) {
    target.searchParams.set('gatewayUrl', normalizeString(gatewayUrl));
  }

  const clean = target.toString();
  const normalizedToken = normalizeString(token);
  return normalizedToken ? `${clean}#token=${encodeURIComponent(normalizedToken)}` : clean;
}

function buildCliTuiCommand({ executable = discoverOpenClawExecutable(), gatewayUrl = '', sessionKey = 'main', token = '', password = '', cliCommand = '' } = {}) {
  const normalizedSessionKey = normalizeChatSessionKey(sessionKey, 'main');
  const normalizedToken = normalizeString(token);
  const normalizedPassword = normalizeString(password);
  const normalizedGatewayUrl = normalizeString(gatewayUrl);

  const authArgs = normalizedToken
    ? ` --url ${normalizedGatewayUrl} --token ${normalizedToken}`
    : normalizedPassword
      ? ` --url ${normalizedGatewayUrl} --password ${normalizedPassword}`
      : '';

  const context = {
    executable,
    gatewayUrl: normalizedGatewayUrl,
    sessionKey: normalizedSessionKey,
    token: normalizedToken,
    password: normalizedPassword,
    authArgs: authArgs.trim(),
  };

  const template = normalizeString(cliCommand);
  if (template) {
    return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, key) => context[key] ?? '');
  }

  return normalizedToken || normalizedPassword
    ? `${executable} tui --session ${normalizedSessionKey}${authArgs}`
    : `${executable} tui --session ${normalizedSessionKey}`;
}

function buildRuntimeConfig() {
  const loadedConfig = readOpenClawConfig();
  const openClawCommand = isWslPath(loadedConfig.path)
    ? discoverWslOpenClawExecutable({ configPath: loadedConfig.path, loadedConfig })
    : discoverOpenClawExecutable();
  const apiModel = resolveConfiguredApiModel(loadedConfig);
  const apiProvider = resolveConfiguredApiProvider(loadedConfig);
  const toolConfig = resolveConfiguredToolConfig(loadedConfig);
  const gatewayUrl = resolveConfiguredGatewayUrl({
    explicitUrl: process.env.PET_GATEWAY_URL,
    loadedConfig,
  });
  const controlUiBaseUrl = resolveConfiguredControlUiBaseUrl({
    explicitBaseUrl: process.env.PET_CONTROL_UI_BASE_URL,
    gatewayUrl,
    loadedConfig,
  });
  const gatewayToken = resolveGatewayToken({
    explicitToken: process.env.PET_GATEWAY_TOKEN,
    explicitTokenFile: process.env.PET_GATEWAY_TOKEN_FILE,
    loadedConfig,
  });
  const gatewayPassword = resolveGatewayPassword({
    explicitPassword: process.env.PET_GATEWAY_PASSWORD,
    explicitPasswordFile: process.env.PET_GATEWAY_PASSWORD_FILE,
    loadedConfig,
  });

  return {
    gatewayUrl,
    controlUiBaseUrl,
    apiProvider,
    apiModel,
    toolConfig,
    gatewayToken: gatewayToken.token,
    gatewayTokenSource: gatewayToken.source,
    gatewayPassword: gatewayPassword.password,
    gatewayPasswordSource: gatewayPassword.source,
    configPath: loadedConfig.path || '',
    mainSessionKey: process.env.PET_MAIN_SESSION_KEY || 'main',
    alwaysOnTop: boolEnv(process.env.PET_ALWAYS_ON_TOP, true),
    petCorner: process.env.PET_CORNER || 'bottom-right',
    petSize: intEnv(process.env.PET_SIZE, 240, 180, 360),
    dashboardWidth: intEnv(process.env.PET_DASHBOARD_WIDTH, 1120, 900, 1600),
    dashboardHeight: intEnv(process.env.PET_DASHBOARD_HEIGHT, 840, 700, 1200),
    chatWidth: intEnv(process.env.PET_CHAT_WIDTH, 1260, 980, 1800),
    chatHeight: intEnv(process.env.PET_CHAT_HEIGHT, 860, 680, 1400),
    clickAction: normalizeString(process.env.PET_CLICK_ACTION) || 'gateway-chat',
    cliCommand: normalizeString(process.env.PET_CLI_COMMAND),
    instanceId: 'clawpeek-desktop-pet',
    openClawCommand,
  };
}

module.exports = {
  boolEnv,
  intEnv,
  parseJson5Like,
  parseDotEnv,
  canUseWsl,
  discoverOpenClawExecutable,
  discoverWslOpenClawExecutable,
  discoverWslOpenClawConfigPath,
  discoverOpenClawConfigPath,
  readOpenClawConfig,
  readOpenClawEnvFiles,
  readWslTextFile,
  readSecretsPayload,
  expandEnvSubstitutions,
  resolveGatewayToken,
  resolveGatewayPassword,
  resolveConfiguredGatewayUrl,
  resolveConfiguredControlUiBaseUrl,
  resolveConfiguredApiModel,
  resolveConfiguredApiProvider,
  resolveConfiguredToolConfig,
  wsOriginToHttpOrigin,
  resolveGatewayConnectOrigin,
  normalizeChatSessionKey,
  buildControlUiChatUrl,
  buildCliTuiCommand,
  buildRuntimeConfig,
};
