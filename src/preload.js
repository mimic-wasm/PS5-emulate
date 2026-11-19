const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('consoleBridge', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
  setBridgeCapturePaused: (paused) => ipcRenderer.invoke('bridge:capture', paused),
  choosePSApp: () => ipcRenderer.invoke('ps:choose-app'),
  launchPSApp: () => ipcRenderer.invoke('ps:launch-app'),
  startControllerBridge: () => ipcRenderer.invoke('bridge:start'),
  stopControllerBridge: () => ipcRenderer.invoke('bridge:stop'),
  onBridgeStatus: (callback) => {
    ipcRenderer.on('bridge:status', (_event, status) => callback(status));
  },
  onSettingsToggle: (callback) => {
    ipcRenderer.on('settings:toggle', callback);
  },
  openExternal: (url) => ipcRenderer.invoke('external:open', url)
});