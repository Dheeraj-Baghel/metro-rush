// Records a real gameplay video (Playwright screencast of the running
// production build) and captures matched before/after comparison frames.
//   node qa/record.mjs
// Output: artifacts/evidence/gameplay.webm + after-*.png
import { createServer } from 'http';
import { readFileSync, existsSync, mkdirSync, renameSync, readdirSync } from 'fs';
import { join, extname, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright-core';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const out = join(root, 'artifacts', 'evidence');
mkdirSync(out, { recursive: true });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.wav': 'audio/wav', '.glb': 'model/gltf-binary', '.ttf': 'font/ttf', '.jpg': 'image/jpeg' };
const server = createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const f = join(dist, p);
  if (existsSync(f)) { const b = readFileSync(f); res.writeHead(200, { 'content-type': MIME[extname(f)] ?? 'application/octet-stream', 'content-length': b.length }); res.end(req.method === 'HEAD' ? undefined : b); }
  else { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(4382, r));
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-webgl', '--ignore-gpu-blocklist'] });
const vidDir = join(out, 'raw');
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: vidDir, size: { width: 1280, height: 720 } } });
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:4382/');
await page.locator('button[aria-label="Play"]').waitFor({ timeout: 60000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: join(out, 'after-menu.png') });
await page.locator('button[aria-label="Play"]').click();
await page.waitForTimeout(3400);
// Autopilot: plays the real game with keyboard input. It reads the obstacle
// field (as a human reads the screen) and picks lanes/jumps/slides. No god
// mode — if it crashes, the recording shows that, and it retries.
const shots = { run: false, jump: false, slide: false, roof: false };
const t0 = Date.now();
while (Date.now() - t0 < 42000) {
  const plan = await page.evaluate(() => {
    const g = window.__metro.game; const w = g.world; const p = g.player;
    if (g.state === 'GAME_OVER') return { over: true, hit: g.lastHit, d: Math.round(w.distance) };
    const lane = p.targetLane;
    const danger = (l, near, far) => w.obstacles.filter((o) => o.active && o.lane === l && o.z + o.len / 2 > -far && o.z - o.len / 2 < -near);
    const ahead = danger(lane, -1, 16);
    const roofY = p.groundY;
    let act = null;
    for (const o of ahead) {
      const dist = -(o.z + o.len / 2);
      if (o.kind === 'ramp' && roofY < 0.1) { act = 'stay'; break; }
      if (o.kind === 'train' && roofY > 2.5) continue; // running on it
      if (o.kind === 'train' && w.obstacles.some((r) => r.kind === 'ramp' && r.lane === lane && Math.abs((r.z - r.len / 2) - (o.z + o.len / 2)) < 0.6)) continue; // fed by our ramp
      if (o.kind === 'train' && p.groundY > 2.5) continue;
      const lead = g.speed * 0.3; // ~0.34 s half-airtime minus reaction
      if ((o.kind === 'lowBarrier' || o.kind === 'barrel') && dist < lead + 1.2 && dist > 0.3) { act = 'jump'; break; }
      if (o.kind === 'overhead' && dist < g.speed * 0.32 + 1 && dist > 0.3) { act = 'slide'; break; }
      if (o.kind === 'train' || o.kind === 'movingTrain' || o.kind === 'crates') { act = 'dodge'; break; }
    }
    // roof end: jump the gap if another roof follows, else just drop
    if (roofY > 2.5) {
      const under = w.obstacles.find((o) => o.lane === lane && o.kind === 'train' && o.z - o.len / 2 < 0 && o.z + o.len / 2 > 0);
      if (under && under.z - under.len / 2 > -2.6) {
        const next = w.obstacles.find((o) => o.lane === lane && o.kind === 'train' && o !== under && o.z + o.len / 2 < under.z - under.len / 2 && o.z + o.len / 2 > under.z - under.len / 2 - 8);
        if (next) act = 'jump';
      }
    }
    let to = lane;
    if (act === 'dodge') {
      const score = (l) => { if (l < 0 || l > 2) return -1e9; let s = 0; for (const o of danger(l, -3, 34)) { const dist = -(o.z + o.len / 2); s -= o.kind === 'ramp' ? -8 : (40 - Math.min(34, Math.max(0, dist))); } if (l === 1) s += 0.5; return s; };
      to = [lane - 1, lane + 1].sort((a, b) => score(b) - score(a))[0];
    }
    // steer toward a ramp a little ahead for rooftop coins
    // steer toward an approaching ramp for the rooftop route: only if the
    // ramp lane is clear between here and the ramp's foot
    const ramp = w.obstacles.find((o) => o.kind === 'ramp' && o.z + o.len / 2 < -4 && o.z + o.len / 2 > -32);
    if (!act && roofY < 0.1 && ramp && ramp.lane !== lane && Math.abs(ramp.lane - lane) === 1) {
      const foot = -(ramp.z + ramp.len / 2);
      const blocked = w.obstacles.some((o) => o.lane === ramp.lane && o.kind !== 'ramp' && o.kind !== 'train' && -(o.z + o.len / 2) < foot && o.z - o.len / 2 < 2) ||
        w.obstacles.some((o) => o.lane === ramp.lane && (o.kind === 'train' || o.kind === 'movingTrain') && o.z - o.len / 2 < 2 && o.z + o.len / 2 > -foot + 0.5);
      if (!blocked) to = ramp.lane;
    }
    if (ramp && ramp.lane === lane && roofY < 0.1) act = 'stay';
    const rampInfo = ramp ? `ramp L${ramp.lane} foot ${(-(ramp.z + ramp.len / 2)).toFixed(0)}` : '';
    return { over: false, act, to, lane, roof: roofY > 2.5 && p.grounded && p.y > 2.5, airborne: !p.grounded, sliding: p.sliding, rampInfo, d: Math.round(w.distance) };
  });
  if (plan.over) {
    console.log('crash on', plan.hit, 'at', plan.d, 'm');
    await page.waitForTimeout(1600);
    if (!existsSync(join(out, 'after-gameover.png'))) await page.screenshot({ path: join(out, 'after-gameover.png') });
    await page.locator('button:has-text("Retry")').click();
    await page.waitForTimeout(3400);
    continue;
  }
  if (plan.rampInfo && (globalThis.__lastR !== plan.rampInfo.split(' foot')[0] + Math.floor(plan.d / 40))) { globalThis.__lastR = plan.rampInfo.split(' foot')[0] + Math.floor(plan.d / 40); console.log('d', plan.d, 'lane', plan.lane, plan.rampInfo, 'act', plan.act, 'to', plan.to); }
  if (plan.to !== plan.lane) await page.keyboard.press(plan.to < plan.lane ? 'ArrowLeft' : 'ArrowRight');
  else if (plan.act === 'jump') await page.keyboard.press('Space');
  else if (plan.act === 'slide') await page.keyboard.press('ArrowDown');
  if (!shots.run && Date.now() - t0 > 2500) { await page.screenshot({ path: join(out, 'after-gameplay.png') }); shots.run = true; }
  if (!shots.jump && plan.airborne && !plan.roof && Date.now() - t0 > 5000) { await page.waitForTimeout(120); await page.screenshot({ path: join(out, 'after-jump.png') }); shots.jump = true; }
  if (!shots.slide && plan.sliding) { await page.waitForTimeout(90); await page.screenshot({ path: join(out, 'after-slide.png') }); shots.slide = true; }
  if (!shots.roof && plan.roof) { await page.waitForTimeout(500); await page.screenshot({ path: join(out, 'after-roof.png') }); shots.roof = true; }
  await page.waitForTimeout(60);
}
const vid = page.video();
await ctx.close();
const raw = await vid.path();
renameSync(raw, join(out, 'gameplay.webm'));
console.log('shots', shots, 'video', join(out, 'gameplay.webm'));

// mobile frames
const m = await browser.newPage({ viewport: { width: 390, height: 844 } });
await m.goto('http://127.0.0.1:4382/');
await m.locator('button[aria-label="Play"]').waitFor({ timeout: 60000 });
await m.waitForTimeout(1200);
await m.screenshot({ path: join(out, 'after-menu-mobile.png') });
await m.locator('button[aria-label="Play"]').click();
await m.waitForTimeout(3400);
await m.evaluate(() => window.__metro.game.debugGodMode(30));
await m.waitForTimeout(2600);
await m.screenshot({ path: join(out, 'after-gameplay-mobile.png') });
await browser.close(); server.close();
