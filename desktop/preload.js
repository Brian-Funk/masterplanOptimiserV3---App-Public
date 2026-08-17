/**
 * Electron Preload Script
 * Safely exposes specific Electron APIs to the renderer process.
 * The renderer receives only the narrow capabilities it needs.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
  /** true when running inside the Electron shell */
  isElectron: true,

  platform: process.platform,
  versions: process.versions,
  apiUrl: process.env.MP_DESKTOP_RENDERER_API_URL,

  /** Run integrity verification against the signed hash manifest. */
  checkIntegrity: () => ipcRenderer.invoke('check-integrity'),

  /** Save recent diagnostic logs to a text file chosen by the user. */
  saveLogDump: (payload) => ipcRenderer.invoke('save-log-dump', payload),

  /** Add renderer-side errors to the diagnostic log buffer. */
  recordRendererError: (payload) => ipcRenderer.invoke('record-renderer-error', payload),

  /** Read or choose the workstation-local PDF export folder. */
  getPdfExportDirectory: () => ipcRenderer.invoke('get-pdf-export-directory'),
  choosePdfExportDirectory: () => ipcRenderer.invoke('choose-pdf-export-directory'),
  clearPdfExportDirectory: () => ipcRenderer.invoke('clear-pdf-export-directory'),

  /** Render one structured Optimised Schedule payload into the configured folder. */
  exportSchedulePdf: (payload) => ipcRenderer.invoke('export-schedule-pdf', payload),
  getPdfExportJob: (jobId) => ipcRenderer.invoke('get-pdf-export-job', jobId),
  notifyPdfExportReady: (jobId) => ipcRenderer.invoke('notify-pdf-export-ready', jobId),
  notifyPdfExportFailed: (jobId, code) => ipcRenderer.invoke('notify-pdf-export-failed', jobId, code),

  /** Toggle the current Electron BrowserWindow fullscreen state. */
  setWindowFullscreen: (fullscreen) => ipcRenderer.invoke('set-window-fullscreen', Boolean(fullscreen)),

  /** Read the current Electron BrowserWindow fullscreen state. */
  getWindowFullscreenState: () => ipcRenderer.invoke('get-window-fullscreen-state'),

  /** Subscribe to native BrowserWindow fullscreen changes. */
  onWindowFullscreenChange: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, fullscreen) => callback(Boolean(fullscreen));
    ipcRenderer.on('window-fullscreen-changed', listener);
    return () => ipcRenderer.removeListener('window-fullscreen-changed', listener);
  },
});
