// Electron main process — Vite dev URL 또는 빌드된 dist를 로드.
const { app, BrowserWindow } = require('electron');
const path = require('node:path');

const DEV_URL = process.env.MOHANI_DEV_URL || 'http://localhost:5173';

function createWindow() {
  const isMac = process.platform === 'darwin';
  const win = new BrowserWindow({
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
    },
  });

  if (app.isPackaged) {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  } else {
    win.loadURL(DEV_URL);
    win.webContents.openDevTools({ mode: 'detach' });
  }
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
