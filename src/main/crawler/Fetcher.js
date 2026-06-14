'use strict';

const { sleep } = require('./utils');

/**
 * Fetcher — the network layer with two engines and an auto-escalation strategy.
 *
 *   1. HTTP engine     — fast `fetch()` with custom headers / UA / cookies.
 *                        Great for static HTML, APIs, and raw asset downloads.
 *
 *   2. Browser engine  — renders the page in a real (hidden) Chromium
 *                        BrowserWindow, runs the site's JavaScript, then reads
 *                        back the fully-built DOM. This is what defeats
 *                        JS-rendered SPAs and many "are you a bot?" gates that
 *                        block plain HTTP clients (e.g. Fandom / Cloudflare).
 *
 *   3. 'auto'          — try HTTP first; if the response is blocked or looks
 *                        like a JS challenge / empty shell, transparently
 *                        retry the same URL through the Browser engine.
 *
 * `electron` is required lazily so the crawler core stays unit-testable.
 */

// A pool of believable desktop user agents for optional rotation.
const DEFAULT_UA_POOL = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
];

// Hostnames matching these tokens are ad / tracker / cookie-sync endpoints.
// Blocking them during render makes pages load faster and cleaner without
// touching real content. Toggle via config.blockTrackers (default on).
const TRACKER_RE = new RegExp(
  [
    'doubleclick', 'googlesyndication', 'google-analytics', 'googletagservices',
    'googletagmanager', 'adservice', 'adsystem', 'adnxs', 'criteo', 'pubmatic',
    'rubicon', 'openx', 'taboola', 'outbrain', 'scorecardresearch', 'quantserve',
    'moatads', 'adsrvr', '3lift', 'casalemedia', 'sharethrough', 'teads',
    'smartadserver', 'yieldmo', 'bidswitch', 'omnitag', 'smilewanted',
    'nextmillmedia', 'gammaplatform', 'unrulymedia', 'programmaticx', 'marphezis',
    'vidazoo', 'adyoulike', 'amazon-adsystem', 'indexww', 'bidder', 'prebid',
    'usersync', 'cookiesync', 'bsync', 'omnitagjs', 'demdex', 'crwdcntrl',
  ].join('|'),
  'i'
);

// Markers that strongly suggest an anti-bot interstitial or empty JS shell.
const CHALLENGE_MARKERS = [
  'just a moment',
  'checking your browser',
  'cf-browser-verification',
  'challenge-platform',
  'enable javascript and cookies',
  'please enable javascript',
  '/cdn-cgi/challenge',
  'ddos protection by',
  'attention required',
];

class Fetcher {
  constructor(config = {}) {
    this.config = config;
    this.timeout = config.timeout || 30000;
    this.settle = config.renderSettle ?? 1200; // ms to let JS settle after load
    // Render windows are POOLED and reused across fetches. Repeatedly creating
    // and destroying BrowserWindows is what crashed early builds, so instead we
    // keep up to `maxWindows` long-lived windows and navigate them.
    this.maxWindows = Math.max(1, config.renderConcurrency || 2);
    this._idle = []; // reusable windows ready for work
    this._allWindows = new Set(); // every live window we own
    this._winWaiters = []; // resolvers awaiting a free window
    this._winCount = 0;
    this.uaPool =
      Array.isArray(config.userAgents) && config.userAgents.length
        ? config.userAgents
        : config.userAgent
        ? [config.userAgent]
        : DEFAULT_UA_POOL;
    this.uaIndex = 0;
    this.partition = config.partition || 'persist:crawlerboy';
    this._electron = null;
    this._headersInstalled = false;
  }

  _ua() {
    if (!this.config.rotateUserAgent) return this.uaPool[0];
    const ua = this.uaPool[this.uaIndex % this.uaPool.length];
    this.uaIndex++;
    return ua;
  }

  _baseHeaders(ua) {
    const headers = {
      'User-Agent': ua,
      Accept:
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': this.config.acceptLanguage || 'en-US,en;q=0.9',
      'Upgrade-Insecure-Requests': '1',
    };
    if (this.config.cookie) headers.Cookie = this.config.cookie;
    if (this.config.referer) headers.Referer = this.config.referer;
    if (this.config.extraHeaders && typeof this.config.extraHeaders === 'object') {
      Object.assign(headers, this.config.extraHeaders);
    }
    return headers;
  }

  // ---------------------------------------------------------------------------
  // HTTP engine
  // ---------------------------------------------------------------------------

  async _httpFetch(url, { method = 'GET' } = {}) {
    const ua = this._ua();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);
    try {
      const res = await fetch(url, {
        method,
        headers: this._baseHeaders(ua),
        redirect: 'follow',
        signal: controller.signal,
      });
      return { res, ua };
    } finally {
      clearTimeout(timer);
    }
  }

  /** Fetch a page as HTML via HTTP. */
  async fetchPageHttp(url) {
    try {
      const { res } = await this._httpFetch(url);
      const contentType = res.headers.get('content-type') || '';
      const finalUrl = res.url || url;
      // Only read a body for HTML-ish responses.
      const isHtml = /html|xml|text/i.test(contentType) || contentType === '';
      const html = isHtml ? await res.text() : '';
      return {
        ok: res.ok,
        status: res.status,
        finalUrl,
        contentType,
        html,
        renderedWith: 'http',
      };
    } catch (err) {
      return {
        ok: false,
        status: 0,
        finalUrl: url,
        contentType: '',
        html: '',
        error: err.name === 'AbortError' ? 'timeout' : err.message,
        renderedWith: 'http',
      };
    }
  }

  /** Fetch arbitrary text (robots.txt, sitemaps). Returns string or null. */
  async fetchText(url) {
    try {
      const { res } = await this._httpFetch(url);
      if (!res.ok) return null;
      return await res.text();
    } catch {
      return null;
    }
  }

  /** Download a binary resource. Returns a Buffer payload + metadata. */
  async fetchBinary(url) {
    try {
      const { res } = await this._httpFetch(url);
      const contentType = res.headers.get('content-type') || '';
      const finalUrl = res.url || url;
      if (!res.ok) {
        return { ok: false, status: res.status, finalUrl, contentType, buffer: null };
      }
      const arr = await res.arrayBuffer();
      return {
        ok: true,
        status: res.status,
        finalUrl,
        contentType,
        buffer: Buffer.from(arr),
      };
    } catch (err) {
      return {
        ok: false,
        status: 0,
        finalUrl: url,
        contentType: '',
        buffer: null,
        error: err.name === 'AbortError' ? 'timeout' : err.message,
      };
    }
  }

  // ---------------------------------------------------------------------------
  // Browser engine (real Chromium)
  // ---------------------------------------------------------------------------

  _getElectron() {
    if (!this._electron) this._electron = require('electron');
    return this._electron;
  }

  _installHeaderHook() {
    if (this._headersInstalled) return;
    const { session } = this._getElectron();
    const ses = session.fromPartition(this.partition);

    // Block ad / tracker / cookie-sync requests during render (faster, quieter).
    if (this.config.blockTrackers !== false) {
      ses.webRequest.onBeforeRequest((details, cb) => {
        try {
          const host = new URL(details.url).hostname;
          if (TRACKER_RE.test(host)) return cb({ cancel: true });
        } catch {
          /* unparseable URL → let it through */
        }
        cb({});
      });
    }

    // Inject our custom headers (cookie, extra headers, language) into every
    // request made by the rendering window.
    ses.webRequest.onBeforeSendHeaders((details, cb) => {
      const h = details.requestHeaders;
      if (this.config.cookie && !h.Cookie) h.Cookie = this.config.cookie;
      if (this.config.acceptLanguage) h['Accept-Language'] = this.config.acceptLanguage;
      if (this.config.extraHeaders) {
        for (const [k, v] of Object.entries(this.config.extraHeaders)) h[k] = v;
      }
      cb({ requestHeaders: h });
    });
    this._headersInstalled = true;
  }

  // ---- window pool ----

  _createWindow() {
    const { BrowserWindow } = this._getElectron();
    this._installHeaderHook();
    const win = new BrowserWindow({
      show: false,
      width: 1280,
      height: 1024,
      webPreferences: {
        partition: this.partition,
        images: false, // we only need the DOM, not painted pixels → faster
        javascript: true,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    });
    win.webContents.setAudioMuted(true);
    win._status = { code: 0, text: '' };
    win._dead = false;
    // Persistent listener captures the main-frame HTTP status per navigation.
    win.webContents.on('did-navigate', (_e, _url, code, text) => {
      if (code) {
        win._status.code = code;
        win._status.text = text || '';
      }
    });
    // If a renderer process dies, retire the window instead of crashing.
    win.webContents.on('render-process-gone', () => {
      win._dead = true;
    });
    this._allWindows.add(win);
    this._winCount++;
    return win;
  }

  _destroyWindow(win) {
    if (this._allWindows.has(win)) {
      this._allWindows.delete(win);
      this._winCount--;
    }
    try {
      if (!win.isDestroyed()) win.destroy();
    } catch {
      /* already gone */
    }
  }

  async _acquireWindow() {
    while (this._idle.length) {
      const w = this._idle.pop();
      if (w && !w.isDestroyed() && !w._dead) return w;
      if (w) this._destroyWindow(w);
    }
    if (this._winCount < this.maxWindows) return this._createWindow();
    return new Promise((resolve) => this._winWaiters.push(resolve));
  }

  _releaseWindow(win) {
    const alive = win && !win.isDestroyed() && !win._dead;
    if (!alive && win) this._destroyWindow(win);
    const waiter = this._winWaiters.shift();
    if (!waiter) {
      if (alive) this._idle.push(win);
      return;
    }
    // Hand the waiter a healthy window: reuse this one, or mint a replacement
    // for the slot the dead one just vacated.
    waiter(alive ? win : this._winCount < this.maxWindows ? this._createWindow() : null);
  }

  async fetchPageBrowser(url) {
    const ua = this._ua();
    const win = await this._acquireWindow();
    if (!win) {
      return { ok: false, status: 0, finalUrl: url, contentType: '', html: '', error: 'no-window', renderedWith: 'browser' };
    }
    const wc = win.webContents;
    try {
      try {
        wc.setUserAgent(ua);
      } catch {
        /* setUserAgent unavailable */
      }
      win._status.code = 0;
      win._status.text = '';

      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          cleanup();
          reject(new Error('render-timeout'));
        }, this.timeout);
        const onFinish = () => {
          cleanup();
          resolve();
        };
        const onFail = (_e, code, desc, _u, isMain) => {
          // -3 == ERR_ABORTED, commonly fired on client-side redirects; ignore.
          if (isMain && code !== -3) {
            cleanup();
            reject(new Error(`load-failed (${code}) ${desc}`));
          }
        };
        function cleanup() {
          clearTimeout(timer);
          wc.removeListener('did-finish-load', onFinish);
          wc.removeListener('did-fail-load', onFail);
        }
        wc.on('did-finish-load', onFinish);
        wc.on('did-fail-load', onFail);
        // loadURL can reject on aborted navigations; let the events decide.
        wc.loadURL(url, { userAgent: ua }).catch(() => {});
      });

      await sleep(this.settle);
      if (this.config.waitSelector) {
        await this._waitForSelector(wc, this.config.waitSelector, 8000).catch(() => {});
      }
      if (this.config.scrollToBottom) {
        await this._autoScroll(wc).catch(() => {});
      }

      const finalUrl = wc.getURL() || url;
      const html = await wc.executeJavaScript(
        'document.documentElement ? document.documentElement.outerHTML : ""'
      );
      const statusCode = win._status.code;
      const statusText = win._status.text;
      this._releaseWindow(win);

      return {
        ok: statusCode === 0 ? true : statusCode < 400,
        status: statusCode || 200,
        statusText,
        finalUrl,
        contentType: 'text/html',
        html: html || '',
        renderedWith: 'browser',
      };
    } catch (err) {
      // Don't reuse a window that errored mid-navigation — retire it.
      win._dead = true;
      this._releaseWindow(win);
      return {
        ok: false,
        status: 0,
        finalUrl: url,
        contentType: '',
        html: '',
        error: err.message,
        renderedWith: 'browser',
      };
    }
  }

  _waitForSelector(wc, selector, maxMs) {
    const escaped = JSON.stringify(selector);
    const script = `new Promise((resolve) => {
      const started = Date.now();
      const check = () => {
        if (document.querySelector(${escaped})) return resolve(true);
        if (Date.now() - started > ${maxMs}) return resolve(false);
        setTimeout(check, 150);
      };
      check();
    })`;
    return wc.executeJavaScript(script);
  }

  _autoScroll(wc) {
    const script = `new Promise((resolve) => {
      let total = 0;
      const step = 600;
      const timer = setInterval(() => {
        window.scrollBy(0, step);
        total += step;
        if (total >= document.body.scrollHeight || total > 30000) {
          clearInterval(timer);
          setTimeout(resolve, 300);
        }
      }, 120);
    })`;
    return wc.executeJavaScript(script);
  }

  // ---------------------------------------------------------------------------
  // Strategy dispatch
  // ---------------------------------------------------------------------------

  _looksBlocked(result) {
    if (!result.ok) {
      // Status codes commonly used by bot walls / rate limiters.
      if ([401, 403, 406, 429, 503].includes(result.status)) return true;
      if (result.status === 0) return true; // network error → try the browser
    }
    const body = (result.html || '').toLowerCase();
    if (result.ok && body) {
      if (body.length < 600) return true; // suspiciously empty shell
      for (const marker of CHALLENGE_MARKERS) {
        if (body.includes(marker)) return true;
      }
    }
    return false;
  }

  /**
   * Fetch a page using the configured mode.
   * @param {string} url
   * @param {'http'|'browser'|'auto'} [mode]
   */
  async fetchPage(url, mode = this.config.mode || 'auto') {
    if (mode === 'browser') return this.fetchPageBrowser(url);
    if (mode === 'http') return this.fetchPageHttp(url);

    // auto: HTTP first, escalate to the browser if it looks blocked.
    const httpResult = await this.fetchPageHttp(url);
    if (!this._looksBlocked(httpResult)) return httpResult;
    const browserResult = await this.fetchPageBrowser(url);
    browserResult.escalated = true;
    return browserResult;
  }

  dispose() {
    for (const win of [...this._allWindows]) this._destroyWindow(win);
    this._idle = [];
    this._winWaiters = [];
    this._winCount = 0;
  }
}

module.exports = { Fetcher, DEFAULT_UA_POOL };
