# Progress

_Last updated: 2026-06-14_

## ✅ Done (v1.1.0 — white-hat recon update)
- [x] `Recon.js`: intel extraction (emails, phones, secrets/API keys, socials,
      endpoints, comments) + security-header audit + tech fingerprinting.
- [x] Form enumeration in `Parser` (`forms.json`).
- [x] **Proxy** (HTTP/SOCKS) for HTTP + browser engines; HTTP now via Electron
      `net.fetch` (Chromium stack → proxy/cookies/response headers).
- [x] Custom request headers UI; discovered-hosts in summary.
- [x] UI: removed the redundant "Download files" master toggle (now any selected
      category = download); "⭐ All" categories toggle; new **Intel** tab;
      `data/intel.json`, `data/security.json`, `data/forms.json`.
- [x] Asset `Content-Length` pre-check before downloading oversize files.
- [x] Tests extended (49 assertions incl. Recon + forms); live Fandom run found
      265 intel rows, 863 endpoints, 1 email.

## ✅ Done (v1.0.0)

### Engine
- [x] `Frontier` — BFS/DFS queue, URL de-dup, visited set.
- [x] `RobotsManager` — fetch/parse/evaluate robots.txt, crawl-delay, sitemaps.
- [x] `Fetcher` — HTTP mode, Browser (Chromium) mode, Auto escalation, UA pool,
      header/cookie injection, wait-for-selector, auto-scroll, binary download.
- [x] `Parser` — exhaustive link & asset extraction via cheerio.
- [x] `Downloader` — session disk layout, asset/page saving, JSON/CSV/NDJSON export.
- [x] `CrawlEngine` — worker pool, per-host throttling, retries/backoff,
      sitemap ingest, scope + include/exclude filters, pause/resume/stop, events.

### App
- [x] `main.js` — window, IPC handlers (start/pause/resume/stop/export/dialogs).
- [x] `preload.js` — secure `window.crawler` bridge.
- [x] Renderer — config panel (6 sections), live stats, Pages/Assets/Errors
      tables, log, export + open-folder, Fandom example loader.
- [x] Icon (dependency-free PNG generator).

### Docs / governance
- [x] README, CHANGELOG, GRAND_RULES, CONTRIBUTING, LICENSE (MIT).
- [x] Memory bank (this folder).

## ✅ Verified (2026-06-14, on Windows 11 / Electron 33.4.11)
- [x] `npm install` + `npm test` → 36/36 unit assertions pass.
- [x] Live crawl of the Blood Brothers Fandom wiki end-to-end:
      HTTP = 403 → Auto escalates to Chromium render = 200 OK; 5 pages crawled,
      links + assets extracted, **639 images (~31 MB)** downloaded to disk.
- [x] Fixed a native crash: render windows are now pooled/reused instead of
      created+destroyed per page.
- [x] Added ad/tracker request blocking during render (faster, quieter).

## 🔄 To verify next
- [ ] Smoke-test the GUI (`npm start`) interactively.
- [ ] Confirm image downloads land correctly on macOS paths (only Windows tested).

## 🧭 Backlog (post-1.0)
- [ ] Resumable crawls (persist frontier + visited to disk).
- [ ] Proxy support (HTTP/SOCKS) + rotation.
- [ ] Visual link-graph explorer.
- [ ] Per-page screenshots.
- [ ] Extractor plugin/hook system.
- [ ] Scheduled / recurring crawls.
- [ ] Basic test suite for the pure crawler modules.

## ⚠️ Known issues / risks
- Subdomain scope uses a curated 2-level-TLD list (not the full Public Suffix
  List) — exotic TLDs may scope imperfectly.
- Browser-mode HTTP status relies on `did-navigate`; unusual redirect chains may
  report 200 by default.
- Very large crawls keep page records in memory; fine for thousands, not millions
  (resumable/streamed storage is backlog).
