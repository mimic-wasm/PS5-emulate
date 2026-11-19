const pages = ['home', 'setup', 'controller', 'about'];
const pageTitles = {
  home: 'Your console, on your PC.',
  setup: 'Set up your console.',
  controller: 'Keyboard and mouse controls.',
  about: 'Built for official remote play.'
};

const defaultKeyMappings = {
  moveUp: 'KeyW', moveLeft: 'KeyA', moveDown: 'KeyS', moveRight: 'KeyD',
  cross: 'KeyX', circle: 'KeyE', square: 'KeyR', triangle: 'KeyF',
  l1: 'KeyQ', r1: 'KeyG', l2: 'KeyZ', r2: 'KeyC',
  options: 'Escape', share: 'Backspace', ps: 'KeyP', touchpad: 'KeyT',
  dpadUp: 'ArrowUp', dpadDown: 'ArrowDown', dpadLeft: 'ArrowLeft', dpadRight: 'ArrowRight'
};

const mappingDefinitions = [
  { group: 'Movement', action: 'moveUp', label: 'Move forward' },
  { group: 'Movement', action: 'moveLeft', label: 'Move left' },
  { group: 'Movement', action: 'moveDown', label: 'Move backward' },
  { group: 'Movement', action: 'moveRight', label: 'Move right' },
  { group: 'Face buttons', action: 'cross', label: 'Cross (×)' },
  { group: 'Face buttons', action: 'circle', label: 'Circle (○)' },
  { group: 'Face buttons', action: 'square', label: 'Square (□)' },
  { group: 'Face buttons', action: 'triangle', label: 'Triangle (△)' },
  { group: 'Shoulders and triggers', action: 'l1', label: 'L1' },
  { group: 'Shoulders and triggers', action: 'r1', label: 'R1' },
  { group: 'Shoulders and triggers', action: 'l2', label: 'L2' },
  { group: 'Shoulders and triggers', action: 'r2', label: 'R2' },
  { group: 'System buttons', action: 'options', label: 'Options' },
  { group: 'System buttons', action: 'share', label: 'Share' },
  { group: 'System buttons', action: 'ps', label: 'PS button' },
  { group: 'System buttons', action: 'touchpad', label: 'Touchpad' },
  { group: 'D-pad', action: 'dpadUp', label: 'D-pad up' },
  { group: 'D-pad', action: 'dpadDown', label: 'D-pad down' },
  { group: 'D-pad', action: 'dpadLeft', label: 'D-pad left' },
  { group: 'D-pad', action: 'dpadRight', label: 'D-pad right' }
];

let currentSettings = { resolution: '1280x720', keyMappings: { ...defaultKeyMappings } };
let settingsOpen = false;
let captureAction = null;
let f1Held = false;

function showPage(name) {
  for (const page of pages) {
    document.getElementById(`page-${page}`).classList.toggle('active', page === name);
  }
  document.querySelectorAll('.nav-item').forEach((button) => {
    button.classList.toggle('active', button.dataset.page === name);
  });
  document.getElementById('page-title').textContent = pageTitles[name] || pageTitles.home;
}

document.querySelectorAll('.nav-item').forEach((button) => {
  button.addEventListener('click', () => showPage(button.dataset.page));
});

document.getElementById('xbox-guide').addEventListener('click', () => showPage('setup'));
document.getElementById('controller-guide').addEventListener('click', () => showPage('controller'));
document.getElementById('xbox-open-guide').addEventListener('click', () => {
  window.consoleBridge.openExternal('https://www.xbox.com/remoteplay');
});
document.getElementById('launch-xbox').addEventListener('click', () => {
  window.consoleBridge.openExternal('https://www.xbox.com/remoteplay');
});
document.getElementById('ps-download').addEventListener('click', () => {
  window.consoleBridge.openExternal('https://remoteplay.dl.playstation.net/remoteplay/');
});
document.getElementById('choose-ps').addEventListener('click', async () => {
  const result = await window.consoleBridge.choosePSApp();
  if (!result.canceled) updatePSPath(result.path);
});
document.getElementById('launch-ps').addEventListener('click', async () => {
  const result = await window.consoleBridge.launchPSApp();
  if (!result.ok) {
    document.getElementById('ps-location').textContent = result.message;
    document.getElementById('ps-location').classList.add('error-text');
  }
});

function updatePSPath(path) {
  const location = document.getElementById('ps-location');
  location.textContent = path || 'No app selected yet.';
  location.classList.remove('error-text');
}

const bridgeStatus = document.getElementById('bridge-status');
const startBridgeButton = document.getElementById('start-bridge');
const stopBridgeButton = document.getElementById('stop-bridge');

function setBridgeActive(active, message) {
  bridgeStatus.textContent = message || (active ? 'Running' : 'Stopped');
  bridgeStatus.classList.toggle('status-active', active);
  bridgeStatus.classList.toggle('status-error', !active && message && message !== 'Stopped');
  startBridgeButton.disabled = active;
  stopBridgeButton.disabled = !active;
}

startBridgeButton.addEventListener('click', async () => {
  setBridgeActive(false, 'Starting controller bridge...');
  startBridgeButton.disabled = true;
  const result = await window.consoleBridge.startControllerBridge();
  if (result.ok) setBridgeActive(true, 'Running · virtual DualShock 4 connected');
  else setBridgeActive(false, result.message || 'Could not start controller bridge.');
});

stopBridgeButton.addEventListener('click', async () => {
  await window.consoleBridge.stopControllerBridge();
  setBridgeActive(false, 'Stopped');
});

document.getElementById('install-driver').addEventListener('click', () => {
  window.consoleBridge.openExternal('https://github.com/nefarius/ViGEmBus/releases/latest');
});

const settingsOverlay = document.getElementById('settings-overlay');
const mappingList = document.getElementById('settings-mapping-list');
const settingsResolution = document.getElementById('settings-resolution');
const settingsMessage = document.getElementById('settings-message');
const saveSettingsButton = document.getElementById('save-settings');

function formatKey(code) {
  const names = {
    Escape: 'Esc', Backspace: 'Backspace', Tab: 'Tab', Space: 'Space', Enter: 'Enter',
    ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
    ShiftLeft: 'Left Shift', ShiftRight: 'Right Shift', ControlLeft: 'Left Ctrl', AltLeft: 'Left Alt'
  };
  if (names[code]) return names[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  return code;
}

function renderMappings() {
  mappingList.replaceChildren();
  let group = '';

  for (const definition of mappingDefinitions) {
    if (definition.group !== group) {
      group = definition.group;
      const heading = document.createElement('h3');
      heading.className = 'settings-group-title';
      heading.textContent = group;
      mappingList.appendChild(heading);
    }

    const row = document.createElement('div');
    row.className = 'settings-mapping-row';

    const label = document.createElement('label');
    label.textContent = definition.label;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'key-capture-button';
    button.dataset.action = definition.action;
    button.textContent = formatKey(currentSettings.keyMappings[definition.action]);

    row.append(label, button);
    mappingList.appendChild(row);
  }
}

function setSettingsOpen(open) {
  settingsOpen = open;
  settingsOverlay.classList.toggle('hidden', !open);
  settingsOverlay.setAttribute('aria-hidden', String(!open));
  captureAction = null;
  settingsMessage.textContent = '';
  if (open) {
    window.consoleBridge.setBridgeCapturePaused(true);
    settingsResolution.value = currentSettings.resolution || '1280x720';
    renderMappings();
  } else {
    window.consoleBridge.setBridgeCapturePaused(false);
  }
}

function toggleSettings() {
  setSettingsOpen(!settingsOpen);
}

mappingList.addEventListener('click', (event) => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  captureAction = button.dataset.action;
  mappingList.querySelectorAll('.key-capture-button').forEach((item) => {
    item.classList.remove('capturing');
    item.textContent = formatKey(currentSettings.keyMappings[item.dataset.action]);
  });
  button.classList.add('capturing');
  button.textContent = 'Press a key…';
  settingsMessage.textContent = 'Press the key to assign. F1 + Esc and F8 are reserved.';
});

window.addEventListener('keydown', (event) => {
  if (event.code === 'F1') {
    f1Held = true;
    return;
  }

  if (event.code === 'Escape' && f1Held) {
    event.preventDefault();
    event.stopImmediatePropagation();
    toggleSettings();
    return;
  }

  if (!captureAction) return;
  event.preventDefault();
  event.stopImmediatePropagation();

  const validKey = /^(Key[A-Z]|Digit[0-9]|F([2-7]|9|1[0-2])|Escape|Backspace|Tab|Space|Enter|ArrowUp|ArrowDown|ArrowLeft|ArrowRight|ShiftLeft|ShiftRight|ControlLeft|AltLeft)$/.test(event.code);
  if (!validKey) {
    settingsMessage.textContent = 'Unsupported key. Try a letter, number, arrow, or function key.';
    return;
  }

  const duplicate = Object.entries(currentSettings.keyMappings)
    .some(([action, code]) => action !== captureAction && code === event.code);
  if (duplicate) {
    settingsMessage.textContent = 'That key is already assigned. Choose another key.';
    return;
  }

  currentSettings.keyMappings[captureAction] = event.code;
  const button = mappingList.querySelector(`[data-action="${captureAction}"]`);
  button.textContent = formatKey(event.code);
  button.classList.remove('capturing');
  settingsMessage.textContent = 'Key assigned. Save settings to apply it.';
  captureAction = null;
}, true);

window.addEventListener('keyup', (event) => {
  if (event.code === 'F1') f1Held = false;
});

document.getElementById('settings-close').addEventListener('click', () => setSettingsOpen(false));
document.getElementById('settings-backdrop').addEventListener('click', () => setSettingsOpen(false));
document.getElementById('settings-reset').addEventListener('click', () => {
  currentSettings.keyMappings = { ...defaultKeyMappings };
  renderMappings();
  settingsMessage.textContent = 'Default mappings restored. Save to apply them.';
});

saveSettingsButton.addEventListener('click', async () => {
  saveSettingsButton.disabled = true;
  const result = await window.consoleBridge.saveSettings({
    resolution: settingsResolution.value,
    keyMappings: currentSettings.keyMappings
  });
  saveSettingsButton.disabled = false;

  if (!result.ok) {
    settingsMessage.textContent = result.message || 'Could not save settings.';
    return;
  }

  currentSettings = result.settings;
  settingsMessage.textContent = 'Settings saved and applied.';
  renderMappings();
});

window.consoleBridge.onSettingsToggle(() => toggleSettings());
window.consoleBridge.onBridgeStatus((status) => {
  if (status === 'stopped') setBridgeActive(false, 'Stopped');
});

window.consoleBridge.getSettings().then((settings) => {
  currentSettings = {
    ...currentSettings,
    ...settings,
    keyMappings: { ...defaultKeyMappings, ...(settings.keyMappings || {}) }
  };
  settingsResolution.value = currentSettings.resolution || '1280x720';
  if (settings.psRemotePlayPath) updatePSPath(settings.psRemotePlayPath);
  renderMappings();
});