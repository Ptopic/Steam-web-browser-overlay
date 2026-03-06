const { app, BrowserWindow, globalShortcut, screen, ipcMain } = require('electron');

let Store;
let store;
let overlayWindow;
let settingsWindow;

const defaults = {
  defaultUrl: 'https://www.ign.com',
  lastUrl: '',
  toggleShortcut: 'Control+Alt+G',
  widthRatio: 0.333
};

async function initStore() {
  if (!Store) {
    Store = (await import('electron-store')).default;
  }
  store = new Store({ defaults });
}

function clampRatio(ratio) {
  const n = Number(ratio);
  if (Number.isNaN(n)) return defaults.widthRatio;
  return Math.min(0.8, Math.max(0.2, n));
}

function getStartUrl() {
  return store.get('lastUrl') || store.get('defaultUrl') || defaults.defaultUrl;
}

function applyOverlayBounds() {
  if (!overlayWindow) return;
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const area = display.workArea;
  const ratio = clampRatio(store.get('widthRatio'));
  const width = Math.floor(area.width * ratio);
  overlayWindow.setBounds({
    x: area.x + area.width - width,
    y: area.y,
    width,
    height: area.height
  });
}

function createOverlayWindow() {
  overlayWindow = new BrowserWindow({
    show: false,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    autoHideMenuBar: true,
    backgroundColor: '#111111',
    webPreferences: {
      preload: `${__dirname}/preload.js`,
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  applyOverlayBounds();
  overlayWindow.loadURL(getStartUrl());

  const saveUrl = (url) => {
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
      store.set('lastUrl', url);
    }
  };

  overlayWindow.webContents.on('did-navigate', (_, url) => saveUrl(url));
  overlayWindow.webContents.on('did-navigate-in-page', (_, url) => saveUrl(url));

  overlayWindow.on('blur', () => {
    if (!overlayWindow.webContents.isDevToolsOpened()) {
      overlayWindow.hide();
    }
  });
}

function createSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 520,
    height: 380,
    autoHideMenuBar: true,
    resizable: false,
    title: 'Steam Web Overlay Settings',
    webPreferences: {
      preload: `${__dirname}/preload.js`,
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  settingsWindow.loadFile(`${__dirname}/settings.html`);
}

function toggleOverlay() {
  if (!overlayWindow) return;
  if (overlayWindow.isVisible()) {
    overlayWindow.hide();
  } else {
    applyOverlayBounds();
    overlayWindow.show();
    overlayWindow.focus();
  }
}

function registerToggleShortcut() {
  globalShortcut.unregisterAll();
  const shortcut = store.get('toggleShortcut') || defaults.toggleShortcut;
  globalShortcut.register(shortcut, toggleOverlay);
}

async function boot() {
  await initStore();
  createOverlayWindow();
  registerToggleShortcut();

  if (process.argv.includes('--settings')) {
    createSettingsWindow();
  }

  screen.on('display-metrics-changed', applyOverlayBounds);

  ipcMain.handle('overlay:get-settings', () => ({
    defaultUrl: store.get('defaultUrl'),
    lastUrl: store.get('lastUrl'),
    toggleShortcut: store.get('toggleShortcut'),
    widthRatio: store.get('widthRatio')
  }));

  ipcMain.handle('overlay:set-settings', (_, next) => {
    if (next.defaultUrl) store.set('defaultUrl', String(next.defaultUrl));
    if (next.toggleShortcut) store.set('toggleShortcut', String(next.toggleShortcut));
    if (next.widthRatio) store.set('widthRatio', clampRatio(next.widthRatio));
    registerToggleShortcut();
    applyOverlayBounds();
    return true;
  });

  ipcMain.handle('overlay:open-default', () => {
    const url = store.get('defaultUrl') || defaults.defaultUrl;
    overlayWindow.loadURL(url);
    overlayWindow.show();
    overlayWindow.focus();
    return true;
  });

  ipcMain.handle('overlay:navigate', (_, url) => {
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
      overlayWindow.loadURL(url);
      overlayWindow.show();
      overlayWindow.focus();
      return true;
    }
    return false;
  });

  ipcMain.handle('overlay:toggle', () => {
    toggleOverlay();
    return true;
  });

  ipcMain.handle('overlay:open-settings', () => {
    createSettingsWindow();
    return true;
  });

  ipcMain.handle('overlay:go-back', () => {
    if (overlayWindow.webContents.canGoBack()) overlayWindow.webContents.goBack();
    return true;
  });

  ipcMain.handle('overlay:go-forward', () => {
    if (overlayWindow.webContents.canGoForward()) overlayWindow.webContents.goForward();
    return true;
  });

  ipcMain.handle('overlay:refresh', () => {
    overlayWindow.webContents.reload();
    return true;
  });
}

app.whenReady().then(boot);

app.on('window-all-closed', () => {
  // Keep running in tray-like mode for quick toggle.
});

app.on('activate', () => {
  if (!overlayWindow || overlayWindow.isDestroyed()) {
    createOverlayWindow();
  }
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});
