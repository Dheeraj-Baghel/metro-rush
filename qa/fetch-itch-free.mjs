// Downloads the FREE (Standard, $0 minimum) tier of a CC0 itch.io pack by
// driving the same UI flow a user follows: "Download Now" -> "No thanks, just
// take me to the downloads" -> click the [Standard] file. Paid tiers are never
// selected. Usage: node qa/fetch-itch-free.mjs <itch-page-url> <outDir> <fileSubstring>
import { chromium } from 'playwright-core';
import { mkdirSync } from 'fs';
import { join } from 'path';

const [url, outDir, want = '[Standard]'] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ acceptDownloads: true });
const page = await ctx.newPage();
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.locator('a.buy_btn').first().click();
// the purchase modal offers a $0 path for name-your-own-price
const noThanks = page.locator('a.direct_download_btn, a:has-text("No thanks")').first();
await noThanks.waitFor({ timeout: 20000 });
await noThanks.click();
await page.waitForLoadState('domcontentloaded');
const row = page.locator('.upload', { hasText: want }).first();
await row.waitFor({ timeout: 20000 });
const [dl] = await Promise.all([
  page.waitForEvent('download', { timeout: 120000 }),
  row.locator('a.download_btn').first().click(),
]);
const dest = join(outDir, dl.suggestedFilename());
await dl.saveAs(dest);
console.log('saved', dest);
await browser.close();
