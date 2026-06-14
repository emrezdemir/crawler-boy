'use strict';

const { EventEmitter } = require('events');
const { URL } = require('url');

const Frontier = require('./Frontier');
const RobotsManager = require('./RobotsManager');
const Downloader = require('./Downloader');
const { Fetcher } = require('./Fetcher');
const { parse } = require('./Parser');
const { extractIntel, auditSecurity } = require('./Recon');
const AnalyzerPool = require('./AnalyzerPool');
const {
  sleep,
  normalizeUrl,
  inScope,
  compilePatterns,
  formatBytes,
  isTracker,
} = require('./utils');

// Small counting semaphore for bounding concurrent asset downloads.
class Pool {
  constructor(max) {
    this.max = Math.max(1, max | 0);
    this.n = 0;
    this.q = [];
  }
  async run(fn) {
    if (this.n >= this.max) await new Promise((r) => this.q.push(r));
    this.n++;
    try {
      return await fn();
    } finally {
      this.n--;
      const next = this.q.shift();
      if (next) next();
    }
  }
}

/** Mask a secret value for display/logging while keeping it recognizable. */
function maskSecret(v) {
  const s = String(v);
  return s.length > 10 ? `${s.slice(0, 4)}…${s.slice(-3)}` : '***';
}

/**
 * CrawlEngine — the orchestrator. Drives a worker pool over the URL frontier,
 * applying scope / robots / pattern filters, rendering each page, extracting
 * links + assets, downloading enabled file types, and emitting live events.
 *
 * Events: 'started' | 'log' | 'page' | 'asset' | 'stats' | 'error'
 *         | 'intel' | 'state' | 'done'
 */
class CrawlEngine extends EventEmitter {
  constructor(config) {
    super();
    this.config = config;
    this.state = 'idle'; // idle | running | paused | stopping | stopped | done
    this.startedAt = 0;

    this.frontier = new Frontier({ order: config.order || 'bfs' });
    this.fetcher = new Fetcher(config);
    this.robots = new RobotsManager({
      respect: config.respectRobots !== false,
      userAgent: config.robotsUserAgent || 'CrawlerBoy',
      fetchText: (u) => this.fetcher.fetchText(u),
    });
    this.downloader = new Downloader({
      sessionDir: config.sessionDir,
      fetcher: this.fetcher,
      categories: new Set(config.categories || []),
      maxFileSize: config.maxFileSize || 0,
      savePages: !!config.savePages,
    });

    this.include = compilePatterns(config.includePatterns);
    this.exclude = compilePatterns(config.excludePatterns);
    this.assetPool = new Pool(config.assetConcurrency || 4);
    // Parse + recon run in worker threads so the main process (and the UI) stay
    // responsive even on big, JS-heavy pages.
    this.analyzer = new AnalyzerPool({ size: config.analyzerThreads });

    this.seeds = (config.seedUrls && config.seedUrls.length
      ? config.seedUrls
      : [config.seedUrl]
    )
      .map((u) => normalizeUrl(u))
      .filter(Boolean);

    this.hostNext = new Map(); // host -> next allowed request time
    this.hostCrawlDelay = new Map(); // host -> robots crawl-delay (ms)
    this.active = 0;

    // Result accumulators.
    this.pages = [];
    this.assetRecords = [];
    this.errors = [];
    this.hosts = new Set();
    this.security = []; // per-page security audit records
    this.intel = {
      emails: new Set(),
      phones: new Set(),
      socials: new Set(),
      endpoints: new Set(),
      secrets: [], // {type, value, page}
      comments: [], // {comment, page}
    };
    this.stats = {
      crawled: 0,
      queued: 0,
      errors: 0,
      downloaded: 0,
      downloadedBytes: 0,
      pageBytes: 0,
      active: 0,
      escalated: 0,
      blockedByRobots: 0,
      outOfScope: 0,
      filtered: 0,
      forms: 0,
      secrets: 0,
      emails: 0,
      elapsedMs: 0,
    };
  }

  log(message, level = 'info') {
    this.emit('log', { level, message, ts: Date.now() });
  }

  _emitStats() {
    this.stats.queued = this.frontier.size;
    this.stats.active = this.active;
    this.stats.elapsedMs = this.startedAt ? Date.now() - this.startedAt : 0;
    this.emit('stats', { ...this.stats });
  }

  // ---- lifecycle ----

  async start() {
    if (this.state === 'running') return;
    this.state = 'running';
    this.startedAt = Date.now();
    await this.downloader.init();

    for (const seed of this.seeds) this.frontier.add(seed, 0, null);
    this.emit('started', { seeds: this.seeds, config: this._publicConfig() });
    this.log(`Crawl started — ${this.seeds.length} seed(s), mode=${this.config.mode}, scope=${this.config.scope}`);

    if (this.config.followSitemaps) {
      for (const seed of this.seeds) await this._loadSitemaps(seed);
    }

    this._statsTimer = setInterval(() => this._emitStats(), 400);

    const workerCount = Math.max(1, this.config.concurrency || 4);
    const workers = [];
    for (let i = 0; i < workerCount; i++) workers.push(this._worker(i));
    await Promise.all(workers);

    clearInterval(this._statsTimer);
    if (this.state !== 'stopped') this.state = 'done';
    await this._finalize();
  }

  pause() {
    if (this.state === 'running') {
      this.state = 'paused';
      this.emit('state', { state: 'paused' });
      this.log('Crawl paused.');
    }
  }

  resume() {
    if (this.state === 'paused') {
      this.state = 'running';
      this.emit('state', { state: 'running' });
      this.log('Crawl resumed.');
    }
  }

  stop() {
    if (['running', 'paused'].includes(this.state)) {
      this.state = 'stopped';
      this.emit('state', { state: 'stopped' });
      this.log('Stop requested — finishing in-flight requests…');
    }
  }

  _intelReport() {
    return {
      emails: [...this.intel.emails],
      phones: [...this.intel.phones],
      socials: [...this.intel.socials],
      endpoints: [...this.intel.endpoints],
      secrets: this.intel.secrets,
      comments: this.intel.comments,
    };
  }

  async _finalize() {
    this._emitStats();
    const intel = this._intelReport();
    const summary = {
      ...this.stats,
      seeds: this.seeds,
      hosts: [...this.hosts],
      finishedAt: Date.now(),
      state: this.state,
      humanBytes: formatBytes(this.stats.pageBytes + this.stats.downloadedBytes),
      intelCounts: {
        emails: intel.emails.length,
        phones: intel.phones.length,
        socials: intel.socials.length,
        endpoints: intel.endpoints.length,
        secrets: intel.secrets.length,
        comments: intel.comments.length,
      },
    };
    try {
      await this.downloader.writeResults({
        pages: this.pages,
        assets: this.assetRecords,
        errors: this.errors,
        intel,
        security: this.security,
        summary,
      });
    } catch (err) {
      this.log(`Failed to write results: ${err.message}`, 'error');
    }
    if (intel.secrets.length) {
      this.log(`Recon: ${intel.emails.length} email(s), ${intel.endpoints.length} endpoint(s), ${intel.secrets.length} potential secret(s).`, 'warn');
    }
    try {
      this.fetcher.dispose();
    } catch {
      /* ignore teardown errors */
    }
    try {
      await this.analyzer.destroy();
    } catch {
      /* ignore teardown errors */
    }
    this.log(
      `Done. Crawled ${this.stats.crawled} page(s), downloaded ${this.stats.downloaded} asset(s), ` +
        `${formatBytes(this.stats.pageBytes + this.stats.downloadedBytes)} total.`
    );
    this.emit('done', { summary, sessionDir: this.config.sessionDir });
  }

  // ---- worker loop ----

  async _worker() {
    while (true) {
      if (this.state === 'stopped') return;
      if (this.state === 'paused') {
        await sleep(150);
        continue;
      }
      if (this.config.maxPages && this.stats.crawled >= this.config.maxPages) {
        return;
      }
      const item = this.frontier.next();
      if (!item) {
        if (this.active === 0) return; // frontier drained and nothing in flight
        await sleep(80);
        continue;
      }
      this.active++;
      try {
        await this._process(item);
      } catch (err) {
        this._recordError(item.url, err.message, item.depth);
      } finally {
        this.active--;
      }
    }
  }

  // ---- per-URL processing ----

  async _throttle(host, url) {
    const base = this.config.delay || 0;
    // Robots crawl-delay overrides the configured delay when larger.
    let crawlDelayMs = this.hostCrawlDelay.get(host);
    if (crawlDelayMs === undefined) {
      const cd = await this.robots.crawlDelay(url);
      crawlDelayMs = cd ? cd * 1000 : 0;
      this.hostCrawlDelay.set(host, crawlDelayMs);
    }
    const delay = Math.max(base, crawlDelayMs);
    if (delay <= 0 && !this.config.jitter) return;
    const jitter = this.config.jitter ? Math.random() * Math.max(delay, 200) : 0;
    const now = Date.now();
    const prev = this.hostNext.get(host) || 0;
    const startAt = Math.max(now, prev);
    this.hostNext.set(host, startAt + delay + jitter);
    const wait = startAt - now;
    if (wait > 0) await sleep(wait);
  }

  _passesFilters(url) {
    if (this.exclude.some((re) => re.test(url))) return false;
    if (this.include.length && !this.include.some((re) => re.test(url))) return false;
    return true;
  }

  _mergeIntel(found, page, record) {
    const newRows = [];
    const addSet = (set, arr, kind, cap = Infinity) => {
      for (const v of arr) {
        if (set.size >= cap) break;
        if (!set.has(v)) {
          set.add(v);
          newRows.push({ kind, value: v, page });
        }
      }
    };
    addSet(this.intel.emails, found.emails, 'email');
    addSet(this.intel.phones, found.phones, 'phone');
    addSet(this.intel.socials, found.socials, 'social');
    addSet(this.intel.endpoints, found.endpoints, 'endpoint', 20000);
    for (const s of found.secrets) {
      if (this.intel.secrets.length >= 5000) break;
      this.intel.secrets.push({ ...s, page });
      newRows.push({ kind: 'secret', value: `[${s.type}] ${maskSecret(s.value)}`, page });
    }
    for (const c of found.comments) {
      if (this.intel.comments.length >= 5000) break;
      this.intel.comments.push({ comment: c, page });
    }
    this.stats.emails = this.intel.emails.size;
    this.stats.secrets = this.intel.secrets.length;
    record.intel = {
      emails: found.emails.length,
      secrets: found.secrets.length,
      endpoints: found.endpoints.length,
    };
    if (found.secrets.length) {
      this.log(`⚠ ${found.secrets.length} potential secret(s) found on ${page}`, 'warn');
    }
    if (newRows.length) this.emit('intel', { page, rows: newRows.slice(0, 200) });
  }

  async _process(item) {
    const { url, depth } = item;
    const seed = this.seeds[0];

    // Robots check (operator-controllable).
    const allowed = await this.robots.isAllowed(url);
    if (!allowed) {
      this.stats.blockedByRobots++;
      this.log(`robots.txt disallows ${url}`, 'warn');
      return;
    }

    let host;
    try {
      host = new URL(url).host;
    } catch {
      return;
    }
    await this._throttle(host, url);

    if (this.state === 'stopped') return;

    const t0 = Date.now();
    const result = await this._fetchWithRetry(url);
    const tookMs = Date.now() - t0;

    if (result.escalated) this.stats.escalated++;

    if (!result.ok && !result.html) {
      this._recordError(url, result.error || `HTTP ${result.status}`, depth);
      return;
    }

    const finalUrl = normalizeUrl(result.finalUrl) || url;
    let parsed = { meta: {}, links: [], assets: [], forms: [] };
    let intelResult = null;
    let securityResult = null;
    const isHtml = /html|xml/i.test(result.contentType) || !result.contentType;
    if (isHtml && result.html) {
      const wantIntel = !!this.config.extractIntel;
      const wantAudit = !!this.config.auditSecurity;
      try {
        // Off-thread parse + recon keeps the main process responsive.
        const a = await this.analyzer.analyze(result.html, finalUrl, {
          intel: wantIntel,
          audit: wantAudit,
          headers: result.headers || {},
        });
        parsed = { meta: a.meta, links: a.links, assets: a.assets, forms: a.forms || [] };
        intelResult = a.intel || null;
        securityResult = a.security || null;
      } catch (err) {
        // Fallback: parse inline so a worker hiccup never drops a page.
        parsed = parse(result.html, finalUrl);
        if (wantIntel) intelResult = extractIntel(result.html, parsed.links);
        if (wantAudit) securityResult = auditSecurity(result.headers || {}, parsed.meta, finalUrl, result.html);
      }
    }

    const pageBytes = result.html ? Buffer.byteLength(result.html) : 0;
    this.stats.pageBytes += pageBytes;
    this.stats.crawled++;

    // Persist HTML mirror.
    await this.downloader.savePage(finalUrl, result.html);

    const record = {
      url,
      finalUrl,
      status: result.status,
      depth,
      contentType: result.contentType,
      bytes: pageBytes,
      tookMs,
      renderedWith: result.renderedWith + (result.escalated ? '+esc' : ''),
      meta: parsed.meta,
      links: [],
      assets: parsed.assets.map((a) => ({ url: a.url, type: a.type })),
      crawledAt: Date.now(),
    };

    // Enqueue in-scope, filtered, depth-limited links.
    const nofollow =
      this.config.respectRobots !== false &&
      /nofollow/i.test(parsed.meta.robotsMeta || '');
    const inScopeLinks = [];
    if (!nofollow) {
      for (const link of parsed.links) {
        if (!inScope(link, seed, this.config.scope)) {
          this.stats.outOfScope++;
          continue;
        }
        inScopeLinks.push(link);
        const withinDepth =
          this.config.maxDepth === 0 || depth + 1 <= this.config.maxDepth;
        if (!withinDepth) continue;
        if (this.frontier.has(link)) continue;
        if (!this._passesFilters(link)) {
          this.stats.filtered++;
          continue;
        }
        this.frontier.add(link, depth + 1, url);
      }
    }
    record.links = inScopeLinks;
    record.forms = parsed.forms;
    this.stats.forms += parsed.forms.length;
    this.hosts.add(host);

    // Passive recon — merge the worker-computed intel / audit (opt-in).
    if (intelResult) {
      this._mergeIntel(intelResult, finalUrl, record);
    }
    if (securityResult) {
      this.security.push(securityResult);
      record.security = {
        missing: securityResult.missingHeaders,
        tech: securityResult.tech,
        cookieIssues: securityResult.cookieIssues,
      };
    }

    this.pages.push(record);
    this.emit('page', record);

    // Download assets (if enabled) with bounded concurrency.
    if (this.config.downloadAssets && parsed.assets.length) {
      await this._downloadAssets(parsed.assets, url);
    }
  }

  async _fetchWithRetry(url) {
    const maxRetries = this.config.maxRetries ?? 2;
    let last = null;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (this.state === 'stopped') break;
      const result = await this.fetcher.fetchPage(url);
      last = result;
      const retryable =
        !result.ok && [0, 429, 500, 502, 503, 504].includes(result.status);
      if (result.ok || result.html || !retryable) return result;
      const backoff = Math.min(8000, 500 * Math.pow(2, attempt)) + Math.random() * 300;
      this.log(`Retry ${attempt + 1}/${maxRetries} for ${url} (status ${result.status})`, 'warn');
      await sleep(backoff);
    }
    return last;
  }

  async _downloadAssets(assets, fromPage) {
    const blockTrackers = this.config.blockTrackers !== false;
    const wanted = assets.filter(
      (a) => this.downloader.wantsCategory(a.type) && !(blockTrackers && isTracker(a.url))
    );
    await Promise.all(
      wanted.map((asset) =>
        this.assetPool.run(async () => {
          if (this.state === 'stopped') return;
          const res = await this.downloader.downloadAsset(asset);
          if (res.status === 'ok') {
            this.stats.downloaded++;
            this.stats.downloadedBytes += res.bytes || 0;
            const rec = {
              url: asset.url,
              type: asset.type,
              bytes: res.bytes,
              fromPage,
              path: res.path,
            };
            this.assetRecords.push(rec);
            this.emit('asset', rec);
          } else if (res.status === 'error') {
            this._recordError(asset.url, `asset: ${res.reason}`, -1);
          }
        })
      )
    );
  }

  _recordError(url, message, depth) {
    this.stats.errors++;
    const rec = { url, message, depth, ts: Date.now() };
    this.errors.push(rec);
    this.emit('error', rec);
    this.log(`Error: ${url} — ${message}`, 'error');
  }

  // ---- sitemaps ----

  async _loadSitemaps(seed) {
    try {
      const fromRobots = await this.robots.sitemaps(seed);
      const origin = new URL(seed).origin;
      const candidates = new Set([...fromRobots, `${origin}/sitemap.xml`]);
      let added = 0;
      for (const sm of candidates) {
        added += await this._ingestSitemap(sm, 0);
        if (added > 5000) break; // safety cap
      }
      if (added) this.log(`Sitemap discovery added ${added} URL(s).`);
    } catch (err) {
      this.log(`Sitemap discovery skipped: ${err.message}`, 'warn');
    }
  }

  async _ingestSitemap(sitemapUrl, depth) {
    if (depth > 3) return 0;
    const xml = await this.fetcher.fetchText(sitemapUrl);
    if (!xml) return 0;
    const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]);
    let added = 0;
    const isIndex = /<sitemapindex/i.test(xml);
    for (const loc of locs) {
      if (isIndex) {
        added += await this._ingestSitemap(loc, depth + 1);
      } else if (inScope(loc, this.seeds[0], this.config.scope) && this._passesFilters(loc)) {
        if (this.frontier.add(loc, 0, sitemapUrl)) added++;
      }
    }
    return added;
  }

  _publicConfig() {
    const { cookie, extraHeaders, ...safe } = this.config;
    return safe;
  }
}

module.exports = CrawlEngine;
