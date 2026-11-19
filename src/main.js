const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

let mainWindow;
let bridgeProcess = null;

const DEFAULT_KEY_MAPPINGS = {
  moveUp: 'KeyW', moveLeft: 'KeyA', moveDown: 'KeyS', moveRight: 'KeyD',
  cross: 'KeyX', circle: 'KeyE', square: 'KeyR', triangle: 'KeyF',
  l1: 'KeyQ', r1: 'KeyG', l2: 'KeyZ', r2: 'KeyC',
  options: 'Escape', share: 'Backspace', ps: 'KeyP', touchpad: 'KeyT',
  dpadUp: 'ArrowUp', dpadDown: 'ArrowDown', dpadLeft: 'ArrowLeft', dpadRight: 'ArrowRight'
};

const DEFAULT_SETTINGS = {
  psRemotePlayPath: '',
  resolution: '1280x720',
  keyMappings: DEFAULT_KEY_MAPPINGS
};

const ALLOWED_RESOLUTIONS = new Set(['Default', '1920x1080', '1600x900', '1280x720', '1024x576']);
const VALID_KEYS = /^(Key[A-Z]|Digit[0-9]|F([2-7]|9|1[0-2])|Escape|Backspace|Tab|Space|Enter|ArrowUp|ArrowDown|ArrowLeft|ArrowRight|ShiftLeft|ShiftRight|ControlLeft|AltLeft)$/;

const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');

function readSettings() {
  try {
    const saved = JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
    return {
      ...DEFAULT_SETTINGS,
      ...saved,
      keyMappings: { ...DEFAULT_KEY_MAPPINGS, ...(saved.keyMappings || {}) }
    };
  } catch {
    return { ...DEFAULT_SETTINGS, keyMappings: { ...DEFAULT_KEY_MAPPINGS } };
  }
}

function writeSettings(settings) {
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2), 'utf8');
}

function applyResolution(resolution) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const sizes = {
    '1920x1080': [1920, 1080],
    '1600x900': [1600, 900],
    '1280x720': [1280, 720],
    '1024x576': [1024, 576]
  };
  const size = sizes[resolution];
  if (size) {
    mainWindow.setMinimumSize(800, 600);
    mainWindow.setSize(size[0], size[1], true);
    mainWindow.center();
  } else {
    mainWindow.setSize(1180, 780, true);
    mainWindow.center();
  }
}

function createWindow() {
  const settings = readSettings();
  const sizes = {
    '1920x1080': [1920, 1080],
    '1600x900': [1600, 900],
    '1280x720': [1280, 720],
    '1024x576': [1024, 576]
  };
  const size = sizes[settings.resolution] || [1180, 780];

  mainWindow = new BrowserWindow({
    width: size[0],
    height: size[1],
    minWidth: 800,
    minHeight: 600,
    backgroundColor: '#090b10',
    title: 'PS5-emulate',
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

function sendBridgeCommand(command) {
  if (bridgeProcess && !bridgeProcess.killed && bridgeProcess.stdin.writable) {
    bridgeProcess.stdin.write(command + '\n');
  }
}

function stopBridge() {
  if (bridgeProcess && !bridgeProcess.killed) bridgeProcess.kill();
  bridgeProcess = null;
}

ipcMain.handle('settings:get', () => readSettings());

ipcMain.handle('settings:save', (_event, incoming) => {
  if (!incoming || typeof incoming !== 'object' || !incoming.keyMappings) {
    return { ok: false, message: 'Invalid settings.' };
  }

  if (!ALLOWED_RESOLUTIONS.has(incoming.resolution)) {
    return { ok: false, message: 'Choose a supported window resolution.' };
  }

  const nextMappings = {};
  for (const action of Object.keys(DEFAULT_KEY_MAPPINGS)) {
    const code = incoming.keyMappings[action];
    if (typeof code !== 'string' || !VALID_KEYS.test(code)) {
      return { ok: false, message: 'One or more key assignments are invalid.' };
    }
    nextMappings[action] = code;
  }

  if (new Set(Object.values(nextMappings)).size !== Object.keys(nextMappings).length) {
    return { ok: false, message: 'Each controller action must use a different key.' };
  }

  const settings = readSettings();
  settings.resolution = incoming.resolution;
  settings.keyMappings = nextMappings;
  writeSettings(settings);
  applyResolution(settings.resolution);
  sendBridgeCommand('RELOAD');
  return { ok: true, settings };
});

ipcMain.handle('bridge:capture', (_event, paused) => {
  sendBridgeCommand(paused ? 'PAUSE' : 'RESUME');
  return { ok: true };
});

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

  const child = spawn(bridgePath, [settingsPath()], {
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe']
  });
  bridgeProcess = child;

  return new Promise((resolve) => {
    let settled = false;
    let output = '';
    const timeout = setTimeout(() => {
      finish({ ok: false, message: 'The controller bridge did not respond. Check the virtual gamepad driver.' });
      stopBridge();
    }, 10000);

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(result);
    };

    child.stdout.on('data', (chunk) => {
      const message = chunk.toString();
      output += message;
      if (message.includes('READY')) finish({ ok: true });
      if (message.includes('SETTINGS') && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show();
        mainWindow.focus();
        mainWindow.webContents.send('settings:toggle');
      }
      if (output.includes('ERROR:')) finish({ ok: false, message: output.split('ERROR:').pop().trim() });
    });

    child.stderr.on('data', (chunk) => {
      output += chunk.toString();
      if (output.includes('ERROR:')) finish({ ok: false, message: output.split('ERROR:').pop().trim() });
    });

    child.once('error', (error) => finish({ ok: false, message: error.message }));
    child.once('exit', (code) => {
      if (bridgeProcess === child) bridgeProcess = null;
      if (!settled) finish({ ok: false, message: output.trim() || `Controller bridge exited with code ${code}.` });
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('bridge:status', 'stopped');
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