# Project Brief

## What is CrawlerBoy?

A cross-platform **desktop web crawler and site downloader** built with Electron.
It runs on Windows, macOS, and Linux from a single codebase.

## The core problem it solves

Conventional crawlers (`curl`, `wget`, simple scripts) fail on modern sites:
- Content is rendered client-side by JavaScript.
- CDNs / WAFs (Cloudflare, Fastly) block non-browser HTTP clients with
  challenge pages.

The original motivating target was the **Blood Brothers Fandom wiki**
(`https://bloodbrothersgame.fandom.com/wiki/Blood_Brothers_Wiki`), which resists
naive crawling.

## The key insight

Because the app **is** an Electron/Chromium application, it can render any page in
a real browser engine — running the site's JS and defeating most "is this a bot?"
gates. CrawlerBoy uses this as an automatic fallback (`Auto` mode): fast HTTP
first, real-browser rendering when blocked.

## Goals

1. Crawl *any* website deeply and reliably, including JS-heavy/bot-protected ones.
2. Optionally download selected file types (images, media, docs, …) from a site.
3. Be genuinely cross-platform (Windows + macOS are first-class).
4. Ship as a polished, **open-source** project with strong docs and governance.
5. Stay a **white-hat** tool: ethical defaults, responsible-use guardrails.

## Non-goals

- Not a DoS / stress-testing tool.
- Not an authentication-bypass or paywall-circumvention tool.
- Not a personal-data harvesting tool.

## Success criteria

- Successfully crawls the Blood Brothers wiki and downloads its images.
- One-command run (`npm start`) and one-command packaged builds per OS.
- Clear README, GRAND_RULES, CHANGELOG, and this memory bank.
