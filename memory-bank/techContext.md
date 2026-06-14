# Tech Context

## Stack

| Layer        | Choice                                   | Why |
|--------------|------------------------------------------|-----|
| Shell        | **Electron 33**                          | One codebase → Windows/macOS/Linux; gives us a real Chromium to render with. |
| Language     | Node.js (CommonJS)                       | No build step; runs as-is. Developed on Node 25. |
| HTML parsing | **cheerio 1.x**                          | jQuery-like, fast, the only runtime dependency. |
| HTTP         | Global `fetch` (Node/Electron built-in)  | No axios needed. |
| Rendering    | Electron `BrowserWindow` (hidden)        | Real JS execution; defeats bot walls. |
| Packaging    | **electron-builder**                     | NSIS/portable, dmg/zip, AppImage/deb. |
| UI           | Vanilla HTML/CSS/JS                      | No framework; small, fast, zero churn. |

## Why so few dependencies

GRAND_RULES Part II.7: every dep is a liability. Runtime deps = `cheerio` only.
robots.txt parsing, the URL frontier, rate limiting, the PNG icon generator, and
exporters are all hand-rolled with the standard library.

## Project layout

```
CrawlerBoy/
├─ package.json            scripts + electron-builder config
├─ assets/                 icon.png (+ generate-icon.js, dependency-free)
├─ src/
│  ├─ main/                main.js, preload.js, crawler/* (incl. Recon.js)
│  └─ renderer/            index.html, styles.css, renderer.js
├─ memory-bank/            this folder
├─ README.md  CHANGELOG.md  GRAND_RULES.md  CONTRIBUTING.md  LICENSE
└─ .gitignore
```

## Dev setup

```bash
npm install      # also runs electron-builder install-app-deps (postinstall)
npm start        # launch
npm run dev      # launch with DevTools detached
npm run dist:win # / dist:mac / dist:linux → release/
node assets/generate-icon.js   # regenerate the icon
```

## Constraints & gotchas

- **Cross-platform paths**: always `path.join`; never hard-code `/` or `\`.
- **`Date.now()` / `Math.random()`** are fine at app runtime (only forbidden
  inside Workflow orchestration scripts, which this project doesn't use).
- **BrowserWindow cost**: rendering windows are heavy. They're capped by a
  semaphore (`renderConcurrency`, default 2) and destroyed after each fetch.
- **HTTP status in browser mode**: captured via the `did-navigate` event's
  `httpResponseCode`, since `BrowserWindow` doesn't expose it directly.
- **Cookies**: HTTP mode uses a static `Cookie` header; browser mode persists
  cookies in the `persist:crawlerboy` session partition.

## External references

- Original target: `https://bloodbrothersgame.fandom.com/wiki/Blood_Brothers_Wiki`
- Robots Exclusion Protocol, electron-builder docs, cheerio docs.
