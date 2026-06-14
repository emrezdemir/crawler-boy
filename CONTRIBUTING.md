# Contributing to CrawlerBoy

Thanks for your interest! CrawlerBoy is open source and contributions are welcome.

## Before you start

1. Read [`GRAND_RULES.md`](GRAND_RULES.md) — it governs both behaviour and code.
2. Skim the [`memory-bank/`](memory-bank/) to understand the architecture and the
   reasoning behind it. Start with `projectbrief.md` → `systemPatterns.md`.

## Dev setup

```bash
npm install
npm run dev      # launches with DevTools
```

## Project conventions

- **CommonJS**, no build step. Keep it that way unless there's a strong reason.
- **Cross-platform**: `path.join` everywhere; never hard-code path separators.
- **Minimal dependencies** (GRAND_RULES II.7). Justify any new runtime dep in
  your PR.
- **Crawler core stays Electron-free** except `Fetcher` (which requires Electron
  lazily). Don't import `electron` elsewhere under `src/main/crawler/`.
- **Fail soft**: never let one bad URL/page crash a crawl.
- Match the surrounding code style (naming, comment density, idioms).

## Submitting changes

1. Branch off `main`.
2. Make the change. Update:
   - `CHANGELOG.md` under `[Unreleased]` for any user-facing change.
   - `memory-bank/activeContext.md` and `progress.md` for anything significant.
   - `memory-bank/systemPatterns.md` when you make an architectural decision.
3. Manually verify a crawl still works (e.g. the Fandom example).
4. Open a PR describing **what** and **why**.

## Reporting bugs / requesting features

Open an issue with:
- For bugs: the target URL (if shareable), config used, and the log output.
- For features: the use case and how it fits the Grand Rules.

## Responsible disclosure

If you find a security issue in CrawlerBoy itself, please report it privately
first rather than opening a public issue.
