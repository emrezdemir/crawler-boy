'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { urlToLocalPath, safeName, hashString } = require('./utils');

/**
 * Downloader — owns the on-disk layout for a crawl session and persists
 * everything the crawl produces:
 *
 *   <outputRoot>/<session>/
 *     ├─ pages/      full HTML mirror (optional)
 *     ├─ assets/<category>/<host>/<path>   downloaded files
 *     └─ data/       crawl-data.json, links.json, errors.json
 *
 * It de-duplicates by URL, enforces a max file size, and tracks byte totals.
 */
class Downloader {
  /**
   * @param {object} opts
   * @param {string} opts.sessionDir   absolute path of the session folder.
   * @param {object} opts.fetcher      Fetcher instance for binary downloads.
   * @param {Set<string>} opts.categories enabled asset categories.
   * @param {number} opts.maxFileSize  bytes; 0 = unlimited.
   * @param {boolean} opts.savePages   write the HTML mirror.
   */
  constructor({ sessionDir, fetcher, categories, maxFileSize = 0, savePages = false }) {
    this.sessionDir = sessionDir;
    this.fetcher = fetcher;
    this.categories = categories instanceof Set ? categories : new Set(categories || []);
    this.maxFileSize = maxFileSize;
    this.savePages = savePages;
    this.downloaded = new Set(); // asset URLs already handled
    this.bytes = 0;
    this.count = 0;
  }

  async init() {
    await fsp.mkdir(path.join(this.sessionDir, 'data'), { recursive: true });
    if (this.savePages) await fsp.mkdir(path.join(this.sessionDir, 'pages'), { recursive: true });
  }

  wantsCategory(category) {
    return this.categories.has(category);
  }

  /** Persist a page's rendered HTML into the mirror tree. */
  async savePage(url, html) {
    if (!this.savePages || !html) return null;
    try {
      const rel = urlToLocalPath(url);
      const full = path.join(this.sessionDir, 'pages', rel);
      await fsp.mkdir(path.dirname(full), { recursive: true });
      await fsp.writeFile(full, html, 'utf8');
      this.bytes += Buffer.byteLength(html);
      return full;
    } catch {
      return null;
    }
  }

  /**
   * Download a single asset if its category is enabled and it's new.
   * @returns {Promise<{status:string, path?:string, bytes?:number, reason?:string}>}
   */
  async downloadAsset(asset) {
    const { url, type } = asset;
    if (this.downloaded.has(url)) return { status: 'duplicate' };
    if (!this.wantsCategory(type)) return { status: 'skipped', reason: 'category-off' };
    this.downloaded.add(url);

    const result = await this.fetcher.fetchBinary(url, this.maxFileSize);
    if (result.tooLarge) {
      return { status: 'skipped', reason: 'too-large', bytes: result.bytes };
    }
    if (!result.ok || !result.buffer) {
      return { status: 'error', reason: result.error || `http-${result.status}` };
    }
    // Fallback guard for servers that don't send Content-Length.
    if (this.maxFileSize && result.buffer.length > this.maxFileSize) {
      return { status: 'skipped', reason: 'too-large', bytes: result.buffer.length };
    }

    try {
      const rel = urlToLocalPath(url, { indexName: `asset_${hashString(url)}.bin` });
      const full = path.join(this.sessionDir, 'assets', type, rel);
      await fsp.mkdir(path.dirname(full), { recursive: true });
      await fsp.writeFile(full, result.buffer);
      this.bytes += result.buffer.length;
      this.count++;
      return { status: 'ok', path: full, bytes: result.buffer.length, category: type };
    } catch (err) {
      return { status: 'error', reason: err.message };
    }
  }

  /** Write the structured crawl results to data/. */
  async writeResults({ pages, assets, errors, intel, security, summary }) {
    const dataDir = path.join(this.sessionDir, 'data');
    await fsp.mkdir(dataDir, { recursive: true });
    const writeJson = (name, obj) =>
      fsp.writeFile(path.join(dataDir, name), JSON.stringify(obj, null, 2), 'utf8');

    const jobs = [
      writeJson('crawl-data.json', { summary, pages }),
      writeJson('assets.json', assets),
      writeJson('errors.json', errors),
      writeJson('links.json', this._buildLinkGraph(pages)),
      writeJson('forms.json', this._collectForms(pages)),
    ];
    if (intel) jobs.push(writeJson('intel.json', intel));
    if (security && security.length) jobs.push(writeJson('security.json', security));
    await Promise.all(jobs);
  }

  _collectForms(pages) {
    const out = [];
    for (const p of pages) {
      if (p.forms && p.forms.length) out.push({ page: p.finalUrl || p.url, forms: p.forms });
    }
    return out;
  }

  _buildLinkGraph(pages) {
    // Adjacency list: page URL -> outbound in-scope links.
    const graph = {};
    for (const p of pages) {
      graph[p.url] = p.links || [];
    }
    return graph;
  }

  /** Convenience exporter used by the IPC layer for the in-memory result set. */
  static async exportData(filePath, format, data) {
    if (format === 'json') {
      await fsp.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
    } else if (format === 'ndjson') {
      const lines = (data.pages || []).map((p) => JSON.stringify(p)).join('\n');
      await fsp.writeFile(filePath, lines, 'utf8');
    } else if (format === 'csv') {
      await fsp.writeFile(filePath, Downloader.toCsv(data.pages || []), 'utf8');
    }
    return filePath;
  }

  static toCsv(rows) {
    const cols = ['url', 'status', 'depth', 'title', 'contentType', 'bytes', 'linkCount', 'assetCount', 'renderedWith'];
    const esc = (v) => {
      const s = v === undefined || v === null ? '' : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = cols.join(',');
    const lines = rows.map((r) =>
      cols
        .map((c) => {
          if (c === 'linkCount') return esc((r.links || []).length);
          if (c === 'assetCount') return esc((r.assets || []).length);
          if (c === 'title') return esc(r.meta ? r.meta.title : r.title);
          return esc(r[c]);
        })
        .join(',')
    );
    return [header, ...lines].join('\n');
  }
}

module.exports = Downloader;
