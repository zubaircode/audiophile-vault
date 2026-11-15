import { app, BrowserWindow, ipcMain, dialog, nativeTheme, Menu, screen } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startServer, stopServer } from '../server/index.js';
import { killActiveRsync } from '../server/services/sync.js';

// Explicitly standardize application name across macOS top menu bar and process hierarchy
app.setName('Audiophile Vault');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow = null;
let sidecarPort = null;

// Suppress disruptive Electron error modal dialogs during development/hot reload
dialog.showErrorBox = (title, content) => {
  console.warn(`[ELECTRON ERROR BOX] ${title}: ${content}`);
};

process.on('uncaughtException', (err) => {
  console.warn('[ELECTRON UNCAUGHT EXCEPTION]', err?.message || err);
});

process.on('unhandledRejection', (reason) => {
  console.warn('[ELECTRON UNHANDLED REJECTION]', reason?.message || reason);
});

/**
 * Robust URL loader with retry and graceful fallback to sidecar
 */
async function safeLoadUrl(win, primaryUrl, fallbackUrl, retries = 6, delayMs = 400) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    if (!win || win.isDestroyed()) return;
    try {
      await win.loadURL(primaryUrl);
      return;
    } catch (err) {
      if (!win || win.isDestroyed()) return;
      if (attempt === retries) {
        console.warn(`[ELECTRON] Could not load ${primaryUrl} (${err.message}). Falling back to ${fallbackUrl}`);
        if (fallbackUrl && fallbackUrl !== primaryUrl) {
          try {
            await win.loadURL(fallbackUrl);
          } catch (fallbackErr) {
            console.error('[ELECTRON] Fallback loadURL failed:', fallbackErr.message);
          }
        }
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

/**
 * Resolves the appropriate application icon path based on the current macOS system appearance.
 */
function getAppIconPath() {
  const isDark = nativeTheme.shouldUseDarkColors;
  const preferred = isDark
    ? path.join(__dirname, '../build/icon-dark-1024.png')
    : path.join(__dirname, '../build/icon-light-1024.png');
  const fallback = path.join(__dirname, '../build/icon-1024.png');

  if (fs.existsSync(preferred)) return preferred;
  if (fs.existsSync(fallback)) return fallback;
  return undefined;
}

function getWindowStateFilePath() {
  return path.join(app.getPath('userData'), 'window-state.json');
}

function loadWindowState() {
  const defaultState = {
    width: 1360,
    height: 860,
    x: undefined,
    y: undefined,
    isFullScreen: false,
  };

  try {
    const filePath = getWindowStateFilePath();
    if (fs.existsSync(filePath)) {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      if (data && typeof data === 'object') {
        return {
          width: Number.isFinite(data.width) && data.width >= 1100 ? data.width : defaultState.width,
          height: Number.isFinite(data.height) && data.height >= 760 ? data.height : defaultState.height,
          x: Number.isFinite(data.x) ? data.x : undefined,
          y: Number.isFinite(data.y) ? data.y : undefined,
          isFullScreen: Boolean(data.isFullScreen),
        };
      }
    }
  } catch (err) {
    console.warn('[ELECTRON] Failed to load window-state.json:', err.message);
  }

  return defaultState;
}

function validateBounds(state) {
  if (state.x === undefined || state.y === undefined) {
    return { ...state, x: undefined, y: undefined };
  }

  try {
    const displays = screen.getAllDisplays();
    const windowBounds = {
      x: state.x,
      y: state.y,
      width: state.width,
      height: state.height,
    };

    const centerX = windowBounds.x + windowBounds.width / 2;
    const centerY = windowBounds.y + windowBounds.height / 2;

    const isVisible = displays.some((display) => {
      const { x, y, width, height } = display.bounds;
      const centerInside =
        centerX >= x &&
        centerX <= x + width &&
        centerY >= y &&
        centerY <= y + height;
      if (centerInside) return true;

      const intersects =
        windowBounds.x < x + width &&
        windowBounds.x + windowBounds.width > x &&
        windowBounds.y < y + height &&
        windowBounds.y + windowBounds.height > y;
      return intersects;
    });

    if (!isVisible) {
      return { ...state, x: undefined, y: undefined };
    }
  } catch (err) {
    console.warn('[ELECTRON] Could not validate display bounds:', err.message);
    return { ...state, x: undefined, y: undefined };
  }

  return state;
}

let saveStateTimeout = null;

function saveWindowState(win) {
  if (!win || win.isDestroyed()) return;

  try {
    const isFullScreen = win.isFullScreen();
    let bounds;

    if (isFullScreen) {
      bounds = win.getNormalBounds();
    } else {
      bounds = win.getBounds();
    }

    const state = {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      isFullScreen: isFullScreen,
    };

    const userDataDir = app.getPath('userData');
    if (!fs.existsSync(userDataDir)) {
      fs.mkdirSync(userDataDir, { recursive: true });
    }
    fs.writeFileSync(getWindowStateFilePath(), JSON.stringify(state, null, 2), 'utf-8');
  } catch (err) {
    console.warn('[ELECTRON] Failed to save window-state.json:', err.message);
  }
}

function scheduleSaveWindowState(win) {
  if (saveStateTimeout) {
    clearTimeout(saveStateTimeout);
  }
  saveStateTimeout = setTimeout(() => {
    saveWindowState(win);
  }, 300);
}

async function createWindow() {
  const preloadPath = fs.existsSync(path.join(__dirname, 'preload.cjs'))
    ? path.join(__dirname, 'preload.cjs')
    : path.join(__dirname, 'preload.js');

  const iconPath = getAppIconPath();
  const rawState = loadWindowState();
  const validState = validateBounds(rawState);

  const windowOptions = {
    width: validState.width,
    height: validState.height,
    minWidth: 1100,
    minHeight: 760,
    title: '',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 20 },
    backgroundColor: '#09090b',
    icon: iconPath,
    show: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      additionalArguments: [`--api-port=${sidecarPort}`],
    },
  };

  if (validState.x !== undefined && validState.y !== undefined) {
    windowOptions.x = validState.x;
    windowOptions.y = validState.y;
  }

  mainWindow = new BrowserWindow(windowOptions);

  mainWindow.on('resize', () => {
    scheduleSaveWindowState(mainWindow);
  });

  mainWindow.on('move', () => {
    scheduleSaveWindowState(mainWindow);
  });

  // Prevent web page title updates from displaying title text in native macOS fullscreen titlebar
  mainWindow.on('page-title-updated', (e) => {
    e.preventDefault();
  });

  // Send fullscreen state changes to the renderer to dynamically collapse traffic light padding
  mainWindow.on('enter-full-screen', () => {
    if (saveStateTimeout) clearTimeout(saveStateTimeout);
    saveWindowState(mainWindow);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('window:fullscreen-change', true);
    }
  });

  mainWindow.on('leave-full-screen', () => {
    if (saveStateTimeout) clearTimeout(saveStateTimeout);
    saveWindowState(mainWindow);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('window:fullscreen-change', false);
    }
  });

  mainWindow.on('close', () => {
    if (saveStateTimeout) clearTimeout(saveStateTimeout);
    saveWindowState(mainWindow);
  });

  mainWindow.once('ready-to-show', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (validState.isFullScreen) {
        mainWindow.setFullScreen(true);
      }
      mainWindow.show();
    }
  });

  const sidecarUrl = `http://127.0.0.1:${sidecarPort}`;

  if (!app.isPackaged) {
    // Development mode: try loading Vite HMR, fall back to sidecar if Vite is not serving
    await safeLoadUrl(mainWindow, 'http://127.0.0.1:5173', sidecarUrl);
  } else {
    // Production mode: load local Express server which serves client/dist
    await safeLoadUrl(mainWindow, sidecarUrl, null);
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Register native directory selection dialog handler for Settings modal
ipcMain.handle('dialog:selectDirectory', async () => {
  if (!mainWindow || mainWindow.isDestroyed()) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
    return null;
  }
  return result.filePaths[0];
});

// Provide current fullscreen state to renderer
ipcMain.handle('window:isFullScreen', () => {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow.isFullScreen() : false;
});

/**
 * Sets up standard macOS application menus with native shortcuts
 */
function setupApplicationMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac
      ? [
          {
            label: 'Audiophile Vault',
            submenu: [
              { role: 'about', label: 'About Audiophile Vault' },
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide', label: 'Hide Audiophile Vault' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit', label: 'Quit Audiophile Vault' },
            ],
          },
        ]
      : []),
    {
      role: 'editMenu',
    },
    {
      role: 'viewMenu',
    },
    {
      role: 'windowMenu',
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

app.whenReady().then(async () => {
  try {
    // Configure native macOS application menu bar
    setupApplicationMenu();
    // Set custom squircle icon in macOS Dock during local development and respond to system appearance changes
    const updateDevDockIcon = () => {
      if (app.isPackaged || !app.dock) return;
      const currentIcon = getAppIconPath();
      if (currentIcon) {
        try {
          app.dock.setIcon(currentIcon);
          if (mainWindow && !mainWindow.isDestroyed() && typeof mainWindow.setIcon === 'function') {
            mainWindow.setIcon(currentIcon);
          }
        } catch (dockErr) {
          console.warn('[ELECTRON] Could not set dock icon:', dockErr.message);
        }
      }
    };

    updateDevDockIcon();
    nativeTheme.on('updated', updateDevDockIcon);

    // 1. Boot Express sidecar on an ephemeral OS-assigned free port (or 3001 in dev fallback)
    const { port } = await startServer(0);
    sidecarPort = port;
    console.log(`[ELECTRON] Express sidecar attached on port ${sidecarPort}`);

    // 2. Create the native macOS window
    await createWindow();
  } catch (err) {
    console.error('[ELECTRON] Failed to start sidecar or create window:', err);
    app.quit();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  killActiveRsync();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', async () => {
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      saveWindowState(mainWindow);
    }
    killActiveRsync();
    await stopServer();
  } catch (err) {
    console.error('[ELECTRON] Error during sidecar shutdown:', err);
  }
});
