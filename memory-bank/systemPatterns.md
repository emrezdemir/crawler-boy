# System Patterns

## High-level architecture

```
Renderer (sandboxed UI)
    │  window.crawler.*  (preload contextBridge)
    ▼
Main process (Electron)
    ├─ IPC handlers (main.js)
    └─ CrawlEngine (EventEmitter)
         ├─ Frontier        URL queue + visited set
         ├─ RobotsManager   robots.txt fetch/parse/evaluate
         ├─ Fetcher         HTTP + Chromium render + auto-escalation
         ├─ Parser          link & asset extraction (cheerio)
         └─ Downloader      disk layout, saving, exporters
```

Events flow **up** (`engine.emit` → `main.js` → `webContents.send` → renderer).
Commands flow **down** (`renderer` → `ipcRenderer.invoke` → `ipcMain.handle`).

## Key design decisions

### 1. The Fetcher is the only Electron-aware crawler module
Everything else in `crawler/` is plain Node and unit-testable. `Fetcher` lazily
`require('electron')` so the engine could even run headless in tests.

### 2. Render windows are POOLED, not per-fetch
Creating and `destroy()`-ing a `BrowserWindow` for every page caused a **native
crash on the second window** (the first always worked). The fix: keep a pool of
up to `renderConcurrency` long-lived windows and `loadURL` into them, releasing
back to the pool after each fetch. A window that errors or whose renderer process
dies is retired and replaced. This is both more stable and faster, and it keeps
session/cookie continuity across pages. An ad/tracker `onBeforeRequest` filter
runs on the render session to cut noise and bandwidth.

### 3. Auto-escalation strategy
`Auto` mode does an HTTP fetch, then runs `_looksBlocked()` heuristics:
- blocking status codes (401/403/406/429/503) or network error,
- suspiciously tiny body (< 600 bytes),
- known challenge markers ("just a moment", "cf-browser-verification", …).
If blocked, it re-fetches the same URL via a hidden `BrowserWindow`, runs the
page's JS, settles, optionally waits for a selector / auto-scrolls, then reads
`document.documentElement.outerHTML`.

### 4. Worker-pool concurrency with a shared frontier
`CrawlEngine` spawns N workers that pull from one `Frontier`. Termination =
frontier empty **and** `active === 0`. Pause/stop are cooperative state flags
checked in the worker loop.

### 5. Per-host politeness, computed synchronously
`_throttle(host)` updates a `hostNext` timestamp map *before* awaiting, which
serializes spacing per host even across concurrent workers. Robots `Crawl-delay`
overrides the configured delay when larger.

### 6. De-duplication by normalized URL
`normalizeUrl` (strip fragment, lowercase host, drop default ports) is the single
identity function used by the frontier, parser, and scope checks.

### 7. Exhaustive-but-bounded extraction
`Parser` looks everywhere URLs hide (srcset, `<source>`, lazy attrs, inline CSS
`url()`, `<link>`). The Downloader bounds it: category filter, max file size,
download concurrency pool, dedupe set.

### 8. Fail-soft everywhere
Bad URLs, malformed HTML, missing robots.txt, failed downloads → recorded as
errors and the crawl continues. One bad page never kills a run.

### 9. HTTP via Electron `net.fetch`, not global fetch
The HTTP engine routes through Chromium's network stack (`net.fetch` with the
crawl's session). This gives us one place where the **proxy** (`session.setProxy`)
and **cookie jar** apply to both engines, plus real response headers for the
security audit. Falls back to global `fetch` when Electron is absent (tests).

### 10. Heavy CPU work runs in worker threads, never on the main thread
Electron's **main** process also drives the OS window message loop. Doing
synchronous, CPU-heavy work there (cheerio parsing a ~1 MB page, recon regexes)
under concurrency blocks that loop → the app "freezes" / "Not Responding". So
`AnalyzerPool` runs **parse + recon in a pool of worker threads** (auto-sized to
CPU cores, per-task timeout, auto-respawn on crash). The main thread only does
light coordination (queue, merge, IPC). **Rule: any new per-page CPU work goes in
the worker, not the engine.** A worker only depends on plain-Node modules
(Parser, Recon, cheerio) — never Electron.

### 11. Passive recon is a separate, opt-in layer (`Recon.js`)
Intel extraction, security-header auditing, and tech fingerprinting are pure
functions over already-fetched content — no extra requests, no probing. They are
opt-in (off by default), bounded (caps on each finding set), and secrets are
masked in the UI/log while the full values land only in the local
`data/intel.json`. This keeps the tool firmly white-hat: it observes, it does not
attack.

## Security posture

- `contextIsolation: true`, `nodeIntegration: false`, sandboxed renderer.
- Strict CSP in `index.html` (`default-src 'self'`).
- Renderer talks to main only through the explicit `preload` API surface.
- Rendering windows load with `images:false` and muted audio (DOM only, faster).

## Data / output layout

See `Downloader`: `<session>/{pages,assets/<category>/<host>/<path>,data/*.json}`.
