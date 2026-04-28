// Electron main process — npm 패키지 'mohani'에 번들된 renderer를 띄운다.
// 친구 PC에 따로 설치 없음 — `mohani start`가 이 파일을 spawn함.
const { app, BrowserWindow } = require('electron');
const path = require('node:path');

const isMac = process.platform === 'darwin';

function createWindow() {
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
  win.loadFile(path.join(__dirname, 'ui', 'index.html'));
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
