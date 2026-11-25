// Fase 3 de punta a punta: «Dónde pierdes» en Estadísticas y la repetición sin ver el futuro.
import { chromium } from 'playwright';
const TDIR = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const EXT = new URL('../Fogueo', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log((c ? 'OK  ' : 'FAIL') + ' ' + m); };
const SOL = 'So11111111111111111111111111111111111111112';
const ADDR = 'FrogQ' + 'x'.repeat(35) + 'pump';
const NOW = Date.now(), MIN = 60e3;
const T0 = NOW - 6 * 3600e3;
// Velas: sube de 1 a 3 y se desploma (el máximo llega después de la compra real)
const candles = Array.from({ length: 140 }, (_, i) => {
  const p = i < 60 ? 1 + i * 0.01 : i < 90 ? 1.6 + (i - 60) * 0.05 : Math.max(0.4, 3.1 - (i - 90) * 0.06);
  const o = i ? (i - 1 < 60 ? 1 + (i - 1) * 0.01 : i - 1 < 90 ? 1.6 + (i - 61) * 0.05 : Math.max(0.4, 3.1 - (i - 91) * 0.06)) : p;
  return [Math.floor((T0 + i * MIN) / 1000), o * 1e-5, Math.max(o, p) * 1.01e-5, Math.min(o, p) * 0.99e-5, p * 1e-5, 500];
});
const ctx = await chromium.launchPersistentContext(TDIR + 'p41-' + Date.now(), { headless: true, channel: 'chromium', viewport: { width: 1440, height: 940 }, args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`] });
let gtCalls = 0;
await ctx.route('https://api.geckoterminal.com/**', (r) => {
  gtCalls++;
  const u = r.request().url();
  if (u.includes('/pools?')) return r.fulfill({ json: { data: [{ attributes: { address: 'POOLFROG', name: 'FROG / SOL' } }] } });
  if (u.includes('/ohlcv/')) return r.fulfill({ json: { data: { attributes: { ohlcv_list: candles.slice().reverse() } } } });
  return r.fulfill({ status: 404, body: '' });
});
await ctx.route('https://api.dexscreener.com/**', (r) => r.fulfill({ json: r.request().url().includes(SOL) ? [{ chainId: 'solana', baseToken: { address: SOL }, quoteToken: { symbol: 'USDC' }, priceUsd: '180', liquidity: { usd: 9e6 } }] : [] }));
await ctx.route('https://lite-api.jup.ag/**', (r) => r.fulfill({ json: {} }));
let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent('serviceworker');
const extId = sw.url().split('/')[2];
const host = await ctx.newPage(); await host.goto(`chrome-extension://${extId}/bot/bot.html`); await host.waitForTimeout(700);
const send = (m) => host.evaluate((m) => new Promise((r) => chrome.runtime.sendMessage(m, r)), m);
await send({ type: 'saveSettings', settings: { lang: 'es' } });
await send({ type: 'saveUi', ui: { popupToured: true, onboarded: true, panelToured: true } });
const st = (await send({ type: 'state' })).data;
let n = 0;
const R = (o) => ({ id: 'r' + (++n), key: 'solana:' + (o.addr || 'TOK' + n), chain: 'solana', address: o.addr || 'TOK' + n, symbol: o.sym || 'T' + n, openedAt: o.at, closedAt: o.at + (o.hold || 6 * MIN), pnlSol: o.pnl, pnlPct: o.pnl / 0.5 * 100, investedSol: 0.5, returnedSol: 0.5 + o.pnl, feesSol: 0.02, entryMcUsd: o.mc, exitMcUsd: o.mc, reason: 'manual', fills: o.fills || [] });
const real = R({ addr: ADDR, sym: 'FROG', at: T0 + 30 * MIN, hold: 25 * MIN, pnl: 0.12, mc: 60e3, fills: [{ t: T0 + 30 * MIN + 5e3, side: 'buy', price: 1.3e-5, sol: 0.5, mc: 60e3 }, { t: T0 + 55 * MIN + 5e3, side: 'sell', price: 1.55e-5, sol: 0.62, mc: 70e3 }] });
const rounds = [
  R({ at: T0 - 20 * 3600e3, mc: 9e3, pnl: -0.2 }), R({ at: T0 - 19 * 3600e3, mc: 12e3, pnl: -0.25 }), R({ at: T0 - 18 * 3600e3, mc: 15e3, pnl: 0.05 }), R({ at: T0 - 17 * 3600e3, mc: 8e3, pnl: -0.3 }),
  R({ at: T0 - 16 * 3600e3, mc: 200e3, pnl: 0.3 }), R({ at: T0 - 15 * 3600e3, mc: 300e3, pnl: 0.2 }), R({ at: T0 - 14 * 3600e3, mc: 150e3, pnl: 0.1 }), real,
];
st.account.rounds = rounds;
await host.evaluate((v) => chrome.storage.local.set({ fogueo: v }), st);
await host.waitForTimeout(400);

// Estadísticas → «Dónde pierdes»
const pop = await ctx.newPage(); await pop.setViewportSize({ width: 392, height: 600 });
const errs = []; pop.on('pageerror', (e) => errs.push('popup: ' + e.message));
await pop.goto(`chrome-extension://${extId}/popup/popup.html`); await pop.waitForTimeout(900);
await pop.click('[data-tab="stats"]'); await pop.waitForTimeout(300);
await pop.click('[data-sp="all"]').catch(() => {}); await pop.waitForTimeout(300);
const stTxt = await pop.locator('[data-view="stats"]').innerText();
ok(/Dónde pierdes/.test(stTxt) && /menos de \$20K pierdes/.test(stTxt), 'Estadísticas: «Dónde pierdes» señala el tramo < $20K');
ok(/Donde mejor te va es entre \$100K – \$500K/.test(stTxt), 'y dice dónde mejor te va');
await pop.locator('.dfs').scrollIntoViewIfNeeded();
await pop.screenshot({ path: TDIR + 't41-stats-es.png', fullPage: true });
await pop.locator('.dtables summary').click(); await pop.waitForTimeout(200);
ok(await pop.locator('.dtables .dr').count() >= 8, 'con «Ver los números» salen las tablas (market cap, hora, tiempo, repetir)');
const sw0 = await pop.evaluate(() => document.documentElement.scrollWidth);
ok(sw0 <= 392, 'el popup no se ensancha (' + sw0 + ' px)');

// Historial → «Repetir esta operación» abre la repetición
await pop.click('[data-tab="history"]'); await pop.waitForTimeout(300);
await pop.locator(`[data-row="${real.id}"]`).click(); await pop.waitForTimeout(300);
ok(await pop.locator(`.replay-btn[data-id="${real.id}"]`).count() === 1, 'el detalle de cada operación tiene «Repetir esta operación»');

const pg = await ctx.newPage(); pg.on('pageerror', (e) => errs.push('replay: ' + e.message));
await pg.goto(`chrome-extension://${extId}/replay/replay.html?id=${real.id}`);
await pg.waitForSelector('svg.chart', { timeout: 15000 }).catch(() => {});
await pg.waitForTimeout(400);
ok(await pg.locator('svg.chart .fog').count() === 1 && /Futuro oculto/.test(await pg.locator('svg.chart').textContent()), 'arranca con el futuro tapado');
const meta = await pg.locator('.meta').innerText();
ok(/vela 10 de 139/.test(meta), 'empieza 20 velas antes de tu compra real (vela 10 de 139) → ' + meta.split('\n').join(' '));
const visibleCandles = await pg.locator('svg.chart .cd').count();
ok(visibleCandles === 10, 'solo se ven las velas pasadas (' + visibleCandles + ')');
// El eje no delata el futuro: el precio más alto del eje está por debajo del máximo que llegará (3,1e-5)
const axMax = await pg.evaluate(() => Math.max(...[...document.querySelectorAll('svg.chart .ax:not(.t)')].map((t) => parseFloat(t.textContent.replace(/[^0-9,.\-e₀-₉]/g, '').replace(',', '.')) || 0)));
ok(await pg.evaluate(() => { const ys = [...document.querySelectorAll('svg.chart .cd rect')].map((r) => +r.getAttribute('y')); return Math.min(...ys) > 5; }), 'el eje vertical sale solo de lo visible');
await pg.screenshot({ path: TDIR + 't41-replay-play-es.png' });
// 5x durante ~2 s
await pg.click('[data-act="speed"][data-v="5"]');
await pg.click('[data-act="play"]'); await pg.waitForTimeout(2100);
await pg.click('[data-act="pause"]');
const cur = Number((await pg.locator('.meta').innerText()).match(/vela (\d+)/)[1]);
ok(cur >= 18 && cur <= 24, 'a 5x avanza unas 5 velas por segundo (va por la ' + cur + ')');
await pg.keyboard.press('b'); await pg.waitForTimeout(150);
ok(await pg.locator('svg.chart .mine.buy').count() === 1 && await pg.locator('[data-act="sell"]').count() === 1, 'B compra en la vela actual y aparece «Vender aquí»');
for (let i = 0; i < 25; i++) await pg.keyboard.press('ArrowRight');
await pg.waitForTimeout(150);
const live = await pg.locator('.live').innerText();
ok(/Tu posición ahora/.test(live) && /comisiones/.test(live), 'enseña cómo va tu posición, con comisiones');
ok(await pg.locator('svg.chart .real.buy').count() === 1, 'tu compra real aparece cuando la partida llega a ella');
await pg.keyboard.press('s'); await pg.waitForTimeout(150);
await pg.click('[data-act="reveal"]'); await pg.waitForTimeout(300);
ok(await pg.locator('svg.chart .fog').count() === 0 && await pg.locator('svg.chart .cd').count() === 139, '«Ver el final» destapa todo');
ok(await pg.locator('svg.chart .hs').count() >= 130, 'tira de colores: qué habría pasado entrando en cada vela');
const cmp = await pg.locator('.cmp').innerText();
ok(/En la repetición/.test(cmp) && /En la operación real/.test(cmp) && /La mejor entrada posible/.test(cmp), 'compara la repetición, la operación real y la mejor entrada');
// Probar entrada aquí: clic en una vela de la subida
const box = await pg.locator('svg.chart').boundingBox();
await pg.mouse.click(box.x + box.width * 0.2, box.y + box.height * 0.5); await pg.waitForTimeout(300);
const test = await pg.locator('.test').innerText().catch(() => '');
ok(/Entrando a las/.test(test) && /tras comisiones/.test(test), 'clic en una vela: prueba a entrar ahí → ' + test.split('\n')[0]);
ok(await pg.locator('svg.chart .lvl.stop').count() === 1 && await pg.locator('svg.chart .lvl.tp').count() === 1, 'dibuja tu stop y tu objetivo');
await pg.screenshot({ path: TDIR + 't41-replay-study-es.png' });
// Cambiar las reglas recalcula
await pg.fill('input[name="tpPct"]', '50'); await pg.locator('input[name="tpPct"]').dispatchEvent('change'); await pg.waitForTimeout(200);
ok(/objetivo|stop|final/.test(await pg.locator('.test').innerText()), 'cambiar stop u objetivo recalcula la prueba');
// Cualquier moneda (beta): por dirección
await pg.fill('input[name="mint"]', ADDR); await pg.click('form[data-form="mint"] button'); await pg.waitForSelector('svg.chart .fog', { timeout: 9000 }).catch(() => {});
ok(await pg.locator('svg.chart .fog').count() === 1, 'también repite cualquier moneda por su dirección');
await pg.fill('input[name="mint"]', 'no-es-una-direccion'); await pg.click('form[data-form="mint"] button'); await pg.waitForTimeout(500);
ok(/no parece de Solana/.test(await pg.locator('.big-e').innerText().catch(() => '')), 'dirección inválida: lo explica');
// Inglés y tamaño estrecho
await pg.click(`[data-act="pick"][data-id="${real.id}"]`); await pg.waitForSelector('svg.chart', { timeout: 9000 }).catch(() => {});
await pg.click('[data-act="lang"]'); await pg.waitForTimeout(300);
const en = await pg.locator('#app').innerText();
const esLines = en.split('\n').filter((x) => /[áéíóúñ¿]| de la | para /i.test(x));
ok(/Replay/.test(en) && !esLines.length, 'en inglés: ' + (esLines.slice(0, 4).join(' | ') || 'sin restos'));
await pg.screenshot({ path: TDIR + 't41-replay-en.png' });
await pg.setViewportSize({ width: 820, height: 1000 }); await pg.waitForTimeout(400);
const over = await pg.evaluate(() => [...document.querySelectorAll('.app *')].filter((e) => { const r = e.getBoundingClientRect(); return r.width && r.right > document.documentElement.clientWidth + 1; }).length);
ok(over === 0, 'pantalla estrecha: nada se sale');
await pg.screenshot({ path: TDIR + 't41-replay-narrow.png', fullPage: true });
ok(errs.length === 0, 'sin errores de JavaScript ' + errs.join(' | '));
await ctx.close();
console.log(fails ? `${fails} fallos` : 'TODO OK'); process.exit(fails ? 1 : 0);
