// Casos visuales extremos: nombres larguísimos, precios diminutos y enormes, muchas posiciones, notas largas.
import { chromium } from 'playwright';
const TDIR = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
import fs from 'fs';
const EXT = new URL('../Fogueo', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), SOL = 'So11111111111111111111111111111111111111112';
const LANG = process.env.L || 'es';
const OUT = TDIR+'t16-' + LANG; fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT);
const toks = [
  { a: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU', sym: 'SUPERLONGTICKERXX', name: 'The Extremely Long Memecoin Name Of Destiny And Glory', p: 1.23e-10, liq: 900, mc: 123 },
  { a: '3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh', sym: 'WBTC', name: 'Wrapped Bitcoin (Portal)', p: 104567.89, liq: 25e6, mc: 4.2e9 },
  { a: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', sym: 'BONK', name: 'Bonk', p: 0.0000234, liq: 8e6, mc: 1.9e9 },
  { a: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm', sym: 'WIF', name: 'dogwifhat', p: 1.98, liq: 12e6, mc: 1.98e9 },
  { a: 'HeLp6NuQkmYB4pYWo2zYs22mESHXPQYzXbB8n4V98jwC', sym: 'AI16Z', name: 'ai16z', p: 0.3, liq: 3e6, mc: 3e8 },
  { a: '52u2Z2PZkPgX8nzzZvN7ADCroDBTRiT4VNkpAgm3pump', sym: 'DOUG', name: 'Doug', p: 0.0000045, liq: 3100, mc: 4500, dex: 'pumpfun' },
];
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log((c ? 'OK  ' : 'FAIL') + ' ' + m); };
const ctx = await chromium.launchPersistentContext(TDIR+'p16-' + Date.now(), { headless: true, channel: 'chromium', locale: LANG === 'es' ? 'es-ES' : 'en-US', viewport: { width: 1200, height: 900 }, deviceScaleFactor: 2, args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, `--lang=${LANG === 'es' ? 'es-ES' : 'en-US'}`] });
const pair = (t) => ({ chainId: 'solana', dexId: t.dex || 'raydium', pairAddress: 'P' + t.a.slice(0, 30), baseToken: { address: t.a, symbol: t.sym, name: t.name }, quoteToken: { symbol: 'SOL' }, priceUsd: String(t.p), liquidity: { usd: t.liq }, marketCap: t.mc, priceChange: { m5: -87.3, h1: 1234.5 }, info: {} });
await ctx.route('https://api.dexscreener.com/**', (r) => {
  const u = r.request().url();
  const hit = toks.filter((t) => u.includes(t.a));
  if (u.includes(SOL) && !hit.length) return r.fulfill({ json: [{ chainId: 'solana', pairAddress: 'x', baseToken: { address: SOL, symbol: 'SOL' }, quoteToken: { symbol: 'USDC' }, priceUsd: '180', liquidity: { usd: 9e6 } }] });
  const ps = hit.map(pair);
  return r.fulfill({ json: u.includes('/search') ? { pairs: ps } : ps });
});
await ctx.route('https://lite-api.jup.ag/**', (r) => r.fulfill({ json: r.request().url().includes('/price/v3') ? {} : [] }));
const fake = fs.readFileSync(TDIR+'fake-padre.html', 'utf8');
await ctx.route('https://trade.padre.gg/**', (r) => r.fulfill({ body: fake, contentType: 'text/html' }));
let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent('serviceworker');
const extId = sw.url().split('/')[2];
const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', (e) => errs.push(e.message));
const S = (s) => pg.locator('#fogueo-root').locator(s);
const overflow = () => pg.evaluate(() => {
  const r = document.querySelector('#fogueo-root').shadowRoot; const fx = r.querySelector('.fx').getBoundingClientRect(); const out = [];
  r.querySelectorAll('.fx *').forEach((el) => {
    if (el.closest('[hidden]') || !el.getClientRects().length) return;
    const b = el.getBoundingClientRect(); if (!b.width) return;
    if (b.right > fx.right + 1 || b.left < fx.left - 1) out.push((el.className?.baseVal ?? el.className) + ':' + (el.textContent || '').trim().slice(0, 24));
    const cs = getComputedStyle(el);
    if (el.scrollWidth > el.clientWidth + 1 && cs.overflowX === 'visible' && el.children.length === 0 && cs.display !== 'inline') out.push('desborda ' + el.className + ':' + el.textContent.trim().slice(0, 24));
  });
  return [...new Set(out)].slice(0, 8);
});
const shot = async (n) => { const fx = await pg.evaluate(() => { const r = document.querySelector('#fogueo-root').shadowRoot.querySelector('.fx').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }); await pg.screenshot({ path: `${OUT}/${n}.png`, clip: { x: fx.x - 4, y: fx.y - 4, width: fx.w + 8, height: Math.min(900 - fx.y + 4, fx.h + 8) } }); };
await pg.goto('https://trade.padre.gg/'); await pg.waitForTimeout(1500); await S('[data-act="onboarded"]').click().catch(() => {});
for (const [i, t] of toks.entries()) {
  await pg.goto('https://trade.padre.gg/trade/solana/' + t.a); await pg.waitForTimeout(2200);
  const price = await S('.price').first().innerText().catch(() => '');
  ok(price && !/NaN|undefined|—/.test(price), `${t.sym}: precio ${price.replace(/\n/g, ' ')}`);
  await S('[data-act="quick"]').nth(0).click();
  if (i === 0) { await S('[data-act="note"][data-for="buyNote"]').click(); await S('[data-ref="buyNote"]').fill('Nota muy larga '.repeat(30)); }
  await S('[data-act="buy"]').click(); await pg.waitForTimeout(1300);
  const o = await overflow(); ok(!o.length, `${t.sym}: nada se sale del panel` + (o.length ? ' → ' + o.join(' | ') : ''));
  await shot(`${i}-${t.sym}`);
}
await S('[data-act="view"][data-v="positions"]').click(); await pg.waitForTimeout(600); await shot('posiciones');
const o2 = await overflow(); ok(!o2.length, 'Lista de posiciones sin desbordes' + (o2.length ? ' → ' + o2.join(' | ') : ''));
const pop = await ctx.newPage(); pop.on('pageerror', (e) => errs.push('POP ' + e.message)); await pop.setViewportSize({ width: 400, height: 600 });
await pop.goto(`chrome-extension://${extId}/popup/popup.html`); await pop.waitForTimeout(1200); await pop.keyboard.press('Escape'); await pop.waitForTimeout(1400);
await pop.screenshot({ path: `${OUT}/pop-wallet.png`, fullPage: true });
const popOver = await pop.evaluate(() => { const out = []; document.querySelectorAll('.app *').forEach((el) => { const b = el.getBoundingClientRect(); if (b.width && b.right > innerWidth + 1) out.push(el.className + ':' + el.textContent.trim().slice(0, 20)); }); return out.slice(0, 6); });
ok(!popOver.length, 'Ventana: nada se sale por la derecha' + (popOver.length ? ' → ' + popOver.join(' | ') : ''));
ok(!errs.length, 'Sin errores JS' + (errs.length ? ': ' + errs.join(' | ') : ''));
console.log(fails ? `\n${fails} FALLOS` : '\nTodo bien');
await ctx.close();
