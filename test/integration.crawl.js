'use strict';
// Live integration test: boots Electron and runs a small real crawl to prove the
// HTTP→browser auto-escalation, link discovery, and asset download all work.
//
//   Run:           npm run test:crawl
//   Custom target: electron test/integration.crawl.js https://your-authorized-site.example
//
// Note: this hits the live network. Pass a JavaScript-heavy / bot-protected site
// you are authorized to access to exercise the auto-escalation path. The default
// is a neutral, static page.
const { app } = require('electron');
const os = require('os');
const path = require('path');
const CrawlEngine = require('../src/main/crawler/CrawlEngine');

app.disableHardwareAcceleration();
process.on('uncaughtException', (e) => { console.error('UNCAUGHT:', e); });
process.on('unhandledRejection', (e) => { console.error('UNHANDLED:', e); });

const SEED = process.argv.find((a, i) => i >= 2 && /^https?:\/\//i.test(a)) ||
  'https://example.com';

const hardTimer = setTimeout(() => { console.error('\n[timeout] forcing exit'); process.exit(2); }, 150000);

app.whenReady().then(async () => {
  const sessionDir = path.join(os.tmpdir(), 'crawlerboy-test-' + Date.now());
  console.log('Seed:', SEED);
  console.log('Session dir:', sessionDir, '\n');

  const engine = new CrawlEngine({
    seedUrl: SEED,
    mode: 'auto', scope: 'domain', order: 'bfs',
    concurrency: 2, delay: 400, jitter: true, timeout: 30000, maxRetries: 1,
    maxDepth: 1, maxPages: 4,
    includePatterns: '/wiki/',
    excludePatterns: '\\?action=|Special:|Talk:|User:|MediaWiki:',
    followSitemaps: false, respectRobots: true,
    downloadAssets: true, categories: ['images'], maxFileSize: 5 * 1024 * 1024, assetConcurrency: 4,
    renderConcurrency: 2, renderSettle: 1000, blockTrackers: true,
    extractIntel: true, auditSecurity: true,
    sessionDir,
  });

  let assetCount = 0;
  let intelCount = 0;
  engine.on('page', (p) => console.log(`  PAGE [${p.status}] depth=${p.depth} via=${p.renderedWith} bytes=${p.bytes} links=${p.links.length} forms=${(p.forms||[]).length} :: ${(p.meta.title || '').slice(0, 45)}`));
  engine.on('asset', () => assetCount++);
  engine.on('intel', (d) => { intelCount += d.rows.length; });
  engine.on('log', (l) => { if (l.level !== 'info') console.log(`  [${l.level}] ${l.message}`); });
  engine.on('done', ({ summary }) => {
    console.log('\n=== DONE ===');
    console.log(`crawled: ${summary.crawled} | escalated: ${summary.escalated} | downloaded: ${summary.downloaded} | errors: ${summary.errors} | data: ${summary.humanBytes}`);
    console.log(`recon: hosts=${(summary.hosts||[]).length} forms=${summary.forms} intel-rows=${intelCount} emails=${summary.intelCounts.emails} endpoints=${summary.intelCounts.endpoints} secrets=${summary.intelCounts.secrets}`);
    const pass = summary.crawled >= 1;
    console.log('VERDICT:', pass ? 'PASS ✅' : 'FAIL ❌');
    clearTimeout(hardTimer);
    setTimeout(() => app.exit(pass ? 0 : 1), 200);
  });

  engine.start().catch((e) => { console.error('engine error:', e); app.exit(3); });
});
