# 📜 The Grand Rules of CrawlerBoy

These are the non-negotiable principles that govern this project — both how the
**software behaves** and how the **codebase evolves**. Think of them as the
constitution. Every feature, PR, and crawl must honour them.

---

## Part I — Ethics of crawling (the white-hat creed)

CrawlerBoy is a sharp tool. Sharp tools demand discipline.

1. **Authorization first.** Only crawl sites you own, have permission to test, or
   that explicitly permit crawling. When in doubt, don't.
2. **Respect `robots.txt` by default.** The toggle to ignore it exists *only* for
   sites you are authorized to test. The default ships **on**.
3. **Be polite, not a flood.** Keep a sane per-host delay. The goal is to read a
   site, never to degrade it. Rate limiting is a feature, not an obstacle.
4. **Identify honestly when asked.** Don't impersonate a specific person or forge
   ownership. The UA pool exists for compatibility, not deception of operators.
5. **No personal-data harvesting.** Don't use CrawlerBoy to scrape and
   aggregate personal information about individuals.
6. **Obey the law and the Terms of Service** of the sites you visit. The
   responsibility is the operator's, not the tool's.
7. **Stop when asked.** Honour `429`/`503` backoff, `Crawl-delay`, and a site's
   clear signals that you should slow down or stop.

> CrawlerBoy will never include features whose *primary* purpose is to evade
> rate limits maliciously, break authentication, or conduct denial-of-service.
> Rendering JavaScript and rotating user agents are about **compatibility**, so
> that legitimately public content is actually reachable.

## Part II — Engineering principles

1. **Security by construction.** The renderer is sandboxed, `contextIsolation`
   is on, `nodeIntegration` is off. All privileged work happens in the main
   process and crosses the boundary only through the explicit `preload` bridge.
2. **The crawler core is pure-ish and portable.** Modules under
   `src/main/crawler/` avoid UI assumptions. `Fetcher` is the *only* place that
   touches Electron, and it requires it lazily — so the engine stays testable.
3. **Small, single-responsibility modules.** Frontier queues. Robots evaluates.
   Parser extracts. Downloader persists. Engine orchestrates. Keep it that way.
4. **No silent truncation.** If a limit drops data (max pages, max file size,
   table row cap), surface it in stats or the log. Never imply full coverage you
   didn't deliver.
5. **Events over coupling.** The engine emits; the IPC layer forwards; the UI
   renders. Components don't reach into each other.
6. **Cross-platform always.** Use `path.join`, never hard-code separators.
   Test (or reason about) both Windows and macOS paths. No POSIX-only calls.
7. **Minimal dependencies.** Every dependency is a liability. Prefer the standard
   library and small, audited packages. Today the only runtime dep is `cheerio`.
8. **Fail soft.** A single bad URL, malformed HTML, or missing `robots.txt` must
   never crash a crawl. Catch, record, continue.

## Part III — Project governance

1. **Update the memory bank.** Significant changes update `memory-bank/` —
   especially `activeContext.md` and `progress.md`. The memory bank is the
   project's source of truth across sessions.
2. **Keep the changelog honest.** Every user-facing change gets a `CHANGELOG.md`
   entry under `[Unreleased]` before release.
3. **Semantic versioning.** Breaking → major, feature → minor, fix → patch.
4. **Document the "why."** Code says what; comments and the memory bank say why.
5. **No secrets in the repo.** Cookies, tokens, and crawl output stay out of git
   (see `.gitignore`).

---

*If a proposed change violates a Grand Rule, the change is wrong — not the rule.
Rules may be amended deliberately via PR, never bypassed silently.*
