// Music candidate analysis in Chromium's decoder:
//  - tempo estimate via onset-energy autocorrelation (60..200 BPM)
//  - loop seam: sample-level discontinuity & RMS jump across end->start join
//  - loudness section profile (2 s windows) to spot intros/fades
import { createServer } from 'http';
import { readFileSync, readdirSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright-core';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dir = resolve(root, process.argv[2] ?? 'asset-inbox/music');
const files = readdirSync(dir).filter((f) => f.endsWith('.ogg'));
const server = createServer((req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<html></html>'); return; }
  try { res.writeHead(200); res.end(readFileSync(join(dir, p.slice(1)))); } catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(4395, r));
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto('http://127.0.0.1:4395/');
const out = await page.evaluate(async (files) => {
  const res = [];
  for (const f of files) {
    const ab = await (await fetch('/' + encodeURIComponent(f))).arrayBuffer();
    const ctx = new OfflineAudioContext(2, 44100, 44100);
    const a = await ctx.decodeAudioData(ab);
    const d = a.getChannelData(0);
    const sr = a.sampleRate;
    // energy envelope at 100 Hz
    const hop = Math.floor(sr / 100);
    const env = [];
    for (let i = 0; i + hop < d.length; i += hop) {
      let s = 0; for (let j = 0; j < hop; j++) s += d[i + j] * d[i + j];
      env.push(Math.sqrt(s / hop));
    }
    // onset = positive energy flux
    const on = env.map((v, i) => Math.max(0, v - (env[i - 1] ?? v)));
    let best = 0, bestLag = 0;
    for (let bpm = 70; bpm <= 190; bpm++) {
      const lag = Math.round((60 / bpm) * 100);
      let s = 0; for (let i = lag; i < on.length; i++) s += on[i] * on[i - lag];
      if (s > best) { best = s; bestLag = lag; }
    }
    // seam: last vs first 5 ms
    const w = Math.floor(sr * 0.005);
    let e0 = 0, e1 = 0; for (let i = 0; i < w; i++) { e0 += d[i] ** 2; e1 += d[d.length - 1 - i] ** 2; }
    const rmsStart = Math.sqrt(e0 / w), rmsEnd = Math.sqrt(e1 / w);
    const jump = Math.abs(d[0] - d[d.length - 1]);
    // 2-second loudness profile
    const prof = [];
    const win = sr * 2;
    for (let i = 0; i < d.length; i += win) {
      let s = 0, n = 0; for (let j = i; j < Math.min(d.length, i + win); j++) { s += d[j] ** 2; n++; }
      prof.push(Math.round(20 * Math.log10(Math.sqrt(s / n) + 1e-9)));
    }
    res.push({ f, dur: +a.duration.toFixed(2), bpm: Math.round(6000 / bestLag), rmsStart: +rmsStart.toFixed(3), rmsEnd: +rmsEnd.toFixed(3), sampleJump: +jump.toFixed(4), profileDb: prof.join(' ') });
  }
  return res;
}, files);
await browser.close(); server.close();
for (const r of out) console.log(JSON.stringify(r));
