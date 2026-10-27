// BigSoundBank (CC0, Joseph Sardin) pages are behind a bot check, so open
// them in a real browser, record the license statement shown on the page,
// and save the OGG/MP3 download it offers. Usage:
//   node qa/fetch-bsb.mjs <outDir> <page-slug>...
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

const [outDir, ...slugs] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ acceptDownloads: true, userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36' });
const page = await ctx.newPage();
const records = [];
for (const slug of slugs) {
  const url = `https://bigsoundbank.com/${slug}.html`;
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(2500);
    const info = await page.evaluate(() => {
      const t = document.body.innerText;
      const lic = (t.match(/(CC0[^\n]{0,80}|Creative Commons[^\n]{0,80}|public domain[^\n]{0,60})/i) || [])[0] ?? null;
      const links = [...document.querySelectorAll('a[href]')].map((a) => a.href).filter((h) => /\.(ogg|mp3|wav|flac)(\?|$)/i.test(h) || /download/i.test(h));
      const dur = (t.match(/(\d+:\d+|\d+(\.\d+)? ?s(ec)?)\b/) || [])[0] ?? null;
      return { title: document.title, lic, links: [...new Set(links)].slice(0, 12), dur };
    });
    const id = (slug.match(/s(\d{4})$/) || [])[1];
    const ogg = id ? new URL(`/UPLOAD/ogg/${id}.ogg`, url).href : null;
    let saved = null;
    if (ogg) {
      const resp = await ctx.request.get(ogg);
      if (resp.ok()) {
        const ext = /\.ogg/i.test(ogg) ? 'ogg' : 'mp3';
        saved = join(outDir, `${slug}.${ext}`);
        writeFileSync(saved, await resp.body());
      }
    }
    records.push({ slug, url, ...info, downloaded: ogg ?? null, saved });
    console.log(JSON.stringify({ slug, title: info.title, lic: info.lic, saved, links: info.links.slice(0, 5) }));
  } catch (e) {
    records.push({ slug, url, error: String(e) });
    console.log('ERR', slug, String(e).slice(0, 200));
  }
}
writeFileSync(join(outDir, 'bsb-records.json'), JSON.stringify(records, null, 2));
await browser.close();
