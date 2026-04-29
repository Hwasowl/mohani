// Dev mode preload — npm 패키지 버전과 동일한 API.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mohaniIpc', {
  toggleWidget: () => ipcRenderer.invoke('mohani:toggle-widget'),
  isWidget: () => location.hash === '#widget',
  toggleChat: () => ipcRenderer.invoke('mohani:toggle-chat'),
  isChat: () => location.hash === '#chat',
  openMainWindow: () => ipcRenderer.invoke('mohani:open-main'),
});
