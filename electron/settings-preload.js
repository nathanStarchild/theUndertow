const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('settingsAPI', {
  getSettings: () => ipcRenderer.invoke('get-settings'),
  getDisplays: () => ipcRenderer.invoke('get-displays'),
  identifyDisplays: () => ipcRenderer.invoke('identify-displays'),
  launch: (settings) => ipcRenderer.invoke('launch', settings),
});
