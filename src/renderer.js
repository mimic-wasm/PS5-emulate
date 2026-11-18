const pages = ['home', 'setup', 'about'];
const pageTitles = {
  home: 'Your console, on your PC.',
  setup: 'Set up your console.',
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

window.consoleBridge.getSettings().then((settings) => {
  if (settings.psRemotePlayPath) updatePSPath(settings.psRemotePlayPath);
});