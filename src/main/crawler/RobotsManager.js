'use strict';

const { URL } = require('url');

/**
 * RobotsManager — fetches, caches, and evaluates robots.txt per host.
 *
 * Implements the core of the Robots Exclusion Protocol:
 *   - Picks the most specific matching user-agent group (falls back to '*').
 *   - Honours Allow / Disallow with longest-match-wins precedence.
 *   - Supports '*' wildcards and '$' end-anchors in paths.
 *   - Extracts Sitemap: directives and Crawl-delay.
 *
 * White-hat note: this is enabled by default. The operator may disable it for
 * sites they own or are explicitly authorized to test (see GRAND_RULES.md).
 */
class RobotsManager {
  /**
   * @param {object} opts
   * @param {boolean} opts.respect    - when false, everything is allowed.
   * @param {string}  opts.userAgent  - UA token to match groups against.
   * @param {Function} opts.fetchText - async (url) => string|null, fetches text.
   */
  constructor({ respect = true, userAgent = 'CrawlerBoy', fetchText }) {
    this.respect = respect;
    this.userAgent = (userAgent || 'CrawlerBoy').toLowerCase();
    this.fetchText = fetchText;
    this.cache = new Map(); // host -> parsed rules
    this.inflight = new Map(); // host -> Promise
  }

  async _getRules(host, origin) {
    if (this.cache.has(host)) return this.cache.get(host);
    if (this.inflight.has(host)) return this.inflight.get(host);

    const p = (async () => {
      let parsed = { groups: [], sitemaps: [] };
      try {
        const text = await this.fetchText(`${origin}/robots.txt`);
        if (text) parsed = this._parse(text);
      } catch {
        /* No robots.txt or fetch failed → treat as allow-all. */
      }
      this.cache.set(host, parsed);
      this.inflight.delete(host);
      return parsed;
    })();

    this.inflight.set(host, p);
    return p;
  }

  _parse(text) {
    const groups = [];
    const sitemaps = [];
    let current = null;
    let lastWasAgent = false;

    for (let line of text.split(/\r?\n/)) {
      line = line.replace(/#.*$/, '').trim();
      if (!line) continue;
      const idx = line.indexOf(':');
      if (idx === -1) continue;
      const field = line.slice(0, idx).trim().toLowerCase();
      const value = line.slice(idx + 1).trim();

      if (field === 'user-agent') {
        if (!lastWasAgent || !current) {
          current = { agents: [], rules: [], crawlDelay: null };
          groups.push(current);
        }
        current.agents.push(value.toLowerCase());
        lastWasAgent = true;
        continue;
      }
      lastWasAgent = false;
      if (!current && (field === 'allow' || field === 'disallow' || field === 'crawl-delay')) {
        current = { agents: ['*'], rules: [], crawlDelay: null };
        groups.push(current);
      }
      if (field === 'allow' || field === 'disallow') {
        if (value !== '' || field === 'disallow') {
          current.rules.push({ allow: field === 'allow', path: value });
        }
      } else if (field === 'crawl-delay') {
        const n = parseFloat(value);
        if (!Number.isNaN(n)) current.crawlDelay = n;
      } else if (field === 'sitemap') {
        sitemaps.push(value);
      }
    }
    return { groups, sitemaps };
  }

  _pickGroup(groups) {
    let best = null;
    let bestLen = -1;
    let star = null;
    for (const g of groups) {
      for (const agent of g.agents) {
        if (agent === '*') {
          star = star || g;
        } else if (this.userAgent.includes(agent) && agent.length > bestLen) {
          best = g;
          bestLen = agent.length;
        }
      }
    }
    return best || star || null;
  }

  _matches(rulePath, urlPath) {
    // Convert a robots path with * and $ into a regex.
    if (rulePath === '') return false;
    let re = '';
    for (let i = 0; i < rulePath.length; i++) {
      const c = rulePath[i];
      if (c === '*') re += '.*';
      else if (c === '$' && i === rulePath.length - 1) re += '$';
      else re += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    try {
      return new RegExp('^' + re).test(urlPath);
    } catch {
      return urlPath.startsWith(rulePath);
    }
  }

  /** @returns {Promise<boolean>} whether `url` is allowed to be fetched. */
  async isAllowed(url) {
    if (!this.respect) return true;
    let u;
    try {
      u = new URL(url);
    } catch {
      return false;
    }
    const rules = await this._getRules(u.host, u.origin);
    const group = this._pickGroup(rules.groups);
    if (!group || group.rules.length === 0) return true;

    const target = u.pathname + u.search;
    let decision = true; // allowed unless a longer Disallow wins
    let winningLen = -1;
    for (const rule of group.rules) {
      if (this._matches(rule.path, target)) {
        const len = rule.path.length;
        if (len > winningLen) {
          winningLen = len;
          decision = rule.allow;
        }
      }
    }
    return decision;
  }

  /** @returns {Promise<number|null>} crawl-delay (seconds) for the matched group. */
  async crawlDelay(url) {
    if (!this.respect) return null;
    try {
      const u = new URL(url);
      const rules = await this._getRules(u.host, u.origin);
      const group = this._pickGroup(rules.groups);
      return group ? group.crawlDelay : null;
    } catch {
      return null;
    }
  }

  /** @returns {Promise<string[]>} sitemap URLs declared in robots.txt. */
  async sitemaps(url) {
    try {
      const u = new URL(url);
      const rules = await this._getRules(u.host, u.origin);
      return rules.sitemaps || [];
    } catch {
      return [];
    }
  }
}

module.exports = RobotsManager;
