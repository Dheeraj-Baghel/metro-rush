// Quick visual iteration harness: serves dist/, captures loading, menu,
// gameplay, jump, slide, roof and mobile frames, prints debug state + errors.
// Usage: node qa/shots.mjs [outDir]
import { createServer } from 'http';
import { readFileSync, existsSync, mkdirSync } from 'fs';
import { join, extname, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright-core';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const out = resolve(root, process.argv[2] ?? 'artifacts/iter');
mkdirSync(out, { recursive: true });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.wav': 'audio/wav', '.glb': 'model/gltf-binary', '.ttf': 'font/ttf', '.jpg': 'image/jpeg' };
const server = createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const f = join(dist, p);
  if (existsSync(f)) {
    const body = readFileSync(f);
    res.writeHead(200, { 'content-type': MIME[extname(f)] ?? 'application/octet-stream', 'content-length': body.length });
    res.end(req.method === 'HEAD' ? undefined : body);
  } else { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(4388, r));
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-webgl', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });

async function run(viewport, tag) {
  const page = await browser.newPage({ viewport });
  const errs = [];
  page.on('pageerror', (e) => errs.push('pageerror ' + String(e)));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.type() + ' ' + m.text().slice(0, 300)); });
  await page.goto('http://127.0.0.1:4388/');
  await page.waitForTimeout(250);
  await page.screenshot({ path: join(out, `${tag}-loading.png`) });
  await page.locator('button[aria-label="Play"]').waitFor({ timeout: 60000 });
  await page.waitForTimeout(900);
  await page.screenshot({ path: join(out, `${tag}-menu.png`) });
  await page.locator('button[aria-label="Play"]').click();
  await page.waitForTimeout(3400);
  await page.evaluate(() => window.__metro.game.debugGodMode(999));
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(out, `${tag}-run.png`) });
  await page.keyboard.press('Space');
  await page.waitForTimeout(230);
  await page.screenshot({ path: join(out, `${tag}-jump.png`) });
  await page.waitForTimeout(800);
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(260);
  await page.screenshot({ path: join(out, `${tag}-slide.png`) });
  // find a roof: wait until the player is standing on a train (god mode keeps us alive)
  let roof = false;
  for (let i = 0; i < 80 && !roof; i++) {
    const s = await page.evaluate(() => window.__metro.game.debugState());
    if (s.player.groundY > 1) { roof = true; break; }
    // steer toward the ramp lane if a ramp is ahead
    const lane = await page.evaluate(() => {
      const w = window.__metro.game.world ?? null;
      const obs = window.__metro.game['world'].obstacles.filter((o) => o.kind === 'ramp' && o.z < 0 && o.z > -60);
      return obs.length ? obs[0].lane : -1;
    });
    const cur = (await page.evaluate(() => window.__metro.game.debugState())).player.lane;
    if (lane >= 0 && lane !== cur) await page.keyboard.press(lane < cur ? 'ArrowLeft' : 'ArrowRight');
    await page.waitForTimeout(250);
  }
  if (roof) { await page.waitForTimeout(350); await page.screenshot({ path: join(out, `${tag}-roof.png`) }); }
  const state = await page.evaluate(() => window.__metro.game.debugState());
  console.log(tag, 'roofReached', roof, JSON.stringify({ player: state.player, world: state.world, audio: state.audio, renderer: state.renderer, lastValidation: state.validation.slice(-4) }));
  console.log(tag, 'errors', errs.length, errs.slice(0, 8));
  await page.close();
}
await run({ width: 1280, height: 720 }, 'desk');
await run({ width: 390, height: 844 }, 'mob');
await browser.close(); server.close();
