'use strict';

/**
 * Shared crawler utilities: URL normalization, scope checks, file-type
 * categorization, and small helpers. Pure functions only — no I/O, no state.
 */

const { URL } = require('url');
const path = require('path');

/** Sleep for `ms` milliseconds. */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Normalize a URL for de-duplication and consistent storage.
 * - Resolves against `base` when relative.
 * - Strips the fragment (#...).
 * - Lowercases the hostname.
 * - Removes default ports.
 * Returns null for non-HTTP(S) or unparseable URLs.
 */
function normalizeUrl(rawUrl, base) {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;
  // Skip non-navigational schemes early.
  if (/^(mailto:|tel:|javascript:|data:|blob:|ftp:|about:|#)/i.test(trimmed)) return null;
  try {
    const u = new URL(trimmed, base || undefined);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    u.hash = '';
    u.hostname = u.hostname.toLowerCase();
    if (
      (u.protocol === 'http:' && u.port === '80') ||
      (u.protocol === 'https:' && u.port === '443')
    ) {
      u.port = '';
    }
    // Collapse a bare "/" path consistently.
    return u.toString();
  } catch {
    return null;
  }
}

// Common multi-label public suffixes so subdomain scoping behaves sensibly.
const TWO_LEVEL_TLDS = new Set([
  'co.uk', 'org.uk', 'gov.uk', 'ac.uk', 'co.jp', 'co.kr', 'com.au', 'net.au',
  'org.au', 'com.br', 'com.tr', 'gov.tr', 'edu.tr', 'org.tr', 'com.cn',
  'com.mx', 'co.in', 'co.za', 'co.nz', 'com.sg',
]);

/** Best-effort registrable domain (handles a curated set of 2-level TLDs). */
function getBaseDomain(hostname) {
  if (!hostname) return '';
  const parts = hostname.split('.');
  if (parts.length <= 2) return hostname;
  const lastTwo = parts.slice(-2).join('.');
  if (TWO_LEVEL_TLDS.has(lastTwo) && parts.length >= 3) {
    return parts.slice(-3).join('.');
  }
  return lastTwo;
}

/**
 * Decide whether `url` is inside the crawl scope relative to `seedUrl`.
 *   - 'page'      : exactly the seed (no link following beyond assets)
 *   - 'path'      : same host AND under the seed's directory path
 *   - 'domain'    : exact same hostname
 *   - 'subdomain' : same registrable domain (any subdomain)
 *   - 'all'       : anywhere on the web
 */
function inScope(url, seedUrl, scope) {
  if (scope === 'all') return true;
  let u, s;
  try {
    u = new URL(url);
    s = new URL(seedUrl);
  } catch {
    return false;
  }
  switch (scope) {
    case 'page':
      return normalizeUrl(url) === normalizeUrl(seedUrl);
    case 'domain':
      return u.hostname === s.hostname;
    case 'subdomain':
      return getBaseDomain(u.hostname) === getBaseDomain(s.hostname);
    case 'path': {
      if (u.hostname !== s.hostname) return false;
      const dir = s.pathname.replace(/[^/]*$/, ''); // strip trailing file segment
      return u.pathname.startsWith(dir);
    }
    default:
      return u.hostname === s.hostname;
  }
}

// Extension -> asset category map. Drives both extraction and download filters.
const ASSET_CATEGORIES = {
  images: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif', 'tiff', 'heic'],
  documents: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'csv', 'rtf', 'odt', 'ods', 'odp', 'epub'],
  media: ['mp4', 'webm', 'mov', 'avi', 'mkv', 'flv', 'mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac', 'wma', 'm4v'],
  archives: ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'tgz'],
  fonts: ['woff', 'woff2', 'ttf', 'otf', 'eot'],
  styles: ['css'],
  scripts: ['js', 'mjs'],
  data: ['json', 'xml', 'yaml', 'yml', 'rss', 'atom'],
};

// Reverse lookup: extension -> category.
const EXT_TO_CATEGORY = (() => {
  const map = new Map();
  for (const [cat, exts] of Object.entries(ASSET_CATEGORIES)) {
    for (const ext of exts) map.set(ext, cat);
  }
  return map;
})();

// Common content-type → extension, for assets whose URL has no usable suffix.
const CONTENT_TYPE_EXT = {
  'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/gif': 'gif',
  'image/webp': 'webp', 'image/svg+xml': 'svg', 'image/avif': 'avif', 'image/bmp': 'bmp',
  'image/x-icon': 'ico', 'image/vnd.microsoft.icon': 'ico', 'image/tiff': 'tiff',
  'application/pdf': 'pdf', 'text/css': 'css', 'text/html': 'html', 'text/plain': 'txt',
  'application/javascript': 'js', 'text/javascript': 'js', 'application/json': 'json',
  'application/xml': 'xml', 'text/xml': 'xml', 'video/mp4': 'mp4', 'video/webm': 'webm',
  'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/ogg': 'ogg', 'font/woff2': 'woff2',
  'font/woff': 'woff', 'font/ttf': 'ttf', 'application/zip': 'zip', 'application/gzip': 'gz',
};

/**
 * Sniff a buffer's real type from its magic bytes. Returns a short tag
 * ('png','jpg','gif','webp','bmp','ico','pdf','zip','gzip','mp4','html','xml')
 * or '' if unrecognized. Used to verify downloads actually contain what their
 * URL/category claims (e.g. a wiki "File:" page saved as a .jpg is really HTML).
 */
function sniffBinaryType(buffer) {
  if (!buffer || buffer.length < 4) return '';
  const b = buffer;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'gif';
  if (
    b.length >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  ) return 'webp';
  if (b[0] === 0x42 && b[1] === 0x4d) return 'bmp';
  if (b[0] === 0x00 && b[1] === 0x00 && b[2] === 0x01 && b[3] === 0x00) return 'ico';
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return 'pdf';
  if (b[0] === 0x50 && b[1] === 0x4b && (b[2] === 0x03 || b[2] === 0x05 || b[2] === 0x07)) return 'zip';
  if (b[0] === 0x1f && b[1] === 0x8b) return 'gzip';
  if (b.length >= 12 && b.slice(4, 8).toString('latin1') === 'ftyp') return 'mp4';
  const head = b.slice(0, 256).toString('latin1').toLowerCase().replace(/^﻿/, '').trimStart();
  if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))) return 'svg';
  if (head.startsWith('<?xml')) return 'xml';
  if (head.startsWith('<!doctype html') || head.startsWith('<html') || head.startsWith('<head') || head.startsWith('<body')) return 'html';
  return '';
}

/** Best-effort extension (no dot) from a Content-Type header. '' if unknown. */
function extFromContentType(contentType) {
  if (!contentType) return '';
  const base = contentType.split(';')[0].trim().toLowerCase();
  return CONTENT_TYPE_EXT[base] || '';
}

/** Lower-cased file extension (no dot) parsed from a URL's pathname. */
function extOf(url) {
  try {
    const { pathname } = new URL(url);
    const ext = path.extname(pathname).slice(1).toLowerCase();
    return ext || '';
  } catch {
    return '';
  }
}

/** Category name ('images', 'media', ...) for a URL, or null if unknown. */
function categoryOf(url) {
  return EXT_TO_CATEGORY.get(extOf(url)) || null;
}

/** Sanitize a string so it is safe to use as a file / folder name. */
function safeName(str, fallback = 'file') {
  const cleaned = String(str || '')
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[._]+|[._]+$/g, '')
    .slice(0, 180);
  return cleaned || fallback;
}

/** Human-readable byte size. */
function formatBytes(bytes) {
  if (!bytes || bytes < 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

/**
 * Build a sensible on-disk relative path that mirrors a URL's structure.
 * e.g. https://x.com/a/b/c.html -> x.com/a/b/c.html
 */
function urlToLocalPath(url, { indexName = 'index.html' } = {}) {
  try {
    const u = new URL(url);
    let p = decodeURIComponent(u.pathname);
    if (p.endsWith('/') || p === '') p += indexName;
    const segments = p.split('/').filter(Boolean).map((s) => safeName(s, 'seg'));
    // Preserve a query hash so distinct querystrings don't collide.
    let file = segments.pop() || indexName;
    if (u.search) {
      const qHash = hashString(u.search).slice(0, 8);
      const dot = file.lastIndexOf('.');
      file = dot > 0 ? `${file.slice(0, dot)}__${qHash}${file.slice(dot)}` : `${file}__${qHash}`;
    }
    return path.join(safeName(u.hostname, 'host'), ...segments, file);
  } catch {
    return path.join('misc', `${hashString(url)}.bin`);
  }
}

/** Fast, dependency-free 32-bit string hash (FNV-1a) as hex. */
function hashString(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

// Hostname tokens for ad / tracker / analytics / cookie-sync endpoints. Shared
// by the render-time request blocker and the asset-download filter.
const TRACKER_TOKENS = [
  'doubleclick', 'googlesyndication', 'google-analytics', 'googletagservices',
  'googletagmanager', 'adservice', 'adsystem', 'adnxs', 'criteo', 'pubmatic',
  'rubicon', 'openx', 'taboola', 'outbrain', 'scorecardresearch', 'quantserve',
  'moatads', 'adsrvr', '3lift', 'casalemedia', 'sharethrough', 'teads',
  'smartadserver', 'yieldmo', 'bidswitch', 'omnitag', 'smilewanted',
  'nextmillmedia', 'gammaplatform', 'unrulymedia', 'programmaticx', 'marphezis',
  'vidazoo', 'adyoulike', 'amazon-adsystem', 'indexww', 'bidder', 'prebid',
  'usersync', 'cookiesync', 'bsync', 'omnitagjs', 'demdex', 'crwdcntrl',
  'btloader', 'btmessage', 'adsafeprotected', 'taboola', 'mgid', 'zergnet',
];
const TRACKER_RE = new RegExp(TRACKER_TOKENS.join('|'), 'i');

/** True if a URL's hostname looks like an ad / tracker / analytics endpoint. */
function isTracker(url) {
  try {
    return TRACKER_RE.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

/** Compile a newline/comma separated list of patterns into RegExp[]. Empty -> []. */
function compilePatterns(raw) {
  if (!raw) return [];
  return String(raw)
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((pattern) => {
      try {
        return new RegExp(pattern, 'i');
      } catch {
        // Fall back to a literal, escaped match if the user typed plain text.
        const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(escaped, 'i');
      }
    });
}

module.exports = {
  sleep,
  normalizeUrl,
  getBaseDomain,
  inScope,
  ASSET_CATEGORIES,
  EXT_TO_CATEGORY,
  extOf,
  extFromContentType,
  sniffBinaryType,
  categoryOf,
  safeName,
  formatBytes,
  urlToLocalPath,
  hashString,
  compilePatterns,
  isTracker,
};
