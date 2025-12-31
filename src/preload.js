const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  saveState: (state) => ipcRenderer.invoke('save-state', state),
  loadState: () => ipcRenderer.invoke('load-state'),
  // Separate handlers for large data (PDF, cover images) to avoid lag
  saveObjectData: (objectId, dataType, dataUrl) => ipcRenderer.invoke('save-object-data', objectId, dataType, dataUrl),
  loadObjectData: (objectId, dataType) => ipcRenderer.invoke('load-object-data', objectId, dataType),
  // Audio transcoding using FFmpeg (for files that browser can't decode)
  transcodeAudio: (audioDataBase64, fileName) => ipcRenderer.invoke('transcode-audio', audioDataBase64, fileName),
  // Cassette player - music folder selection and audio file reading
  selectMusicFolder: () => ipcRenderer.invoke('select-music-folder'),
  readAudioFile: (filePath) => ipcRenderer.invoke('read-audio-file', filePath),
  refreshMusicFolder: (folderPath) => ipcRenderer.invoke('refresh-music-folder', folderPath)
});
