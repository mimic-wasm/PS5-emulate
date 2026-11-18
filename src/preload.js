const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('consoleBridge', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  choosePSApp: () => ipcRenderer.invoke('ps:choose-app'),
  launchPSApp: () => ipcRenderer.invoke('ps:launch-app'),
  openExternal: (url) => ipcRenderer.invoke('external:open', url)
});