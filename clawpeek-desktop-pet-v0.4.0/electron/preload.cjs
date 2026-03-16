const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, callback) {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('desktopPetAPI', {
  getBootstrapConfig: () => ipcRenderer.invoke('config:getBootstrap'),
  sendStateSnapshot: (snapshot) => ipcRenderer.send('state:update', snapshot),
  getLatestSnapshot: () => ipcRenderer.invoke('state:getSnapshot'),
  getDebugLogPath: () => ipcRenderer.invoke('debug:getPath'),
  debugLog: (scope, payload) => ipcRenderer.send('debug:log', { scope, payload }),
  onStateSnapshot: (callback) => subscribe('state:snapshot', callback),
  startGatewayBridge: (options = {}) => ipcRenderer.invoke('gateway:start', options),
  stopGatewayBridge: () => ipcRenderer.invoke('gateway:stop'),
  requestGateway: (method, params = {}) => ipcRenderer.invoke('gateway:request', { method, params }),
  onGatewayStatus: (callback) => subscribe('gateway:status', callback),
  onGatewayFrame: (callback) => subscribe('gateway:frame', callback),
  openDashboard: () => ipcRenderer.send('dashboard:open'),
  openPrimaryAction: (sessionKey) => ipcRenderer.send('primary-action:open', sessionKey),
  openOpenClawChat: (sessionKey) => ipcRenderer.send('openclaw:openChat', sessionKey),
  openCliChat: (sessionKey) => ipcRenderer.send('openclaw:openCli', sessionKey),
  movePetBy: (deltaX, deltaY) => ipcRenderer.send('pet:moveBy', deltaX, deltaY),
  getInteractionSettings: () => ipcRenderer.invoke('interaction:getSettings'),
  setClickAction: (mode) => ipcRenderer.send('interaction:setClickAction', mode),
  onInteractionSettings: (callback) => subscribe('interaction:settings', callback),
});
