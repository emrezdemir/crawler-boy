# Changelog

All notable changes to CrawlerBoy are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Planned
- Pause/resume that persists the frontier to disk (resumable crawls across restarts).
- Proxy support (HTTP/SOCKS) and per-request proxy rotation.
- Visual link-graph explorer.
- Screenshot capture per page.
- Plugin/hook system for custom extractors.
- Scheduling (cron-style recurring crawls).

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
