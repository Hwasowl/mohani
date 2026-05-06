// Electron main process — npm 패키지 'mohani'에 번들된 renderer를 띄운다.
// 친구 PC에 따로 설치 없음 — `mohani start`가 이 파일을 spawn함.
const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const isMac = process.platform === 'darwin';
const PRELOAD = path.join(__dirname, 'electron-preload.cjs');
const INDEX = path.join(__dirname, 'ui', 'index.html');
const MOHANI_CONFIG_PATH = path.join(os.homedir(), '.mohani', 'config.json');

// H1: 데몬은 ~/.mohani/config.json의 localSecret을 알아야만 호출 가능.
// renderer는 IPC를 통해서만 secret에 접근 — 외부 웹페이지/LAN 공격자는 알 수 없음.
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

// H1: renderer가 데몬 호출 시 헤더로 첨부할 로컬 secret을 IPC로만 전달.
// 외부 웹페이지가 contextIsolation 우회로도 못 가져가게 main process가 격리.
ipcMain.handle('mohani:get-local-secret', () => readLocalSecret());

// 새 채팅 도착 시 작업표시줄 점멸 — 렌더러가 호출.
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
