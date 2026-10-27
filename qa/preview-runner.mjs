// Drives qa/preview-runner.html: reports clip bone coverage, measures foot
// contact / root drift for candidate clips, and renders a contact sheet of
// key poses to artifacts/anim-preview/*.png for visual review.
import { createServer } from 'http';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { join, extname, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright-core';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'artifacts', 'anim-preview');
mkdirSync(out, { recursive: true });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.png': 'image/png', '.bin': 'application/octet-stream' };
const server = createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/qa/preview-runner.html';
  const f = join(root, p);
  if (existsSync(f)) { res.writeHead(200, { 'content-type': MIME[extname(f)] ?? 'application/octet-stream' }); res.end(readFileSync(f)); }
  else { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(4392, r));
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 480, height: 640 } });
page.on('pageerror', (e) => console.log('[pageerror]', String(e)));
await page.goto('http://127.0.0.1:4392/');
await page.waitForFunction(() => window.ready === true, null, { timeout: 60000 });

const CANDIDATES = (process.argv[2] ?? 'idle,run,jumpStart,jumpLoop,jumpLand,slideStart,slideLoop,slideExit,hit,knockback,death,celebrate').split(',');
const report = {};
for (const name of CANDIDATES) {
  const cov = await page.evaluate((n) => window.api.coverage(n), name);
  const s = await page.evaluate((n) => window.api.sample(n), name);
  const minFoot = Math.min(...s.map((f) => Math.min(f.ballL[1], f.ballR[1])));
  const maxFoot = Math.max(...s.map((f) => Math.min(f.ballL[1], f.ballR[1])));
  const pelvisY = s.map((f) => f.pelvis[1]);
  const drift = [s[s.length - 1].pelvis[0] - s[0].pelvis[0], s[s.length - 1].pelvis[2] - s[0].pelvis[2]].map((x) => +x.toFixed(3));
  report[name] = { ...cov, frames: s.length, lowestFootY: +minFoot.toFixed(3), highestSupportFootY: +maxFoot.toFixed(3), pelvisY: [Math.min(...pelvisY), Math.max(...pelvisY)].map((x) => +x.toFixed(3)), headMinY: +Math.min(...s.map((f) => f.head[1])).toFixed(3), driftXZ: drift, samples: s };
  console.log(`${name.padEnd(16)} bound ${cov.bound}/${cov.tracks} lowestFoot=${minFoot.toFixed(3)} supportFootMax=${maxFoot.toFixed(3)} pelvisY=${report[name].pelvisY} headMin=${report[name].headMinY} driftXZ=${drift}`);
  // contact sheet: 4 phases
  const dur = s[s.length - 1].t;
  for (const [k, frac] of [[0, 0], [1, 0.33], [2, 0.66], [3, 0.95]]) {
    await page.evaluate(([n, t]) => window.api.pose(n, t), [name, dur * frac]);
    await page.screenshot({ path: join(out, `${name}_${k}.png`) });
  }
}
writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 1));
await browser.close(); server.close();
