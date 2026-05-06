// Electron main process — Vite dev URL 또는 빌드된 dist를 로드.
const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const DEV_URL = process.env.MOHANI_DEV_URL || 'http://localhost:5173';
const PRELOAD = path.join(__dirname, 'preload.cjs');
const MOHANI_CONFIG_PATH = path.join(os.homedir(), '.mohani', 'config.json');

// H1: 데몬 호출 시 헤더로 첨부할 로컬 secret 조회. (agent/electron-main.cjs와 동일 로직)
function readLocalSecret() {
  try {
    const raw = fs.readFileSync(MOHANI_CONFIG_PATH, 'utf8');
    const cfg = JSON.parse(raw);
    return typeof cfg.localSecret === 'string' ? cfg.localSecret : null;
  } catch {
    return null;
  }
}

let mainWindow = null;
let widgetWindow = null;
let chatWindow = null;

function loadInto(win, hash) {
  if (app.isPackaged) {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), hash ? { hash } : undefined);
  } else {
    win.loadURL(hash ? `${DEV_URL}#${hash}` : DEV_URL);
  }
}

function createMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    return mainWindow;
  }
  const isMac = process.platform === 'darwin';
  mainWindow = new BrowserWindow({
    width: 1080,
    height: 720,
    minWidth: 760,
    minHeight: 520,
    backgroundColor: '#0b1220',
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    titleBarOverlay: !isMac ? {
      color: '#0b1220',
      symbolColor: '#cbd5e1',
      height: 36,
    } : undefined,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: PRELOAD,
    },
  });
  loadInto(mainWindow);
  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
  mainWindow.on('closed', () => { mainWindow = null; });
  return mainWindow;
}

function createWidgetWindow() {
  if (widgetWindow && !widgetWindow.isDestroyed()) {
    widgetWindow.show();
    widgetWindow.focus();
    return widgetWindow;
  }
  const { workArea } = screen.getPrimaryDisplay();
  const w = 280;
  const h = 320;
  widgetWindow = new BrowserWindow({
    width: w,
    height: h,
    x: workArea.x + workArea.width - w - 20,
    y: workArea.y + 60,
    frame: false,
    resizable: true,
    minWidth: 220,
    minHeight: 180,
    maxWidth: 480,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: '#0b1220',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: PRELOAD,
    },
  });
  loadInto(widgetWindow, 'widget');
  widgetWindow.on('closed', () => { widgetWindow = null; });
  return widgetWindow;
}

ipcMain.handle('mohani:toggle-widget', () => {
  if (widgetWindow && !widgetWindow.isDestroyed()) {
    widgetWindow.close();
    return { open: false };
  }
  createWidgetWindow();
  return { open: true };
});

ipcMain.handle('mohani:open-main', () => {
  createMainWindow();
  return { ok: true };
});

// H1: renderer가 데몬 호출 시 헤더로 첨부할 로컬 secret을 IPC로만 전달.
ipcMain.handle('mohani:get-local-secret', () => readLocalSecret());

// 새 채팅 도착 시 작업표시줄 점멸 — 렌더러가 호출 (창 미포커스일 때만 의미 있음).
// 채팅 팝업이 열려있으면 메인창 점멸은 무시 — 알림은 채팅창에서만.
ipcMain.handle('mohani:flash-frame', (e, on) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (!win || win.isDestroyed()) return;
  if (on && chatWindow && !chatWindow.isDestroyed() && win === mainWindow) return;
  if (on && win.isFocused()) return;
  win.flashFrame(!!on);
});

function createChatWindow() {
  if (chatWindow && !chatWindow.isDestroyed()) {
    chatWindow.show();
    chatWindow.focus();
    return chatWindow;
  }
  const { workArea } = screen.getPrimaryDisplay();
  const w = 380;
  const h = 600;
  const isMac = process.platform === 'darwin';
  chatWindow = new BrowserWindow({
    width: w,
    height: h,
    x: workArea.x + workArea.width - w - 20,
    y: workArea.y + 80,
    minWidth: 320,
    minHeight: 360,
    title: '모하니 채팅',
    backgroundColor: '#0b1220',
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    titleBarOverlay: !isMac ? {
      color: '#0b1220',
      symbolColor: '#cbd5e1',
      height: 36,
    } : undefined,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: PRELOAD,
    },
  });
  loadInto(chatWindow, 'chat');
  chatWindow.on('closed', () => { chatWindow = null; });
  return chatWindow;
}

ipcMain.handle('mohani:toggle-chat', () => {
  if (chatWindow && !chatWindow.isDestroyed()) {
    chatWindow.close();
    return { open: false };
  }
  createChatWindow();
  return { open: true };
});

app.whenReady().then(() => {
  createMainWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
