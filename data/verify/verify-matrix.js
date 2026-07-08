#!/usr/bin/env node
/**
 * v51 verification matrix — original vs clone, 8 paired states + behavior checks.
 * Usage: node /tmp/verify-matrix.js <cloneDir> <origUrl> [port]
 *
 * Checks (clone, hard-offline via route-blocking of all non-localhost):
 *   - 8 paired screenshots (load/sweep/midscroll/deepscroll/work/workscroll/contact/home)
 *   - zero 404s, zero post-upgrade request failures, zero external leaks, zero page errors
 *   - carousel cycles ≥3 distinct cards during 25s idle (pixel clustering + lazy .bin loads)
 *   - WORK/CONTACT overlays open with content (innerText delta)
 *   - recorded mp4s play (currentTime advances)
 *   - mouse-trail pixel delta ≥ idle baseline
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const http = require('http');
const zlib = require('zlib');

const CLONE_DIR = process.argv[2];
const ORIG_URL = process.argv[3] || 'https://activetheory.net';
const PORT = parseInt(process.argv[4] || '8471', 10);
if (!CLONE_DIR || !fs.existsSync(CLONE_DIR)) { console.error('clone dir missing'); process.exit(1); }
const SHOT_DIR = path.join(CLONE_DIR, 'data', 'verify');
fs.mkdirSync(SHOT_DIR, { recursive: true });

const MIME = { html:'text/html', js:'application/javascript', css:'text/css', json:'application/json', png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', gif:'image/gif', svg:'image/svg+xml', webp:'image/webp', avif:'image/avif', ico:'image/x-icon', woff:'font/woff', woff2:'font/woff2', otf:'font/otf', ttf:'font/ttf', mp4:'video/mp4', webm:'video/webm', mp3:'audio/mpeg', bin:'application/octet-stream', txt:'text/plain', xml:'text/xml' };
const binHits = new Set();
let binWindowActive = false; const binWindowHits = new Set();

function serveStatic(req, res) {
  try {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p === '/') p = '/index.html';
    let file = path.join(CLONE_DIR, p);
    if (!file.startsWith(CLONE_DIR)) { res.writeHead(403); return res.end(); }
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('nf'); }
    if (p.startsWith('/live-assets/')) { binHits.add(p); if (binWindowActive) binWindowHits.add(p); }
    const ext = p.split('.').pop().toLowerCase();
    const buf = fs.readFileSync(file);
    const range = req.headers.range;
    const head = { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' };
    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range);
      if (m) {
        const s = m[1] ? parseInt(m[1]) : 0; const e = m[2] ? Math.min(parseInt(m[2]), buf.length-1) : buf.length-1;
        head['Content-Range'] = `bytes ${s}-${e}/${buf.length}`; head['Content-Length'] = e-s+1;
        res.writeHead(206, head); return res.end(buf.slice(s, e+1));
      }
    }
    head['Content-Length'] = buf.length;
    res.writeHead(200, head); res.end(buf);
  } catch (e) { res.writeHead(500); res.end(); }
}

// ── PNG pixel tools (no deps): parse IHDR/IDAT, inflate, unfilter → RGBA ──
function pngPixels(buf) {
  let pos = 8; let w = 0, h = 0, bpp = 0; const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos); const type = buf.toString('ascii', pos+4, pos+8);
    if (type === 'IHDR') {
      w = buf.readUInt32BE(pos+8); h = buf.readUInt32BE(pos+12);
      const depth = buf[pos+16], color = buf[pos+17], interlace = buf[pos+20];
      if (depth !== 8 || interlace !== 0) return null;
      if (color === 6) bpp = 4; else if (color === 2) bpp = 3; else return null; // RGBA or RGB
    }
    if (type === 'IDAT') idat.push(buf.slice(pos+8, pos+8+len));
    pos += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * bpp; const out = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride+1)]; const line = raw.slice(y*(stride+1)+1, (y+1)*(stride+1));
    const prev = y > 0 ? out.slice((y-1)*stride, y*stride) : null;
    const cur = out.slice(y*stride, (y+1)*stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i-bpp] : 0, b = prev ? prev[i] : 0, c = (prev && i >= bpp) ? prev[i-bpp] : 0;
      let v = line[i];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a+b)>>1;
      else if (f === 4) { const pp = a+b-c, pa = Math.abs(pp-a), pb = Math.abs(pp-b), pc = Math.abs(pp-c); v += (pa<=pb&&pa<=pc)?a:(pb<=pc?b:c); }
      cur[i] = v & 0xff;
    }
  }
  return { w, h, bpp, data: out };
}
function meanAbsDiff(bufA, bufB) {
  const a = pngPixels(bufA), b = pngPixels(bufB);
  if (!a || !b || a.data.length !== b.data.length || a.bpp !== b.bpp) return -1;
  let sum = 0, n = 0;
  const step = a.bpp * 16; // sample every 16th pixel, compare RGB channels
  for (let i = 0; i + 2 < a.data.length; i += step) {
    sum += Math.abs(a.data[i]-b.data[i]) + Math.abs(a.data[i+1]-b.data[i+1]) + Math.abs(a.data[i+2]-b.data[i+2]);
    n += 3;
  }
  return n ? sum / n : -1;
}

const VW = 1440, VH = 900;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function sweep(page, n, pause) {
  for (let i = 0; i < n; i++) {
    await page.mouse.move(VW/2 + Math.sin(i*0.55)*VW*0.42, VH/2 + Math.cos(i*0.35)*VH*0.38, { steps: 12 }).catch(()=>{});
    await sleep(pause);
  }
}
async function clickByText(page, text) {
  const spot = await page.evaluate((t) => {
    for (const el of document.querySelectorAll('a, button, [role="button"], nav *, header *')) {
      const s = (el.textContent||'').trim().replace(/\s+/g,' ');
      if (s.toLowerCase() === t.toLowerCase()) {
        const r = el.getBoundingClientRect();
        if (r.width > 4 && r.height > 4) return { x: r.x+r.width/2, y: r.y+r.height/2 };
      }
    }
    return null;
  }, text).catch(() => null);
  if (!spot) return false;
  await page.mouse.click(spot.x, spot.y).catch(()=>{});
  return true;
}
async function textLen(page) {
  return page.evaluate(() => (document.body.innerText||'').replace(/\s+/g,' ').length).catch(() => 0);
}

async function runSide(tag, url, opts) {
  const report = { tag, url, states: {}, fails404: [], failedReqs: [], preUpgradeFails: [], externals: [], pageErrors: [], synthetics: { track204: 0, audio200: 0 } };
  const browser = await chromium.launch({ headless: true, args: ['--ignore-gpu-blocklist','--enable-gpu-rasterization','--enable-webgl','--disable-blink-features=AutomationControlled', ...(process.platform==='darwin'?['--use-gl=angle','--use-angle=metal']:['--use-gl=angle'])] });
  const context = await browser.newContext({ viewport: { width: VW, height: VH }, userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36', locale: 'en-US' });
  await context.addInitScript(() => { try { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); } catch(e){} });
  if (opts.blockExternal) {
    await context.route('**/*', (route) => {
      const u = route.request().url();
      if (u.startsWith(`http://localhost:${PORT}`)) return route.continue();
      report.externals.push(u.slice(0, 140));
      return route.abort();
    });
  }
  const page = await context.newPage();
  let upgraded = !opts.blockExternal; // original side: everything counts from the start
  page.on('response', (res) => {
    try {
      const st = res.status(); const u = res.url();
      if (st === 404) report.fails404.push(u.slice(0, 140));
      if (st === 204 && /google|collect|doubleclick|facebook|hotjar|segment|clarity/i.test(u)) report.synthetics.track204++;
      if (st === 200 && (res.headers()['content-type']||'').startsWith('audio/')) report.synthetics.audio200++;
    } catch {}
  });
  page.on('requestfailed', (req) => {
    try {
      const err = (req.failure()||{}).errorText || '';
      const item = req.url().slice(0, 140) + ' [' + err + ']';
      if (opts.blockExternal && !req.url().startsWith(`http://localhost:${PORT}`)) return; // already in externals
      // ERR_ABORTED = browser canceled (media element restarts, navigation) —
      // normal on real sites too; genuine missing files surface as 404s instead.
      if (/ERR_ABORTED/.test(err)) { report.aborts = report.aborts || []; report.aborts.push(item); return; }
      (upgraded ? report.failedReqs : report.preUpgradeFails).push(item);
    } catch {}
  });
  page.on('pageerror', (e) => report.pageErrors.push(String(e).slice(0, 200)));

  const shot = async (name) => {
    const f = path.join(SHOT_DIR, `${name}-${tag}.png`);
    await page.screenshot({ path: f, timeout: 15000 }).catch(()=>{});
    return f;
  };
  const clip = { x: VW*0.2, y: VH*0.2, width: VW*0.6, height: VH*0.6 };
  const clipShot = async () => page.screenshot({ clip, timeout: 15000 }).catch(() => null);

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    if (opts.blockExternal) {
      await page.waitForURL('**/live.html', { timeout: 20000 }).catch(() => {});
      upgraded = true;
      report.liveUrl = page.url();
    }
    await sleep(8000); // preloader/intro
    report.states.load = await shot('1-load');
    const homeUrl = page.url();
    const homeText = await textLen(page);

    // trail: idle baseline vs MID-sweep delta, full viewport (trail may sit
    // anywhere; short trails fade fast, so sample DURING motion)
    const fullShot = async () => page.screenshot({ timeout: 15000 }).catch(() => null);
    await page.mouse.move(30, VH - 40); await sleep(1600);
    const i1 = await fullShot(); await sleep(1600);
    const i2 = await fullShot();
    await sweep(page, 5, 110);
    const s1 = await fullShot();
    await sweep(page, 5, 110);
    const s2 = await fullShot();
    report.states.sweep = await shot('2-sweep');
    if (i1 && i2 && s1 && s2) {
      report.trailBaseline = +meanAbsDiff(i1, i2).toFixed(2);
      report.trailSweep = +Math.max(meanAbsDiff(s1, s2), meanAbsDiff(i2, s1)).toFixed(2);
    }

    // scroll states
    for (let i = 0; i < 8; i++) { await page.mouse.wheel(0, 420); await sleep(160); }
    await sleep(1400); report.states.midscroll = await shot('3-midscroll');
    for (let i = 0; i < 30; i++) { await page.mouse.wheel(0, 480); await sleep(120); }
    await sleep(1600); report.states.deepscroll = await shot('4-deepscroll');
    for (let i = 0; i < 45; i++) { await page.mouse.wheel(0, -520); await sleep(70); }
    await sleep(2000);

    // WORK overlay
    const workClicked = await clickByText(page, 'WORK');
    await sleep(3500);
    report.workClicked = workClicked;
    report.workText = await textLen(page);
    report.workUrl = page.url();
    report.states.work = await shot('5-work');
    await sweep(page, 6, 100);
    for (let i = 0; i < 8; i++) { await page.mouse.wheel(0, 420); await sleep(160); }
    await sleep(1200); report.states.workscroll = await shot('6-workscroll');

    // recover → CONTACT
    await page.keyboard.press('Escape').catch(()=>{}); await sleep(900);
    if (page.url() !== homeUrl) { await page.goBack({ timeout: 10000 }).catch(()=>{}); await sleep(1200); }
    const contactClicked = await clickByText(page, 'CONTACT');
    await sleep(3500);
    report.contactClicked = contactClicked;
    report.contactText = await textLen(page);
    report.contactUrl = page.url();
    report.states.contact = await shot('7-contact');

    // back home
    await page.keyboard.press('Escape').catch(()=>{}); await sleep(900);
    if (page.url() !== homeUrl) { await page.goBack({ timeout: 10000 }).catch(()=>{}); await sleep(1500); }
    await sleep(1500);
    report.states.home = await shot('8-home');
    report.homeText = homeText;

    // carousel: 25s idle, 6 clipped shots → distinct clusters; clone: lazy .bin window
    if (opts.blockExternal) { binWindowActive = true; binWindowHits.clear(); }
    const frames = [];
    for (let i = 0; i < 6; i++) {
      await page.mouse.move(VW/2 + Math.sin(i)*25, VH/2 + Math.cos(i)*18, { steps: 2 }).catch(()=>{});
      const f = await clipShot(); if (f) frames.push(f);
      await sleep(4200);
    }
    if (opts.blockExternal) { binWindowActive = false; report.idleNewBins = binWindowHits.size; }
    const kept = [];
    for (const f of frames) {
      let isNew = true;
      for (const k of kept) { const d = meanAbsDiff(f, k); if (d >= 0 && d < 9) { isNew = false; break; } }
      if (isNew) kept.push(f);
    }
    report.carouselDistinct = kept.length;

    // video playback probe (clone only): all same-origin mp4s from sw.js manifest
    if (opts.blockExternal) {
      let mp4s = [];
      try {
        const sw = fs.readFileSync(path.join(CLONE_DIR, 'sw.js'), 'utf-8');
        const M = JSON.parse(sw.slice(sw.indexOf('var M=')+6, sw.indexOf(';\nvar NORM=')));
        const all = Object.keys(M).filter(k => /\.mp4(\?|$)/i.test(k.split('?')[0]));
        mp4s = [...all.filter(k => k.startsWith('/')).slice(0, 2), ...all.filter(k => !k.startsWith('/')).slice(0, 2)];
      } catch (e) { report.videoProbeError = String(e).slice(0,100); }
      report.videos = {};
      for (const src of mp4s) {
        report.videos[src] = await page.evaluate(async (s) => {
          const v = document.createElement('video');
          v.muted = true; v.src = s; v.style.cssText = 'position:fixed;left:0;top:0;width:12px;height:12px;opacity:0.01;z-index:2147483647';
          document.body.appendChild(v);
          try { await v.play(); } catch (e) { v.remove(); return 'play-error: ' + e.message.slice(0, 80); }
          const a = v.currentTime;
          await new Promise(r => setTimeout(r, 1800));
          const b = v.currentTime; v.remove();
          return b > a + 0.2 ? 'PLAYS dt=' + (b-a).toFixed(2) : 'STALLED ' + a.toFixed(2) + '→' + b.toFixed(2);
        }, src).catch(e => 'eval-error: ' + String(e).slice(0, 80));
      }
    }
  } catch (e) { report.fatal = String(e).slice(0, 300); }
  await browser.close().catch(()=>{});
  return report;
}

(async () => {
  const server = http.createServer(serveStatic);
  await new Promise(r => server.listen(PORT, r));
  console.log(`serving ${CLONE_DIR} on :${PORT}`);

  const clone = await runSide('clone', `http://localhost:${PORT}/`, { blockExternal: true });
  const orig = await runSide('orig', ORIG_URL, { blockExternal: false });
  server.close();

  const verdicts = [];
  const V = (name, pass, detail) => { verdicts.push({ name, pass, detail }); };
  V('zero-404', clone.fails404.length === 0, clone.fails404.join(' | ') || 'none');
  V('zero-failed-post-upgrade', clone.failedReqs.length === 0, clone.failedReqs.join(' | ') || 'none');
  V('zero-external-leaks', clone.externals.length === 0, clone.externals.join(' | ') || 'none');
  V('zero-page-errors', clone.pageErrors.length === 0, clone.pageErrors.join(' | ') || 'none');
  V('upgraded-to-live', !!clone.liveUrl && clone.liveUrl.includes('live.html'), clone.liveUrl || 'no');
  V('work-overlay-content', clone.workClicked && clone.workText > 30, `clicked=${clone.workClicked} text=${clone.workText} url=${clone.workUrl}`);
  V('contact-overlay-content', clone.contactClicked && clone.contactText > 30, `clicked=${clone.contactClicked} text=${clone.contactText} url=${clone.contactUrl}`);
  V('carousel-cycles', clone.carouselDistinct >= 3, `distinct=${clone.carouselDistinct} idleNewBins=${clone.idleNewBins}`);
  // "indistinguishable" = judged against the ORIGINAL's own trail response,
  // not an absolute bar (procedural scenes differ per run; orig itself varies)
  const cloneDelta = clone.trailSweep - clone.trailBaseline;
  const origDelta = orig.trailSweep - orig.trailBaseline;
  V('mouse-trail-reactive', clone.trailSweep > clone.trailBaseline && (origDelta <= 0 || cloneDelta >= origDelta * 0.5),
    `clone Δ=${cloneDelta.toFixed(2)} (${clone.trailBaseline}→${clone.trailSweep}) vs orig Δ=${origDelta.toFixed(2)} (${orig.trailBaseline}→${orig.trailSweep})`);
  const vids = Object.entries(clone.videos || {});
  V('videos-play', vids.length > 0 && vids.every(([,r]) => r.startsWith('PLAYS')), vids.map(([k,r]) => `${k}: ${r}`).join(' | ') || 'no mp4s found');

  console.log('\n══ VERDICTS ══');
  let fails = 0;
  for (const v of verdicts) { console.log(`${v.pass ? '✅' : '❌'} ${v.name} — ${v.detail}`); if (!v.pass) fails++; }
  console.log(`\npre-upgrade fails: ${clone.preUpgradeFails.join(' | ') || 'none'}`);
  console.log(`benign aborts: clone=${(clone.aborts||[]).length} orig=${(orig.aborts||[]).length}`);
  console.log(`synthetics: track204=${clone.synthetics.track204} audio200=${clone.synthetics.audio200}`);
  console.log(`orig side: 404=${orig.fails404.length} errors=${orig.pageErrors.length} carousel=${orig.carouselDistinct} trail=${orig.trailSweep}/${orig.trailBaseline} workText=${orig.workText} contactText=${orig.contactText}`);
  fs.writeFileSync(path.join(SHOT_DIR, 'report.json'), JSON.stringify({ clone, orig, verdicts }, null, 2));
  console.log(`\nreport → ${path.join(SHOT_DIR, 'report.json')}`);
  process.exit(fails ? 1 : 0);
})();
