// Pitch contour + loop-seam continuity analysis (Chromium decoder).
// - contour: dominant pitch per 40 ms window via normalized autocorrelation
//   (80..1600 Hz); reports first/last voiced pitch and overall direction
// - seam: compares the waveform slope across the end->start join against the
//   file's typical sample-to-sample slope (ratio ~1 = continuous, >>1 = click)
import { createServer } from 'http';
import { readFileSync, readdirSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright-core';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dir = resolve(root, process.argv[2]);
const filter = new RegExp(process.argv[3] ?? '.');
const files = readdirSync(dir).filter((f) => f.endsWith('.ogg') && filter.test(f));
const server = createServer((req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<html></html>'); return; }
  try { res.writeHead(200); res.end(readFileSync(join(dir, p.slice(1)))); } catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(4394, r));
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto('http://127.0.0.1:4394/');
const out = await page.evaluate(async (files) => {
  const res = [];
  for (const f of files) {
    const ab = await (await fetch('/' + encodeURIComponent(f))).arrayBuffer();
    const a = await new OfflineAudioContext(1, 44100, 44100).decodeAudioData(ab);
    const d = a.getChannelData(0), sr = a.sampleRate;
    const win = Math.floor(sr * 0.04);
    const pitches = [];
    for (let s = 0; s + win * 2 < d.length && pitches.length < 400; s += win) {
      let e = 0; for (let i = 0; i < win; i++) e += d[s + i] ** 2;
      if (e / win < 1e-4) { pitches.push(0); continue; }
      let best = 0, bestLag = 0;
      for (let lag = Math.floor(sr / 1600); lag < Math.floor(sr / 80); lag++) {
        let c = 0, n1 = 0, n2 = 0;
        for (let i = 0; i < win; i++) { c += d[s + i] * d[s + i + lag]; n1 += d[s + i] ** 2; n2 += d[s + i + lag] ** 2; }
        const r = c / Math.sqrt(n1 * n2 + 1e-12);
        if (r > best) { best = r; bestLag = lag; }
      }
      pitches.push(best > 0.6 ? Math.round(sr / bestLag) : 0);
    }
    const voiced = pitches.filter((p) => p > 0);
    const third = Math.max(1, Math.floor(voiced.length / 3));
    const med = (xs) => { const s = [...xs].sort((x, y) => x - y); return s[Math.floor(s.length / 2)] ?? 0; };
    const first = med(voiced.slice(0, third)), last = med(voiced.slice(-third));
    // seam continuity
    let slopeSum = 0;
    for (let i = 1; i < d.length; i++) slopeSum += Math.abs(d[i] - d[i - 1]);
    const typical = slopeSum / (d.length - 1);
    const seamSlope = Math.abs(d[0] - d[d.length - 1]);
    res.push({ f, dur: +a.duration.toFixed(2), firstHz: first, lastHz: last, dir: first && last ? (last > first * 1.06 ? 'RISING' : last < first / 1.06 ? 'FALLING' : 'flat') : 'unvoiced', voicedPct: Math.round((voiced.length / Math.max(1, pitches.length)) * 100), seamRatio: +(seamSlope / (typical + 1e-9)).toFixed(1) });
  }
  return res;
}, files);
await browser.close(); server.close();
for (const r of out) console.log(`${r.f.padEnd(30)} dur=${String(r.dur).padEnd(6)} ${String(r.firstHz).padStart(5)}Hz -> ${String(r.lastHz).padStart(5)}Hz ${r.dir.padEnd(8)} voiced=${r.voicedPct}% seamRatio=${r.seamRatio}`);
