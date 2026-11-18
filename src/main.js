const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

let mainWindow;
let bridgeProcess = null;
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

function stopBridge() {
  if (bridgeProcess && !bridgeProcess.killed) {
    bridgeProcess.kill();
  }
  bridgeProcess = null;
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

ipcMain.handle('bridge:start', async () => {
  if (process.platform !== 'win32') {
    return { ok: false, message: 'Keyboard-to-controller mapping is currently Windows-only.' };
  }

  if (bridgeProcess && !bridgeProcess.killed) return { ok: true };

  const bridgePath = path.join(__dirname, '..', 'native', 'publish', 'InputBridge.exe');
  if (!fs.existsSync(bridgePath)) {
    return { ok: false, message: 'Controller bridge is not built yet. Run npm run build:bridge.' };
  }

  const child = spawn(bridgePath, [], {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  bridgeProcess = child;

  return new Promise((resolve) => {
    let settled = false;
    let output = '';
    const timeout = setTimeout(() => {
      finish({ ok: false, message: 'The controller bridge did not respond. Check the driver installation.' });
      stopBridge();
    }, 10000);

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(result);
    };

    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
      if (output.includes('READY')) finish({ ok: true });
      if (output.includes('ERROR:')) {
        finish({ ok: false, message: output.split('ERROR:').pop().trim() });
      }
    });

    child.stderr.on('data', (chunk) => {
      output += chunk.toString();
      if (output.includes('ERROR:')) {
        finish({ ok: false, message: output.split('ERROR:').pop().trim() });
      }
    });

    child.once('error', (error) => finish({ ok: false, message: error.message }));
    child.once('exit', (code) => {
      if (bridgeProcess === child) bridgeProcess = null;
      if (!settled) finish({ ok: false, message: output.trim() || `Controller bridge exited with code ${code}.` });
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('bridge:status', 'stopped');
      }
    });
  });
});

ipcMain.handle('bridge:stop', () => {
  stopBridge();
  return { ok: true };
});

ipcMain.handle('external:open', async (_event, url) => {
  const allowed = new Set([
    'https://www.xbox.com/remoteplay',
    'https://remoteplay.dl.playstation.net/remoteplay/',
    'https://www.playstation.com/en-us/remote-play/',
    'https://www.xbox.com/en-US/consoles/remote-play',
    'https://github.com/nefarius/ViGEmBus/releases/latest'
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

app.on('before-quit', stopBridge);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});