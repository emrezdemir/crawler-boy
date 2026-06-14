# Active Context

_Last updated: 2026-06-14_

## Current focus

**v1.0.0 — initial build complete.** The full crawler app exists end to end:
engine, fetcher (HTTP/browser/auto), robots, parser, downloader, IPC, and the
dashboard UI. Documentation and governance are in place.

## What just happened

- Built the entire `src/main/crawler/` engine and `Fetcher` with auto-escalation
  to a real Chromium render for bot-protected / JS sites.
- Built the Electron shell (`main.js`, `preload.js`) and the dashboard renderer.
- Wrote README, CHANGELOG, GRAND_RULES, CONTRIBUTING, and this memory bank.
- Generated the app icon with a dependency-free PNG writer.
- **Verified end-to-end** against the Blood Brothers Fandom wiki: HTTP 403 →
  Auto-escalated browser render 200 OK; 639 images (~31 MB) downloaded. `npm test`
  green (36/36).
- **Fixed a native crash** by reusing pooled render windows instead of
  create/destroy-per-page (see `Fetcher` window pool in systemPatterns).
- **Added an ad/tracker blocker** to the render session.

## Immediate next steps

1. Interactive GUI smoke test (`npm start`) — confirm the dashboard drives a crawl.
2. (User) Initialize git and push to GitHub. Update `GITHUB_URL` in
   `src/renderer/renderer.js` and the badge/clone URLs in `README.md`.
3. Optional: produce platform icons and run `npm run dist:*` to build installers.

## Open questions / decisions pending

- Should pause persist the frontier so crawls survive an app restart? (Backlog.)
- Proxy support: needed for the first release or post-1.0? (Currently post-1.0.)

## Watch-outs for the next session

- Verify Fandom's `did-navigate` status capture works (some redirects fire -3).
- Confirm `images:false` in render windows doesn't hide content that only loads
  via image-triggered lazy logic (rare; `scrollToBottom` mitigates).
