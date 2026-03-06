const { app, BrowserWindow, globalShortcut, screen, ipcMain, Tray, Menu, nativeImage } = require('electron');

let Store;
let store;
let overlayWindow;
let backdropWindow;
let settingsWindow;
let tray;
let isQuitting = false;

const defaults = {
  defaultUrl: 'https://www.ign.com',
  lastUrl: '',
  toggleShortcut: 'F9',
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

function getTargetDisplay() {
  return screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
}

function applyOverlayBounds() {
  if (!overlayWindow || !backdropWindow) return;

  const display = getTargetDisplay();
  const bounds = display.bounds;
  const ratio = clampRatio(store.get('widthRatio'));
  const panelWidth = Math.floor(bounds.width * ratio);

  backdropWindow.setBounds({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height
  });

  overlayWindow.setBounds({
    x: bounds.x + bounds.width - panelWidth,
    y: bounds.y,
    width: panelWidth,
    height: bounds.height
  });
}

function injectControllerBrowserControls() {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;

  overlayWindow.webContents.executeJavaScript(`
    (() => {
      if (window.__steamOverlayControllerInjected) return;
      window.__steamOverlayControllerInjected = true;

      let x = window.innerWidth / 2;
      let y = window.innerHeight / 2;
      let prevButtons = [];
      let lockMode = false;
      const deadzone = 0.15;

      const cursor = document.createElement('div');
      cursor.id = 'controller-overlay-cursor';
      Object.assign(cursor.style, {
        position: 'fixed',
        left: '0px',
        top: '0px',
        width: '18px',
        height: '18px',
        borderRadius: '50%',
        border: '2px solid #ffffff',
        background: 'rgba(0,0,0,0.5)',
        boxShadow: '0 0 10px rgba(0,0,0,0.7)',
        zIndex: '2147483647',
        pointerEvents: 'none',
        transform: 'translate(-50%, -50%)'
      });
      document.documentElement.appendChild(cursor);

      const crosshair = document.createElement('div');
      crosshair.id = 'controller-overlay-crosshair';
      Object.assign(crosshair.style, {
        position: 'fixed',
        left: '50%',
        top: '50%',
        width: '24px',
        height: '24px',
        marginLeft: '-12px',
        marginTop: '-12px',
        borderRadius: '50%',
        border: '2px solid rgba(255,255,255,0.95)',
        boxShadow: '0 0 8px rgba(0,0,0,0.8)',
        zIndex: '2147483647',
        pointerEvents: 'none',
        display: 'none'
      });
      document.documentElement.appendChild(crosshair);

      const lockBadge = document.createElement('div');
      lockBadge.id = 'controller-overlay-lock-badge';
      Object.assign(lockBadge.style, {
        position: 'fixed',
        left: '12px',
        top: '12px',
        padding: '6px 10px',
        borderRadius: '8px',
        background: 'rgba(0,0,0,0.7)',
        color: '#fff',
        fontSize: '12px',
        fontFamily: 'Arial, sans-serif',
        letterSpacing: '0.3px',
        zIndex: '2147483647',
        pointerEvents: 'none',
        display: 'none'
      });
      lockBadge.textContent = 'MOUSE LOCK';
      document.documentElement.appendChild(lockBadge);

      const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
      const focusedList = () => {
        return Array.from(document.querySelectorAll('a, button, input, textarea, select, [tabindex]:not([tabindex="-1"])'))
          .filter(el => !el.disabled && el.offsetParent !== null);
      };

      function setLockMode(on) {
        lockMode = !!on;
        document.documentElement.style.cursor = lockMode ? 'none' : '';
        cursor.style.display = lockMode ? 'none' : 'block';
        crosshair.style.display = lockMode ? 'block' : 'none';
        lockBadge.style.display = lockMode ? 'block' : 'none';

        if (lockMode) {
          x = window.innerWidth / 2;
          y = window.innerHeight / 2;
        }
      }

      function cycleFocus(reverse = false) {
        const list = focusedList();
        if (!list.length) return;

        const active = document.activeElement;
        let idx = list.indexOf(active);
        if (idx === -1) idx = reverse ? 0 : -1;

        idx = reverse
          ? (idx - 1 + list.length) % list.length
          : (idx + 1) % list.length;

        list[idx].focus({ preventScroll: false });
        list[idx].scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }

      function pointerClick() {
        const clickX = lockMode ? window.innerWidth / 2 : x;
        const clickY = lockMode ? window.innerHeight / 2 : y;
        const target = document.elementFromPoint(clickX, clickY);
        if (!target) return;
        for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
          target.dispatchEvent(new MouseEvent(type, {
            bubbles: true,
            cancelable: true,
            clientX: clickX,
            clientY: clickY,
            button: 0
          }));
        }
      }

      function pressed(gp, idx) {
        const now = !!gp.buttons[idx]?.pressed;
        const before = !!prevButtons[idx];
        prevButtons[idx] = now;
        return now && !before;
      }

      function updateCursor() {
        cursor.style.left = x + 'px';
        cursor.style.top = y + 'px';
      }

      function tick() {
        const gp = navigator.getGamepads?.()[0];
        if (gp) {
          const moveX = gp.axes[0] || 0;
          const moveY = gp.axes[1] || 0;
          const scrollY = gp.axes[3] || 0;

          if (pressed(gp, 11)) setLockMode(!lockMode);         // R3 toggles mouse lock

          if (lockMode) {
            if (Math.abs(moveY) > deadzone) window.scrollBy(0, moveY * 28);
            if (Math.abs(moveX) > deadzone) window.scrollBy(moveX * 28, 0);
            x = window.innerWidth / 2;
            y = window.innerHeight / 2;
          } else {
            if (Math.abs(moveX) > deadzone) x += moveX * 18;
            if (Math.abs(moveY) > deadzone) y += moveY * 18;
            x = clamp(x, 0, window.innerWidth);
            y = clamp(y, 0, window.innerHeight);
            if (Math.abs(scrollY) > deadzone) window.scrollBy(0, scrollY * 28);
          }

          if (pressed(gp, 0)) pointerClick();                 // Cross / A
          if (pressed(gp, 1)) history.back();                 // Circle / B
          if (pressed(gp, 2)) history.forward();              // Square / X
          if (pressed(gp, 3)) window.scrollBy(0, -400);       // Triangle / Y
          if (pressed(gp, 12)) window.scrollBy(0, -180);      // D-pad Up
          if (pressed(gp, 13)) window.scrollBy(0, 180);       // D-pad Down
          if (pressed(gp, 4)) cycleFocus(true);               // L1
          if (pressed(gp, 5)) cycleFocus(false);              // R1
        }

        updateCursor();
        requestAnimationFrame(tick);
      }

      window.addEventListener('resize', () => {
        x = clamp(x, 0, window.innerWidth);
        y = clamp(y, 0, window.innerHeight);
      });

      setLockMode(false);
      updateCursor();
      requestAnimationFrame(tick);
    })();
  `).catch(() => {});
}

function createBackdropWindow() {
  backdropWindow = new BrowserWindow({
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000088',
    movable: false,
    resizable: false,
    focusable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false
  });

  backdropWindow.setAlwaysOnTop(true, 'screen-saver', 1);
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

  overlayWindow.setAlwaysOnTop(true, 'screen-saver', 2);
  overlayWindow.loadURL(getStartUrl());

  const saveUrl = (url) => {
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
      store.set('lastUrl', url);
    }
  };

  overlayWindow.webContents.on('did-navigate', (_, url) => saveUrl(url));
  overlayWindow.webContents.on('did-navigate-in-page', (_, url) => saveUrl(url));
  overlayWindow.webContents.on('did-finish-load', injectControllerBrowserControls);
}

function createTray() {
  if (tray) return;

  // Tiny white dot icon (works cross-platform without external asset files).
  const iconDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAQAAAC1+jfqAAAAX0lEQVR4AWP4//8/AyUYTFhY2P///xkYGFgYGBj+////n4GB4f///58YGBiY/v//P8P///8ZGBj+////PwMDA8N/0P8fGBiYwYGBgQxQ9v///z8DAwODQf8fA2QAAK+EE86Qv8xVAAAAAElFTkSuQmCC';
  const trayIcon = nativeImage.createFromDataURL(iconDataUrl);

  tray = new Tray(trayIcon);
  tray.setToolTip('Steam Web Overlay');

  const menu = Menu.buildFromTemplate([
    { label: 'Open Settings', click: () => createSettingsWindow() },
    { label: 'Toggle Overlay', click: () => toggleOverlay() },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(menu);
  tray.on('click', () => createSettingsWindow());
}

function createSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show();
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

  settingsWindow.on('close', (event) => {
    if (isQuitting) return;
    event.preventDefault();
    settingsWindow.hide();
  });
}

function showOverlay() {
  applyOverlayBounds();
  backdropWindow.showInactive();
  overlayWindow.show();
  overlayWindow.focus();
  injectControllerBrowserControls();
}

function hideOverlay() {
  overlayWindow.hide();
  backdropWindow.hide();
}

function toggleOverlay() {
  if (!overlayWindow || !backdropWindow) return;
  if (overlayWindow.isVisible()) hideOverlay();
  else showOverlay();
}

function registerToggleShortcut() {
  globalShortcut.unregisterAll();
  const shortcut = store.get('toggleShortcut') || defaults.toggleShortcut;
  globalShortcut.register(shortcut, toggleOverlay);
}

async function boot() {
  await initStore();
  createBackdropWindow();
  createOverlayWindow();
  createTray();
  registerToggleShortcut();
  applyOverlayBounds();

  createSettingsWindow();

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
    showOverlay();
    return true;
  });

  ipcMain.handle('overlay:navigate', (_, url) => {
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
      overlayWindow.loadURL(url);
      showOverlay();
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
  // Keep app running for quick overlay toggle.
});

app.on('activate', () => {
  if (!overlayWindow || overlayWindow.isDestroyed() || !backdropWindow || backdropWindow.isDestroyed()) {
    createBackdropWindow();
    createOverlayWindow();
    applyOverlayBounds();
  }
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});
