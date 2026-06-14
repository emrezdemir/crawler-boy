<div align="center">

# 🩸 CrawlerBoy

**A powerful, cross-platform desktop web crawler & site downloader.**
Built with Electron — crawls even JavaScript-heavy, bot-protected sites by rendering them in a real Chromium engine.

[![License: MIT](https://img.shields.io/badge/License-MIT-e5484d.svg)](LICENSE)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-2f81f7)
![Electron](https://img.shields.io/badge/Electron-33-3fb950)

</div>

---

## Why CrawlerBoy?

Most crawlers fail on modern sites: content is rendered by JavaScript, and CDNs
(Cloudflare, Fastly, etc.) block plain HTTP clients with "are you a bot?" gates —
so `curl`, `wget`, or a simple script often get an empty page or a `403`.

CrawlerBoy solves this by **being a real browser**. When a page looks blocked or
empty, it transparently renders the URL in a hidden Chromium window, runs the
site's JavaScript, and reads back the fully-built DOM — exactly what a human
would see.

> ⚠️ **For educational use.** Only crawl sites you own or are authorized to
> access. Please read the [Disclaimer & Terms of Use](DISCLAIMER.md) and the
> [Grand Rules](GRAND_RULES.md) first.

## ✨ Features

### Crawl engine
- **Three fetch modes**
  - `HTTP` — fast `fetch()` for static pages and APIs.
  - `Browser` — full Chromium rendering for JS-heavy SPAs.
  - `Auto` — tries HTTP first, **auto-escalates to the browser** when it detects
    a bot wall, challenge page, or empty JS shell.
- **Breadth-first or depth-first** traversal with a de-duplicating URL frontier.
- **Scope control**: single page, under-path, same domain, domain + subdomains,
  or the entire web.
- **Depth & page limits**, include/exclude **regex filters**.
- **Concurrency** with a worker pool and **polite per-host rate limiting**
  (configurable delay + jitter, honours robots `Crawl-delay`).
- **robots.txt** parsing (Allow/Disallow, wildcards, `$`, longest-match) —
  respected by default, toggleable for authorized testing.
- **Sitemap discovery** (`robots.txt` + `/sitemap.xml`, nested indexes).
- **Retries** with exponential backoff for transient failures.

### Downloading
- Selectively download **images, media, documents, archives, CSS, JS, fonts, data**.
- Exhaustive asset extraction: `src`, `srcset`, `<source>`, `<video>`/`<audio>`,
  lazy-load `data-src`, inline CSS `url()`, `<link>` resources.
- **Max file-size** guard and bounded download concurrency.
- Optional **full HTML mirror** for offline browsing.
- Mirrors the site's path structure on disk.

### Stealth & rendering (white-hat toolbox)
- Built-in **user-agent pool** with optional rotation.
- Custom **cookie**, **Accept-Language**, and extra headers.
- **Wait-for-selector** and **auto-scroll** to trigger lazy content.
- **Ad / tracker blocking** during render — faster, quieter, less bandwidth.
- **Pooled render windows** (reused, not recreated) — stable and fast.
- Configurable render settle time and parallel render windows.

### UX
- Live dashboard: crawled / queued / active / files / data / errors / escalations / elapsed.
- Sortable result tables (Pages, Assets, Errors) + live log.
- One-click **export** to JSON, CSV, or NDJSON.
- Results auto-saved per session (`crawl-data.json`, `assets.json`, `links.json`, `errors.json`).

## 🚀 Getting started

> Requires [Node.js](https://nodejs.org) 18+ (developed on Node 25).

```bash
git clone <your-repo-url> CrawlerBoy
cd CrawlerBoy
npm install
npm start
```

### Build installers

```bash
npm run dist:win     # Windows (NSIS installer + portable)
npm run dist:mac     # macOS (dmg + zip)
npm run dist:linux   # Linux (AppImage + deb)
```

Output lands in `release/`.

## 🧭 Example: crawling a JavaScript-heavy site you’re authorized to access

1. Paste the start URL into the **Target** card.
2. Mode `Auto`, Scope `Same domain`.
3. (Optional) Add **Include** / **Exclude** regex filters to focus the crawl and
   skip edit/login/meta pages.
4. (Optional) Open **④ Downloads**, tick **All** or a category (e.g. Images).
5. Choose an **⑥ Output** folder (required), then press **Start**.

When the site blocks plain HTTP, Auto mode renders the page in Chromium, so the
fully-built content comes through.

## 📂 Output layout

```
<output>/<session>/
├─ pages/      full HTML mirror (if enabled)
├─ assets/<category>/<host>/<path>   downloaded files
└─ data/
   ├─ crawl-data.json   pages + summary
   ├─ assets.json       downloaded files index
   ├─ links.json        page → outbound links graph
   └─ errors.json       failures
```

## 🛡️ Responsible use

CrawlerBoy is a **white-hat**, **educational** tool. Read
[`DISCLAIMER.md`](DISCLAIMER.md) and [`GRAND_RULES.md`](GRAND_RULES.md) before
pointing it at anything. In short: respect `robots.txt`, throttle your requests,
only crawl what you’re authorized to, and never use it to overwhelm a service or
harvest personal data. The app shows these terms on first launch and requires
acceptance.

## 🗂️ Project docs

- [`DISCLAIMER.md`](DISCLAIMER.md) — terms of use, educational purpose, liability.
- [`GRAND_RULES.md`](GRAND_RULES.md) — the non-negotiable principles.
- [`CHANGELOG.md`](CHANGELOG.md) — version history.
- [`memory-bank/`](memory-bank/) — the project's living design memory.
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — how to contribute.

## 🏗️ Architecture

```
src/
├─ main/
│  ├─ main.js              Electron entry, window, IPC
│  ├─ preload.js           secure contextBridge API
│  └─ crawler/
│     ├─ CrawlEngine.js    orchestrator (worker pool, throttling, events)
│     ├─ Fetcher.js        HTTP + Chromium render + auto-escalation
│     ├─ Parser.js         link & asset extraction (cheerio)
│     ├─ Frontier.js       URL queue + visited set
│     ├─ RobotsManager.js  robots.txt fetch/parse/evaluate
│     ├─ Downloader.js     disk layout, asset/page saving, exporters
│     └─ utils.js          URL normalization, scope, file-type maps
└─ renderer/
   ├─ index.html / styles.css / renderer.js   the dashboard UI
```

## 📜 License

MIT © 2026 — see [LICENSE](LICENSE).
