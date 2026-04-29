// Electron main process — npm 패키지 'mohani'에 번들된 renderer를 띄운다.
// 친구 PC에 따로 설치 없음 — `mohani start`가 이 파일을 spawn함.
const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('node:path');

const isMac = process.platform === 'darwin';
const PRELOAD = path.join(__dirname, 'electron-preload.cjs');
const INDEX = path.join(__dirname, 'ui', 'index.html');

let mainWindow = null;
let widgetWindow = null;
let chatWindow = null;

function createMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    return mainWindow;
  }
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
  mainWindow.loadFile(INDEX);
  if (process.env.MOHANI_DEBUG === '1' || process.argv.includes('--debug')) {
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
  // 화면 우상단에 기본 배치
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
  widgetWindow.loadFile(INDEX, { hash: 'widget' });
  if (process.env.MOHANI_DEBUG === '1') {
    widgetWindow.webContents.openDevTools({ mode: 'detach' });
  }
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

function createChatWindow() {
  if (chatWindow && !chatWindow.isDestroyed()) {
    chatWindow.show();
    chatWindow.focus();
    return chatWindow;
  }
  const { workArea } = screen.getPrimaryDisplay();
  const w = 380;
  const h = 600;
  chatWindow = new BrowserWindow({
    width: w,
    height: h,
    x: workArea.x + workArea.width - w - 20,
    y: workArea.y + 80,
    minWidth: 320,
    minHeight: 360,
    title: '모하니 채팅',
    backgroundColor: '#0b1220',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: PRELOAD,
    },
  });
  chatWindow.loadFile(INDEX, { hash: 'chat' });
  if (process.env.MOHANI_DEBUG === '1') {
    chatWindow.webContents.openDevTools({ mode: 'detach' });
  }
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
