// Seguridad: tokens con HTML/JS en símbolo, nombre e icono; notas con HTML; CSV con fórmulas.
import { chromium } from 'playwright';
const TDIR = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
import fs from 'fs';
const EXT = new URL('../Fogueo', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), SOL = 'So11111111111111111111111111111111111111112';
const A = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';
const EVIL = '<img src=x onerror="window.__xss=(window.__xss||0)+1">';
const SYM = `X${EVIL}`, NAME = `"><svg onload="window.__xss=99"></svg>${EVIL}`;
const ICON = 'javascript:window.__xss=7" onerror="window.__xss=8';
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log((c ? 'OK  ' : 'FAIL') + ' ' + m); };
const ctx = await chromium.launchPersistentContext(TDIR+'p19-' + Date.now(), { headless: true, channel: 'chromium', locale: 'es-ES', acceptDownloads: true, args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--lang=es-ES'] });
await ctx.route('https://api.dexscreener.com/**', (r) => {
  const u = r.request().url();
  if (u.includes(SOL) && !u.includes(A)) return r.fulfill({ json: [{ chainId: 'solana', pairAddress: 'x', baseToken: { address: SOL, symbol: 'SOL' }, quoteToken: { symbol: 'USDC' }, priceUsd: '150', liquidity: { usd: 9e6 } }] });
  const ps = [{ chainId: 'solana', dexId: 'raydium', pairAddress: 'PX1', baseToken: { address: A, symbol: SYM, name: NAME }, quoteToken: { symbol: 'SOL' }, priceUsd: '0.0001', liquidity: { usd: 5e5 }, marketCap: 1e5, priceChange: { m5: 1, h1: 2 }, info: { imageUrl: ICON } }];
  return r.fulfill({ json: u.includes('/search') ? { pairs: ps } : ps });
});
await ctx.route('https://lite-api.jup.ag/**', (r) => r.fulfill({ json: r.request().url().includes('/price/v3') ? {} : [] }));
await ctx.route('https://x/**', (r) => r.abort());
const fake = fs.readFileSync(TDIR+'fake-padre.html', 'utf8');
await ctx.route('https://trade.padre.gg/**', (r) => r.fulfill({ body: fake, contentType: 'text/html' }));
let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent('serviceworker');
const extId = sw.url().split('/')[2];
const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', (e) => errs.push(e.message));
const S = (s) => pg.locator('#fogueo-root').locator(s);
await pg.goto('https://trade.padre.gg/trade/solana/' + A); await pg.waitForTimeout(2500);
await S('[data-act="onboarded"]').click().catch(() => {});
await S('[data-act="quick"]').nth(1).click();
await S('[data-act="note"][data-for="buyNote"]').click();
await S('[data-ref="buyNote"]').fill(`=HYPERLINK("http://evil","pulsa") ${EVIL}`);
await S('[data-act="buy"]').click(); await pg.waitForTimeout(1500);
await S('[data-act="view"][data-v="positions"]').click(); await pg.waitForTimeout(500);
const listInj = await pg.evaluate(() => ({ xss: window.__xss || 0, tags: document.querySelector('#fogueo-root').shadowRoot.querySelectorAll('img[src="x"], svg[onload]').length }));
ok(listInj.xss === 0 && listInj.tags === 0, 'Lista de posiciones: nada se inyecta (' + JSON.stringify(listInj) + ')');
await pg.reload(); await pg.waitForTimeout(2500);
await S('[data-act="side"][data-side="sell"]').click(); await S('[data-act="sellpct"][data-pct="100"]').click();
await S('[data-act="note"][data-for="sellNote"]').click(); await S('[data-ref="sellNote"]').fill('+cmd|"/c calc"!A0');
await S('[data-act="sell"]').click(); await pg.waitForTimeout(1500);
await pg.waitForTimeout(500);
const injected = await pg.evaluate(() => {
  const r = document.querySelector('#fogueo-root').shadowRoot;
  return { xss: window.__xss || 0, imgs: r.querySelectorAll('img[src="x"], svg[onload], [onerror]').length, text: r.querySelector('.tok-sym, .sym')?.textContent || '' };
});
ok(injected.xss === 0, 'Panel: ningún código del nombre del token se ejecuta (window.__xss = ' + injected.xss + ')');
ok(injected.imgs === 0, 'Panel: no se inyectan etiquetas del nombre/símbolo (' + injected.imgs + ')');
ok(injected.text.includes('<img'), 'Panel: el símbolo raro se muestra como texto: ' + injected.text.slice(0, 40));
// ventana
const pop = await ctx.newPage(); const perrs = []; pop.on('pageerror', (e) => perrs.push(e.message));
await pop.goto(`chrome-extension://${extId}/popup/popup.html`); await pop.waitForTimeout(1200); await pop.keyboard.press('Escape'); await pop.waitForTimeout(300);
for (const t of ['wallet', 'history', 'stats', 'settings']) { await pop.locator(`[data-tab="${t}"]`).click(); await pop.waitForTimeout(400); if (t === 'history') { await pop.locator('[data-row]').first().click(); await pop.waitForTimeout(400); } }
await pop.locator('[data-tab="history"]').click(); await pop.waitForTimeout(300); await pop.locator('[data-row]').first().click(); await pop.waitForTimeout(300);
const popInj = await pop.evaluate(() => ({ xss: window.__xss || 0, tags: document.querySelectorAll('img[src="x"], svg[onload], [onerror]:not(.av img)').length, avOnError: [...document.querySelectorAll('img')].filter((i) => i.getAttribute('src')?.startsWith('javascript:')).length }));
ok(popInj.xss === 0 && popInj.tags === 0, 'Ventana: nada se ejecuta ni se inyecta (' + JSON.stringify(popInj) + ')');
ok(popInj.avOnError === 0, 'Iconos con «javascript:» no se cargan');
// CSV
await pop.locator('[data-tab="history"]').click(); await pop.waitForTimeout(300);
const [dl] = await Promise.all([pop.waitForEvent('download'), pop.locator('[data-act="csv"]').click()]);
const csv = fs.readFileSync(await dl.path(), 'utf8');
const lines = csv.trim().split('\n');
const cells = lines[1];
ok(!/(^|,)"[=+\-@]/.test(cells) && /"'=HYPERLINK/.test(cells) && /"'\+cmd/.test(cells), 'CSV: ninguna celda empieza por = + - @ (sin fórmulas que Excel ejecute): ' + cells.slice(0, 160));
ok(lines.length === 2, 'CSV: una fila por trade aunque las notas tengan saltos y comillas (' + lines.length + ' líneas)');
ok(!errs.length && !perrs.length, 'Sin errores JS' + (errs.concat(perrs).length ? ': ' + errs.concat(perrs).join(' | ') : ''));
console.log(fails ? `\n${fails} FALLOS` : '\nTodo bien');
await ctx.close();
