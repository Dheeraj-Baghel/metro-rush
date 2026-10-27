// Objective audio audition: decodes candidate OGGs in Chromium (the real
// target decoder) and reports duration, peak, RMS, attack, decay tail and a
// spectral-brightness estimate (zero-crossing rate). Used to choose samples by
// measured character rather than by filename. Usage:
//   node qa/audition-audio.mjs <dir-or-glob-prefix>...
import { createServer } from 'http';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'fs';
import { join, resolve, dirname, relative } from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright-core';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dirs = process.argv.slice(2);
const files = [];
for (const d of dirs) {
  const abs = resolve(root, d);
  for (const f of readdirSync(abs)) if (/.(ogg|wav)$/.test(f)) files.push(join(abs, f));
}
const server = createServer((req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<html></html>'); return; }
  const f = join(root, p);
  try { statSync(f); res.writeHead(200, { 'content-type': 'audio/ogg' }); res.end(readFileSync(f)); }
  catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(4396, r));
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto('http://127.0.0.1:4396/');
const urls = files.map((f) => '/' + relative(root, f).split('\\').join('/'));
const out = await page.evaluate(async (urls) => {
  const ctx = new OfflineAudioContext(1, 44100, 44100);
  const res = [];
  for (const u of urls) {
    try {
      const buf = await (await fetch(u)).arrayBuffer();
      const a = await ctx.decodeAudioData(buf);
      const d = a.getChannelData(0);
      let peak = 0, sum = 0, zc = 0, peakIdx = 0;
      for (let i = 0; i < d.length; i++) {
        const v = Math.abs(d[i]);
        if (v > peak) { peak = v; peakIdx = i; }
        sum += d[i] * d[i];
        if (i && (d[i] >= 0) !== (d[i - 1] >= 0)) zc++;
      }
      // time until signal falls below 10% of peak for good (tail length)
      let end = d.length - 1;
      while (end > 0 && Math.abs(d[end]) < peak * 0.1) end--;
      // leading silence before first sample above 5% of peak
      let start = 0;
      while (start < d.length && Math.abs(d[start]) < peak * 0.05) start++;
      // loop seam: amplitude difference between first & last 10 ms windows
      const w = Math.floor(a.sampleRate * 0.01);
      let s0 = 0, s1 = 0;
      for (let i = 0; i < w; i++) { s0 += Math.abs(d[i]); s1 += Math.abs(d[d.length - 1 - i]); }
      res.push({
        url: u,
        dur: +a.duration.toFixed(3),
        ch: a.numberOfChannels,
        sr: a.sampleRate,
        peak: +peak.toFixed(3),
        rmsDb: +(10 * Math.log10(sum / d.length + 1e-12)).toFixed(1),
        attackMs: Math.round(((peakIdx - start) / a.sampleRate) * 1000),
        leadMs: Math.round((start / a.sampleRate) * 1000),
        bodyMs: Math.round(((end - start) / a.sampleRate) * 1000),
        zcr: Math.round(zc / a.duration), // ~brightness: crossings per second
        seam: +(Math.abs(s0 - s1) / w).toFixed(4),
      });
    } catch (e) { res.push({ url: u, error: String(e) }); }
  }
  return res;
}, urls);
await browser.close(); server.close();
for (const r of out) {
  if (r.error) { console.log('ERR', r.url, r.error); continue; }
  console.log(`${r.url.split('/').pop().padEnd(32)} dur=${String(r.dur).padEnd(6)} peak=${r.peak} rms=${r.rmsDb}dB attack=${r.attackMs}ms lead=${r.leadMs}ms body=${r.bodyMs}ms zcr=${r.zcr}/s seam=${r.seam} ch=${r.ch}`);
}
writeFileSync(join(root, 'artifacts', 'audio-audition.json'), JSON.stringify(out, null, 2));
