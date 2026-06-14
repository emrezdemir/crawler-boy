'use strict';

/**
 * Generates the README screenshots by loading the real UI in a BrowserWindow,
 * injecting representative sample data, and capturing the page.
 *
 *   Run:  npm run screenshots   (electron tools/screenshot.js)
 */

const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const SAMPLE_JS = `(function () {
  document.getElementById('disclaimerModal').classList.add('hidden');
  document.getElementById('statusDot').className = 'dot running';
  document.getElementById('statusText').textContent = 'Crawling…';
  document.getElementById('progressFill').style.width = '62%';
  document.getElementById('seedUrl').value = 'https://example.com';
  const stats = { stCrawled:'105', stQueued:'1843', stActive:'5', stDownloaded:'1728', stBytes:'212 MB', stErrors:'0', stEscalated:'6', stElapsed:'1m 12s' };
  Object.entries(stats).forEach(([k,v]) => { const el=document.getElementById(k); if(el) el.textContent=v; });
  document.getElementById('startBtn').disabled = true;
  document.getElementById('pauseBtn').disabled = false;
  document.getElementById('stopBtn').disabled = false;
  document.getElementById('configPanel').classList.add('locked');
  document.querySelectorAll('[data-export]').forEach(b => b.disabled = false);
  document.getElementById('openFolderBtn').disabled = false;

  const pages = [
    ['200','0','Example Domain','https://example.com/','html','42','38 KB','s-ok'],
    ['200','1','Documentation','https://example.com/docs','browser','61','120 KB','s-ok'],
    ['200','1','Guides Index','https://example.com/guides','browser+esc','88','96 KB','s-ok'],
    ['200','2','Getting Started','https://example.com/guides/start','http','37','54 KB','s-ok'],
    ['301','2','Old Path','https://example.com/legacy','http','0','0 B','s-warn'],
    ['200','2','API Reference','https://example.com/api','browser','143','210 KB','s-ok'],
    ['200','3','Image Gallery','https://example.com/gallery','browser','206','180 KB','s-ok'],
    ['200','3','Downloads','https://example.com/downloads','http','24','41 KB','s-ok'],
    ['200','3','Blog','https://example.com/blog','browser+esc','77','88 KB','s-ok'],
    ['200','4','Release Notes','https://example.com/blog/release','http','19','33 KB','s-ok'],
    ['404','4','Missing','https://example.com/blog/draft','http','0','1 KB','s-err'],
    ['200','4','Team','https://example.com/about/team','browser','31','45 KB','s-ok'],
    ['200','5','Contact','https://example.com/contact','http','12','22 KB','s-ok'],
    ['200','5','Privacy','https://example.com/privacy','http','9','28 KB','s-ok'],
  ];
  const pb = document.getElementById('pagesBody');
  pb.innerHTML = pages.map((p,i) =>
    '<tr><td>'+(i+1)+'</td><td class="'+p[7]+'">'+p[0]+'</td><td>'+p[1]+'</td><td>'+p[2]+
    '</td><td class="u">'+p[3]+'</td><td><span class="tag">'+p[4]+'</span></td><td>'+p[5]+'</td><td>'+p[6]+'</td></tr>'
  ).join('');
  document.getElementById('pagesCount').textContent = '105';
  document.getElementById('assetsCount').textContent = '1728';
  document.getElementById('intelCount').textContent = '54';
  document.getElementById('errorsCount').textContent = '0';

  // Expand the Downloads card so the categories + "All" toggle are visible.
  document.querySelectorAll('.card').forEach(c => {
    const h = c.querySelector('.card-head');
    if (h && /Downloads/.test(h.textContent)) c.classList.remove('collapsed');
  });
})();`;

async function capture(win, file) {
  let img = await win.webContents.capturePage();
  // Retry a few times if the compositor hasn't produced pixels yet.
  for (let i = 0; i < 8 && img.isEmpty(); i++) {
    await wait(400);
    img = await win.webContents.capturePage();
  }
  const size = img.getSize();
  fs.writeFileSync(file, img.toPNG());
  console.log('wrote', path.basename(file), `${size.width}x${size.height}`, `(${(fs.statSync(file).size / 1024).toFixed(0)} KB)`);
}

app.whenReady().then(async () => {
  const outDir = path.join(__dirname, '..', 'assets', 'screenshots');
  fs.mkdirSync(outDir, { recursive: true });

  const win = new BrowserWindow({
    width: 1360,
    height: 900,
    show: true,
    backgroundColor: '#0d1117',
    webPreferences: {
      preload: path.join(__dirname, '..', 'src', 'main', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  win.removeMenu();
  await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
  win.show();
  win.focus();
  win.moveTop();
  await wait(2200);

  // 1) The consent / disclaimer modal (shown by default on a clean profile).
  await capture(win, path.join(outDir, 'disclaimer.png'));

  // 2) The dashboard mid-crawl with sample data.
  await win.webContents.executeJavaScript(SAMPLE_JS);
  await wait(600);
  await capture(win, path.join(outDir, 'dashboard.png'));

  win.destroy();
  app.quit();
});
