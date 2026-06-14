'use strict';

/* CrawlerBoy renderer — wires the UI to the main-process crawler over the
   `window.crawler` bridge exposed by preload.js. No Node access here. */

const $ = (id) => document.getElementById(id);
const GITHUB_URL = 'https://github.com/emrezdemir/crawler-boy';

const els = {
  start: $('startBtn'),
  pause: $('pauseBtn'),
  stop: $('stopBtn'),
  openFolder: $('openFolderBtn'),
  pagesBody: $('pagesBody'),
  assetsBody: $('assetsBody'),
  errorsBody: $('errorsBody'),
  intelBody: $('intelBody'),
  logBox: $('logBox'),
  statusDot: $('statusDot'),
  statusText: $('statusText'),
  progressFill: $('progressFill'),
};

let pageRows = 0;
let assetRows = 0;
let errorRows = 0;
let intelRows = 0;
const intelSeen = new Set();
let running = false;
let paused = false;
let sessionDir = null;
const MAX_TABLE_ROWS = 3000; // cap DOM size; counters stay accurate

// ---------------------------------------------------------------------------
// Config gathering
// ---------------------------------------------------------------------------

function gatherConfig() {
  const seedUrls = $('seedUrl').value
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const categories = [...document.querySelectorAll('#categories input:checked')]
    .filter((c) => c.id !== 'catAll')
    .map((c) => c.value);

  return {
    seedUrls,
    seedUrl: seedUrls[0],
    mode: $('mode').value,
    order: $('order').value,
    scope: $('scope').value,
    concurrency: int($('concurrency').value, 5),
    delay: int($('delay').value, 300),
    timeout: int($('timeout').value, 30000),
    maxRetries: int($('maxRetries').value, 2),
    analyzerThreads: int($('analyzerThreads').value, 0) || undefined,
    jitter: $('jitter').checked,
    maxDepth: int($('maxDepth').value, 5),
    maxPages: int($('maxPages').value, 500),
    includePatterns: $('includePatterns').value,
    excludePatterns: $('excludePatterns').value,
    followSitemaps: $('followSitemaps').checked,
    respectRobots: $('respectRobots').checked,
    // Downloads happen whenever at least one file type is selected.
    downloadAssets: categories.length > 0,
    categories,
    maxFileSize: int($('maxFileSize').value, 0) * 1024 * 1024,
    assetConcurrency: int($('assetConcurrency').value, 4),
    organizeByExtension: $('organizeByExtension').checked,
    savePages: $('savePages').checked,
    rotateUserAgent: $('rotateUserAgent').checked,
    userAgent: $('userAgent').value.trim() || undefined,
    renderConcurrency: int($('renderConcurrency').value, 2),
    renderSettle: int($('renderSettle').value, 1200),
    waitSelector: $('waitSelector').value.trim() || undefined,
    scrollToBottom: $('scrollToBottom').checked,
    blockTrackers: $('blockTrackers').checked,
    cookie: $('cookie').value.trim() || undefined,
    acceptLanguage: $('acceptLanguage').value.trim() || 'en-US,en;q=0.9',
    // Recon & security
    extractIntel: $('extractIntel').checked,
    auditSecurity: $('auditSecurity').checked,
    proxy: $('proxy').value.trim() || undefined,
    extraHeaders: parseHeaders($('extraHeaders').value),
    outputRoot: $('outputRoot').value.trim() || undefined,
    sessionName: $('sessionName').value.trim() || undefined,
  };
}

/** Parse "Header: value" lines into an object (empty → undefined). */
function parseHeaders(raw) {
  const out = {};
  for (const line of String(raw || '').split(/\n+/)) {
    const i = line.indexOf(':');
    if (i > 0) {
      const k = line.slice(0, i).trim();
      const v = line.slice(i + 1).trim();
      if (k && v) out[k] = v;
    }
  }
  return Object.keys(out).length ? out : undefined;
}

const int = (v, d) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : d;
};

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validate(cfg) {
  if (!cfg.seedUrls.length) return 'Please enter at least one seed URL.';
  for (const u of cfg.seedUrls) {
    if (!/^https?:\/\//i.test(u)) return `Seed URLs must start with http(s):// — got "${u}"`;
  }
  if (!cfg.outputRoot) return 'Please choose an output folder first (⑦ Output → Browse…).';
  return null;
}

// ---------------------------------------------------------------------------
// Lifecycle controls
// ---------------------------------------------------------------------------

els.start.addEventListener('click', async () => {
  // Never start without an explicit destination — prompt for one if missing.
  if (!$('outputRoot').value.trim()) {
    const dir = await window.crawler.selectFolder();
    if (dir) $('outputRoot').value = dir;
  }
  const cfg = gatherConfig();
  const err = validate(cfg);
  if (err) {
    if (/output folder/i.test(err)) $('cardOutput').classList.remove('collapsed');
    setStatus('stopped', err);
    return;
  }
  resetUI();
  const res = await window.crawler.start(cfg);
  if (!res.ok) {
    setStatus('stopped', res.error || 'Failed to start.');
    return;
  }
  sessionDir = res.sessionDir;
  running = true;
  paused = false;
  setRunningUI(true);
  setStatus('running', 'Crawling…');
});

els.pause.addEventListener('click', async () => {
  if (!running) return;
  if (paused) {
    await window.crawler.resume();
    paused = false;
    els.pause.textContent = '⏸ Pause';
    setStatus('running', 'Crawling…');
  } else {
    await window.crawler.pause();
    paused = true;
    els.pause.textContent = '▶ Resume';
    setStatus('paused', 'Paused.');
  }
});

els.stop.addEventListener('click', async () => {
  await window.crawler.stop();
  setStatus('stopped', 'Stopping…');
});

els.openFolder.addEventListener('click', () => {
  if (sessionDir) window.crawler.openPath(sessionDir);
});

document.querySelectorAll('[data-export]').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const res = await window.crawler.exportResults(btn.dataset.export);
    if (res.ok) appendLog('info', `Exported → ${res.path}`);
    else if (res.error && res.error !== 'canceled') appendLog('error', `Export failed: ${res.error}`);
  });
});

$('pickFolder').addEventListener('click', async () => {
  const dir = await window.crawler.selectFolder();
  if (dir) $('outputRoot').value = dir;
});

// Collapsible config sections.
document.querySelectorAll('.card-head').forEach((head) => {
  head.addEventListener('click', () => head.closest('.card').classList.toggle('collapsed'));
});

// "All" toggle for the download categories — selects/clears every sub-item.
const catAll = $('catAll');
const catBoxes = () =>
  [...document.querySelectorAll('#categories input[type="checkbox"]')].filter((c) => c.id !== 'catAll');
catAll.addEventListener('change', () => {
  catBoxes().forEach((c) => (c.checked = catAll.checked));
});
catBoxes().forEach((c) =>
  c.addEventListener('change', () => {
    catAll.checked = catBoxes().every((b) => b.checked);
  })
);

$('githubLink').addEventListener('click', (e) => {
  e.preventDefault();
  window.crawler.openExternal(GITHUB_URL);
});

// ---- Disclaimer / consent gate ----
const ACCEPT_KEY = 'crawlerboy_terms_accepted_v1';
const disclaimer = $('disclaimerModal');
const agreeCheck = $('agreeCheck');
const agreeBtn = $('agreeBtn');
agreeCheck.addEventListener('change', () => { agreeBtn.disabled = !agreeCheck.checked; });
agreeBtn.addEventListener('click', () => {
  if ($('rememberCheck').checked) { try { localStorage.setItem(ACCEPT_KEY, '1'); } catch {} }
  disclaimer.classList.add('hidden');
});
$('declineBtn').addEventListener('click', () => window.crawler.quit());
$('termsLink').addEventListener('click', (e) => {
  e.preventDefault();
  agreeCheck.checked = true;
  agreeBtn.disabled = false; // already accepted earlier; this is just a re-read
  disclaimer.classList.remove('hidden');
});
try {
  if (localStorage.getItem(ACCEPT_KEY) === '1') disclaimer.classList.add('hidden');
} catch {
  /* localStorage unavailable → keep the gate visible */
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach((p) => p.classList.remove('active'));
    tab.classList.add('active');
    $(`tab-${tab.dataset.tab}`).classList.add('active');
  });
});

// ---------------------------------------------------------------------------
// Event stream from main
// ---------------------------------------------------------------------------

window.crawler.onEvent(({ type, data }) => {
  switch (type) {
    case 'started':
      appendLog('info', `Started: ${(data.seeds || []).join(', ')}`);
      break;
    case 'log':
      appendLog(data.level, data.message, data.ts);
      break;
    case 'page':
      addPageRow(data);
      break;
    case 'asset':
      addAssetRow(data);
      break;
    case 'intel':
      addIntelRows(data);
      break;
    case 'error':
      addErrorRow(data);
      break;
    case 'stats':
      updateStats(data);
      break;
    case 'state':
      if (data.state === 'paused') setStatus('paused', 'Paused.');
      else if (data.state === 'running') setStatus('running', 'Crawling…');
      else if (data.state === 'stopped') setStatus('stopped', 'Stopped.');
      break;
    case 'done':
      onDone(data);
      break;
  }
});

function onDone({ summary }) {
  running = false;
  paused = false;
  setRunningUI(false);
  const st = summary.state === 'stopped' ? 'stopped' : 'done';
  setStatus(st, `Finished — ${summary.crawled} pages, ${summary.downloaded} files, ${summary.humanBytes}.`);
  els.progressFill.style.width = '100%';
  document.querySelectorAll('[data-export]').forEach((b) => (b.disabled = false));
  els.openFolder.disabled = false;
  appendLog('info', `Output saved to: ${sessionDir}`);
}

// ---------------------------------------------------------------------------
// Rendering helpers
// ---------------------------------------------------------------------------

function updateStats(s) {
  $('stCrawled').textContent = s.crawled;
  $('stQueued').textContent = s.queued;
  $('stActive').textContent = s.active;
  $('stDownloaded').textContent = s.downloaded;
  $('stBytes').textContent = formatBytes((s.pageBytes || 0) + (s.downloadedBytes || 0));
  $('stErrors').textContent = s.errors;
  $('stEscalated').textContent = s.escalated || 0;
  $('stElapsed').textContent = formatDuration(s.elapsedMs || 0);

  const total = s.crawled + s.queued + s.active;
  const pct = total > 0 ? Math.min(99, Math.round((s.crawled / total) * 100)) : 0;
  if (running) els.progressFill.style.width = pct + '%';
}

function statusClass(status) {
  if (status >= 200 && status < 300) return 's-ok';
  if (status >= 300 && status < 400) return 's-warn';
  return 's-err';
}

function addPageRow(p) {
  pageRows++;
  $('pagesCount').textContent = pageRows;
  if (pageRows > MAX_TABLE_ROWS) return;
  const tr = document.createElement('tr');
  const title = (p.meta && p.meta.title) || '—';
  tr.innerHTML =
    `<td>${pageRows}</td>` +
    `<td class="${statusClass(p.status)}">${p.status}</td>` +
    `<td>${p.depth}</td>` +
    `<td>${escapeHtml(truncate(title, 60))}</td>` +
    `<td class="u" title="${escapeAttr(p.url)}">${escapeHtml(truncate(p.url, 70))}</td>` +
    `<td><span class="tag">${escapeHtml(shortType(p.contentType))}</span> <span class="tag">${escapeHtml(p.renderedWith || '')}</span></td>` +
    `<td>${(p.links || []).length}</td>` +
    `<td>${formatBytes(p.bytes || 0)}</td>`;
  bindOpen(tr.querySelector('.u'), p.finalUrl || p.url);
  els.pagesBody.appendChild(tr);
  autoScrollTable(els.pagesBody);
}

function addAssetRow(a) {
  assetRows++;
  $('assetsCount').textContent = assetRows;
  if (assetRows > MAX_TABLE_ROWS) return;
  const tr = document.createElement('tr');
  tr.innerHTML =
    `<td>${assetRows}</td>` +
    `<td><span class="tag">${escapeHtml(a.type)}</span></td>` +
    `<td class="u" title="${escapeAttr(a.url)}">${escapeHtml(truncate(a.url, 80))}</td>` +
    `<td>${formatBytes(a.bytes || 0)}</td>`;
  bindOpen(tr.querySelector('.u'), a.url);
  els.assetsBody.appendChild(tr);
  autoScrollTable(els.assetsBody);
}

function addErrorRow(e) {
  errorRows++;
  $('errorsCount').textContent = errorRows;
  if (errorRows > MAX_TABLE_ROWS) return;
  const tr = document.createElement('tr');
  tr.innerHTML =
    `<td>${errorRows}</td>` +
    `<td class="u" title="${escapeAttr(e.url || '')}">${escapeHtml(truncate(e.url || '', 80))}</td>` +
    `<td class="s-err">${escapeHtml(e.message || '')}</td>`;
  if (e.url) bindOpen(tr.querySelector('.u'), e.url);
  els.errorsBody.appendChild(tr);
}

function addIntelRows({ rows }) {
  for (const r of rows || []) {
    const key = `${r.kind}|${r.value}`;
    if (intelSeen.has(key)) continue;
    intelSeen.add(key);
    intelRows++;
    $('intelCount').textContent = intelRows;
    if (intelRows > MAX_TABLE_ROWS) continue;
    const tr = document.createElement('tr');
    tr.innerHTML =
      `<td>${intelRows}</td>` +
      `<td><span class="kind kind-${escapeHtml(r.kind)}">${escapeHtml(r.kind)}</span></td>` +
      `<td>${escapeHtml(truncate(r.value, 90))}</td>` +
      `<td class="u" title="${escapeAttr(r.page)}">${escapeHtml(truncate(r.page, 50))}</td>`;
    bindOpen(tr.querySelector('.u'), r.page);
    els.intelBody.appendChild(tr);
  }
}

function appendLog(level, message, ts) {
  const time = new Date(ts || Date.now()).toLocaleTimeString();
  const line = document.createElement('span');
  line.className = `l-${level || 'info'}`;
  line.textContent = `[${time}] ${message}\n`;
  els.logBox.appendChild(line);
  // Keep the log bounded.
  if (els.logBox.childNodes.length > 1500) els.logBox.removeChild(els.logBox.firstChild);
  els.logBox.scrollTop = els.logBox.scrollHeight;
}

function bindOpen(el, url) {
  if (!el || !url) return;
  el.addEventListener('click', () => window.crawler.openExternal(url));
}

// Coalesce autoscroll to at most once per animation frame per pane — appending
// hundreds of rows per second otherwise forces a layout on every single row.
const scrollPending = new Set();
function autoScrollTable(body) {
  const pane = body.closest('.tab-pane');
  if (!pane || !pane.classList.contains('active') || scrollPending.has(pane)) return;
  scrollPending.add(pane);
  requestAnimationFrame(() => {
    scrollPending.delete(pane);
    pane.scrollTop = pane.scrollHeight;
  });
}

// ---------------------------------------------------------------------------
// UI state
// ---------------------------------------------------------------------------

function setRunningUI(isRunning) {
  els.start.disabled = isRunning;
  els.pause.disabled = !isRunning;
  els.stop.disabled = !isRunning;
  if (!isRunning) els.pause.textContent = '⏸ Pause';
  // Visibly lock the whole config panel while a crawl is in flight.
  $('configPanel').classList.toggle('locked', isRunning);
  $('configPanel').querySelectorAll('input, select, textarea, button').forEach((el) => {
    el.disabled = isRunning;
  });
}

function setStatus(state, text) {
  els.statusDot.className = `dot ${state}`;
  els.statusText.textContent = text;
}

function resetUI() {
  pageRows = assetRows = errorRows = intelRows = 0;
  intelSeen.clear();
  els.pagesBody.innerHTML = '';
  els.assetsBody.innerHTML = '';
  els.errorsBody.innerHTML = '';
  els.intelBody.innerHTML = '';
  els.logBox.innerHTML = '';
  $('pagesCount').textContent = '0';
  $('assetsCount').textContent = '0';
  $('errorsCount').textContent = '0';
  $('intelCount').textContent = '0';
  els.progressFill.style.width = '0';
  document.querySelectorAll('[data-export]').forEach((b) => (b.disabled = true));
  els.openFolder.disabled = true;
  ['stCrawled', 'stQueued', 'stActive', 'stDownloaded', 'stErrors', 'stEscalated'].forEach((id) => ($(id).textContent = '0'));
  $('stBytes').textContent = '0 B';
  $('stElapsed').textContent = '0s';
}

// ---------------------------------------------------------------------------
// Formatting utils
// ---------------------------------------------------------------------------

function formatBytes(bytes) {
  if (!bytes || bytes < 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

function formatDuration(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function shortType(ct) {
  if (!ct) return '?';
  return ct.split(';')[0].split('/').pop();
}

const truncate = (s, n) => (s && s.length > n ? s.slice(0, n - 1) + '…' : s || '');
const escapeHtml = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const escapeAttr = (s) => String(s).replace(/"/g, '&quot;');

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

(async function init() {
  try {
    const meta = await window.crawler.meta();
    $('appMeta').textContent = `v${meta.version} · ${meta.platform} · Electron ${meta.electron}`;
  } catch {
    $('appMeta').textContent = 'CrawlerBoy';
  }
})();
