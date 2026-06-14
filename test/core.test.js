'use strict';
// Unit smoke test of the Electron-free crawler modules.
//   Run:  npm test   (or: node test/core.test.js)
const assert = require('assert');
const u = require('../src/main/crawler/utils');
const Frontier = require('../src/main/crawler/Frontier');
const RobotsManager = require('../src/main/crawler/RobotsManager');
const { parse } = require('../src/main/crawler/Parser');
const { extractIntel, auditSecurity } = require('../src/main/crawler/Recon');

let passed = 0;
const ok = (cond, msg) => { assert(cond, msg); console.log('  ✓', msg); passed++; };

console.log('utils:');
ok(u.normalizeUrl('HTTP://Example.com:80/a#frag') === 'http://example.com/a', 'normalizeUrl lowercases host, strips port+frag');
ok(u.normalizeUrl('/wiki/X', 'https://site.com/a/b') === 'https://site.com/wiki/X', 'normalizeUrl resolves relative');
ok(u.normalizeUrl('mailto:x@y.com') === null, 'normalizeUrl rejects mailto');
ok(u.inScope('https://a.fandom.com/wiki/X', 'https://a.fandom.com/wiki/Home', 'domain'), 'inScope same domain');
ok(!u.inScope('https://other.com/x', 'https://a.fandom.com/y', 'domain'), 'inScope rejects other domain');
ok(u.inScope('https://sub.fandom.com/x', 'https://a.fandom.com/y', 'subdomain'), 'inScope subdomain matches base domain');
ok(u.categoryOf('https://x.com/pic.PNG') === 'images', 'categoryOf images (case-insensitive)');
ok(u.categoryOf('https://x.com/a.pdf') === 'documents', 'categoryOf documents');
ok(u.urlToLocalPath('https://x.com/a/b/').endsWith('index.html'), 'urlToLocalPath dir -> index.html');
ok(u.compilePatterns('/wiki/\nSpecial:').length === 2, 'compilePatterns splits lines');
ok(u.isTracker('https://www.googletagmanager.com/gtm.js') === true, 'isTracker flags googletagmanager');
ok(u.isTracker('https://sb.scorecardresearch.com/beacon.js') === true, 'isTracker flags scorecardresearch');
ok(u.isTracker('https://static.wikia.nocookie.net/img/x.png') === false, 'isTracker passes a real asset host');
ok(u.extFromContentType('image/png; charset=binary') === 'png', 'extFromContentType maps image/png');
ok(u.extFromContentType('application/pdf') === 'pdf', 'extFromContentType maps pdf');
ok(u.extFromContentType('') === '', 'extFromContentType empty for none');

console.log('Frontier:');
const f = new Frontier({ order: 'bfs' });
ok(f.add('https://x.com/a') === true, 'Frontier adds new url');
ok(f.add('https://x.com/a') === false, 'Frontier dedupes');
ok(f.add('https://x.com/a#y') === false, 'Frontier dedupes by normalized url');
f.add('https://x.com/b');
ok(f.next().url === 'https://x.com/a' && f.next().url === 'https://x.com/b', 'BFS is FIFO');
const d = new Frontier({ order: 'dfs' });
d.add('https://x.com/1'); d.add('https://x.com/2');
ok(d.next().url === 'https://x.com/2', 'DFS is LIFO');

console.log('Parser:');
const html = `<!doctype html><html lang="en"><head><title>Hello</title>
<meta name="description" content="desc">
<link rel="stylesheet" href="/style.css"><link rel="canonical" href="https://s.com/page">
</head><body>
<a href="/wiki/A">A</a><a href="https://ext.com/x">ext</a><a href="/files/doc.pdf">pdf</a>
<img src="/img/1.png" data-src="/img/2.jpg" srcset="/img/3.png 1x, /img/4.png 2x">
<video src="/v/clip.mp4" poster="/v/p.jpg"></video>
<div style="background:url('/bg/hero.webp')"></div>
<script src="/app.js"></script>
</body></html>`;
const r = parse(html, 'https://s.com/page');
ok(r.meta.title === 'Hello', 'Parser reads title');
ok(r.meta.description === 'desc', 'Parser reads description');
ok(r.meta.canonical === 'https://s.com/page', 'Parser reads canonical');
ok(r.links.includes('https://s.com/wiki/A'), 'Parser extracts internal link');
ok(r.links.includes('https://ext.com/x'), 'Parser extracts external link');
const aset = new Set(r.assets.map(a => a.url));
ok(aset.has('https://s.com/img/1.png'), 'Parser extracts img src');
ok(aset.has('https://s.com/img/2.jpg'), 'Parser extracts lazy data-src');
ok(aset.has('https://s.com/img/3.png') && aset.has('https://s.com/img/4.png'), 'Parser extracts srcset');
ok(aset.has('https://s.com/v/clip.mp4'), 'Parser extracts video src (media)');
ok(aset.has('https://s.com/v/p.jpg'), 'Parser extracts video poster (image)');
ok(aset.has('https://s.com/bg/hero.webp'), 'Parser extracts inline CSS url()');
ok(aset.has('https://s.com/style.css'), 'Parser extracts stylesheet');
ok(aset.has('https://s.com/app.js'), 'Parser extracts script');
ok(aset.has('https://s.com/files/doc.pdf'), 'Parser treats .pdf link as document asset');
ok(r.assets.find(a => a.url === 'https://s.com/v/clip.mp4').type === 'media', 'mp4 categorized as media');

console.log('Parser forms:');
const fp = parse('<form action="/login" method="POST"><input name="user"><input name="pass" type="password"><button name="go">Go</button></form>', 'https://s.com/');
ok(fp.forms.length === 1, 'Parser extracts a form');
ok(fp.forms[0].method === 'post', 'form method captured (lowercased)');
ok(fp.forms[0].action === 'https://s.com/login', 'form action resolved');
ok(fp.forms[0].inputs.some(i => i.name === 'pass' && i.type === 'password'), 'form inputs + types captured');

console.log('Recon (intel + security):');
const intelHtml = `<html><body>
contact admin@example.com or sales@test.co.uk
<a href="https://twitter.com/acme">tw</a>
<script>const k="AKIAIOSFODNN7EXAMPLE"; fetch('/api/v1/users');</script>
<!-- TODO: remove hardcoded password before launch -->
</body></html>`;
const intel = extractIntel(intelHtml, ['https://twitter.com/acme', 'https://example.com/x']);
ok(intel.emails.includes('admin@example.com'), 'intel finds email');
ok(intel.secrets.some(s => /AKIA/.test(s.value)), 'intel finds AWS access key');
ok(intel.socials.some(s => /twitter\.com/.test(s)), 'intel finds social link');
ok(intel.endpoints.some(e => e.includes('/api/v1/users')), 'intel finds API endpoint');
ok(intel.comments.some(c => /TODO/i.test(c)), 'intel finds interesting comment');
const audit = auditSecurity({ server: 'nginx', 'x-powered-by': 'PHP/8.1' }, {}, 'https://x.com/', '<html>wp-content/themes</html>');
ok(audit.missingHeaders.includes('content-security-policy'), 'audit flags missing CSP');
ok(audit.https === true, 'audit detects https');
ok(audit.tech.some(t => /nginx/i.test(t)), 'fingerprint detects server (nginx)');
ok(audit.tech.includes('WordPress'), 'fingerprint detects WordPress');

console.log('Downloader (organize by extension):');
const Downloader = require('../src/main/crawler/Downloader');
const dl = new Downloader({ sessionDir: '/tmp/sess', organizeByExtension: true });
const ep1 = dl._extensionPath('https://x.com/a/b/Photo.PNG', 'image/png');
ok(/[\\/]assets[\\/]png[\\/]Photo\.PNG$/i.test(ep1), 'extensionPath → assets/png/Photo.PNG');
const ep2 = dl._extensionPath('https://x.com/c/Photo.PNG', 'image/png');
ok(ep2 !== ep1 && /Photo__[0-9a-f]{8}\.PNG$/i.test(ep2), 'extensionPath disambiguates same-name files');
const ep3 = dl._extensionPath('https://x.com/icon', 'image/svg+xml');
ok(/[\\/]assets[\\/]svg[\\/]icon\.svg$/i.test(ep3), 'extensionPath uses content-type when URL has no ext');

console.log('RobotsManager:');
(async () => {
  const robotsTxt = `User-agent: *\nDisallow: /private\nAllow: /private/public\nCrawl-delay: 2\nSitemap: https://s.com/sitemap.xml\n\nUser-agent: BadBot\nDisallow: /`;
  const rm = new RobotsManager({ respect: true, userAgent: 'CrawlerBoy', fetchText: async () => robotsTxt });
  ok((await rm.isAllowed('https://s.com/index.html')) === true, 'robots allows normal path');
  ok((await rm.isAllowed('https://s.com/private/secret')) === false, 'robots disallows /private');
  ok((await rm.isAllowed('https://s.com/private/public/x')) === true, 'robots Allow overrides (longest match)');
  ok((await rm.crawlDelay('https://s.com/')) === 2, 'robots crawl-delay parsed');
  ok((await rm.sitemaps('https://s.com/')).includes('https://s.com/sitemap.xml'), 'robots sitemap parsed');
  const rm2 = new RobotsManager({ respect: false, userAgent: 'X', fetchText: async () => robotsTxt });
  ok((await rm2.isAllowed('https://s.com/private/secret')) === true, 'respect=false allows everything');

  console.log('AnalyzerPool (worker threads):');
  const AnalyzerPool = require('../src/main/crawler/AnalyzerPool');
  const pool = new AnalyzerPool({ size: 2 });
  const a = await pool.analyze(
    '<html><head><title>T</title></head><body><a href="/x">x</a><img src="/i.png"></body></html>',
    'https://s.com/',
    { intel: true, audit: true, headers: { server: 'nginx' } }
  );
  ok(a.meta.title === 'T', 'pool: parse runs off-thread (meta)');
  ok(a.links.includes('https://s.com/x'), 'pool: links returned');
  ok(a.assets.some((x) => x.url === 'https://s.com/i.png'), 'pool: assets returned');
  ok(a.security && a.security.tech.some((t) => /nginx/i.test(t)), 'pool: audit runs in worker');
  // Run several concurrently to exercise queueing across the pool.
  const many = await Promise.all(Array.from({ length: 6 }, (_, i) =>
    pool.analyze(`<html><body><a href="/p${i}">l</a></body></html>`, 'https://s.com/', {})
  ));
  ok(many.every((m) => m.links.length === 1), 'pool: handles concurrent tasks');
  await pool.destroy();

  console.log(`\nALL ${passed} ASSERTIONS PASSED ✅`);
})().catch(e => { console.error('TEST FAILED ❌', e); process.exit(1); });
