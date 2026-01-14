const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  selectFile: (options) => ipcRenderer.invoke('select-file', options),
  runScript: (scriptPath, args, options) => ipcRenderer.invoke('run-script', scriptPath, args, options),
  saveRenderConfig: (config) => ipcRenderer.invoke('save-render-config', config),
  loadRenderConfig: () => ipcRenderer.invoke('load-render-config'),
  openNewWindow: () => ipcRenderer.invoke('open-new-window'),
  onScriptOutput: (callback) => {
    ipcRenderer.on('script-output', (event, data) => callback(data));
  },
  removeScriptOutputListener: () => {
    ipcRenderer.removeAllListeners('script-output');
  }
});
