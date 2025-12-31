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
  refreshMusicFolder: (folderPath) => ipcRenderer.invoke('refresh-music-folder', folderPath),
  // Dictaphone - recording folder selection and saving
  selectRecordingsFolder: (format) => ipcRenderer.invoke('select-recordings-folder', format),
  saveRecording: (folderPath, recordingNumber, audioDataBase64, format) => ipcRenderer.invoke('save-recording', folderPath, recordingNumber, audioDataBase64, format),
  getNextRecordingNumber: (folderPath) => ipcRenderer.invoke('get-next-recording-number', folderPath),
  // Markdown editor - notes folder selection and saving
  getDefaultNotesFolder: () => ipcRenderer.invoke('get-default-notes-folder'),
  selectNotesFolder: () => ipcRenderer.invoke('select-notes-folder'),
  saveMarkdownFile: (folderPath, fileName, content) => ipcRenderer.invoke('save-markdown-file', folderPath, fileName, content)
});
