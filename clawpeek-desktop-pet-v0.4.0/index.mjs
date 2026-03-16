import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let electronProcess = null;

function extensionRoot() {
  return __dirname;
}

function resolveElectronCommand() {
  const root = extensionRoot();
  if (process.platform === 'win32') {
    const electronExe = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
    if (fs.existsSync(electronExe)) return electronExe;
    const shim = path.join(root, 'node_modules', '.bin', 'electron.cmd');
    if (fs.existsSync(shim)) return shim;
  } else {
    const shim = path.join(root, 'node_modules', '.bin', 'electron');
    if (fs.existsSync(shim)) return shim;
  }
  return 'electron';
}

function stopElectron() {
  if (!electronProcess) return;
  try {
    if (process.platform === 'win32' && electronProcess.pid) {
      spawn('taskkill', ['/F', '/PID', String(electronProcess.pid)], { stdio: 'ignore' });
    } else {
      electronProcess.kill('SIGTERM');
    }
  } catch {
    // noop
  }
  electronProcess = null;
}

function startElectron(config = {}) {
  stopElectron();
  const root = extensionRoot();
  const electronMain = path.join(root, 'electron', 'main.cjs');
  const env = {
    ...process.env,
    PET_ALWAYS_ON_TOP: String(config.alwaysOnTop ?? true),
    PET_GATEWAY_URL: String(config.gatewayUrl || ''),
    PET_GATEWAY_TOKEN: String(config.gatewayToken || ''),
    PET_GATEWAY_TOKEN_FILE: String(config.gatewayTokenFile || ''),
    PET_GATEWAY_PASSWORD: String(config.gatewayPassword || ''),
    PET_GATEWAY_PASSWORD_FILE: String(config.gatewayPasswordFile || ''),
    PET_CONTROL_UI_BASE_URL: String(config.controlUiBaseUrl || ''),
    PET_MAIN_SESSION_KEY: String(config.mainSessionKey || 'main'),
    PET_CLICK_ACTION: String(config.clickAction || 'gateway-chat'),
    PET_CLI_COMMAND: String(config.cliCommand || ''),
    PET_CORNER: String(config.petCorner || 'bottom-right'),
    PET_SIZE: String(config.petSize || 240),
    PET_DASHBOARD_WIDTH: String(config.dashboardWidth || 1120),
    PET_DASHBOARD_HEIGHT: String(config.dashboardHeight || 760),
    PET_CHAT_WIDTH: String(config.chatWidth || 1260),
    PET_CHAT_HEIGHT: String(config.chatHeight || 860),
  };

  electronProcess = spawn(resolveElectronCommand(), [electronMain], {
    cwd: root,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  electronProcess.stdout?.on('data', (buf) => {
    console.log(`[desktop-pet] ${buf.toString().trim()}`);
  });

  electronProcess.stderr?.on('data', (buf) => {
    console.error(`[desktop-pet:error] ${buf.toString().trim()}`);
  });

  electronProcess.on('close', () => {
    electronProcess = null;
  });
}

export default function register(api) {
  const config = api?.config || {};
  if (config.enabled === false) {
    return { dispose() {} };
  }

  startElectron(config);

  api?.onConfigChange?.((nextConfig) => {
    startElectron(nextConfig || {});
  });

  return {
    dispose() {
      stopElectron();
    },
  };
}
