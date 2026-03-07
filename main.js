const { app, BrowserWindow, globalShortcut, screen, ipcMain, Tray, Menu, nativeImage } = require('electron');
const { spawn } = require('node:child_process');

let Store;
let store;
let overlayWindow;
let settingsWindow;
let tray;
let isQuitting = false;

const defaults = {
  defaultUrl: 'https://www.ign.com/wikis/clair-obscur-expedition-33/Flying_Waters_Walkthrough',
  lastUrl: '',
  toggleShortcut: 'F9',
  widthRatio: 0.333,
  launchAtStartup: true
};

async function initStore() {
  if (!Store) {
    Store = (await import('electron-store')).default;
  }
  store = new Store({ defaults });

  // Migrate old default shortcut to new default.
  const currentShortcut = store.get('toggleShortcut');
  if (!currentShortcut || currentShortcut === 'Control+Alt+G') {
    store.set('toggleShortcut', 'F9');
  }

  // Migrate old default URL to walkthrough URL.
  const currentDefaultUrl = normalizeIgnToWalkthrough(store.get('defaultUrl'));
  store.set('defaultUrl', currentDefaultUrl || defaults.defaultUrl);

  const currentLastUrl = normalizeIgnToWalkthrough(store.get('lastUrl'));
  if (currentLastUrl !== String(store.get('lastUrl') || '').trim()) {
    store.set('lastUrl', currentLastUrl);
  }

  if (typeof store.get('launchAtStartup') !== 'boolean') {
    store.set('launchAtStartup', true);
  }

  applyLaunchAtStartup(store.get('launchAtStartup'));
}

function clampRatio(ratio) {
  const n = Number(ratio);
  if (Number.isNaN(n)) return defaults.widthRatio;
  return Math.min(0.8, Math.max(0.2, n));
}

function applyLaunchAtStartup(enabled) {
  const openAtLogin = !!enabled;
  app.setLoginItemSettings({
    openAtLogin,
    path: process.execPath,
    args: []
  });
}

function normalizeIgnToWalkthrough(url) {
  const value = String(url || '').trim();
  if (!value) return '';

  const lower = value.toLowerCase();
  const plainIgn =
    lower === 'ign.com' ||
    lower === 'http://ign.com' ||
    lower === 'https://ign.com' ||
    lower === 'http://www.ign.com' ||
    lower === 'https://www.ign.com';

  if (plainIgn) return defaults.defaultUrl;

  try {
    const normalized = value.startsWith('http://') || value.startsWith('https://') ? value : `https://${value}`;
    const u = new URL(normalized);
    const host = u.hostname.toLowerCase();
    const isIgn = host === 'ign.com' || host === 'www.ign.com';
    const isHomePath = !u.pathname || u.pathname === '/';

    if (isIgn && isHomePath) {
      return defaults.defaultUrl;
    }
  } catch {
    // keep original when URL parsing fails
  }

  return value;
}

function getStartUrl() {
  const lastUrl = normalizeIgnToWalkthrough(store.get('lastUrl'));
  const defaultUrl = normalizeIgnToWalkthrough(store.get('defaultUrl')) || defaults.defaultUrl;
  return lastUrl || defaultUrl;
}

function getTargetDisplay() {
  return screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
}

function applyOverlayBounds() {
  if (!overlayWindow) return;

  const display = getTargetDisplay();
  const bounds = display.bounds;
  const ratio = clampRatio(store.get('widthRatio'));
  const panelWidth = Math.floor(bounds.width * ratio);

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
      let prevComboClose = false;
      let prevL2 = false;
      let prevR2 = false;
      let lockMode = false;
      let zoomLevel = 1;
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

      function triggerPressed(gp, idx, prevStateName) {
        const value = Number(gp.buttons[idx]?.value || 0);
        const now = value > 0.65;
        const was = prevStateName === 'l2' ? prevL2 : prevR2;
        if (prevStateName === 'l2') prevL2 = now;
        else prevR2 = now;
        return now && !was;
      }

      function applyZoom(nextZoom) {
        zoomLevel = clamp(nextZoom, 0.5, 2.0);
        document.documentElement.style.zoom = String(zoomLevel);
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

          if (triggerPressed(gp, 6, 'l2')) applyZoom(zoomLevel - 0.1); // L2 zoom out
          if (triggerPressed(gp, 7, 'r2')) applyZoom(zoomLevel + 0.1); // R2 zoom in

          // Fast close/toggle from controller while inside webview.
          // Different drivers expose these buttons differently.
          const closePressed =
            pressed(gp, 9) ||    // Options/Start
            pressed(gp, 17) ||   // Touchpad press (standard mapping)
            pressed(gp, 8);      // Share/Create fallback

          // Emergency combo fallback: L3 + R3 together.
          const l3 = !!gp.buttons[10]?.pressed;
          const r3 = !!gp.buttons[11]?.pressed;
          const comboClose = l3 && r3;
          const comboClosePressed = comboClose && !prevComboClose;
          prevComboClose = comboClose;

          const ignoreCloseUntil = Number(window.__overlayIgnoreCloseUntil || 0);
          const canCloseNow = Date.now() >= ignoreCloseUntil;

          if (canCloseNow && (closePressed || comboClosePressed)) {
            window.overlayAPI?.toggle?.();
          }
        }

        updateCursor();
        requestAnimationFrame(tick);
      }

      window.addEventListener('resize', () => {
        x = clamp(x, 0, window.innerWidth);
        y = clamp(y, 0, window.innerHeight);
      });

      // Keyboard fallback: lets DS4Windows keybinds close reliably while focused.
      window.addEventListener('keydown', (e) => {
        if (e.repeat) return;
        const k = String(e.key || '').toLowerCase();
        if (k === 'f9' || k === 'escape') {
          e.preventDefault();
          window.overlayAPI?.toggle?.();
        }
      });

      setLockMode(false);
      updateCursor();
      requestAnimationFrame(tick);
    })();
  `).catch(() => {});
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
      nodeIntegration: false,
      partition: 'persist:overlay'
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

async function clearBrowserCache({ resetLastUrl = false } = {}) {
  if (!overlayWindow || overlayWindow.isDestroyed()) return false;

  try {
    const ses = overlayWindow.webContents.session;
    await ses.clearCache();
    await ses.clearStorageData({
      storages: ['appcache', 'cookies', 'filesystem', 'indexdb', 'localstorage', 'shadercache', 'serviceworkers', 'websql']
    });

    if (resetLastUrl) {
      store.set('lastUrl', '');
    }

    return true;
  } catch {
    return false;
  }
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
    {
      label: 'Clear Browser Cache',
      click: async () => {
        const ok = await clearBrowserCache({ resetLastUrl: true });
        if (ok) {
          const defaultUrl = normalizeIgnToWalkthrough(store.get('defaultUrl')) || defaults.defaultUrl;
          overlayWindow.loadURL(defaultUrl);
        }
      }
    },
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

function forceRefocusPreviousWindowWindows() {
  if (process.platform !== 'win32') return;

  // Uses Alt+Esc to return focus to previously active window (typically the game).
  // This is more reliable than PID-based focus in many game/anti-cheat setups.
  const script = "$ws=New-Object -ComObject WScript.Shell; Start-Sleep -Milliseconds 30; $ws.SendKeys('%{ESC}')";
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const ps = spawn('powershell', ['-NoProfile', '-EncodedCommand', encoded], {
    windowsHide: true,
    stdio: 'ignore'
  });
  ps.unref();
}

function showOverlay() {
  applyOverlayBounds();
  overlayWindow.setFocusable(true);

  // Prevent immediate re-toggle when the same controller button is used to open the overlay.
  overlayWindow.webContents.executeJavaScript(
    'window.__overlayIgnoreCloseUntil = Date.now() + 900;'
  ).catch(() => {});

  overlayWindow.show();
  overlayWindow.focus();
  injectControllerBrowserControls();
}

function hideOverlay() {
  overlayWindow.blur();
  overlayWindow.setFocusable(false);
  overlayWindow.hide();

  setTimeout(() => {
    forceRefocusPreviousWindowWindows();
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.setFocusable(true);
    }
  }, 120);
}

function toggleOverlay() {
  if (!overlayWindow) return;
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
  createOverlayWindow();
  createTray();
  registerToggleShortcut();
  applyOverlayBounds();

  createSettingsWindow();

  screen.on('display-metrics-changed', applyOverlayBounds);

  ipcMain.handle('overlay:get-settings', () => ({
    defaultUrl: normalizeIgnToWalkthrough(store.get('defaultUrl')) || defaults.defaultUrl,
    lastUrl: normalizeIgnToWalkthrough(store.get('lastUrl')),
    toggleShortcut: store.get('toggleShortcut'),
    widthRatio: store.get('widthRatio'),
    launchAtStartup: !!store.get('launchAtStartup')
  }));

  ipcMain.handle('overlay:set-settings', async (_, next) => {
    const prevDefaultUrl = normalizeIgnToWalkthrough(store.get('defaultUrl')) || defaults.defaultUrl;

    if (next.defaultUrl) {
      const normalizedNewDefault = normalizeIgnToWalkthrough(String(next.defaultUrl));
      store.set('defaultUrl', normalizedNewDefault || defaults.defaultUrl);
    }
    if (next.toggleShortcut) store.set('toggleShortcut', String(next.toggleShortcut));
    if (next.widthRatio) store.set('widthRatio', clampRatio(next.widthRatio));
    if (typeof next.launchAtStartup === 'boolean') {
      store.set('launchAtStartup', !!next.launchAtStartup);
      applyLaunchAtStartup(!!next.launchAtStartup);
    }

    const updatedDefaultUrl = normalizeIgnToWalkthrough(store.get('defaultUrl')) || defaults.defaultUrl;
    const defaultChanged = prevDefaultUrl !== updatedDefaultUrl;

    if (defaultChanged) {
      await clearBrowserCache({ resetLastUrl: true });
      overlayWindow.loadURL(updatedDefaultUrl);
    }

    registerToggleShortcut();
    applyOverlayBounds();
    return true;
  });

  ipcMain.handle('overlay:open-default', () => {
    const url = normalizeIgnToWalkthrough(store.get('defaultUrl')) || defaults.defaultUrl;
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
  if (!overlayWindow || overlayWindow.isDestroyed()) {
    createOverlayWindow();
    applyOverlayBounds();
  }
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});
