// Resistencia: APIs que fallan o devuelven datos raros, service worker reiniciado, datos antiguos o corruptos,
// doble clic, dos pestañas de Padre y órdenes límite en casos límite.
import { chromium } from 'playwright';
const TDIR = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
import fs from 'fs';
const EXT = new URL('../Fogueo', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), SOL = 'So11111111111111111111111111111111111111112';
const A = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', B = 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm';
let mode = 'ok', p = { [A]: 0.00002, [B]: 2 }, delay = 0;
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log((c ? 'OK  ' : 'FAIL') + ' ' + m); };
const ctx = await chromium.launchPersistentContext(TDIR+'p20-' + Date.now(), { headless: true, channel: 'chromium', locale: 'es-ES', viewport: { width: 1200, height: 900 }, args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--lang=es-ES'] });
const pair = (a) => ({ chainId: 'solana', dexId: 'raydium', pairAddress: 'P' + a.slice(0, 25), baseToken: { address: a, symbol: a === A ? 'BONK' : 'WIF', name: 'x' }, quoteToken: { symbol: 'SOL' }, priceUsd: String(p[a]), liquidity: { usd: 5e6 }, marketCap: p[a] * 1e9, priceChange: {}, info: {} });
await ctx.route('https://api.dexscreener.com/**', async (r) => {
  const u = r.request().url();
  if (u.includes(SOL) && ![A, B].some((a) => u.includes(a))) return r.fulfill({ json: [{ chainId: 'solana', pairAddress: 'x', baseToken: { address: SOL, symbol: 'SOL' }, quoteToken: { symbol: 'USDC' }, priceUsd: '150', liquidity: { usd: 9e6 } }] });
  if (delay) await new Promise((res) => setTimeout(res, delay));
  if (mode === '500') return r.fulfill({ status: 500, body: 'boom' });
  if (mode === 'garbage') return r.fulfill({ status: 200, body: '<html>not json', contentType: 'text/html' });
  if (mode === 'empty') return r.fulfill({ json: u.includes('/search') ? { pairs: [] } : [] });
  if (mode === 'weird') { const ps = [{ ...pair(A), priceUsd: null, liquidity: null, marketCap: undefined }, { ...pair(A), pairAddress: 'neg', priceUsd: '-1' }, { ...pair(A), pairAddress: 'nan', priceUsd: 'NaN' }]; return r.fulfill({ json: u.includes('/search') ? { pairs: ps } : ps }); }
  const ps = [A, B].filter((a) => u.includes(a)).map(pair);
  return r.fulfill({ json: u.includes('/search') ? { pairs: ps } : ps });
});
await ctx.route('https://lite-api.jup.ag/**', (r) => (mode === 'ok' || mode === 'empty' ? r.fulfill({ json: r.request().url().includes('/price/v3') ? {} : [] }) : r.fulfill({ status: 429, body: '' })));
const fake = fs.readFileSync(TDIR+'fake-padre.html', 'utf8');
await ctx.route('https://trade.padre.gg/**', (r) => r.fulfill({ body: fake, contentType: 'text/html' }));
let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent('serviceworker');
const extId = sw.url().split('/')[2];
const host = await ctx.newPage(); await host.goto(`chrome-extension://${extId}/popup/popup.html`); await host.waitForTimeout(800); await host.keyboard.press('Escape');
const send = (msg) => host.evaluate((m) => new Promise((res) => chrome.runtime.sendMessage(m, res)), msg);
const st = async () => (await send({ type: 'state' })).data;
const setStore = (v) => host.evaluate((v) => chrome.storage.local.set({ fogueo: v }), v);
const errs = [];
const openPadre = async (addr) => { const pg = await ctx.newPage(); pg.on('pageerror', (e) => errs.push(e.message)); await pg.goto('https://trade.padre.gg/trade/solana/' + addr); await pg.waitForTimeout(2500); return pg; };
const panelText = (pg) => pg.evaluate(() => document.querySelector('#fogueo-root')?.shadowRoot?.querySelector('.fx')?.innerText || '');
const kA = 'solana:' + A, kB = 'solana:' + B;

// ---- 1. APIs que fallan ----
for (const m of ['500', 'garbage', 'empty', 'weird']) {
  mode = m;
  const pg = await openPadre(A);
  const txt = await panelText(pg);
  const buy = await send({ type: 'buy', key: kA, solIn: 0.1 });
  ok(txt.length > 20 && !/NaN|undefined|\[object/.test(txt) && !buy.ok && buy.error && !/undefined/.test(buy.error), `API «${m}»: el panel sigue en pie y la compra se rechaza con un mensaje claro → «${(buy.error || '').slice(0, 70)}»`);
  await pg.close();
}
mode = 'ok';
// precio que tarda más de 7 s: se corta y no se queda colgado
delay = 9000;
const t0 = Date.now(); const slow = await send({ type: 'resolve', address: B }); const dt = Date.now() - t0;
ok(dt < 9000, `API lenta (9 s): la extensión deja de esperar a los ${Math.round(dt / 1000)} s` + (slow.ok ? '' : ' y avisa'));
delay = 0;

// ---- 2. Service worker reiniciado (se «duerme» y pierde la memoria) ----
await send({ type: 'resolve', address: A });
await send({ type: 'buy', key: kA, solIn: 0.5, slPct: 30, trailing: true });
const cdp = await ctx.newCDPSession(host);
await cdp.send('ServiceWorker.enable'); await cdp.send('ServiceWorker.stopAllWorkers');
await new Promise((r) => setTimeout(r, 1500));
const afterRestart = await send({ type: 'sell', key: kA, pct: 50 });
let s = await st();
ok(afterRestart.ok && afterRestart.data.ok && s.account.positions[kA]?.qty > 0, 'Service worker reiniciado: la cuenta sigue y se puede operar (venta del 50 %)');
await send({ type: 'sell', key: kA, pct: 100 });

// ---- 3. Datos antiguos o corruptos ----
await setStore({ version: 1, settings: { feePct: 1 }, account: { balance: 7, startBalance: 10, positions: {}, rounds: [], fills: [] } });
let r = await send({ type: 'buy', key: kA, solIn: 0.2 });
s = await st();
ok(r.ok && r.data.ok && Array.isArray(s.account.equity) && Array.isArray(s.account.orders) && s.settings.priorityFee > 0, 'Datos de una versión antigua (sin curva, órdenes ni ajustes nuevos): se completan y se puede operar');
const pop2 = await ctx.newPage(); pop2.on('pageerror', (e) => errs.push('POP ' + e.message));
await pop2.goto(`chrome-extension://${extId}/popup/popup.html`); await pop2.waitForTimeout(1200);
ok(await pop2.locator('#equity').innerText().then((t) => /\d/.test(t)), 'Ventana abre con datos antiguos'); await pop2.close();
await setStore('basura');
r = await send({ type: 'state' });
ok(r.ok && r.data?.account && typeof r.data.account.balance === 'number', 'Datos corruptos («basura»): se recupera una cuenta válida en vez de romperse');
await setStore({ account: null, settings: 5 });
r = await send({ type: 'state' });
ok(r.ok && r.data?.account?.positions && typeof r.data.settings === 'object', 'Datos a medias (cuenta nula): cuenta válida');
await send({ type: 'reset', startBalance: 10 });

// ---- 4. Doble clic y tecla repetida ----
const pg = await openPadre(A);
const P = pg.locator('#fogueo-root');
await P.locator('[data-act="onboarded"]').click().catch(() => {});
await P.locator('[data-act="quick"]').nth(1).click();
const nBefore = (await st()).account.fills.length;
await pg.evaluate(() => { const b = document.querySelector('#fogueo-root').shadowRoot.querySelector('[data-ref="buyForm"] .go'); b.click(); b.click(); b.click(); });
await pg.waitForTimeout(2500);
s = await st();
ok(s.account.fills.length - nBefore === 1, `Triple clic en Comprar: ${s.account.fills.length - nBefore} compra(s)`);
await pg.mouse.move(150, 300);
const n2 = s.account.fills.length;
for (let i = 0; i < 4; i++) await pg.keyboard.press('2');
await pg.waitForTimeout(3000);
s = await st();
ok(s.account.fills.length - n2 <= 1, `Tecla «2» pulsada 4 veces seguidas: ${s.account.fills.length - n2} compra(s) (no se disparan en ráfaga)`);

// ---- 5. Dos pestañas de Padre ----
const pg2 = await openPadre(B);
const P2 = pg2.locator('#fogueo-root');
const balBefore = await P2.locator('[data-ref="bal"]').innerText();
await P.locator('[data-act="quick"]').nth(0).click(); await P.locator('[data-ref="buyForm"] .go').click(); await pg.waitForTimeout(2000);
const balAfter = await P2.locator('[data-ref="bal"]').innerText();
ok(balBefore !== balAfter, `Dos pestañas: comprar en una actualiza el saldo de la otra (${balBefore} → ${balAfter})`);

// ---- 6. Órdenes límite ----
await send({ type: 'resolve', address: B });
const o1 = await send({ type: 'placeOrder', key: kB, mc: p[B] * 1e9 * 0.8, solIn: 0.3 });
ok(o1.ok, 'Orden límite colocada (comprar WIF si baja un 20 %)');
p[B] *= 0.9; await new Promise((r) => setTimeout(r, 2700)); await send({ type: 'tick', key: kB }); await new Promise((r) => setTimeout(r, 1200));
s = await st(); ok(s.account.orders.length === 1 && !s.account.positions[kB], 'Baja un 10 %: la orden sigue esperando');
p[B] *= 0.85; await new Promise((r) => setTimeout(r, 2700)); await send({ type: 'tick', key: kB }); await new Promise((r) => setTimeout(r, 2000));
s = await st(); ok(s.account.orders.length === 0 && !!s.account.positions[kB], 'Baja un 23,5 %: la orden se ejecuta y abre posición');
// orden sin saldo cuando llega el momento
await send({ type: 'placeOrder', key: kB, mc: p[B] * 1e9 * 0.95, solIn: 1 });
const bal = (await st()).account.balance;
await send({ type: 'buy', key: kA, solIn: +(bal - 0.5).toFixed(3) });   // nos gastamos el saldo antes de que salte
p[B] *= 0.9; await new Promise((r) => setTimeout(r, 2700)); await send({ type: 'tick', key: kB }); await new Promise((r) => setTimeout(r, 2000));
s = await st();
ok(s.account.orders.length === 0 && s.account.balance >= 0, 'Orden que salta sin saldo suficiente: se cancela sin dejar el saldo en negativo');
// tope de 20 órdenes
await send({ type: 'reset', startBalance: 100 });
let lastErr = null;
for (let i = 0; i < 21; i++) { const x = await send({ type: 'placeOrder', key: kB, mc: 1000 + i, solIn: 0.01 }); if (!x.ok) lastErr = x.error; }
s = await st(); ok(s.account.orders.length === 20 && /20/.test(lastErr || ''), 'Máximo 20 órdenes pendientes: la 21.ª se rechaza');
const id = s.account.orders[0].id; await send({ type: 'cancelOrder', id }); s = await st();
ok(s.account.orders.length === 19 && !s.account.orders.some((o) => o.id === id), 'Cancelar una orden la quita');
ok(!errs.length, 'Sin errores JS en ninguna pestaña' + (errs.length ? ': ' + [...new Set(errs)].join(' | ') : ''));
console.log(fails ? `\n${fails} FALLOS` : '\nTodo bien');
await ctx.close();
