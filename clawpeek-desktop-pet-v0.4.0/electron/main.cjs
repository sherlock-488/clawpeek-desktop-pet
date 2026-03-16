const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, screen } = require('electron');
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { createDebugLogger } = require('./debug-log.cjs');
const { debugLabelForState } = require('./debug-text.cjs');
const {
  buildRuntimeConfig,
  buildControlUiChatUrl,
  buildCliTuiCommand,
  resolveGatewayConnectOrigin,
} = require('./runtime.cjs');
const { createGatewayBridge, loadOrCreateDeviceState } = require('./gateway-bridge.cjs');

const APP_NAME = 'ClawPeek 2D 桌宠';
const PET_SESSION_PARTITION = 'persist:clawpeek-desktop-pet';
const CLICK_ACTIONS = new Set(['gateway-chat', 'cli-tui']);

// Transparent frameless windows can exhibit compositor scaling artifacts while moving on Windows.
app.disableHardwareAcceleration();

let petWindow = null;
let dashboardWindow = null;
let chatWindow = null;
let tray = null;
let latestSnapshot = null;
let isQuitting = false;
let preferences = null;
let gatewayBridge = null;
let lastLoggedSnapshotKey = '';
let lastTrayStatusKey = '';
let gatewayConnectionPreference = 'auto';

const config = buildRuntimeConfig();
const appStartedAt = Date.now();
const debugLogger = createDebugLogger({
  resolveBaseDir: () => app.getPath('userData'),
});
const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
  app.quit();
}

app.on('second-instance', () => {
  if (!petWindow || petWindow.isDestroyed()) {
    createPetWindow();
  }
  petWindow?.show();
  petWindow?.focus();
});

function iconPath() {
  return path.join(__dirname, '..', 'assets', 'lobster.png');
}

function identityFilePath() {
  return path.join(app.getPath('userData'), 'gateway-device.json');
}

function preferencesFilePath() {
  return path.join(app.getPath('userData'), 'preferences.json');
}

function normalizeClickAction(value) {
  return CLICK_ACTIONS.has(value) ? value : 'gateway-chat';
}

function loadPreferences() {
  const file = preferencesFilePath();
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    return {
      clickAction: normalizeClickAction(raw?.clickAction || config.clickAction),
    };
  } catch {
    return {
      clickAction: normalizeClickAction(config.clickAction),
    };
  }
}

function savePreferences() {
  try {
    fs.mkdirSync(path.dirname(preferencesFilePath()), { recursive: true });
    fs.writeFileSync(preferencesFilePath(), JSON.stringify(preferences, null, 2), 'utf8');
  } catch {
    // ignore
  }
}

function currentClickAction() {
  return normalizeClickAction(preferences?.clickAction || config.clickAction);
}

function interactionSettings() {
  return {
    clickAction: currentClickAction(),
  };
}

function broadcastInteractionSettings() {
  const payload = interactionSettings();
  for (const windowRef of [petWindow, dashboardWindow]) {
    if (windowRef && !windowRef.isDestroyed()) {
      windowRef.webContents.send('interaction:settings', payload);
    }
  }
}

function logBootstrapInfo() {
  const forcedOrigin = resolveGatewayConnectOrigin({
    gatewayUrl: config.gatewayUrl,
    controlUiBaseUrl: config.controlUiBaseUrl,
  });
  const authMode = config.gatewayToken ? 'token' : config.gatewayPassword ? 'password' : 'none';
  debugLogger.log('bootstrap', 'runtime', {
    gateway: config.gatewayUrl,
    origin: forcedOrigin,
    authMode,
    tokenSource: config.gatewayTokenSource,
    passwordSource: config.gatewayPasswordSource,
    config: config.configPath || 'n/a',
    clickAction: currentClickAction(),
    debugLogPath: debugLogger.getFilePath(),
  });
}

function getPetBounds() {
  const area = screen.getPrimaryDisplay().workArea;
  const width = config.petSize;
  const height = config.petSize;
  const margin = 18;

  let x = area.x + area.width - width - margin;
  let y = area.y + area.height - height - margin;

  if (config.petCorner.includes('left')) x = area.x + margin;
  if (config.petCorner.includes('top')) y = area.y + margin;

  return { width, height, x, y };
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function movePetWindowBy(deltaX, deltaY) {
  if (!petWindow || petWindow.isDestroyed()) return;

  const bounds = petWindow.getBounds();
  const display = screen.getDisplayMatching(bounds);
  const workArea = display.workArea;
  const nextX = clamp(bounds.x + Math.round(deltaX), workArea.x, workArea.x + workArea.width - bounds.width);
  const nextY = clamp(bounds.y + Math.round(deltaY), workArea.y, workArea.y + workArea.height - bounds.height);
  petWindow.setBounds({ x: nextX, y: nextY, width: bounds.width, height: bounds.height }, false);
}

function stabilizePetWindow(windowRef, bounds) {
  if (!windowRef || windowRef.isDestroyed()) return;

  const fixedBounds = { ...bounds };
  const lockZoom = () => {
    if (!windowRef || windowRef.isDestroyed()) return;
    try {
      windowRef.webContents.setZoomFactor(1);
      windowRef.webContents.setVisualZoomLevelLimits(1, 1).catch(() => {});
      windowRef.webContents.setLayoutZoomLevelLimits(0, 0).catch(() => {});
    } catch {
      // ignore unsupported zoom APIs
    }
  };

  windowRef.setResizable(false);
  windowRef.setMinimumSize(fixedBounds.width, fixedBounds.height);
  windowRef.setMaximumSize(fixedBounds.width, fixedBounds.height);

  lockZoom();
  windowRef.webContents.on('did-finish-load', lockZoom);
  windowRef.webContents.on('zoom-changed', lockZoom);
  windowRef.on('move', () => {
    if (!windowRef || windowRef.isDestroyed()) return;
    const current = windowRef.getBounds();
    if (current.width !== fixedBounds.width || current.height !== fixedBounds.height) {
      windowRef.setBounds({
        x: current.x,
        y: current.y,
        width: fixedBounds.width,
        height: fixedBounds.height,
      }, false);
    }
    lockZoom();
  });
}

function bridgeSettings(overrides = {}) {
  return {
    gatewayUrl: config.gatewayUrl,
    gatewayToken: config.gatewayToken,
    gatewayPassword: config.gatewayPassword,
    connectOrigin: resolveGatewayConnectOrigin({
      gatewayUrl: config.gatewayUrl,
      controlUiBaseUrl: config.controlUiBaseUrl,
    }),
    instanceId: config.instanceId,
    userAgent: `clawpeek-desktop-pet/${app.getVersion ? app.getVersion() : '0.4.0'}`,
    clientPlatform: process.platform,
    locale: app.getLocale?.() || 'zh-CN',
    authPreference: String(overrides.authPreference || gatewayConnectionPreference || 'auto').trim() || 'auto',
  };
}

function ensureGatewayBridge() {
  if (gatewayBridge) return gatewayBridge;
  gatewayBridge = createGatewayBridge({
    identityFile: identityFilePath(),
    debugLog: (scope, message, payload, options) => debugLogger.log(scope, message, payload, options),
  });
  gatewayBridge.on('status', (status) => {
    if (petWindow && !petWindow.isDestroyed()) {
      petWindow.webContents.send('gateway:status', status);
    }
  });
  gatewayBridge.on('frame', (frame) => {
    if (petWindow && !petWindow.isDestroyed()) {
      petWindow.webContents.send('gateway:frame', frame);
    }
  });
  return gatewayBridge;
}

function normalizeAuthPreference(value) {
  const normalized = String(value || '').trim();
  return ['auto', 'shared-token', 'password', 'device-token'].includes(normalized) ? normalized : 'auto';
}

function loadDeviceState() {
  try {
    return loadOrCreateDeviceState(identityFilePath());
  } catch {
    return { deviceToken: '' };
  }
}

function availableAuthModes() {
  const deviceState = loadDeviceState();
  const modes = ['auto'];
  if (config.gatewayToken) modes.push('shared-token');
  if (config.gatewayPassword) modes.push('password');
  if (String(deviceState.deviceToken || '').trim()) modes.push('device-token');
  return modes;
}

function startGatewayBridge(options = {}) {
  gatewayConnectionPreference = normalizeAuthPreference(options.authPreference || gatewayConnectionPreference);
  ensureGatewayBridge().start(bridgeSettings({ authPreference: gatewayConnectionPreference }));
}

function stopGatewayBridge() {
  gatewayBridge?.stop();
}

function createPetWindow() {
  const bounds = getPetBounds();
  petWindow = new BrowserWindow({
    ...bounds,
    useContentSize: true,
    transparent: true,
    frame: false,
    resizable: false,
    hasShadow: false,
    skipTaskbar: true,
    alwaysOnTop: config.alwaysOnTop,
    fullscreenable: false,
    maximizable: false,
    minimizable: false,
    thickFrame: false,
    roundedCorners: false,
    backgroundColor: '#00000000',
    title: APP_NAME,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      partition: PET_SESSION_PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  petWindow.setMenuBarVisibility(false);
  stabilizePetWindow(petWindow, bounds);
  petWindow.loadFile(path.join(__dirname, '..', 'renderer', 'pet.html'));
  petWindow.on('closed', () => {
    petWindow = null;
  });
}

function createDashboardWindow() {
  if (dashboardWindow && !dashboardWindow.isDestroyed()) {
    dashboardWindow.show();
    dashboardWindow.focus();
    pushSnapshotToDashboard();
    return dashboardWindow;
  }

  dashboardWindow = new BrowserWindow({
    width: config.dashboardWidth,
    height: config.dashboardHeight,
    minWidth: 920,
    minHeight: 700,
    show: false,
    title: `${APP_NAME} · 龙虾控制面板`,
    autoHideMenuBar: true,
    icon: iconPath(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      partition: PET_SESSION_PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  dashboardWindow.loadFile(path.join(__dirname, '..', 'renderer', 'dashboard.html'));
  dashboardWindow.once('ready-to-show', () => {
    dashboardWindow.show();
    pushSnapshotToDashboard();
    broadcastInteractionSettings();
  });
  dashboardWindow.on('closed', () => {
    dashboardWindow = null;
  });
  return dashboardWindow;
}

function currentChatSessionKey(requestedSessionKey = '') {
  const derivedSessionKey = latestSnapshot?.derived?.sessionKey;
  return String(requestedSessionKey || derivedSessionKey || config.mainSessionKey || 'main').trim();
}

function buildChatWindowUrl(sessionKey = '') {
  return buildControlUiChatUrl({
    gatewayUrl: config.gatewayUrl,
    controlUiBaseUrl: config.controlUiBaseUrl,
    sessionKey: currentChatSessionKey(sessionKey),
    mainSessionKey: config.mainSessionKey,
    token: config.gatewayToken,
  });
}

function createChatWindow(sessionKey = '') {
  const url = buildChatWindowUrl(sessionKey);

  if (chatWindow && !chatWindow.isDestroyed()) {
    if (chatWindow.webContents.getURL() !== url) {
      chatWindow.loadURL(url);
    }
    chatWindow.show();
    chatWindow.focus();
    return chatWindow;
  }

  chatWindow = new BrowserWindow({
    width: config.chatWidth,
    height: config.chatHeight,
    minWidth: 960,
    minHeight: 680,
    show: false,
    title: 'OpenClaw 聊天面板',
    autoHideMenuBar: true,
    icon: iconPath(),
    webPreferences: {
      partition: PET_SESSION_PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  let revealTimer = null;
  const revealWindow = () => {
    if (!chatWindow || chatWindow.isDestroyed()) return;
    if (revealTimer) {
      clearTimeout(revealTimer);
      revealTimer = null;
    }
    chatWindow.show();
    chatWindow.focus();
  };

  chatWindow.loadURL(url);
  chatWindow.once('ready-to-show', revealWindow);
  chatWindow.webContents.once('did-finish-load', revealWindow);
  chatWindow.webContents.once('did-fail-load', (_event, errorCode, errorDescription) => {
    if (petWindow && !petWindow.isDestroyed()) {
      petWindow.webContents.send('gateway:status', {
        type: 'SYSTEM_ERROR',
        ts: Date.now(),
        label: '打开聊天面板失败',
        detail: `${errorCode}: ${errorDescription}`,
      });
    }
    revealWindow();
  });
  revealTimer = setTimeout(revealWindow, 1200);
  chatWindow.on('closed', () => {
    if (revealTimer) {
      clearTimeout(revealTimer);
      revealTimer = null;
    }
    chatWindow = null;
  });
  return chatWindow;
}

function commandExists(command) {
  try {
    const probe = process.platform === 'win32' ? 'where' : 'which';
    return spawnSync(probe, [command], { stdio: 'ignore', windowsHide: true }).status === 0;
  } catch {
    return false;
  }
}

function applescriptString(value) {
  return `"${String(value ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function isWslRuntimeConfig() {
  return process.platform === 'win32' && String(config.configPath || '').startsWith('wsl:');
}

function quoteCmdDoubleQuoted(value) {
  return String(value ?? '').replace(/(["^])/g, '^$1');
}

function spawnDetached(command, args, options = {}) {
  const child = spawn(command, args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
    ...options,
  });
  child.unref();
  return child;
}

function openCliChat(sessionKey = '') {
  const command = buildCliTuiCommand({
    executable: config.openClawCommand,
    gatewayUrl: config.gatewayUrl,
    sessionKey: currentChatSessionKey(sessionKey),
    token: config.gatewayToken,
    password: config.gatewayPassword,
    cliCommand: config.cliCommand,
  });

  let launched = false;

  try {
    if (process.platform === 'win32') {
      if (isWslRuntimeConfig()) {
        const wslCommand = `${command}; exec bash -l`;
        const bashArgs = ['-e', 'bash', '-lc', wslCommand];

        if (commandExists('wt.exe')) {
          spawnDetached('wt.exe', ['new-tab', '--title', 'OpenClaw TUI', 'wsl.exe', ...bashArgs]);
          launched = true;
        } else {
          const cmdLine = `wsl.exe ${bashArgs.map((part) => part.includes(' ') ? `"${quoteCmdDoubleQuoted(part)}"` : part).join(' ')}`;
          spawnDetached('cmd.exe', ['/d', '/s', '/k', cmdLine]);
          launched = true;
        }
      } else {
        spawnDetached('cmd.exe', ['/d', '/s', '/k', command]);
        launched = true;
      }
    } else if (process.platform === 'darwin') {
      spawnDetached('osascript', [
        '-e', 'tell application "Terminal" to activate',
        '-e', `tell application "Terminal" to do script ${applescriptString(command)}`,
      ]);
      launched = true;
    } else {
      const terminalCandidates = [
        { cmd: 'x-terminal-emulator', args: ['-e', 'bash', '-lc', `${command}; exec bash`] },
        { cmd: 'gnome-terminal', args: ['--', 'bash', '-lc', `${command}; exec bash`] },
        { cmd: 'konsole', args: ['-e', 'bash', '-lc', `${command}; exec bash`] },
        { cmd: 'xfce4-terminal', args: ['--command', `bash -lc \"${command}; exec bash\"`] },
        { cmd: 'xterm', args: ['-e', `bash -lc \"${command}; exec bash\"`] },
      ];

      for (const candidate of terminalCandidates) {
        if (!commandExists(candidate.cmd)) continue;
        spawnDetached(candidate.cmd, candidate.args);
        launched = true;
        break;
      }
    }
  } catch {
    launched = false;
  }

  if (!launched) {
    const detail = process.platform === 'linux'
      ? `未找到可用终端。请安装 x-terminal-emulator / gnome-terminal / konsole / xfce4-terminal / xterm，或在配置里写 cliCommand。命令：${command}`
      : `无法打开命令行聊天。命令：${command}`;
    if (petWindow && !petWindow.isDestroyed()) {
      petWindow.webContents.send('gateway:status', {
        type: 'SYSTEM_ERROR',
        ts: Date.now(),
        label: '打开命令行聊天失败',
        detail,
      });
    }
  }
}

function openPrimaryAction(sessionKey = '') {
  if (currentClickAction() === 'cli-tui') {
    openCliChat(sessionKey);
    return;
  }
  createChatWindow(sessionKey);
}

function pushSnapshotToDashboard() {
  if (!dashboardWindow || dashboardWindow.isDestroyed() || !latestSnapshot) return;
  dashboardWindow.webContents.send('state:snapshot', latestSnapshot);
}

function trayConnectionLabel() {
  const connection = latestSnapshot?.connection || 'disconnected';
  switch (connection) {
    case 'connected':
      return '已连接';
    case 'connecting':
      return '连接中';
    case 'error':
      return '连接失败';
    default:
      return '休息中';
  }
}

function trayConnectionMenuItems() {
  const availableModes = new Set(availableAuthModes());
  const items = [
    {
      label: `当前状态：${trayConnectionLabel()}`,
      enabled: false,
    },
    { type: 'separator' },
    {
      label: '自动重连',
      click() {
        startGatewayBridge({ authPreference: 'auto' });
      },
    },
  ];

  if (availableModes.has('shared-token')) {
    items.push({
      label: '只试 Token',
      click() {
        startGatewayBridge({ authPreference: 'shared-token' });
      },
    });
  }

  if (availableModes.has('password')) {
    items.push({
      label: '只试 Password',
      click() {
        startGatewayBridge({ authPreference: 'password' });
      },
    });
  }

  if (availableModes.has('device-token')) {
    items.push({
      label: '只试设备 Token',
      click() {
        startGatewayBridge({ authPreference: 'device-token' });
      },
    });
  }

  items.push({
    label: '暂停连接',
    click() {
      stopGatewayBridge();
    },
  });

  return items;
}

function rebuildTrayMenu() {
  if (!tray) return;

  tray.setContextMenu(Menu.buildFromTemplate([
    {
      label: '显示桌宠',
      click() {
        if (!petWindow || petWindow.isDestroyed()) {
          createPetWindow();
        }
        petWindow?.show();
        petWindow?.focus();
      },
    },
    {
      label: '连接',
      submenu: trayConnectionMenuItems(),
    },
    {
      label: '单击动作',
      submenu: [
        {
          label: '打开 Gateway 聊天面板',
          type: 'radio',
          checked: currentClickAction() === 'gateway-chat',
          click() {
            preferences.clickAction = 'gateway-chat';
            savePreferences();
            broadcastInteractionSettings();
            rebuildTrayMenu();
          },
        },
        {
          label: '打开命令行 TUI',
          type: 'radio',
          checked: currentClickAction() === 'cli-tui',
          click() {
            preferences.clickAction = 'cli-tui';
            savePreferences();
            broadcastInteractionSettings();
            rebuildTrayMenu();
          },
        },
      ],
    },
    {
      label: '打开当前单击动作',
      click() {
        openPrimaryAction();
      },
    },
    {
      label: '打开 OpenClaw 聊天面板',
      click() {
        createChatWindow();
      },
    },
    {
      label: '打开命令行 TUI',
      click() {
        openCliChat();
      },
    },
    {
      label: '打开龙虾控制面板',
      click() {
        createDashboardWindow();
      },
    },
    { type: 'separator' },
    {
      label: '退出',
      click() {
        app.quit();
      },
    },
  ]));
}

function createTray() {
  const icon = nativeImage.createFromPath(iconPath());
  tray = new Tray(icon);
  tray.setToolTip(APP_NAME);
  rebuildTrayMenu();

  tray.on('double-click', () => {
    if (petWindow?.isVisible()) {
      petWindow.hide();
    } else {
      if (!petWindow || petWindow.isDestroyed()) {
        createPetWindow();
      }
      petWindow?.show();
      petWindow?.focus();
    }
  });
}

ipcMain.handle('config:getBootstrap', () => ({
  gatewayUrl: config.gatewayUrl,
  gatewayAuthMode: config.gatewayToken ? 'token' : config.gatewayPassword ? 'password' : 'none',
  gatewayAuthSource: config.gatewayToken ? config.gatewayTokenSource : config.gatewayPassword ? config.gatewayPasswordSource : 'none',
  gatewayTokenSource: config.gatewayTokenSource,
  gatewayPasswordSource: config.gatewayPasswordSource,
  gatewayTokenAvailable: Boolean(config.gatewayToken),
  gatewayPasswordAvailable: Boolean(config.gatewayPassword),
  deviceTokenAvailable: availableAuthModes().includes('device-token'),
  availableAuthModes: availableAuthModes(),
  gatewayConnectionPreference,
  apiProvider: config.apiProvider,
  apiModel: config.apiModel,
  toolConfig: config.toolConfig,
  controlUiBaseUrl: config.controlUiBaseUrl,
  mainSessionKey: config.mainSessionKey,
  instanceId: config.instanceId,
  configPath: config.configPath,
  runtimeHost: isWslRuntimeConfig() ? 'wsl' : process.platform,
  openClawCommand: config.openClawCommand,
  appStartedAt,
  appVersion: app.getVersion ? app.getVersion() : '0.4.0',
  debugLogPath: debugLogger.getFilePath(),
  clickAction: currentClickAction(),
}));

ipcMain.handle('state:getSnapshot', () => latestSnapshot);
ipcMain.handle('interaction:getSettings', () => interactionSettings());
ipcMain.handle('debug:getPath', () => debugLogger.getFilePath());
ipcMain.handle('gateway:start', (_event, payload = {}) => {
  startGatewayBridge(payload || {});
  return { ok: true };
});
ipcMain.handle('gateway:stop', () => {
  stopGatewayBridge();
  return { ok: true };
});
ipcMain.handle('gateway:request', async (_event, payload = {}) => {
  const method = String(payload?.method || '').trim();
  if (!method) {
    throw new Error('gateway request method is required');
  }

  const bridge = ensureGatewayBridge();
  if (!bridge.isActive()) {
    startGatewayBridge();
  }

  const params = payload?.params && typeof payload.params === 'object' ? payload.params : {};
  debugLogger.log('gateway-request', 'invoke', {
    method,
    params,
  });

  try {
    const response = await bridge.request(method, params);
    debugLogger.log('gateway-request', 'success', {
      method,
    });
    return response;
  } catch (error) {
    debugLogger.log('gateway-request', 'error', {
      method,
      detail: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
});

ipcMain.on('state:update', (_event, snapshot) => {
  latestSnapshot = snapshot;
  const phase = snapshot?.derived?.phase || 'idle';
  const debugStatus = debugLabelForState(snapshot?.derived);
  const status = snapshot?.derived?.label || '空闲中';
  const activity = snapshot?.derived?.activityKind || 'none';
  const sessionKey = snapshot?.derived?.sessionKey || config.mainSessionKey || 'main';
  const snapshotKey = [sessionKey, phase, activity, debugStatus].join('|');

  if (snapshotKey !== lastLoggedSnapshotKey) {
    lastLoggedSnapshotKey = snapshotKey;
    debugLogger.log('state', 'snapshot', {
      sessionKey,
      phase,
      activity,
      status: debugStatus,
      connection: snapshot?.connection || 'disconnected',
      recentEvent: snapshot?.recentEvents?.[0]?.type || '',
    });
  }

  tray?.setToolTip(`${APP_NAME} · ${phase} · ${status}`);
  const trayStatusKey = `${snapshot?.connection || 'disconnected'}|${gatewayConnectionPreference}|${availableAuthModes().join(',')}`;
  if (trayStatusKey !== lastTrayStatusKey) {
    lastTrayStatusKey = trayStatusKey;
    rebuildTrayMenu();
  }
  pushSnapshotToDashboard();
});

ipcMain.on('debug:log', (_event, payload = {}) => {
  debugLogger.log(
    payload.scope || 'renderer',
    'trace',
    payload.payload ?? null
  );
});

ipcMain.on('dashboard:open', () => {
  createDashboardWindow();
});

ipcMain.on('primary-action:open', (_event, sessionKey) => {
  openPrimaryAction(sessionKey);
});

ipcMain.on('openclaw:openChat', (_event, sessionKey) => {
  createChatWindow(sessionKey);
});

ipcMain.on('openclaw:openCli', (_event, sessionKey) => {
  openCliChat(sessionKey);
});

ipcMain.on('interaction:setClickAction', (_event, mode) => {
  preferences.clickAction = normalizeClickAction(mode);
  savePreferences();
  broadcastInteractionSettings();
  rebuildTrayMenu();
});

ipcMain.on('pet:moveBy', (_event, deltaX, deltaY) => {
  movePetWindowBy(deltaX, deltaY);
});

app.on('before-quit', () => {
  isQuitting = true;
  stopGatewayBridge();
});

app.whenReady().then(() => {
  app.setName(APP_NAME);
  preferences = loadPreferences();
  logBootstrapInfo();
  createPetWindow();
  createTray();
  ensureGatewayBridge();

  app.on('activate', () => {
    if (!petWindow || petWindow.isDestroyed()) {
      createPetWindow();
    }
    petWindow?.show();
  });
});

app.on('window-all-closed', (event) => {
  if (isQuitting) return;

  event.preventDefault();
  dashboardWindow?.hide();
  chatWindow?.hide();
  petWindow?.hide();
});
