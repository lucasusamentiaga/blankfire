import { chromium } from 'playwright';
const [,, url, out, w, h, scale] = process.argv;
const b = await chromium.launch({ channel: 'chromium' });
const p = await b.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: +(scale || 1) });
await p.goto(url); await p.waitForTimeout(900); await p.evaluate(() => document.fonts.ready);
await p.screenshot({ path: out, omitBackground: process.env.TRANSP === '1' });
await b.close();
