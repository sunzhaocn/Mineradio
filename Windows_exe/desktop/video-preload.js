'use strict';
const {contextBridge, ipcRenderer} = require('electron');
// Match desktop rendering without granting the export page the main window's
// filesystem, account, update or window-management IPC capabilities.
contextBridge.exposeInMainWorld('desktopWindow', {
  isDesktop:true,
  onStateChange:() => {},
  getState:async () => ({isVisible:true,isMinimized:false,isFullScreen:true,isNativeFullScreen:true}),
});
contextBridge.exposeInMainWorld('mineradioVideoRender', {
  getConfig:() => ipcRenderer.invoke('mineradio-video-render-config'),
});
