# Changelog

All notable changes to CrawlerBoy are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Planned
- Pause/resume that persists the frontier to disk (resumable crawls across restarts).
- Per-request proxy rotation and authenticated proxies.
- Visual link-graph explorer.
- Screenshot capture per page.
- Plugin/hook system for custom extractors.
- Scheduling (cron-style recurring crawls).

## [1.4.0] — 2026-06-14

### Added
- **File integrity & correct extensions**: downloads are now verified by their
  magic bytes. HTML pages served under an image/PDF/etc. URL (e.g. a wiki
  `File:Foo.jpg` description page) are **rejected** instead of saved as corrupt
  files, and every file is given the right extension based on its *real* sniffed
  type — fixing "this file format may not be supported" when opening downloads.
- **`summary.txt`** (human-readable run report) and **`downloaded-files.txt`**
  (every saved file as `path⇥bytes`, streamed live) written to the session folder.
- **README screenshots** + an `npm run screenshots` generator (`tools/screenshot.js`).

### Changed / performance
- **Live tables use a rolling window**: the Pages/Assets/Intel/Errors tables now
  keep only as many rows as fit the window and drop older ones from the DOM
  (counters still show the true total). Keeps renderer memory flat on huge crawls
  — the full lists live in the on-disk artifacts.
- In-memory dedup/state stays in hash-based `Set`/`Map` collections (the JS
  equivalent of .NET `HashSet`/`Dictionary`); the downloaded-file list is streamed
  to disk rather than only held in memory.

## [1.3.0] — 2026-06-14

### Added
- **Organize downloads by file type** (optional): a new Downloads toggle saves
  every downloaded file into a folder named after its extension —
  `assets/png/`, `assets/jpg/`, `assets/pdf/`, … — instead of mirroring the
  site's path structure. Great for "just grab all the images/PDFs". Filenames
  stay readable; clashes are disambiguated with a short hash. The extension is
  taken from the URL, falling back to the `Content-Type`. When the toggle is off,
  the standard `assets/<category>/<host>/<path>` mirror layout is used.

## [1.2.0] — 2026-06-14

### Performance (fixes UI freezing on large crawls)
- **Worker-thread analyzer pool** (`AnalyzerPool` + `analyzer-worker.js`): HTML
  parsing (cheerio) and all recon regexes now run in a pool of worker threads
  instead of on Electron's main thread. Previously, parsing big JS-heavy pages
  (~1 MB+) across several concurrent workers blocked the main process — and with
  it the OS window message loop — making the app freeze / "Not Responding" on
  Windows. The main process now stays responsive under load.
  - Pool size auto-scales to CPU cores (overridable via the new **Worker threads**
    field; `0` = auto). Per-task timeout retires and replaces a hung worker.
- **Skip ad/tracker asset downloads**: when tracker-blocking is on, known
  ad/analytics scripts (Google Tag Manager, Scorecard, btloader, …) are no longer
  downloaded — less bandwidth and disk, fewer junk files. The tracker list is now
  shared between the render blocker and the download filter.
- Asset downloads already skip oversize files via a `Content-Length` pre-check.
- **Render windows** default raised 2 → 3 for better escalation throughput.
- Renderer coalesces table auto-scroll to one reflow per frame.

## [1.1.0] — 2026-06-14

### Added — white-hat recon toolkit
- **Intel extraction** (`Recon.js`): passively harvests emails, phone numbers,
  secrets / API keys (AWS, Google, Slack, GitHub, Stripe, JWT, private keys,
  generic), social-media links, API endpoints, and noteworthy HTML comments.
  Live **Intel tab** + `data/intel.json`. Secrets are masked in the UI/log.
- **Security & tech audit**: flags missing security headers (CSP, HSTS,
  X-Frame-Options, …) and insecure cookie flags, and fingerprints the
  server / framework / CMS. Written to `data/security.json`.
- **Form enumeration**: every page's forms (action, method, input names/types)
  captured for attack-surface mapping → `data/forms.json`.
- **Proxy support**: route all traffic (HTTP **and** browser engine) through an
  HTTP or SOCKS proxy — e.g. Burp/ZAP (`127.0.0.1:8080`) or Tor
  (`socks5://127.0.0.1:9050`).
- **Custom request headers** UI (e.g. `Authorization: Bearer …`).
- **Discovered-hosts** list in the run summary.

### Changed
- The HTTP engine now uses Electron's `net.fetch` (Chromium network stack) so it
  honours the session proxy and cookie jar, and captures response headers.
- **Downloads UX**: removed the redundant "Download files / assets" master
  checkbox — downloads now happen when **any** file-type category is selected.
  Added the **"⭐ All"** toggle that selects/clears every type.
- Asset downloads check `Content-Length` first and skip oversize files before
  transferring the body.

### Fixed
- Two competing "select all" controls in the Downloads panel (the master toggle
  and the All chip) collapsed into one clear model.

## [1.0.0] — 2026-06-14

### Added
- **Initial release.** Cross-platform Electron desktop crawler.
- **Crawl engine** (`CrawlEngine`): worker-pool concurrency, BFS/DFS frontier,
  per-host polite rate limiting with jitter and robots `Crawl-delay`, retries
  with exponential backoff, pause/resume/stop.
- **Three fetch modes** (`Fetcher`): HTTP, real-Chromium Browser rendering, and
  `Auto` with automatic escalation when a bot wall / challenge / empty shell is
  detected.
- **Reusable render-window pool**: render windows are pooled and navigated
  rather than created/destroyed per page — faster, and fixes a native crash that
  occurred when spinning BrowserWindows up and down rapidly.
- **Ad / tracker blocker**: cancels cookie-sync, ad, and analytics requests
  during rendering (faster, quieter, less bandwidth). Toggleable.
- **robots.txt** support (`RobotsManager`): group selection, Allow/Disallow with
  wildcards + `$` + longest-match precedence, `Crawl-delay`, `Sitemap`.
- **Scope control**: page / path / domain / subdomain / all.
- **Filters**: include/exclude regex, depth & page caps.
- **Sitemap discovery** including nested sitemap indexes.
- **Asset extraction & download** (`Parser`, `Downloader`): images, media,
  documents, archives, fonts, styles, scripts, data; `srcset`, `<source>`,
  lazy-load attributes, inline CSS `url()`, `<link>` resources; max file-size
  guard; bounded download concurrency; optional full HTML mirror.
- **Stealth toolbox**: user-agent pool + rotation, custom cookie / headers /
  Accept-Language, wait-for-selector, auto-scroll, configurable render settle,
  ad/tracker blocking.
- **Dashboard UI**: live stats, Pages/Assets/Errors tables, live log, progress.
- **First-launch consent gate**: a Terms of Use & Disclaimer modal (educational
  purpose, MIT/no-warranty, liability disclaimer, acceptable-use) that must be
  accepted before use; re-openable via the "Terms" link. See `DISCLAIMER.md`.
- **Collapsible config sections** so the sidebar stays compact.
- **"All" toggle** for download categories (selects/clears every file type).
- **Required output folder**: the app won't start until you choose where to save
  (auto-prompts the folder picker).
- **Config lock**: the whole settings panel is visibly locked while a crawl runs.
- **Exporters**: JSON, CSV, NDJSON, plus per-session `data/*.json` artifacts.
- **Tests**: `npm test` (pure-module unit smoke test) and `npm run test:crawl`
  (live Electron integration crawl).
- Project governance: `GRAND_RULES.md`, `memory-bank/`, MIT license.

### Verified
- End-to-end live crawl of the Blood Brothers Fandom wiki: HTTP returns 403, Auto
  mode escalates to Chromium render (200 OK), links + assets extracted, and 639
  images (~31 MB) downloaded to a tidy on-disk mirror. 36/36 unit assertions pass.
