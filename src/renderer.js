const pages = ['home', 'setup', 'controller', 'about'];
const pageTitles = {
  home: 'Your console, on your PC.',
  setup: 'Set up your console.',
  controller: 'Keyboard and mouse controls.',
  about: 'Built for official remote play.'
};

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
  if (result.ok) {
    setBridgeActive(true, 'Running · virtual DualShock 4 connected');
  } else {
    setBridgeActive(false, result.message || 'Could not start controller bridge.');
  }
});

stopBridgeButton.addEventListener('click', async () => {
  await window.consoleBridge.stopControllerBridge();
  setBridgeActive(false, 'Stopped');
});

document.getElementById('install-driver').addEventListener('click', () => {
  window.consoleBridge.openExternal('https://github.com/nefarius/ViGEmBus/releases/latest');
});

window.consoleBridge.onBridgeStatus((status) => {
  if (status === 'stopped') setBridgeActive(false, 'Stopped');
});

window.consoleBridge.getSettings().then((settings) => {
  if (settings.psRemotePlayPath) updatePSPath(settings.psRemotePlayPath);
});