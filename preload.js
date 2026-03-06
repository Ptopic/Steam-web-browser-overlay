const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('overlayAPI', {
  getSettings: () => ipcRenderer.invoke('overlay:get-settings'),
  setSettings: (settings) => ipcRenderer.invoke('overlay:set-settings', settings),
  openDefault: () => ipcRenderer.invoke('overlay:open-default'),
  navigate: (url) => ipcRenderer.invoke('overlay:navigate', url),
  toggle: () => ipcRenderer.invoke('overlay:toggle'),
  openSettings: () => ipcRenderer.invoke('overlay:open-settings'),
  back: () => ipcRenderer.invoke('overlay:go-back'),
  forward: () => ipcRenderer.invoke('overlay:go-forward'),
  refresh: () => ipcRenderer.invoke('overlay:refresh')
});
