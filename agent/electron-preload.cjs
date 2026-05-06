// Electron preload — renderer에서 main process로 IPC 호출 가능하게 하는 안전한 bridge.
// contextIsolation:true 환경에서 window.mohaniIpc.* 로 노출.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mohaniIpc', {
  toggleWidget: () => ipcRenderer.invoke('mohani:toggle-widget'),
  isWidget: () => location.hash === '#widget',
  toggleChat: () => ipcRenderer.invoke('mohani:toggle-chat'),
  isChat: () => location.hash === '#chat',
  openMainWindow: () => ipcRenderer.invoke('mohani:open-main'),
  flashFrame: (on) => ipcRenderer.invoke('mohani:flash-frame', !!on),
  // H1: renderer가 데몬 호출 시 Authorization 헤더로 첨부할 로컬 secret.
  getLocalSecret: () => ipcRenderer.invoke('mohani:get-local-secret'),
  // 채팅 팝업 라이프사이클 — 메인창이 미읽음 카운트 클리어 판정에 사용.
  getChatWindowOpen: () => ipcRenderer.invoke('mohani:get-chat-window-open'),
  onChatWindowChanged: (cb) => {
    const handler = (_e, open) => cb(!!open);
    ipcRenderer.on('mohani:chat-window-changed', handler);
    return () => ipcRenderer.removeListener('mohani:chat-window-changed', handler);
  },
});
