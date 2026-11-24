// Chequeo de monedas: lee las fichas de Trenches (estructura real de Padre), etiqueta cada tarjeta,
// recuerda snipers/insiders y los junta en la página del token con «Token Data & Security»;
// la compra guarda la instantánea y la revisión marca «moneda peligrosa». También la guía de Jupiter.
import { chromium } from 'playwright';
const TDIR = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
import fs from 'fs';
process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = '1';
const EXT = new URL('../Fogueo', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), SOL = 'So11111111111111111111111111111111111111112';
const BAD = 'BADz7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263pump', GOOD = 'GooDAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaBpump', MID = 'MiDDAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaBpump';
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log((c ? 'OK  ' : 'FAIL') + ' ' + m); };
const lang = process.argv[2] || 'es';
const ctx = await chromium.launchPersistentContext(TDIR + 'p33-' + Date.now(), { headless: true, channel: 'chromium', locale: lang === 'en' ? 'en-US' : 'es-ES', viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2, args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, `--lang=${lang === 'en' ? 'en-US' : 'es-ES'}`] });
const pair = (a) => ({ chainId: 'solana', dexId: 'pumpfun', pairAddress: 'P' + a.slice(0, 20), baseToken: { address: a, symbol: a.slice(0, 4).toUpperCase(), name: 'x' }, quoteToken: { symbol: 'SOL' }, priceUsd: '0.00002', liquidity: { usd: 20000 }, marketCap: 27000, priceChange: { m5: 1, h1: 2 }, info: {} });
await ctx.route('https://api.dexscreener.com/**', (r) => {
  const u = r.request().url();
  if (u.includes(SOL) && ![BAD, GOOD, MID].some((a) => u.includes(a))) return r.fulfill({ json: [{ chainId: 'solana', pairAddress: 'x', baseToken: { address: SOL, symbol: 'SOL' }, quoteToken: { symbol: 'USDC' }, priceUsd: '150', liquidity: { usd: 9e6 } }] });
  const ps = [BAD, GOOD, MID].filter((a) => u.includes(a)).map(pair);
  return r.fulfill({ json: u.includes('/search') ? { pairs: ps } : ps });
});
await ctx.route('https://lite-api.jup.ag/**', (r) => r.fulfill({ json: r.request().url().includes('/price/v3') ? {} : [] }));
await ctx.route('https://api.jup.ag/**', (r) => r.fulfill({ status: r.request().headers()['x-api-key'] === 'GOODKEY1234567890abc' ? 200 : 401, json: {} }));
await ctx.route('https://api.geckoterminal.com/**', (r) => r.fulfill({ status: 404, body: '' }));
await ctx.route('https://raw.githubusercontent.com/**', (r) => r.fulfill({ status: 404, body: '' }));
await ctx.route('https://**.supabase.co/**', (r) => r.fulfill({ json: { ok: true, raised: 0, goal: 50, supporters: 0 } }));
// Tarjeta con la misma estructura que Padre: fila aria-label="Audit", pastillas con clase _outer_…,
// dev y bundle sin etiqueta, comisión con otra clase.
const card = (mint, sym, mc, top10, dev, snip, ins, bun) => `
<div class="card"><div class="c-top"><a href="https://pump.fun/coin/${mint}?utm_source=terminal">${sym}</a><span>MC</span><span>${mc}</span></div>
<div class="_root_1xtf0_1"><div class="_row_123ri_13" aria-label="Audit">
 <div class="_outer_1kzh9_4" aria-label="Top 10 holders"><div class="_pill_1kzh9_15"><svg width="10" height="10"></svg><span class="_text_1kzh9_28">${top10}</span></div></div>
 <div class="_outer_1kzh9_4"><div class="_pill_1kzh9_15"><svg width="10" height="10"></svg><span class="_text_1kzh9_28">${dev}</span></div></div>
 <div class="_outer_1kzh9_4" aria-label="Snipers count & holdings"><div class="_pill_1kzh9_15"><span>${snip.split('•')[0]}</span><span>•</span><span class="_text_1kzh9_28">${snip.split('•')[1]}</span></div></div>
 <div class="_outer_1kzh9_4" aria-label="Insiders holding"><div class="_pill_1kzh9_15"><span class="_text_1kzh9_28">${ins}</span></div></div>
 ${bun ? `<div class="_outer_1kzh9_4"><div class="_pill_1kzh9_15"><span class="_text_1kzh9_28">${bun}</span></div></div>` : ''}
 <div><div class="flex bg-[var(--trenches-audit-tax-pill-bg)] _pill_n4ypv_5"><span>1.25%</span></div></div>
</div></div></div>`;
const trenches = `<!doctype html><html><head><meta charset="utf-8"><title>Trenches</title><style>
body{margin:0;background:#0b0c0f;color:#ddd;font:13px system-ui;padding:20px 380px 20px 20px}
.card{background:#14161b;border:1px solid #222;border-radius:10px;padding:10px;margin-bottom:10px;width:520px}
.c-top{display:flex;gap:10px;margin-bottom:8px}.c-top a{color:#fff;font-weight:700}
._row_123ri_13{display:flex;gap:6px;align-items:center;flex-wrap:nowrap}
._pill_1kzh9_15,._pill_n4ypv_5{display:inline-flex;gap:3px;align-items:center;height:24px;padding:0 6px;border:1px solid #2a2d35;border-radius:16px;color:#e66}
</style></head><body><h3>Trenches</h3>
${card(BAD, 'RUG', '$27K', '66%', '21%3mo', '14•0%', '23%', '34%')}
${card(GOOD, 'GOOD', '$120K', '18%', 'DS1mo', '4•2%', '5%', '3%')}
${card(MID, 'MID', '$40K', '35%', '8%2h', '6•9%', '8%', '')}
</body></html>`;
const fake = fs.readFileSync(TDIR + 'fake-padre.html', 'utf8');
const tokenData = (top10, dev, bun, mint, freeze) => `<div id="td" style="position:fixed;left:20px;bottom:240px;display:flex;gap:14px;background:#111;padding:8px;color:#ccc">
 <div><p>Token Data &amp; Security</p></div>
 <div><div><span>${top10}</span></div><div>Top 10 H.</div></div>
 <div><div><span>${dev}</span></div><div>Dev holding</div></div>
 <div><div><span>${bun}</span></div><div>Bundles H.</div></div>
 <div><div><span>${mint}</span></div><div>Mint Auth.</div></div>
 <div><div><span>${freeze}</span></div><div>Freeze Auth.</div></div></div>`;
await ctx.route('https://trade.padre.gg/**', (r) => {
  const u = r.request().url();
  if (u.includes('/trenches')) return r.fulfill({ body: trenches, contentType: 'text/html' });
  const td = u.includes(BAD) ? tokenData('66%', '21%', '34%', 'No', 'No') : tokenData('18%', '0%', '-', 'No', 'No');
  return r.fulfill({ body: fake.replace('</body>', td + '</body>'), contentType: 'text/html' });
});
let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent('serviceworker');
const extId = sw.url().split('/')[2];
const host = await ctx.newPage(); await host.goto(`chrome-extension://${extId}/popup/popup.html`); await host.waitForTimeout(700);
const send = (msg) => host.evaluate((m) => new Promise((res) => chrome.runtime.sendMessage(m, res)), msg);
await send({ type: 'saveUi', ui: { popupToured: true, onboarded: true, panelToured: true } });
await send({ type: 'saveSettings', settings: { lang } });
const errs = [];

// 1) Trenches: etiquetas
const pg = await ctx.newPage(); pg.on('pageerror', (e) => errs.push(e.message));
await pg.goto('https://trade.padre.gg/trenches'); await pg.waitForTimeout(3500);
const tags = await pg.evaluate(() => [...document.querySelectorAll('[data-fx-chk]')].map((h) => ({ t: h.shadowRoot.textContent.replace(/\s+/g, ' ').trim(), title: h.title })));
console.log(JSON.stringify(tags));
const L = lang === 'en' ? { avoid: 'Avoid', good: 'Good', care: 'Care' } : { avoid: 'Evitar', good: 'Bien', care: 'Ojo' };
ok(tags.length === 3, 'una etiqueta por tarjeta de Trenches');
ok(tags[0]?.t.endsWith(L.avoid) && /66/.test(tags[0].title) && /21/.test(tags[0].title) && /34/.test(tags[0].title), 'la moneda con top 10 66 %, dev 21 % y bundle 34 % sale «evitar» con los motivos');
ok(tags[1]?.t.endsWith(L.good), 'la moneda sana (dev vendió, top 10 18 %) sale «bien»');
ok(tags[2]?.t.endsWith(L.care), 'la moneda con dos señales flojas sale «ojo»');
const tax = await pg.evaluate(() => [...document.querySelectorAll('[aria-label="Audit"]')].map((r) => r.firstElementChild.hasAttribute('data-fx-chk')));
ok(tax.every(Boolean), 'la etiqueta va al principio de la fila (no la tapa la compra rápida de Padre) y no rompe la lectura de las pastillas');
await pg.screenshot({ path: TDIR + `t33-trenches-${lang}.png`, clip: { x: 0, y: 0, width: 600, height: 330 } });
await pg.waitForTimeout(10500);   // se guarda en disco cada 10 s
const saved = await host.evaluate(() => chrome.storage.local.get('blankfireScreen').then((x) => x.blankfireScreen || {}));
ok(saved[BAD]?.snipers === 0 && saved[BAD]?.snipersN === 14 && saved[BAD]?.insiders === 23, 'recuerda snipers e insiders de cada moneda');

// Desactivar etiquetas
await send({ type: 'saveSettings', settings: { screenBadges: false } }); await pg.waitForTimeout(1800);
ok(await pg.evaluate(() => document.querySelectorAll('[data-fx-chk]').length) === 0, 'al apagar «Marcar en Trenches» se quitan las etiquetas');
await send({ type: 'saveSettings', settings: { screenBadges: true } });
await pg.close();

// 2) Página del token: tarjeta de chequeo en el panel
const tp = await ctx.newPage(); tp.on('pageerror', (e) => errs.push(e.message));
await tp.goto('https://trade.padre.gg/trade/solana/' + BAD); await tp.waitForTimeout(4000);
const chk = () => tp.evaluate(() => { const r = document.querySelector('#fogueo-root')?.shadowRoot; const c = r?.querySelector('.chk'); return c ? { cls: c.className, text: c.innerText } : null; });
let c = await chk();
console.log(JSON.stringify(c));
ok(c && /is-avoid/.test(c.cls), 'en la página del token el panel muestra el chequeo en rojo');
await tp.evaluate(() => document.querySelector('#fogueo-root').shadowRoot.querySelector('[data-act="checkToggle"]').click()); await tp.waitForTimeout(500);
c = await chk();
ok(/Snipers/.test(c.text) && /14/.test(c.text) && /23/.test(c.text), 'mezcla los datos de Trenches (snipers 14, insiders 23 %) con los de la página');
ok(!/NaN|undefined|null/.test(c.text), 'sin NaN/undefined en el chequeo');
const panelBox = await tp.evaluate(() => { const r = document.querySelector('#fogueo-root').shadowRoot.querySelector('.fx'); const b = r.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; });
await tp.screenshot({ path: TDIR + `t33-panel-${lang}.png`, clip: { x: panelBox.x - 4, y: panelBox.y - 4, width: panelBox.w + 8, height: Math.min(panelBox.h + 8, 880 - panelBox.y) } });
const ov = await tp.evaluate(() => [...document.querySelector('#fogueo-root').shadowRoot.querySelectorAll('.chk *')].filter((e) => e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflow === 'visible' && getComputedStyle(e).whiteSpace !== 'nowrap').map((e) => e.className).slice(0, 5));
ok(ov.length === 0, 'nada se sale del panel en el chequeo ' + ov.join(','));

// 3) Comprar → la instantánea viaja a la ronda y la revisión marca la entrada peligrosa
const buy = await send({ type: 'buy', key: 'solana:' + BAD, solIn: 0.1, screen: await tp.evaluate(() => null) });
ok(buy.ok, 'compra sin instantánea (orden antigua) sigue funcionando');
await send({ type: 'sell', key: 'solana:' + BAD, pct: 100 });
await tp.evaluate(() => { const r = document.querySelector('#fogueo-root').shadowRoot; r.querySelector('[data-ref="amount"]').value = '0.1'; r.querySelector('[data-ref="amount"]').dispatchEvent(new Event('input')); });
await tp.evaluate(() => document.querySelector('#fogueo-root').shadowRoot.querySelector('.go')?.click()); await tp.waitForTimeout(800);
// Modo estricto: antes de comprar una moneda en rojo, aviso con los motivos y nada comprado todavía.
const guard = await tp.evaluate(() => { const r = document.querySelector('#fogueo-root').shadowRoot; const g = r.querySelector('.guard'); return g ? g.innerText : ''; });
const before = (await send({ type: 'state' })).data.account.positions['solana:' + BAD];
ok(/rug|signals/i.test(guard) && /top 10/i.test(guard) && !before, 'modo estricto: avisa con los motivos antes de comprar una moneda en rojo y no compra');
await tp.evaluate(() => document.querySelector('#fogueo-root').shadowRoot.querySelector('[data-act="guardGo"]')?.click()); await tp.waitForTimeout(1500);
let s = (await send({ type: 'state' })).data;
const pos = s.account.positions['solana:' + BAD];
ok(pos?.screen?.verdict === 'avoid' && pos.screen.risks.length >= 3 && pos.screen.facts.snipersN === 14, 'al comprar desde el panel se guarda el chequeo en la posición');
await send({ type: 'sell', key: 'solana:' + BAD, pct: 100 });
s = (await send({ type: 'state' })).data;
const round = s.account.rounds[0];
ok(round.screen?.verdict === 'avoid', 'la ronda cerrada conserva el chequeo de la entrada');
const { tradeFlags } = await import('../Fogueo/lib/review.js');
const fl = tradeFlags(round, {}, {});
ok(fl.errors[0]?.id === 'riskyEntry' && fl.errors[0].sev === 'high', 'la revisión lo marca como «entraste en una moneda peligrosa» (primer error)');
// cleanScreen: basura del panel no entra
const bogus = await send({ type: 'buy', key: 'solana:' + GOOD, solIn: 0.05, screen: { verdict: 'hack', facts: { top10: '<b>' } } });
s = (await send({ type: 'state' })).data;
ok(bogus.ok && !s.account.positions['solana:' + GOOD].screen, 'una instantánea inválida se ignora');
const b2 = await send({ type: 'buy', key: 'solana:' + MID, solIn: 0.05, screen: { verdict: 'care', risks: ['x'.repeat(200)], facts: { top10: 35.123, evil: 1, curve: 'yes' } } });
s = (await send({ type: 'state' })).data;
const sc = s.account.positions['solana:' + MID].screen;
ok(b2.ok && sc.risks[0].length === 48 && sc.facts.top10 === 35.12 && !('evil' in sc.facts) && !('curve' in sc.facts), 'la instantánea se limpia (textos cortos, solo números y booleanos conocidos)');
await tp.close();

console.log('errores de página:', JSON.stringify(errs));
ok(errs.length === 0, 'sin errores de JavaScript');
console.log(fails ? `${fails} FALLOS` : 'TODO OK');
await ctx.close();
process.exit(fails ? 1 : 0);
