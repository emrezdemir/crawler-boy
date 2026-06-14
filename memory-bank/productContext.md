# Product Context

## Who it's for

- Researchers, archivists, and hobbyists who want a local offline copy of a site
  (e.g. a game wiki) or a specific set of its assets.
- Developers and white-hat security folks doing authorized site mapping / audits.
- Anyone who hit "this site won't crawl" with normal tools.

## The experience we want

1. **Paste a URL, press Start, watch it work.** Sensible defaults mean a novice
   gets a good crawl without touching the advanced options.
2. **Power when you need it.** Scope, depth, filters, stealth, render tuning, and
   per-file-type download control are all there, grouped and out of the way.
3. **Transparency.** Live stats and a log show exactly what's happening:
   what's queued, what got crawled, what was blocked, what escalated to the
   browser engine, and where files landed.
4. **Trust.** Ethical defaults (respect robots.txt, polite delays) and clear
   responsible-use guidance. The tool nudges toward good behaviour.

## Key UX decisions

- **Auto mode is the default** so users don't need to know *why* a site blocks
  them — CrawlerBoy figures out when to render in a real browser.
- **One crawl at a time** keeps the model simple and resource use predictable.
- **Downloads are opt-in** and per-category, so a "just map the site" crawl stays
  light, while "grab all the images" is one checkbox away.
- **Everything is saved to a per-session folder** automatically; export buttons
  are for convenience, not the only way to keep results.
- **Config panel is collapsible sections (①–⑥)** ordered from most to least
  commonly touched: Target → Engine → Scope → Downloads → Stealth → Output.

## What "good" looks like for the user

> "I pasted the Fandom URL, picked Images, and pressed Start. Two minutes later I
> had the whole wiki's pages mapped and every unit image in a tidy folder."
