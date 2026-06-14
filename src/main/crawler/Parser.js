'use strict';

const cheerio = require('cheerio');
const { normalizeUrl, categoryOf } = require('./utils');

/**
 * Parser — turns a rendered HTML document into structured data:
 *   - page metadata (title, description, canonical, OpenGraph, language…)
 *   - outbound page links (for the frontier)
 *   - downloadable assets (images, media, documents, styles, scripts, fonts…)
 *
 * Designed to be exhaustive about where URLs can hide: src, href, srcset,
 * <source>, <video>/<audio> posters, inline CSS url(), data-src lazy-loading,
 * and <link rel> resources.
 */

function extractMeta($, baseUrl) {
  const get = (sel, attr = 'content') => {
    const el = $(sel).first();
    return el.length ? (el.attr(attr) || '').trim() : '';
  };
  const canonicalHref = $('link[rel="canonical"]').first().attr('href');
  return {
    title: ($('title').first().text() || '').trim(),
    description: get('meta[name="description"]') || get('meta[property="og:description"]'),
    canonical: canonicalHref ? normalizeUrl(canonicalHref, baseUrl) : null,
    lang: ($('html').attr('lang') || '').trim(),
    ogTitle: get('meta[property="og:title"]'),
    ogType: get('meta[property="og:type"]'),
    ogImage: get('meta[property="og:image"]'),
    robotsMeta: get('meta[name="robots"]'),
    generator: get('meta[name="generator"]'),
    charset: ($('meta[charset]').attr('charset') || '').trim(),
  };
}

/** Enumerate forms (action, method, inputs) — useful for attack-surface maps. */
function extractForms($, baseUrl) {
  const forms = [];
  $('form').each((_, el) => {
    const $f = $(el);
    const action = $f.attr('action');
    const inputs = [];
    $f.find('input, select, textarea, button').each((__, i) => {
      const $i = $(i);
      const name = $i.attr('name');
      if (!name) return;
      inputs.push({ name, type: ($i.attr('type') || $i.get(0).tagName || '').toLowerCase() });
    });
    forms.push({
      action: action ? normalizeUrl(action, baseUrl) || action : baseUrl,
      method: ($f.attr('method') || 'get').toLowerCase(),
      inputs,
    });
    return forms.length < 100; // cap per page
  });
  return forms;
}

function pushUnique(map, url, type, attrOrigin) {
  if (!url) return;
  if (!map.has(url)) map.set(url, { url, type, via: attrOrigin });
}

function collectFromSrcset(value, baseUrl, map, type) {
  if (!value) return;
  for (const part of value.split(',')) {
    const candidate = part.trim().split(/\s+/)[0];
    const abs = normalizeUrl(candidate, baseUrl);
    if (abs) pushUnique(map, abs, type, 'srcset');
  }
}

const CSS_URL_RE = /url\(\s*['"]?([^'")]+)['"]?\s*\)/gi;

/**
 * @param {string} html      rendered HTML
 * @param {string} baseUrl   the page's final URL (after redirects)
 * @returns {{meta:object, links:string[], assets:Array}}
 */
function parse(html, baseUrl) {
  const $ = cheerio.load(html);

  // Honour <base href> if present.
  const baseTag = $('base[href]').first().attr('href');
  const effectiveBase = baseTag ? normalizeUrl(baseTag, baseUrl) || baseUrl : baseUrl;

  const meta = extractMeta($, effectiveBase);
  const links = new Set();
  const assets = new Map(); // url -> {url, type, via}

  // --- Page links (anchors) ---
  $('a[href]').each((_, el) => {
    const abs = normalizeUrl($(el).attr('href'), effectiveBase);
    if (!abs) return;
    const cat = categoryOf(abs);
    if (cat) {
      // A link that points straight at a file is treated as an asset too.
      pushUnique(assets, abs, cat, 'a');
    }
    links.add(abs);
  });

  // Frames are navigable too.
  $('iframe[src], frame[src]').each((_, el) => {
    const abs = normalizeUrl($(el).attr('src'), effectiveBase);
    if (abs) links.add(abs);
  });

  // --- Images (incl. lazy-load + responsive) ---
  $('img').each((_, el) => {
    const $el = $(el);
    for (const attr of ['src', 'data-src', 'data-original', 'data-lazy-src']) {
      const abs = normalizeUrl($el.attr(attr), effectiveBase);
      if (abs) pushUnique(assets, abs, 'images', attr);
    }
    collectFromSrcset($el.attr('srcset'), effectiveBase, assets, 'images');
    collectFromSrcset($el.attr('data-srcset'), effectiveBase, assets, 'images');
  });

  // --- <picture><source> ---
  $('picture source, source').each((_, el) => {
    const $el = $(el);
    collectFromSrcset($el.attr('srcset'), effectiveBase, assets, 'images');
    const abs = normalizeUrl($el.attr('src'), effectiveBase);
    if (abs) pushUnique(assets, abs, categoryOf(abs) || 'media', 'source');
  });

  // --- Video / audio ---
  $('video, audio').each((_, el) => {
    const $el = $(el);
    for (const attr of ['src', 'poster']) {
      const abs = normalizeUrl($el.attr(attr), effectiveBase);
      if (abs) pushUnique(assets, abs, attr === 'poster' ? 'images' : 'media', attr);
    }
  });

  // --- Stylesheets, icons, preloads ---
  $('link[href]').each((_, el) => {
    const $el = $(el);
    const rel = ($el.attr('rel') || '').toLowerCase();
    const abs = normalizeUrl($el.attr('href'), effectiveBase);
    if (!abs) return;
    if (rel.includes('stylesheet')) pushUnique(assets, abs, 'styles', 'link');
    else if (rel.includes('icon')) pushUnique(assets, abs, 'images', 'link');
    else if (rel.includes('preload') || rel.includes('prefetch')) {
      pushUnique(assets, abs, categoryOf(abs) || 'other', 'link');
    } else {
      const cat = categoryOf(abs);
      if (cat) pushUnique(assets, abs, cat, 'link');
    }
  });

  // --- Scripts ---
  $('script[src]').each((_, el) => {
    const abs = normalizeUrl($(el).attr('src'), effectiveBase);
    if (abs) pushUnique(assets, abs, 'scripts', 'script');
  });

  // --- Inline CSS url(...) in <style> blocks and style="" attributes ---
  const scrapeCss = (cssText) => {
    if (!cssText) return;
    let m;
    CSS_URL_RE.lastIndex = 0;
    while ((m = CSS_URL_RE.exec(cssText)) !== null) {
      const abs = normalizeUrl(m[1], effectiveBase);
      if (abs) pushUnique(assets, abs, categoryOf(abs) || 'images', 'css');
    }
  };
  $('style').each((_, el) => scrapeCss($(el).html()));
  $('[style]').each((_, el) => scrapeCss($(el).attr('style')));

  return {
    meta,
    links: Array.from(links),
    assets: Array.from(assets.values()),
    forms: extractForms($, effectiveBase),
  };
}

module.exports = { parse };
