// Builds the curated METRO RUSH runtime audio set from downloaded CC0 sources.
// Runs in Chromium so it uses the same Vorbis decoder the game targets, then
// trims / fades / normalizes / loop-crossfades each source with sample-exact
// edits and encodes 16-bit PCM WAV (lossless, universally decodable incl.
// Safari — OGG decode support on Safari is the reason not to ship OGG here).
//
// Every output records its source file + time range in public/assets/c/audio/
// audio-sources.json so provenance survives the edit.
import { createServer } from 'http';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright-core';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(root, 'public', 'assets', 'c', 'audio');
mkdirSync(OUT, { recursive: true });

const K = 'metro-rush-assets/assets/audio';
// name: [source, startSec, durSec|null, opts]
//   opts.loop: crossfade seconds for a seamless loop
//   opts.fadeIn/fadeOut: seconds; opts.gainDb: final peak target (dBFS)
//   opts.mono: downmix; opts.sr: resample rate
const SPEC = {
  // ---- movement (Kenney Impact Sounds, concrete; RPG cloth) ----
  step0: [`${K}/kenney-impact-sounds/Audio/footstep_concrete_000.ogg`, 0, null, { gainDb: -6, mono: true }],
  step1: [`${K}/kenney-impact-sounds/Audio/footstep_concrete_001.ogg`, 0, null, { gainDb: -6, mono: true }],
  step2: [`${K}/kenney-impact-sounds/Audio/footstep_concrete_003.ogg`, 0, null, { gainDb: -6, mono: true }],
  step3: [`${K}/kenney-impact-sounds/Audio/footstep_concrete_004.ogg`, 0, null, { gainDb: -6, mono: true }],
  jump: ['asset-inbox/cand/rpg/cloth1.ogg', 0.06, 0.42, { fadeOut: 0.12, gainDb: -4, mono: true }],
  land: [`${K}/kenney-impact-sounds/Audio/impactSoft_medium_001.ogg`, 0, null, { gainDb: -5, mono: true }],
  slide: ['asset-inbox/cand/rpg/cloth3.ogg', 0.04, 0.42, { fadeOut: 0.14, gainDb: -6, mono: true }],
  lane: ['asset-inbox/bsb/whoosh-3-s1795.ogg', 0.26, 0.38, { fadeIn: 0.01, fadeOut: 0.12, gainDb: -8, mono: true }],
  // ---- pickups (Kenney Digital Audio / Interface) ----
  coin: [`${K}/kenney-digital-audio/Audio/highUp.ogg`, 0.13, 0.32, { fadeOut: 0.08, gainDb: -7 }],
  powerup: [`${K}/kenney-digital-audio/Audio/powerUp3.ogg`, 0.12, 0.9, { fadeOut: 0.2, gainDb: -5 }],
  activate: [`${K}/kenney-interface-sounds/Audio/confirmation_003.ogg`, 0, null, { fadeOut: 0.05, gainDb: -6 }],
  // ---- trains (BigSoundBank CC0, Joseph Sardin) ----
  trainPass: ['asset-inbox/bsb/passage-of-a-train-6-s3416.ogg', 7.4, 6.6, { fadeIn: 0.6, fadeOut: 1.2, gainDb: -3, mono: true }],
  trainHorn: ['asset-inbox/bsb/train-horn-2-s2846.ogg', 0.03, 1.7, { fadeOut: 0.35, gainDb: -4, mono: true }],
  // ---- impacts ----
  crash: [`${K}/kenney-impact-sounds/Audio/impactPunch_heavy_001.ogg`, 0.01, null, { gainDb: -2, mono: true }],
  crashMetal: [`${K}/kenney-impact-sounds/Audio/impactPlate_heavy_001.ogg`, 0, null, { gainDb: -6, mono: true }],
  // ---- UI (Kenney Interface Sounds + Music Jingles) ----
  click: [`${K}/kenney-interface-sounds/Audio/select_002.ogg`, 0, null, { gainDb: -6, mono: true }],
  back: [`${K}/kenney-interface-sounds/Audio/back_001.ogg`, 0, null, { gainDb: -8, mono: true }],
  countTick: [`${K}/kenney-interface-sounds/Audio/tick_002.ogg`, 0, null, { gainDb: -6, mono: true }],
  countGo: [`${K}/kenney-interface-sounds/Audio/confirmation_001.ogg`, 0, null, { gainDb: -5, mono: true }],
  gameOver: ['asset-inbox/cand/jingles/jingles_NES13.ogg', 0, null, { fadeOut: 0.1, gainDb: -6 }],
  highScore: ['asset-inbox/cand/jingles/jingles_NES07.ogg', 0, null, { fadeOut: 0.1, gainDb: -6 }],
  // ---- beds ----
  ambience: ['asset-inbox/bsb/dock-gare-du-nord-paris-s0647.ogg', 30, 24, { loop: 2.0, gainDb: -8, mono: true, sr: 22050 }],
  // music: 'Keep your dream alive!' (congusbongus, CC0). Loop region chosen by
  // qa/find-loop.mjs (44 bars @166.5 BPM, corr 0.53, sample jump 0.011) and
  // finished with a short equal-power crossfade.
  music: ['asset-inbox/music/keep_your_dream_alive.ogg', 0.00109, 63.4514, { loop: 0.03, gainDb: -3, sr: 32000 }],
};

const files = [...new Set(Object.values(SPEC).map((s) => s[0]))];
for (const f of files) if (!existsSync(join(root, f))) { console.error('MISSING SOURCE', f); process.exit(1); }
const server = createServer((req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<html></html>'); return; }
  try { res.writeHead(200); res.end(readFileSync(join(root, p.slice(1)))); } catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(4391, r));
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto('http://127.0.0.1:4391/');

const results = {};
for (const [name, [src, start, dur, opts]] of Object.entries(SPEC)) {
  const r = await page.evaluate(async ({ src, start, dur, opts }) => {
    const ab = await (await fetch('/' + src.split('/').map(encodeURIComponent).join('/'))).arrayBuffer();
    const ctx = new OfflineAudioContext(2, 48000, 48000);
    const a = await ctx.decodeAudioData(ab);
    const srcSr = a.sampleRate;
    const outSr = opts.sr ?? Math.min(44100, srcSr);
    const s0 = Math.floor(start * srcSr);
    const n = dur ? Math.min(a.length - s0, Math.floor(dur * srcSr)) : a.length - s0;
    let chans = [];
    for (let c = 0; c < a.numberOfChannels; c++) chans.push(a.getChannelData(c).slice(s0, s0 + n));
    if (opts.mono || chans.length === 1) {
      const m = new Float32Array(n);
      for (const ch of chans) for (let i = 0; i < n; i++) m[i] += ch[i] / chans.length;
      chans = [m];
    }
    // resample (linear; only used for beds where it is inaudible)
    if (outSr !== srcSr) {
      const ratio = srcSr / outSr, m2 = Math.floor(n / ratio);
      chans = chans.map((ch) => { const o = new Float32Array(m2); for (let i = 0; i < m2; i++) { const x = i * ratio, i0 = Math.floor(x), f = x - i0; o[i] = ch[i0] * (1 - f) + (ch[i0 + 1] ?? ch[i0]) * f; } return o; });
    }
    let L = chans[0].length;
    // seamless loop: equal-power crossfade. The loop body is [X, L) and the
    // first X samples are the blend of tail [L-X, L) fading out into head
    // [0, X) fading in — placed at the END so the file's last sample flows
    // directly into its first sample (head[X]) with no discontinuity.
    if (opts.loop) {
      const X = Math.floor(opts.loop * outSr);
      chans = chans.map((ch) => {
        // file = head[X .. L-X) + blend(tail[L-X..L) -> head[0..X));
        // the blend ends on head[X-1], whose successor head[X] is sample 0.
        const body = ch.slice(X, L - X);
        const o = new Float32Array(body.length + X);
        o.set(body, 0);
        for (let i = 0; i < X; i++) {
          const t = (i + 1) / X;
          o[body.length + i] = ch[L - X + i] * Math.cos(t * Math.PI / 2) + ch[i] * Math.sin(t * Math.PI / 2);
        }
        return o;
      });
      L = chans[0].length;
    }
    // fades (never on loops: they would put a dip in the seam)
    if (!opts.loop) {
      const fi = Math.floor((opts.fadeIn ?? 0.003) * outSr), fo = Math.floor((opts.fadeOut ?? 0.01) * outSr);
      for (const ch of chans) {
        for (let i = 0; i < fi && i < L; i++) ch[i] *= i / fi;
        for (let i = 0; i < fo && i < L; i++) ch[L - 1 - i] *= i / fo;
      }
    }
    // peak normalize to target
    let peak = 0;
    for (const ch of chans) for (let i = 0; i < L; i++) peak = Math.max(peak, Math.abs(ch[i]));
    const target = Math.pow(10, (opts.gainDb ?? -3) / 20);
    const g = peak > 0 ? target / peak : 1;
    // seam check after processing
    let seam = null;
    if (opts.loop) {
      const ch = chans[0];
      let slope = 0; for (let i = 1; i < L; i++) slope += Math.abs(ch[i] - ch[i - 1]);
      seam = +((Math.abs(ch[0] - ch[L - 1]) / (slope / (L - 1))) || 0).toFixed(2);
    }
    // 16-bit PCM WAV
    const nc = chans.length, bytes = 44 + L * nc * 2;
    const buf = new ArrayBuffer(bytes), dv = new DataView(buf);
    const w = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); dv.setUint32(4, bytes - 8, true); w(8, 'WAVE'); w(12, 'fmt ');
    dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, nc, true);
    dv.setUint32(24, outSr, true); dv.setUint32(28, outSr * nc * 2, true); dv.setUint16(32, nc * 2, true); dv.setUint16(34, 16, true);
    w(36, 'data'); dv.setUint32(40, L * nc * 2, true);
    let o = 44;
    for (let i = 0; i < L; i++) for (let c = 0; c < nc; c++) { const v = Math.max(-1, Math.min(1, chans[c][i] * g)); dv.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true); o += 2; }
    let bin = ''; const u8 = new Uint8Array(buf);
    for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode(...u8.subarray(i, i + 0x8000));
    return { b64: btoa(bin), dur: L / outSr, sr: outSr, ch: nc, seam, gainApplied: +g.toFixed(3) };
  }, { src, start, dur, opts });
  writeFileSync(join(OUT, `${name}.wav`), Buffer.from(r.b64, 'base64'));
  results[name] = { source: src, startSec: start, durSec: +r.dur.toFixed(3), sampleRate: r.sr, channels: r.ch, loop: !!opts.loop, seamRatio: r.seam };
  console.log(`${name.padEnd(11)} ${r.dur.toFixed(2)}s ${r.sr}Hz ch=${r.ch}${opts.loop ? ' seam=' + r.seam : ''}  <- ${src.split('/').pop()}`);
}
writeFileSync(join(OUT, 'audio-sources.json'), JSON.stringify(results, null, 2));
await browser.close(); server.close();
