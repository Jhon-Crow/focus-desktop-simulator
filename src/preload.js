const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  saveState: (state) => ipcRenderer.invoke('save-state', state),
  loadState: () => ipcRenderer.invoke('load-state'),
  // Separate handlers for large data (PDF, cover images) to avoid lag
  saveObjectData: (objectId, dataType, dataUrl) => ipcRenderer.invoke('save-object-data', objectId, dataType, dataUrl),
  loadObjectData: (objectId, dataType) => ipcRenderer.invoke('load-object-data', objectId, dataType)
});
