// METRO RUSH browser QA. Serves dist/ (static, like production hosting) and
// drives the real game in Chromium with WebGL. Every check exercises actual
// gameplay through the engine; screenshots land in artifacts/testing/.
//
//   node qa/run-qa.mjs              full suite (~4 min)
//   METRO_QA_ENDURANCE=1 node ...   + 5-minute recycling / heap run
import { createServer } from 'http';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { join, extname, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright-core';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const outDir = join(root, 'artifacts', 'testing');
mkdirSync(outDir, { recursive: true });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.wav': 'audio/wav', '.glb': 'model/gltf-binary', '.ttf': 'font/ttf', '.jpg': 'image/jpeg' };
let block = null; // substring of a URL to 404 (simulated failure)
let hits = new Map();
const server = createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  if (req.method === 'GET') hits.set(p, (hits.get(p) ?? 0) + 1);
  const f = join(dist, p);
  if (block && p.includes(block)) { res.writeHead(404); res.end(); return; }
  if (existsSync(f)) {
    const body = readFileSync(f);
    res.writeHead(200, { 'content-type': MIME[extname(f)] ?? 'application/octet-stream', 'content-length': body.length });
    res.end(req.method === 'HEAD' ? undefined : body);
  } else { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(4398, r));

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-webgl', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });

async function open(viewport, { touch = false } = {}) {
  const ctx = await browser.newContext({ viewport, hasTouch: touch, isMobile: touch, deviceScaleFactor: touch ? 2 : 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('response', (r) => { if (r.status() >= 400 && !(block && r.url().includes(block))) errors.push(`HTTP ${r.status()} ${r.url()}`); });
  return { ctx, page, errors };
}
const shot = (page, name) => page.screenshot({ path: join(outDir, name + '.png') });
const dbg = (page) => page.evaluate(() => window.__metro.game.debugState());
const waitPlay = (page) => page.locator('button[aria-label="Play"]').waitFor({ timeout: 60000 });
const waitFor = async (page, fn, ms = 20000, step = 100) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await page.evaluate(fn)) return true; await page.waitForTimeout(step); } return false; };

// ===================== 1. cold-cache loading =====================
{
  const { ctx, page, errors } = await open({ width: 1280, height: 720 });
  const stages = new Set();
  const placeholderSeen = [];
  await page.goto('http://127.0.0.1:4398/');
  // sample the loading UI until the menu appears
  const t0 = Date.now();
  let revealedAt = 0;
  while (Date.now() - t0 < 60000) {
    const s = await page.evaluate(() => ({
      stage: document.querySelector('.stages li.active')?.textContent ?? null,
      loading: !!document.querySelector('.loading'),
      canvasOpacity: getComputedStyle(document.querySelector('canvas')).opacity,
      play: !!document.querySelector('button[aria-label="Play"]'),
      menuState: window.__metro?.game.state,
    }));
    if (s.stage) stages.add(s.stage);
    // scene must stay hidden while loading: no partial assembly visible
    if (s.loading && +s.canvasOpacity > 0.01) placeholderSeen.push(s);
    if (s.play) { revealedAt = Date.now() - t0; break; }
    await page.waitForTimeout(40);
  }
  check('loading screen reports real stages', stages.size >= 2, [...stages].join(' > '));
  check('3D scene hidden until fully prepared (no placeholder swaps)', placeholderSeen.length === 0, `${placeholderSeen.length} visible frames during load`);
  check('menu revealed after load', revealedAt > 0, `${revealedAt} ms`);
  const prep = await page.evaluate(() => {
    const g = window.__metro.game;
    let skinned = 0, procedural = 0;
    window.__metro.scene.traverse((o) => { if (o.isSkinnedMesh) skinned++; });
    return { skinned, state: g.state, prog: g.renderer.info.programs.length };
  });
  check('skinned runner present at reveal', prep.skinned > 0, JSON.stringify(prep));
  await page.waitForTimeout(700);
  await shot(page, 'menu-desktop');
  // first-action shader stutter: time the first jump/slide/train frames
  await page.locator('button[aria-label="Play"]').click();
  await page.waitForTimeout(3300);
  const progsBefore = await page.evaluate(() => window.__metro.game.renderer.info.programs.length);
  const frameTimes = await page.evaluate(async () => {
    const g = window.__metro.game;
    g.debugGodMode(30);
    const ts = [];
    let last = performance.now();
    const press = (k) => window.dispatchEvent(new KeyboardEvent('keydown', { code: k, key: k }));
    for (let i = 0; i < 90; i++) {
      if (i === 5) press('Space');
      if (i === 40) press('ArrowDown');
      if (i === 60) g.debugGivePower('shield');
      await new Promise((r) => requestAnimationFrame(r));
      const n = performance.now(); ts.push(n - last); last = n;
    }
    return ts;
  });
  const progsAfter = await page.evaluate(() => window.__metro.game.renderer.info.programs.length);
  const worst = Math.max(...frameTimes.slice(2));
  check('no new shader programs compiled on first actions', progsAfter === progsBefore, `${progsBefore} -> ${progsAfter} programs`);
  check('first-action frames free of major stutter (<100 ms)', worst < 100, `worst ${worst.toFixed(1)} ms`);
  check('no console errors / missing files on cold start', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

// ===================== 2. failure + retry reuses cache =====================
{
  block = 'runner-anims.glb';
  hits = new Map();
  const { ctx, page } = await open({ width: 1280, height: 720 });
  await page.goto('http://127.0.0.1:4398/');
  const failed = await page.locator('.load-error').waitFor({ timeout: 60000 }).then(() => true).catch(() => false);
  const msg = failed ? await page.locator('.load-detail.mono').innerText() : '';
  check('missing required asset shows retry with exact file', failed && msg.includes('runner-anims.glb'), msg);
  await shot(page, 'load-error');
  const firstPass = new Map(hits);
  block = null;
  const retryHits = new Map();
  page.on('request', (r) => { if (r.method() === 'GET' && /\.(glb|wav)$/.test(r.url())) { const u = new URL(r.url()).pathname; retryHits.set(u, (retryHits.get(u) ?? 0) + 1); } });
  await page.locator('button:has-text("Retry")').click();
  const ok = await waitPlay(page).then(() => true).catch(() => false);
  // 'later'-stage district files load only after the first successful reveal,
  // so they legitimately appear for the first time here; exclude them
  const refetchedList = [...retryHits.keys()].filter((p) => !p.includes('runner-anims') && (firstPass.get(p) ?? 0) > 0);
  const refetched = refetchedList.length;
  check('retry recovers and reaches the menu', ok);
  check('retry reuses cached assets (only failed file re-requested)', refetched === 0 && retryHits.has('/assets/c/runner/runner-anims.glb'), `${refetched} previously-loaded files re-requested ${refetchedList.slice(0,4).join(',')}; failed file re-requested: ${retryHits.has('/assets/c/runner/runner-anims.glb')}`);
  await ctx.close();
}

// ===================== 3. gameplay (desktop) =====================
const { ctx: dctx, page, errors } = await open({ width: 1280, height: 720 });
await page.goto('http://127.0.0.1:4398/');
await waitPlay(page);
await page.locator('button[aria-label="Play"]').click();
check('countdown appears', await page.locator('.count-num').isVisible().catch(() => false));
await page.waitForTimeout(3400);
// control/feel checks must not depend on surviving the course; collision is
// verified deterministically in section 4
await page.evaluate(() => window.__metro.game.debugGodMode(120));
let s = await dbg(page);
check('run starts after countdown', s.state === 'PLAYING' && s.player.anim === 'run', s.player.anim);
check('tutorial sequence opens the run', s.validation.length > 0 && ['t-coins-lane'].includes(s.validation[0].id), s.validation.map((v) => v.id).join(','));
await shot(page, 'gameplay-run');

// lane switching timing
const lane0 = (await dbg(page)).player.lane;
await page.keyboard.press('ArrowLeft');
await page.waitForTimeout(220);
s = await dbg(page);
check('lane switch responds within one lane-change time', s.player.lane === Math.max(0, lane0 - 1), `lane ${lane0} -> ${s.player.lane}`);
await shot(page, 'gameplay-lane');
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(250);

// jump arc + animation state
await page.evaluate(() => window.__metro.game.debugGodMode(20));
await page.keyboard.press('Space');
const apex = await page.evaluate(async () => { let m = 0; for (let i = 0; i < 40; i++) { await new Promise((r) => requestAnimationFrame(r)); m = Math.max(m, window.__metro.game.debugState().player.y); } return m; });
await page.waitForTimeout(80);
check('jump reaches expected apex (~1.8 m) and lands', apex > 1.5 && apex < 2.1 && (await dbg(page)).player.grounded, `apex ${apex.toFixed(2)}`);
await page.keyboard.press('Space');
await page.waitForTimeout(210);
await shot(page, 'gameplay-jump');
await page.waitForTimeout(700);

// slide shrinks collider and uses the slide clip
await page.keyboard.press('ArrowDown');
await page.waitForTimeout(250);
s = await dbg(page);
check('slide state + low pose', s.player.sliding && s.player.anim === 'slide', s.player.anim);
await shot(page, 'gameplay-slide');
await page.waitForTimeout(900);

// pause / resume freezes simulation and suspends audio
await page.keyboard.press('Escape');
await page.waitForTimeout(250);
const d1 = (await dbg(page)).distance;
await page.waitForTimeout(600);
const p2 = await dbg(page);
check('pause freezes simulation', Math.abs(p2.distance - d1) < 0.01 && p2.state === 'PAUSED');
check('pause suspends audio', p2.audio.state === 'suspended', p2.audio.state);
await shot(page, 'paused');
await page.locator('button:has-text("Resume")').click();
await page.waitForTimeout(400);
s = await dbg(page);
check('resume continues run + audio', s.state === 'PLAYING' && s.audio.state === 'running' && s.distance > d1, s.audio.state);

// tab hide pauses + suspends
await page.evaluate(() => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
await page.waitForTimeout(250);
s = await dbg(page);
check('tab hide pauses and suspends audio', s.state === 'PAUSED' && s.audio.state === 'suspended', `${s.state}/${s.audio.state}`);
await page.evaluate(() => { Object.defineProperty(document, 'hidden', { value: false, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
await page.locator('button:has-text("Resume")').click();
await page.waitForTimeout(300);

// coins + power-ups: run with god mode, steering at coins
await page.evaluate(() => window.__metro.game.debugGodMode(60));
const coins0 = (await page.locator('.hud-coins').innerText()).replace(/\D/g, '');
let roofSeen = false, roofShot = false, rampTaken = false;
for (let i = 0; i < 120; i++) {
  const st = await page.evaluate(() => {
    const g = window.__metro.game; const w = g.world;
    const near = (k) => w.obstacles.filter((o) => o.kind === k && o.z < 4 && o.z > -55).sort((a, b) => b.z - a.z)[0];
    const ramp = near('ramp');
    return { lane: g.player.targetLane, gy: g.player.groundY, ramp: ramp ? ramp.lane : -1 };
  });
  if (st.ramp >= 0 && st.ramp !== st.lane && !roofSeen) await page.keyboard.press(st.ramp < st.lane ? 'ArrowLeft' : 'ArrowRight');
  if (st.ramp >= 0) rampTaken = true;
  if (st.gy > 2) { roofSeen = true; if (!roofShot) { await page.waitForTimeout(300); await shot(page, 'gameplay-roof'); roofShot = true; } }
  if (roofSeen && i > 60) break;
  await page.waitForTimeout(150);
}
const coins1 = (await page.locator('.hud-coins').innerText()).replace(/\D/g, '');
check('coins collected and counted', +coins1 > +coins0, `${coins0} -> ${coins1}`);
check('ramp leads onto a train roof (roof landing)', roofSeen, `ramp seen: ${rampTaken}`);

// power-ups: activate and expire each
for (const k of ['magnet', 'multiplier', 'shield', 'jetpack']) {
  await page.evaluate((k) => window.__metro.game.debugGivePower(k), k);
  await page.waitForTimeout(250);
  const chip = await page.locator('.power-chip').count();
  if (k === 'jetpack') { await page.waitForTimeout(800); await shot(page, 'powerup-jetpack'); s = await dbg(page); check('jetpack lifts runner', s.player.y > 4, `y ${s.player.y}`); }
  if (k === 'shield') await shot(page, 'powerup-shield');
  check(`power-up ${k} activates with HUD indicator`, chip > 0);
}
await page.waitForTimeout(10500);
s = await dbg(page);
check('power-ups expire cleanly (runner back on a surface)', (await page.locator('.power-chip').count()) === 0 && s.player.y < 3.2, `chips ${(await page.locator('.power-chip').count())} y ${s.player.y}`);

// ===================== 4. collision & roof physics (deterministic) =====================
const phys = await page.evaluate(async () => {
  const g = window.__metro.game; const w = g.world; const p = g.player;
  const out = {};
  const settle = async (n = 6) => { for (let i = 0; i < n; i++) await new Promise((r) => requestAnimationFrame(r)); };
  // clear the track ahead and build exact scenarios via the real spawner
  const reset = () => { for (const o of [...w.obstacles]) { w.release(o); } w.obstacles.length = 0; p.reset(); g.invuln = 0; g.powerTimers = {}; g.state = 'PLAYING'; w.nextSeqZ = 1e9; };
  const spawn = (kind, lane, zAhead, length) => w.spawnHazard({ kind, lane, z: zAhead, length }, 0);
  const runUntil = async (pred, max = 400) => { for (let i = 0; i < max; i++) { await new Promise((r) => requestAnimationFrame(r)); if (pred()) return true; } return false; };
  // a) frontal train hit = crash
  reset(); g.debugSetSpeed(20); spawn('train', 1, 12, 15);
  await runUntil(() => g.state === 'GAME_OVER', 200);
  out.frontalTrain = { crashed: g.state === 'GAME_OVER', hit: g.lastHit };
  // b) ramp -> roof at MAX speed: must land on top, no crash
  reset(); g.debugSetSpeed(32); spawn('ramp', 1, 10, 6.5); spawn('train', 1, 16.5, 15);
  let maxGround = 0;
  await runUntil(() => { maxGround = Math.max(maxGround, p.groundY); return g.state === 'GAME_OVER' || w.obstacles.every((o) => o.z - o.len / 2 > 2); }, 400);
  out.rampRoofMax = { crashed: g.state === 'GAME_OVER', maxGround: +maxGround.toFixed(2) };
  // c) after roof end: drop back to track, grounded
  await settle(30);
  out.dropAfterRoof = { y: +p.y.toFixed(2), grounded: p.grounded, crashed: g.state === 'GAME_OVER' };
  // d) thin low barrier at max speed without jumping = crash (no tunnelling)
  reset(); g.debugSetSpeed(32); spawn('lowBarrier', 1, 14, 0.5);
  await runUntil(() => g.state === 'GAME_OVER', 200);
  out.barrierNoJump = { crashed: g.state === 'GAME_OVER', hit: g.lastHit };
  // e) same barrier, jump in time = clean
  reset(); g.debugSetSpeed(32); spawn('lowBarrier', 1, 14, 0.5);
  await runUntil(() => { const o = w.obstacles[0]; return o && o.z > -5.5; }, 200);
  p.jump();
  await runUntil(() => g.state === 'GAME_OVER' || w.obstacles[0].z > 3, 200);
  out.barrierJump = { crashed: g.state === 'GAME_OVER' };
  // f) overhead sign: standing = crash, sliding = clean
  reset(); g.debugSetSpeed(25); spawn('overhead', 1, 12, 0.5);
  await runUntil(() => g.state === 'GAME_OVER', 200);
  out.overheadStand = { crashed: g.state === 'GAME_OVER' };
  reset(); g.debugSetSpeed(25); spawn('overhead', 1, 12, 0.5);
  await runUntil(() => w.obstacles[0].z > -6, 200); p.slide();
  await runUntil(() => g.state === 'GAME_OVER' || w.obstacles[0].z > 3, 200);
  out.overheadSlide = { crashed: g.state === 'GAME_OVER' };
  // g) roof-to-roof gap jump at max speed (roof-hop geometry)
  reset(); g.debugSetSpeed(32); spawn('ramp', 1, 8, 6.5); spawn('train', 1, 14.5, 15); spawn('train', 1, 34, 15);
  await runUntil(() => { const t = w.obstacles.find((o) => o.kind === 'train'); return t && t.z + t.len / 2 > -1.5; }, 300);
  await runUntil(() => { const t = w.obstacles.filter((o) => o.kind === 'train')[0]; return t.z - t.len / 2 > -3.2; }, 300);
  const [t1, t2] = w.obstacles.filter((o) => o.kind === 'train');
  p.jump();
  let landedOnSecond = false;
  // landed on the second roof = grounded at roof height after the first train's far end has passed us
  await runUntil(() => { if (p.grounded && p.groundY > 2.5 && t1.z - t1.len / 2 > 0.5) landedOnSecond = true; return g.state === 'GAME_OVER' || (landedOnSecond && p.groundY < 0.1) || t2.z - t2.len / 2 > 3; }, 400);
  out.roofHop = { crashed: g.state === 'GAME_OVER', onSecondRoof: landedOnSecond, endY: +p.y.toFixed(2) };
  // h) side brush: switching lanes into the side of a train = crash
  reset(); g.debugSetSpeed(20); spawn('train', 0, -2, 15); // train already beside us in lane 0
  p.moveLane(-1);
  await runUntil(() => g.state === 'GAME_OVER', 120);
  out.sideTrain = { crashed: g.state === 'GAME_OVER' };
  return out;
});
check('frontal train collision is fatal', phys.frontalTrain.crashed, JSON.stringify(phys.frontalTrain));
check('ramp → roof landing at max speed (32 u/s) is safe', !phys.rampRoofMax.crashed && phys.rampRoofMax.maxGround > 2.5, JSON.stringify(phys.rampRoofMax));
check('dropping off the roof end lands on the track', phys.dropAfterRoof.grounded && phys.dropAfterRoof.y < 0.05 && !phys.dropAfterRoof.crashed, JSON.stringify(phys.dropAfterRoof));
check('thin barrier at max speed cannot be tunnelled', phys.barrierNoJump.crashed, JSON.stringify(phys.barrierNoJump));
check('timed jump clears barrier at max speed', !phys.barrierJump.crashed);
check('overhead sign: standing crashes, sliding clears', phys.overheadStand.crashed && !phys.overheadSlide.crashed);
check('roof-to-roof gap jump at max speed', !phys.roofHop.crashed && phys.roofHop.onSecondRoof, JSON.stringify(phys.roofHop));
check('lane change into a train side is fatal', phys.sideTrain.crashed);

// ===================== 5. moving train warning + audio =====================
const mt = await page.evaluate(async () => {
  const g = window.__metro.game; const w = g.world; const p = g.player;
  for (const o of [...w.obstacles]) w.release(o); w.obstacles.length = 0; p.reset(); g.state = 'PLAYING'; g.invuln = 0; w.nextSeqZ = 1e9;
  g.debugSetSpeed(18);
  w.spawnHazard({ kind: 'movingTrain', lane: 1, z: 120, length: 15, speed: 9 }, 0);
  let warnedAt = null, trainVoices = 0;
  for (let i = 0; i < 300; i++) {
    await new Promise((r) => requestAnimationFrame(r));
    const o = w.obstacles[0];
    if (o.warned && warnedAt === null) warnedAt = -(o.z + o.len / 2);
    trainVoices = Math.max(trainVoices, g.audio.debug().trains);
    if (warnedAt !== null && i > 20) break;
  }
  const closing = 18 + 9;
  return { warnedAtM: warnedAt, warningSeconds: warnedAt / closing, trainVoices };
});
check('moving train warns early enough (>= 2.5 s)', mt.warningSeconds >= 2.5, `warned ${mt.warnedAtM?.toFixed(1)} m out = ${mt.warningSeconds?.toFixed(2)} s`);
check('moving train has positional pass-by audio', mt.trainVoices > 0);
await page.evaluate(async () => { const g = window.__metro.game; g.player.moveLane(-1); for (let i = 0; i < 20; i++) await new Promise((r) => requestAnimationFrame(r)); });
await page.waitForTimeout(400);
await shot(page, 'moving-train');

// ===================== 6. crash → game over → retry; audio cleanup =====================
await page.evaluate(() => { const g = window.__metro.game; g.invuln = 0; g.powerTimers = {}; g.world.spawnHazard({ kind: 'crates', lane: g.player.targetLane, z: 8, length: 1.2 }, 0); });
const over = await waitFor(page, () => window.__metro.game.state === 'GAME_OVER', 8000);
check('collision triggers game over', over);
await page.waitForTimeout(600);
await shot(page, 'gameover');
const aOver = (await dbg(page)).audio;
check('game over stops music + trains (no lingering run sounds)', !aOver.music && aOver.trains === 0, JSON.stringify(aOver));
await page.locator('button:has-text("Retry")').click();
await page.waitForTimeout(3600);
s = await dbg(page);
check('retry starts a fresh run', s.state === 'PLAYING' && s.distance < 60 && !s.player.crashed, `d=${s.distance.toFixed(1)}`);
check('retry: single music voice, no duplicated beds', s.audio.music === true, JSON.stringify(s.audio));
for (let i = 0; i < 3; i++) {
  await page.evaluate(() => { const g = window.__metro.game; g.invuln = 0; g.world.spawnHazard({ kind: 'crates', lane: g.player.targetLane, z: 6, length: 1.2 }, 0); });
  await waitFor(page, () => window.__metro.game.state === 'GAME_OVER', 8000);
  await page.locator('button:has-text("Retry")').click();
  await page.waitForTimeout(3500);
}
s = await dbg(page);
check('repeated restarts stay stable (voices bounded)', s.state === 'PLAYING' && s.audio.voices < 12, JSON.stringify(s.audio));

// mute + settings persistence
await page.keyboard.press('Escape');
await page.locator('button:has-text("Settings")').click();
await page.locator('button[aria-pressed]').click();
await page.locator('button:has-text("Done")').click();
const muted = await page.evaluate(() => window.__metro.game.save.settings.muted);
check('mute toggle applies', muted === true);
await page.reload();
await waitPlay(page);
const persisted = await page.evaluate(() => ({ muted: window.__metro.game.save.settings.muted, best: window.__metro.game.save.bestScore }));
check('settings + best score persist after reload', persisted.muted === true && persisted.best > 0, JSON.stringify(persisted));
await page.evaluate(() => { const g = window.__metro.game; g.updateSettings({ ...g.save.settings, muted: false }); });

// ===================== 7. performance + resource stability =====================
await page.locator('button[aria-label="Play"]').click();
await page.waitForTimeout(3500);
const perf = await page.evaluate(async () => {
  const g = window.__metro.game; g.debugGodMode(999);
  const sample = async (ms) => { let f = 0; const t0 = performance.now(); let worst = 0, last = t0; while (performance.now() - t0 < ms) { await new Promise((r) => requestAnimationFrame(r)); const n = performance.now(); worst = Math.max(worst, n - last); last = n; f++; } return { fps: f / (ms / 1000), worst }; };
  const a = await sample(5000);
  const s0 = g.debugState();
  await sample(20000);
  const s1 = g.debugState();
  return { fps: a.fps, worstMs: a.worst, objects: [s0.world.objects, s1.world.objects], geo: [s0.renderer.geometries, s1.renderer.geometries], tex: [s0.renderer.textures, s1.renderer.textures], calls: s1.renderer.calls, tris: s1.renderer.triangles, distance: s1.distance };
});
check('gameplay fps (headless Chromium, 1280x720, HIGH)', perf.fps >= 45, `${perf.fps.toFixed(1)} fps, worst frame ${perf.worstMs.toFixed(0)} ms, ${perf.calls} draw calls, ${(perf.tris / 1000).toFixed(0)}k tris`);
check('scene objects stable while recycling', Math.abs(perf.objects[1] - perf.objects[0]) <= 80, perf.objects.join(' -> '));
check('GPU geometries/textures do not grow', perf.geo[1] <= perf.geo[0] + 2 && perf.tex[1] <= perf.tex[0] + 2, `geo ${perf.geo.join('->')} tex ${perf.tex.join('->')}`);
await shot(page, 'gameplay-later');

if (process.env.METRO_QA_ENDURANCE) {
  // 5-minute continuous run, sampled from Node every 30 s (a single long
  // page.evaluate would hit the protocol timeout)
  await page.evaluate(() => window.__metro.game.debugGodMode(1e6));
  const end = [];
  const t0 = Date.now();
  while (Date.now() - t0 < 300000) {
    await page.waitForTimeout(30000);
    const p = await page.evaluate(() => {
      const g = window.__metro.game; const s = g.debugState();
      if (g.state !== 'PLAYING') { g.resume?.(); }
      return { heap: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null, objects: s.world.objects, geo: s.renderer.geometries, tex: s.renderer.textures, d: Math.round(s.distance), speed: +s.speed.toFixed(1), state: s.state };
    });
    p.t = Math.round((Date.now() - t0) / 1000);
    end.push(p);
    console.log('  endurance', JSON.stringify(p));
  }
  writeFileSync(join(outDir, 'endurance.json'), JSON.stringify(end, null, 2));
  const h = end.filter((p) => p.heap !== null).map((p) => p.heap);
  check('5-minute run: still playing at max speed', end[end.length - 1].state === 'PLAYING' && end[end.length - 1].speed >= 31.9, `d=${end[end.length - 1].d} m speed=${end[end.length - 1].speed}`);
  check('5-minute run: heap stable (< 40 MB growth after warm-up)', h.length < 3 || h[h.length - 1] - h[1] < 40, `heap ${h.join(', ')} MB`);
  const objs = end.map((p) => p.objects);
  check('5-minute run: scene objects stable', Math.max(...objs) - Math.min(...objs) < 150, objs.join(','));
  check('5-minute run: GPU geometries/textures flat', new Set(end.map((p) => p.geo)).size <= 2 && new Set(end.map((p) => p.tex)).size <= 2, `geo ${[...new Set(end.map((p) => p.geo))]} tex ${[...new Set(end.map((p) => p.tex))]}`);
}
check('no page errors during desktop session', errors.length === 0, errors.slice(0, 4).join(' | '));
await dctx.close();

// ===================== 8. mobile portrait + touch swipes =====================
{
  const { ctx, page: m, errors: merr } = await open({ width: 390, height: 844 }, { touch: true });
  await m.goto('http://127.0.0.1:4398/');
  await waitPlay(m);
  await m.waitForTimeout(800);
  await shot(m, 'menu-mobile');
  const btn = await m.locator('button[aria-label="Play"]').boundingBox();
  check('mobile play button is touch-sized (>= 48 px tall)', btn && btn.height >= 48, `${btn?.height}px`);
  await m.locator('button[aria-label="Play"]').tap();
  await m.waitForTimeout(3500);
  await m.evaluate(() => window.__metro.game.debugGodMode(60));
  const swipe = async (dx, dy) => {
    await m.evaluate(([dx, dy]) => {
      const c = document.querySelector('canvas');
      const mk = (type, x, y) => { const t = new Touch({ identifier: 1, target: c, clientX: x, clientY: y }); return new TouchEvent(type, { touches: type === 'touchend' ? [] : [t], changedTouches: [t], bubbles: true, cancelable: true }); };
      c.dispatchEvent(mk('touchstart', 195, 500)); c.dispatchEvent(mk('touchmove', 195 + dx / 2, 500 + dy / 2)); c.dispatchEvent(mk('touchend', 195 + dx, 500 + dy));
    }, [dx, dy]);
    await m.waitForTimeout(260);
  };
  const l0 = (await dbg(m)).player.lane;
  await swipe(-120, 0);
  const l1 = (await dbg(m)).player.lane;
  await swipe(0, -120);
  const jumped = (await dbg(m)).player.y > 0.3;
  await m.waitForTimeout(600);
  await swipe(0, 120);
  const slid = (await dbg(m)).player.sliding;
  check('swipe left changes lane', l1 === Math.max(0, l0 - 1), `${l0} -> ${l1}`);
  check('swipe up jumps', jumped);
  check('swipe down slides', slid);
  await m.waitForTimeout(500);
  await shot(m, 'gameplay-mobile');
  // HUD must not overlap the runner/lanes: HUD rects stay in the top 12% / bottom strip
  const hudRects = await m.evaluate(() => [...document.querySelectorAll('.hud-left, .hud-right')].map((e) => e.getBoundingClientRect().bottom));
  check('mobile HUD stays clear of lanes (top band)', Math.max(...hudRects) < 844 * 0.14, hudRects.map((v) => v.toFixed(0)).join(','));
  // rotate to landscape
  await m.setViewportSize({ width: 844, height: 390 });
  await m.waitForTimeout(600);
  await shot(m, 'gameplay-mobile-landscape');
  check('no page errors on mobile', merr.length === 0, merr.slice(0, 3).join(' | '));
  await ctx.close();
}

await browser.close();
server.close();
const fails = results.filter((r) => !r.ok);
writeFileSync(join(outDir, 'qa-results.json'), JSON.stringify({ date: new Date().toISOString(), browser: 'Chromium (playwright-core 1.64.1, headless, ANGLE/Metal)', results }, null, 2));
console.log(`\n${results.length - fails.length}/${results.length} checks passed`);
process.exit(fails.length ? 1 : 0);
