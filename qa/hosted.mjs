// Anonymous real-production smoke checks. No debug globals, injected engine
// state, fake assets, or save fixtures. Separate from deterministic local QA.
import { chromium, devices } from 'playwright-core';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { MANIFEST } from '../src/game/assetManifest.ts';
const base = process.env.METRO_HOSTED_URL || 'https://metro-rush-softtech10.vercel.app';
const out = 'artifacts/testing/vercel'; await fs.mkdir(out, { recursive: true });
const checks = [], errors = [], failures = [], completedHeadProbes = [];
const successfulHeadRequests = new WeakSet();
const runtimePaths = new Set(MANIFEST.map(entry => '/' + entry.url));
const pass = name => { checks.push({ name, status: 'PASS' }); console.log(`PASS ${name}`); };
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-webgl', '--ignore-gpu-blocklist'] });
function observe(page) {
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('requestfailed', request => {
    const detail = { url: request.url(), method: request.method(), error: request.failure()?.errorText };
    // The loader uses bodyless HEAD size probes. Chromium on this host reports
    // net::ERR_ABORTED after their successful HTTP 200 headers. Record those
    // only; never exempt GET failures, HTTP errors or unknown paths.
    if (detail.method === 'HEAD' && detail.error === 'net::ERR_ABORTED' && successfulHeadRequests.has(request) && runtimePaths.has(new URL(detail.url).pathname)) completedHeadProbes.push(detail);
    else failures.push(detail);
  });
  page.on('response', response => {
    if (response.request().method() === 'HEAD' && response.status() === 200) successfulHeadRequests.add(response.request());
    if (response.status() >= 400) failures.push({ url: response.url(), status: response.status() });
  });
}
async function ready(page) {
  await page.getByRole('button', { name: 'Play', exact: true }).waitFor({ timeout: 60000 });
  assert.equal(await page.locator('.load-error,.fallback').count(), 0);
  assert.equal(await page.locator('canvas.revealed').count(), 1);
  await page.locator('.menu-card').evaluate(element => Promise.all(element.closest('.overlay').getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => undefined))));
}
const score = async page => Number((await page.locator('.hud-score').innerText()).replace(/\D/g, ''));
const sha = buffer => createHash('sha256').update(buffer).digest('hex');
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage(); observe(page);
  const t = Date.now(), response = await page.goto(base, { waitUntil: 'domcontentloaded' });
  assert.equal(response.status(), 200); await ready(page);
  pass(`public HTTPS/WebGL cold load reaches animated menu (${Date.now() - t} ms)`);
  assert.equal(response.headers()['x-content-type-options'], 'nosniff'); assert.equal(response.headers()['x-frame-options'], 'DENY');
  assert.equal(response.headers()['permissions-policy'], 'camera=(), microphone=(), geolocation=()');
  pass('production security headers');
  const urls = [...new Set(MANIFEST.map(entry => entry.url))];
  // Four concurrent cached GETs at a time; verify actual bytes, not just HTTP 200.
  for (let index = 0; index < urls.length; index += 4) await Promise.all(urls.slice(index, index + 4).map(async url => {
    const remote = await context.request.get(`${base}/${url}`); assert.equal(remote.status(), 200, url);
    assert.equal(sha(await remote.body()), sha(await fs.readFile(path.join('public', url))), `runtime bytes ${url}`);
    if (url.endsWith('.glb')) assert.match(remote.headers()['content-type'], /model\/gltf-binary/);
    if (url.endsWith('.wav')) assert.match(remote.headers()['content-type'], /audio\/wav/);
  }));
  const localEntry = await fs.readFile('dist/index.html', 'utf8');
  const references = [...localEntry.matchAll(/(?:src|href)="(\.\/assets\/[^"#]+)"/g)].map(match => match[1]);
  for (const reference of references) {
    const remote = await context.request.get(base + '/' + reference.slice(2)); assert.equal(remote.status(), 200, reference);
    assert.equal(sha(await remote.body()), sha(await fs.readFile('dist/' + reference.slice(2))));
  }
  pass(`all ${urls.length} runtime files and ${references.length} compiled entry assets match local production SHA-256; GLB/WAV MIME correct`);
  assert.equal(await page.evaluate(() => typeof window.__metro), 'undefined');
  await page.goto(base + '/?test', { waitUntil: 'domcontentloaded' }); await ready(page);
  assert.equal(await page.evaluate(() => typeof window.__metro), 'undefined');
  for (const route of ['/.env', '/.git/config', '/src/game/game.ts', '/asset-inbox/music/keep_your_dream_alive.ogg', '/metro-rush-assets/sources.json', '/artifacts/testing/qa-results.json']) {
    const denied = await context.request.get(base + route); assert.equal(denied.status(), 404, route);
  }
  pass('public debug controls absent even with ?test; source/downloads/secrets/captures return 404');
  await page.screenshot({ path: `${out}/hosted-menu-desktop.png` });
  await page.getByRole('button', { name: 'How to play', exact: true }).click();
  await page.getByRole('dialog', { name: 'How to play' }).waitFor();
  assert.match(await page.getByRole('dialog', { name: 'How to play' }).innerText(), /Jump barriers/);
  await page.getByRole('button', { name: 'Got it', exact: true }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
  await settings.getByRole('slider', { name: 'Music', exact: true }).fill('0.25');
  await settings.getByRole('button', { name: 'On', exact: true }).click();
  await settings.getByRole('button', { name: 'Done', exact: true }).click();
  await page.reload({ waitUntil: 'domcontentloaded' }); await ready(page);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  assert.equal(await settings.getByRole('slider', { name: 'Music', exact: true }).inputValue(), '0.25');
  assert.equal(await settings.getByRole('button', { name: 'Muted', exact: true }).isVisible(), true);
  await settings.getByRole('button', { name: 'Done', exact: true }).click();
  pass('visible help, real settings changes and hosted preference persistence across reload');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.locator('.count-num').waitFor();
  await page.getByRole('button', { name: 'Pause', exact: true }).waitFor();
  await page.waitForFunction(() => Number((document.querySelector('.hud-score')?.textContent || '').replace(/\D/g, '')) > 0);
  const first = await score(page); await page.waitForTimeout(400); assert.ok((await score(page)) > first);
  await page.keyboard.press('ArrowLeft'); await page.keyboard.press('Space'); await page.waitForTimeout(180);
  await page.screenshot({ path: `${out}/hosted-play-desktop.png` });
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.getByRole('dialog', { name: 'Paused', exact: true }).waitFor();
  const frozen = await page.locator('.hud-score').count() ? await score(page) : null;
  await page.waitForTimeout(250);
  if (frozen !== null && await page.locator('.hud-score').count()) assert.equal(await score(page), frozen);
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await page.getByRole('button', { name: 'Pause', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.getByRole('button', { name: 'Restart', exact: true }).click();
  await page.locator('.count-num').waitFor(); assert.equal(await score(page), 0);
  pass('real countdown, score advancement, keyboard input, pause/resume and restart-reset controls');
  await page.waitForFunction(() => !document.querySelector('.count-num') && Number((document.querySelector('.hud-score')?.textContent || '').replace(/\D/g, '')) > 0);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.getByRole('button', { name: 'Main menu', exact: true }).click(); await ready(page);
  pass('paused run returns cleanly to the public main menu');
  const phoneContext = await browser.newContext({ ...devices['iPhone 13'] });
  const phone = await phoneContext.newPage(); observe(phone);
  await phone.goto(base, { waitUntil: 'domcontentloaded' }); await ready(phone);
  assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  const bounds = await phone.getByRole('button', { name: 'Play', exact: true }).boundingBox(); assert.ok(bounds.height >= 48);
  await phone.screenshot({ path: `${out}/hosted-menu-phone.png` });
  await phone.getByRole('button', { name: 'Play', exact: true }).tap();
  await phone.getByRole('button', { name: 'Pause', exact: true }).waitFor();
  await phone.waitForFunction(() => Number((document.querySelector('.hud-score')?.textContent || '').replace(/\D/g, '')) > 0);
  const box = await phone.locator('canvas').boundingBox();
  const cdp = await phoneContext.newCDPSession(phone);
  const x = box.x + box.width * .55, y = box.y + box.height * .7;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x - 90, y }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await phone.getByRole('button', { name: 'Pause', exact: true }).tap();
  await phone.getByRole('dialog', { name: 'Paused', exact: true }).waitFor();
  await phone.getByRole('dialog', { name: 'Paused', exact: true }).evaluate(element => Promise.all(element.closest('.overlay').getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => undefined))));
  assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await phone.screenshot({ path: `${out}/hosted-pause-phone.png` });
  pass('fresh emulated-phone WebGL load, touch-sized Play, real tap launch/swipe/pause and no overflow');
  assert.deepEqual(errors, []); assert.deepEqual(failures, []);
  pass('zero console/page errors, failed GET/HTTP requests or missing assets; completed HEAD size probes recorded separately');
} finally {
  await browser.close();
  await fs.writeFile(`${out}/hosted-results.json`, JSON.stringify({ base, verifiedAt: new Date().toISOString(), checks, errors, failures, completedHeadProbes, limits: 'Native Chromium desktop and emulated phone only. Hosted checks use real UI without debug helpers; collision/power-up outcomes are separately deterministic local QA. No human audio assessment or physical-device claim.' }, null, 2));
}
console.log(`${checks.length}/${checks.length} hosted workflow groups passed.`);
