'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fsp = require('fs/promises');

const CrawlEngine = require('./crawler/CrawlEngine');
const Downloader = require('./crawler/Downloader');
const { safeName } = require('./crawler/utils');

const isDev = process.argv.includes('--dev');

let mainWindow = null;
/** The single in-flight crawl engine (CrawlerBoy runs one crawl at a time). */
let activeEngine = null;
let lastResults = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 940,
    minHeight: 600,
    backgroundColor: '#0d1117',
    title: 'CrawlerBoy',
    icon: path.join(__dirname, '..', '..', 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.removeMenu();
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (activeEngine) activeEngine.stop();
  if (process.platform !== 'darwin') app.quit();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function wireEngine(engine) {
  for (const evt of ['started', 'log', 'page', 'asset', 'stats', 'error', 'state', 'done']) {
    engine.on(evt, (data) => send('crawl:event', { type: evt, data }));
  }
  engine.on('done', ({ summary }) => {
    lastResults = {
      summary,
      pages: engine.pages,
      assets: engine.assetRecords,
      errors: engine.errors,
    };
    activeEngine = null;
  });
}

async function resolveSessionDir(config) {
  const root =
    config.outputRoot && config.outputRoot.trim()
      ? config.outputRoot
      : path.join(app.getPath('downloads'), 'CrawlerBoy');
  let label = config.sessionName && config.sessionName.trim();
  if (!label) {
    let host = 'crawl';
    try {
      host = new URL(config.seedUrl || (config.seedUrls && config.seedUrls[0])).hostname;
    } catch {
      /* keep default */
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    label = `${safeName(host)}_${stamp}`;
  }
  const dir = path.join(root, safeName(label));
  await fsp.mkdir(dir, { recursive: true });
  return dir;
}

// ---------------------------------------------------------------------------
// IPC: crawl control
// ---------------------------------------------------------------------------

ipcMain.handle('crawl:start', async (_e, config) => {
  if (activeEngine) return { ok: false, error: 'A crawl is already running.' };
  try {
    const sessionDir = await resolveSessionDir(config);
    const fullConfig = { ...config, sessionDir };
    const engine = new CrawlEngine(fullConfig);
    activeEngine = engine;
    lastResults = null;
    wireEngine(engine);
    // Fire-and-forget; progress arrives via events.
    engine.start().catch((err) => {
      send('crawl:event', { type: 'error', data: { url: '', message: err.message, fatal: true } });
      activeEngine = null;
    });
    return { ok: true, sessionDir };
  } catch (err) {
    activeEngine = null;
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('crawl:pause', () => {
  if (activeEngine) activeEngine.pause();
  return { ok: true };
});

ipcMain.handle('crawl:resume', () => {
  if (activeEngine) activeEngine.resume();
  return { ok: true };
});

ipcMain.handle('crawl:stop', () => {
  if (activeEngine) activeEngine.stop();
  return { ok: true };
});

// ---------------------------------------------------------------------------
// IPC: filesystem & shell
// ---------------------------------------------------------------------------

ipcMain.handle('dialog:selectFolder', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Select output folder',
    properties: ['openDirectory', 'createDirectory'],
  });
  return res.canceled ? null : res.filePaths[0];
});

ipcMain.handle('crawl:export', async (_e, { format }) => {
  if (!lastResults) return { ok: false, error: 'No results to export yet.' };
  const ext = format === 'csv' ? 'csv' : format === 'ndjson' ? 'ndjson' : 'json';
  const res = await dialog.showSaveDialog(mainWindow, {
    title: 'Export crawl results',
    defaultPath: `crawlerboy-results.${ext}`,
    filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
  });
  if (res.canceled) return { ok: false, error: 'canceled' };
  try {
    await Downloader.exportData(res.filePath, format, lastResults);
    return { ok: true, path: res.filePath };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('app:openPath', async (_e, target) => {
  if (!target) return { ok: false };
  const err = await shell.openPath(target);
  return { ok: !err, error: err || undefined };
});

ipcMain.handle('app:openExternal', async (_e, url) => {
  try {
    await shell.openExternal(url);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('app:quit', () => {
  if (activeEngine) activeEngine.stop();
  app.quit();
  return { ok: true };
});

ipcMain.handle('app:meta', () => ({
  version: app.getVersion(),
  platform: process.platform,
  electron: process.versions.electron,
  node: process.versions.node,
  chrome: process.versions.chrome,
  defaultOutput: path.join(app.getPath('downloads'), 'CrawlerBoy'),
}));
