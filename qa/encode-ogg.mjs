// Encodes the large beds (music, ambience) from the processed WAVs to
// compressed formats using the browser's MediaRecorder (no ffmpeg here):
// renders the PCM through an AudioContext into a MediaStreamDestination and
// records Opus. Chromium records 'audio/webm;codecs=opus'; that container is
// only used as a transport here — we then verify the result decodes and
// report its exact decoded duration so loop points stay sample-accurate.
import { createServer } from 'http';
import { readFileSync, writeFileSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright-core';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'public', 'assets', 'c', 'audio');
const names = process.argv.slice(2);
const server = createServer((req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<html></html>'); return; }
  try { res.writeHead(200); res.end(readFileSync(join(dir, p.slice(1)))); } catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(4390, r));
const browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
await page.goto('http://127.0.0.1:4390/');
for (const n of names) {
  const r = await page.evaluate(async (n) => {
    const ctx = new AudioContext();
    const a = await ctx.decodeAudioData(await (await fetch('/' + n + '.wav')).arrayBuffer());
    const dest = ctx.createMediaStreamDestination();
    const src = ctx.createBufferSource(); src.buffer = a; src.connect(dest);
    const mime = MediaRecorder.isTypeSupported('audio/ogg;codecs=opus') ? 'audio/ogg;codecs=opus' : 'audio/webm;codecs=opus';
    const rec = new MediaRecorder(dest.stream, { mimeType: mime, audioBitsPerSecond: n === 'music' ? 128000 : 64000 });
    const chunks = [];
    rec.ondataavailable = (e) => chunks.push(e.data);
    const done = new Promise((res) => (rec.onstop = res));
    rec.start(); src.start();
    await new Promise((res) => setTimeout(res, a.duration * 1000 + 400));
    rec.stop(); await done;
    const blob = new Blob(chunks, { type: mime });
    const ab = await blob.arrayBuffer();
    const back = await ctx.decodeAudioData(ab.slice(0));
    let bin = ''; const u8 = new Uint8Array(ab);
    for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode(...u8.subarray(i, i + 0x8000));
    return { mime, b64: btoa(bin), srcDur: a.duration, decDur: back.duration, bytes: u8.length };
  }, n);
  const ext = r.mime.includes('ogg') ? 'ogg' : 'webm';
  writeFileSync(join(dir, `${n}.${ext}`), Buffer.from(r.b64, 'base64'));
  console.log(n, r.mime, r.bytes, 'bytes', 'src', r.srcDur.toFixed(3), 'decoded', r.decDur.toFixed(3));
}
await browser.close(); server.close();
