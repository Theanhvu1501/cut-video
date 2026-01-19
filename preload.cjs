const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  selectFolder: () => ipcRenderer.invoke("select-folder"),
  selectFile: (options) => ipcRenderer.invoke("select-file", options),
  runScript: (scriptPath, args, options) =>
    ipcRenderer.invoke("run-script", scriptPath, args, options),
  saveRenderConfig: (config) =>
    ipcRenderer.invoke("save-render-config", config),
  loadRenderConfig: () => ipcRenderer.invoke("load-render-config"),
  openNewWindow: () => ipcRenderer.invoke("open-new-window"),
  downloadYtDlp: () => ipcRenderer.invoke("download-ytdlp"),
  getProjects: () => ipcRenderer.invoke("get-projects"),
  createProject: (projectName) =>
    ipcRenderer.invoke("create-project", projectName),
  deleteProject: (projectName) =>
    ipcRenderer.invoke("delete-project", projectName),
  saveProjectConfig: (projectName, config) =>
    ipcRenderer.invoke("save-project-config", projectName, config),
  loadProjectConfig: (projectName) =>
    ipcRenderer.invoke("load-project-config", projectName),
  getCurrentProject: () => ipcRenderer.invoke("get-current-project"),
  setCurrentProject: (projectName) =>
    ipcRenderer.invoke("set-current-project", projectName),
  syncConfigFiles: (configs) =>
    ipcRenderer.invoke("sync-config-files", configs),
  checkForUpdates: () => ipcRenderer.invoke("check-for-updates"),
  downloadUpdate: () => ipcRenderer.invoke("download-update"),
  installUpdate: () => ipcRenderer.invoke("install-update"),
  onUpdateStatus: (callback) => {
    ipcRenderer.on("update-status", (event, data) => callback(data));
  },
  onUpdateProgress: (callback) => {
    ipcRenderer.on("update-progress", (event, data) => callback(data));
  },
  removeUpdateListeners: () => {
    ipcRenderer.removeAllListeners("update-status");
    ipcRenderer.removeAllListeners("update-progress");
  },
  onScriptOutput: (callback) => {
    ipcRenderer.on("script-output", (event, data) => callback(data));
  },
  removeScriptOutputListener: () => {
    ipcRenderer.removeAllListeners("script-output");
  },
  detectGpuCodec: () => ipcRenderer.invoke("detect-gpu-codec"),
});
