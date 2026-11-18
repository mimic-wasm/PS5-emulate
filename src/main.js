const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

let mainWindow;
const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
  } catch {
    return { psRemotePlayPath: '' };
  }
}

function writeSettings(settings) {
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2), 'utf8');
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 900,
    minHeight: 620,
    backgroundColor: '#090b10',
    title: 'GTA6-emulate',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });
}

ipcMain.handle('settings:get', () => readSettings());

ipcMain.handle('ps:choose-app', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose the official PS Remote Play application',
    properties: ['openFile'],
    filters: [{ name: 'Windows applications', extensions: ['exe'] }]
  });

  if (result.canceled || !result.filePaths[0]) return { canceled: true };

  const settings = readSettings();
  settings.psRemotePlayPath = result.filePaths[0];
  writeSettings(settings);
  return { canceled: false, path: settings.psRemotePlayPath };
});

ipcMain.handle('ps:launch-app', async () => {
  const settings = readSettings();
  if (!settings.psRemotePlayPath || !fs.existsSync(settings.psRemotePlayPath)) {
    return { ok: false, message: 'Choose the installed PS Remote Play application first.' };
  }

  const error = await shell.openPath(settings.psRemotePlayPath);
  return error ? { ok: false, message: error } : { ok: true };
});

ipcMain.handle('external:open', async (_event, url) => {
  const allowed = new Set([
    'https://www.xbox.com/remoteplay',
    'https://remoteplay.dl.playstation.net/remoteplay/',
    'https://www.playstation.com/en-us/remote-play/',
    'https://www.xbox.com/en-US/consoles/remote-play'
  ]);

  if (!allowed.has(url)) return { ok: false };
  await shell.openExternal(url);
  return { ok: true };
});

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});