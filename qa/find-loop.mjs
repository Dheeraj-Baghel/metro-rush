// Finds a click-free loop region inside a long music file: searches bar-length
// multiples (from estimated tempo) for an end point whose waveform and local
// spectrum best match the loop start. Reports candidate loopStart/loopEnd in
// seconds for AudioBufferSourceNode.loopStart/loopEnd (no re-encoding needed).
import { createServer } from 'http';
import { readFileSync } from 'fs';
import { join, resolve, dirname, basename } from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright-core';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const file = resolve(root, process.argv[2]);
const bpmHint = +(process.argv[3] ?? 0);
const server = createServer((req, res) => {
  if (req.url === '/') { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<html></html>'); return; }
  res.writeHead(200); res.end(readFileSync(file));
});
await new Promise((r) => server.listen(4393, r));
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto('http://127.0.0.1:4393/');
const r = await page.evaluate(async (bpmHint) => {
  const ab = await (await fetch('/a.ogg')).arrayBuffer();
  const a = await new OfflineAudioContext(2, 44100, 44100).decodeAudioData(ab);
  const d = a.getChannelData(0), sr = a.sampleRate;
  // envelope tempo (if no hint)
  const hop = Math.floor(sr / 200), env = [];
  for (let i = 0; i + hop < d.length; i += hop) { let s = 0; for (let j = 0; j < hop; j++) s += Math.abs(d[i + j]); env.push(s / hop); }
  const on = env.map((v, i) => Math.max(0, v - (env[i - 1] ?? v)));
  let bpm = bpmHint;
  if (!bpm) {
    let best = 0;
    for (let b = 70; b <= 200; b += 0.25) {
      const lag = (60 / b) * 200; const li = Math.round(lag);
      let s = 0; for (let i = li; i < on.length; i++) s += on[i] * on[i - li];
      if (s > best) { best = s; bpm = b; }
    }
  }
  // find first strong onset as loop start (skip any silence)
  let startS = 0; while (startS < d.length && Math.abs(d[startS]) < 0.02) startS++;
  const beat = (60 / bpm) * sr;
  const W = 2048;
  const sim = (p, q) => { // waveform correlation over a short window
    let c = 0, n1 = 0, n2 = 0;
    for (let i = 0; i < W; i++) { const x = d[p + i], y = d[q + i]; c += x * y; n1 += x * x; n2 += y * y; }
    return c / Math.sqrt(n1 * n2 + 1e-12);
  };
  const cands = [];
  for (let bars = 4; bars <= 64; bars += 4) {
    const ideal = startS + bars * 4 * beat;
    if (ideal + W >= d.length) break;
    // refine within +/- 30 ms for the best waveform match
    let best = -2, bestQ = 0;
    for (let off = -Math.floor(sr * 0.03); off <= Math.floor(sr * 0.03); off++) {
      const q = Math.round(ideal + off);
      const s = sim(startS, q);
      if (s > best) { best = s; bestQ = q; }
    }
    cands.push({ bars, corr: +best.toFixed(4), loopStart: +(startS / sr).toFixed(5), loopEnd: +(bestQ / sr).toFixed(5), len: +((bestQ - startS) / sr).toFixed(2), jump: +Math.abs(d[startS] - d[bestQ]).toFixed(4) });
  }
  return { bpm, dur: a.duration, cands };
}, bpmHint);
await browser.close(); server.close();
console.log(basename(file), 'bpm≈', r.bpm, 'dur', r.dur.toFixed(2));
for (const c of r.cands) console.log(`  bars=${String(c.bars).padStart(2)} len=${String(c.len).padStart(6)}s corr=${c.corr} jump=${c.jump} start=${c.loopStart} end=${c.loopEnd}`);
