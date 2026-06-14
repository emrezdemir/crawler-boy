'use strict';

/**
 * Analyzer worker thread.
 *
 * The CPU-heavy part of crawling is parsing big HTML documents (cheerio) and
 * running the recon regexes over them. Doing that on Electron's main thread
 * blocks the OS window message loop → the app appears to "freeze" / "Not
 * Responding". This worker moves all of that off the main thread.
 *
 * It depends only on plain-Node modules (no Electron), so it runs cleanly inside
 * a worker_thread.
 */

const { parentPort } = require('worker_threads');
const { parse } = require('./Parser');
const { extractIntel, auditSecurity } = require('./Recon');

// Skip recon regexes on absurdly large documents to avoid pathological cost.
const MAX_INTEL_BYTES = 8 * 1024 * 1024;

parentPort.on('message', (msg) => {
  const { id, html, baseUrl, intel, audit, headers } = msg;
  try {
    const parsed = parse(html, baseUrl);
    const out = {
      meta: parsed.meta,
      links: parsed.links,
      assets: parsed.assets,
      forms: parsed.forms,
    };
    const small = (html ? html.length : 0) <= MAX_INTEL_BYTES;
    if (intel && small) out.intel = extractIntel(html, parsed.links);
    if (audit) out.security = auditSecurity(headers || {}, parsed.meta, baseUrl, small ? html : '');
    parentPort.postMessage({ id, ok: true, result: out });
  } catch (err) {
    parentPort.postMessage({ id, ok: false, error: err.message });
  }
});
