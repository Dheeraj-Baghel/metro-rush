// Live-scene probe: inspects instanced track tiles and runner bounds in the
// running production build (serves dist/ like run-qa.mjs).
import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { join, extname, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright-core';

const dist = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'dist');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  const f = join(dist, p);
  if (existsSync(f)) { res.writeHead(200, { 'content-type': MIME[extname(f)] ?? 'application/octet-stream' }); res.end(readFileSync(f)); }
  else { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(4397, r));
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', (m) => console.log('[console]', m.type(), m.text().slice(0, 300)));
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 300)));
await page.goto('http://127.0.0.1:4397/');
await page.locator('button[aria-label="Play"]').first().waitFor({ timeout: 30000 });
const info = await page.evaluate(() => {
  const { scene, game } = window.__metro;
  const out = { inst: [], runner: null, ready: game.assetsReady, prog: game.loadProgress, hasAnim: !!game.player.animator, sameGame: window.__metro.game === game };
  let total = 0, inst = 0; scene.traverse((o) => { total++; if (o.isInstancedMesh) inst++; });
  out.total = total; out.instAll = inst;
  scene.traverse((o) => {
    if (o.isInstancedMesh && o.userData.sharedAsset && out.inst.length < 4) {
      const m = new o.matrixWorld.constructor(); o.getMatrixAt(0, m);
      o.geometry.computeBoundingBox();
      out.inst.push({ count: o.count, visible: o.visible, parentVisible: o.parent?.visible, bbox: [o.geometry.boundingBox.min.toArray(), o.geometry.boundingBox.max.toArray()].map(a => a.map(v => +v.toFixed(2))), m0: m.elements.map(v => +v.toFixed(2)) });
    }
  });
  const r = game.player.animator?.root;
  if (r) {
    const B = r.constructor; // not Box3; compute via skinned bounds
    let n = 0; r.traverse((o) => { if (o.isSkinnedMesh) n++; });
    r.updateMatrixWorld(true);
    out.runner = { skinned: n, worldScale: r.children[0]?.scale.toArray().map(v => +v.toFixed(3)), rotY: r.children[0]?.rotation.y };
  }
  return out;
});
console.log(JSON.stringify(info, null, 1));
await browser.close(); server.close();
