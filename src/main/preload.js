'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/**
 * Secure bridge between the sandboxed renderer and the main process.
 * The renderer never touches Node or Electron internals directly — it only
 * sees this small, explicit API surface.
 */
contextBridge.exposeInMainWorld('crawler', {
  start: (config) => ipcRenderer.invoke('crawl:start', config),
  pause: () => ipcRenderer.invoke('crawl:pause'),
  resume: () => ipcRenderer.invoke('crawl:resume'),
  stop: () => ipcRenderer.invoke('crawl:stop'),

  selectFolder: () => ipcRenderer.invoke('dialog:selectFolder'),
  exportResults: (format) => ipcRenderer.invoke('crawl:export', { format }),
  openPath: (target) => ipcRenderer.invoke('app:openPath', target),
  openExternal: (url) => ipcRenderer.invoke('app:openExternal', url),
  quit: () => ipcRenderer.invoke('app:quit'),
  meta: () => ipcRenderer.invoke('app:meta'),

  /** Subscribe to crawl events. Returns an unsubscribe function. */
  onEvent: (handler) => {
    const listener = (_e, payload) => handler(payload);
    ipcRenderer.on('crawl:event', listener);
    return () => ipcRenderer.removeListener('crawl:event', listener);
  },
});
