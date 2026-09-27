const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Window controls
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close'),
  isMaximized: () => ipcRenderer.invoke('window:isMaximized'),

  // Native folder selection & file explorer
  selectDirectory: (currentPath) => ipcRenderer.invoke('dialog:select-directory', currentPath),
  getDefaultDirectory: () => ipcRenderer.invoke('dialog:get-default-directory'),
  openDirectory: (folderPath) => ipcRenderer.invoke('shell:open-directory', folderPath),
  openFile: (filePath) => ipcRenderer.invoke('shell:open-file', filePath),
  openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),

  // Drama resolution & downloads
  resolveDrama: (input) => ipcRenderer.invoke('drama:resolve', input),
  fetchDramaDetail: (seriesId) => ipcRenderer.invoke('drama:detail', seriesId),
  startDownload: (downloadRequest) => ipcRenderer.invoke('drama:start-download', downloadRequest),
  cancelDownload: (seriesId) => ipcRenderer.invoke('drama:cancel-download', seriesId),
  getDownloadStatus: () => ipcRenderer.invoke('drama:get-status'),
  getEpisodeStream: (params) => ipcRenderer.invoke('drama:get-episode-stream', params),
  getEngineStatus: () => ipcRenderer.invoke('engine:status'),
  onEngineStatus: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on('engine:status', handler);
    return () => ipcRenderer.removeListener('engine:status', handler);
  },

  // Library scanner
  scanLibrary: (folderPath) => ipcRenderer.invoke('drama:scan-library', folderPath),

  // Auto-updater
  getAppVersion: () => ipcRenderer.invoke('app:version'),
  checkForUpdates: () => ipcRenderer.invoke('updater:check'),
  startDownloadUpdate: () => ipcRenderer.invoke('updater:download'),
  quitAndInstall: () => ipcRenderer.invoke('updater:install'),
  onUpdateStatus: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on('updater:status', handler);
    return () => ipcRenderer.removeListener('updater:status', handler);
  },

  // Events from main process
  onDownloadProgress: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on('download:progress', handler);
    return () => ipcRenderer.removeListener('download:progress', handler);
  },
  onDownloadComplete: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on('download:complete', handler);
    return () => ipcRenderer.removeListener('download:complete', handler);
  },
  onDownloadError: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on('download:error', handler);
    return () => ipcRenderer.removeListener('download:error', handler);
  }
});
