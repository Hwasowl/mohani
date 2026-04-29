// Electron preload — renderer에서 main process로 IPC 호출 가능하게 하는 안전한 bridge.
// contextIsolation:true 환경에서 window.mohaniIpc.* 로 노출.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mohaniIpc', {
  toggleWidget: () => ipcRenderer.invoke('mohani:toggle-widget'),
  isWidget: () => location.hash === '#widget',
  toggleChat: () => ipcRenderer.invoke('mohani:toggle-chat'),
  isChat: () => location.hash === '#chat',
  openMainWindow: () => ipcRenderer.invoke('mohani:open-main'),
});
