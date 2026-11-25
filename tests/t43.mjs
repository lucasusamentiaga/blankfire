// Fases 4 y 5 de punta a punta: Radar (temas, ballenas, wallets) y copiloto (aviso con el bot y en el panel de Padre).
import { chromium } from 'playwright';
import fs from 'fs';
const TDIR = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const EXT = new URL('../Fogueo', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log((c ? 'OK  ' : 'FAIL') + ' ' + m); };
const SOL = 'So11111111111111111111111111111111111111112';
const NOW = Date.now();
const A = (s) => (s.replace(/[0OIl]/g, 'o') + 'x'.repeat(40)).slice(0, 40) + 'pump';
const T = {
  FROG: { name: 'Moon Frog', px: 0.0005, liq: 80000, mc: 500000, h1: 40 }, KFROG: { name: 'Frog King', px: 0.0002, liq: 30000, mc: 200000, h1: 12 },
  BFROG: { name: 'Baby Frog', px: 0.0001, liq: 20000, mc: 90000, h1: -8 }, CAT: { name: 'Lone Cat', px: 0.001, liq: 50000, mc: 300000, h1: 5 },
};
const ADDR = Object.fromEntries(Object.keys(T).map((k) => [k, A(k)]));
const pairOf = (k) => { const t = T[k]; return {
  chainId: 'solana', dexId: 'pumpswap', pairAddress: 'P' + ADDR[k], pairCreatedAt: NOW - 3 * 3600e3, baseToken: { address: ADDR[k], name: t.name, symbol: k }, quoteToken: { symbol: 'SOL' },
  priceUsd: String(t.px), liquidity: { usd: t.liq }, marketCap: t.mc, fdv: t.mc, volume: { m5: 30000, h1: 200000, h24: 900000 },
  txns: { m5: { buys: 80, sells: 30 }, h1: { buys: 400, sells: 150 }, h24: { buys: 2000, sells: 1500 } }, priceChange: { m5: 4, h1: t.h1, h24: 50 },
  info: { websites: [{ url: 'https://x' }], socials: [{ type: 'twitter', url: 'https://x' }] },
}; };
const ctx = await chromium.launchPersistentContext(TDIR + 'p43-' + Date.now(), { headless: true, channel: 'chromium', viewport: { width: 1440, height: 960 }, args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`] });
await ctx.route('https://api.dexscreener.com/**', (r) => {
  const u = r.request().url();
  if (u.includes('/token-boosts/')) return r.fulfill({ json: [{ chainId: 'solana', tokenAddress: ADDR.FROG }] });
  if (u.includes('/token-profiles/')) return r.fulfill({ json: ['KFROG', 'BFROG', 'CAT'].map((k) => ({ chainId: 'solana', tokenAddress: ADDR[k] })) });
  if (u.includes('/search')) return r.fulfill({ json: { pairs: Object.keys(T).filter((k) => u.includes(ADDR[k])).map(pairOf) } });
  if (u.includes(SOL)) return r.fulfill({ json: [{ chainId: 'solana', baseToken: { address: SOL, symbol: 'SOL' }, quoteToken: { symbol: 'USDC' }, priceUsd: '180', liquidity: { usd: 9e6 } }] });
  const ps = Object.keys(T).filter((k) => u.includes(ADDR[k])).map(pairOf);
  return r.fulfill({ json: ps });
});
const iso = (min) => new Date(NOW - min * 60e3).toISOString();
await ctx.route('https://api.geckoterminal.com/**', (r) => {
  const u = r.request().url();
  if (u.includes('/pools?')) return r.fulfill({ json: { data: [{ attributes: { address: 'POOLFROG', name: 'FROG / SOL', reserve_in_usd: '80000' } }] } });
  if (u.includes('/trades')) return r.fulfill({ json: { data: [
    { attributes: { block_timestamp: iso(1), kind: 'buy', volume_in_usd: '4200', tx_from_address: 'WhaLe1' + 'z'.repeat(38) } },
    { attributes: { block_timestamp: iso(3), kind: 'sell', volume_in_usd: '1500', tx_from_address: 'DumP' + 'z'.repeat(40) } },
    { attributes: { block_timestamp: iso(4), kind: 'buy', volume_in_usd: '90', tx_from_address: 'small' + 'z'.repeat(39) } },
    ...Array.from({ length: 6 }, (_, i) => ({ attributes: { block_timestamp: iso(6 + i), kind: 'buy', volume_in_usd: '60', tx_from_address: 'BoT' + 'z'.repeat(41) } })),
  ] } });
  if (u.includes('/ohlcv/')) return r.fulfill({ json: { data: { attributes: { ohlcv_list: Array.from({ length: 30 }, (_, i) => [Math.floor(NOW / 1000) - (30 - i) * 60, 1, 1.02, 0.99, 1.01, 900 + (i * 97) % 300]) } } } });
  return r.fulfill({ status: 404, body: '' });
});
await ctx.route('https://lite-api.jup.ag/**', (r) => r.fulfill({ json: r.request().url().includes('/swap/v1/quote') ? { priceImpactPct: '0.004', routePlan: [{ swapInfo: { label: 'Pump.fun Amm' } }] } : {} }));
const fake = fs.readFileSync(TDIR + 'fake-padre.html', 'utf8');
await ctx.route('https://trade.padre.gg/**', (r) => r.fulfill({ body: fake, contentType: 'text/html' }));
let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent('serviceworker');
const id = sw.url().split('/')[2];
const errs = [];
const pg = await ctx.newPage(); pg.on('pageerror', (e) => errs.push('radar: ' + e.message));
await pg.goto(`chrome-extension://${id}/radar/radar.html`); await pg.waitForTimeout(300);
const send = (m) => pg.evaluate((m) => new Promise((r) => chrome.runtime.sendMessage(m, r)), m);
await send({ type: 'saveSettings', settings: { lang: 'es' } });
await send({ type: 'saveUi', ui: { popupToured: true, onboarded: true, panelToured: true } });
await pg.reload(); await pg.waitForSelector('.themes', { timeout: 15000 }).catch(() => {});
let txt = await pg.locator('#app').innerText();
ok(/Temas de moda/.test(txt) && (await pg.locator('.th').count()) >= 1 && /frog/i.test(await pg.locator('.th-w').first().innerText()), 'temas de moda: «frog» (3 monedas)');
ok(await pg.locator('.pnav a').count() === 3 && await pg.locator('.pnav a[aria-current="page"]').innerText() === 'Radar', 'navegación Bot · Radar · Repetición');
await pg.locator('.th-row').first().click(); await pg.waitForTimeout(200);
ok(await pg.locator('.coins li').count() === 3, 'al abrir un tema salen sus monedas');
// Ballenas desde el tema
await pg.locator('.coins [data-act="whales"]').first().click();
await pg.waitForSelector('.tape', { timeout: 12000 }).catch(() => {});
txt = await pg.locator('#app').innerText();
ok(await pg.locator('.wt').count() === 2 && /4,2\s?K|4\.2K/.test(await pg.locator('.wt').first().innerText()), 'ballenas: 2 operaciones grandes, la primera la compra de $4,2K');
ok(await pg.locator('.flow').count() === 3 && /ballenas/.test(await pg.locator('.flows').innerText()), 'flujo de 5 min, 15 min y 1 h (todo y solo ballenas)');
ok(await pg.locator('.busy li').count() === 1 && /6 órdenes/.test(await pg.locator('.busy').innerText()), 'detecta la wallet que repite (bot)');
await pg.screenshot({ path: TDIR + 't43-radar-es.png', fullPage: true });
// Seguir una ballena
await pg.locator('.wt [data-act="follow"]').first().click(); await pg.waitForTimeout(400);
ok(await pg.locator('.wc').count() === 1, '«Seguir» en una ballena la añade a tus wallets');
ok(await pg.locator('form[data-form="helius"]').count() === 1 && /dashboard\.helius\.dev/.test(await pg.locator('.helius').innerText()), 'sin clave de Helius explica cómo conseguirla (la creas tú)');
const badKey = await send({ type: 'saveKeys', helius: 'no-vale' });
ok(!badKey.ok && /formato/.test(badKey.error), 'rechaza una clave de Helius con mal formato');
// Patrón de una wallet (historial ya leído)
const W = 'WaLLeTx' + 'y'.repeat(37);
await send({ type: 'walletAdd', address: W, name: 'Ansem' });
const tx = (min, sol, mint, qty) => ({ signature: 's' + min, timestamp: Math.floor((NOW - min * 60e3) / 1000), accountData: [{ account: W, nativeBalanceChange: Math.round(sol * 1e9) }], tokenTransfers: [{ mint, tokenAmount: Math.abs(qty), fromUserAccount: qty < 0 ? W : 'p', toUserAccount: qty > 0 ? W : 'p' }] });
await pg.evaluate(({ W, txs }) => chrome.storage.local.get('blankfireWallets').then((g) => { const ws = g.blankfireWallets; ws.data[W] = { at: Date.now(), txs }; return chrome.storage.local.set({ blankfireWallets: ws }); }), { W, txs: [
  tx(300, -1, 'M1', 1e6), tx(280, 2.5, 'M1', -1e6), tx(250, -0.5, 'M2', 2e6), tx(240, 0.2, 'M2', -2e6), tx(200, -0.5, 'M3', 1e6), tx(190, 1.5, 'M3', -1e6),
  tx(150, -1, 'M4', 1e6), tx(140, 0.5, 'M4', -1e6), tx(100, -0.2, 'M5', 1e5), tx(95, 0.6, 'M5', -1e5), tx(8, -0.4, ADDR.FROG, 1e6)] });
await pg.reload(); await pg.waitForTimeout(800);
await pg.locator(`.wc-h[data-a="${W}"]`).click(); await pg.waitForTimeout(200);
const wc = await pg.locator('.wc.on').innerText();
ok(/Ansem/.test(wc) && /60\s?% acierto/.test(wc) && /Suele entrar/.test(wc) && /Aguanta/.test(wc), 'patrón de la wallet: 60 % de acierto, dónde entra y cuánto aguanta');
await pg.screenshot({ path: TDIR + 't43-wallet-es.png', fullPage: true });

// ---- Copiloto ----
const bot = await ctx.newPage(); bot.on('pageerror', (e) => errs.push('bot: ' + e.message));
await bot.goto(`chrome-extension://${id}/bot/bot.html`); await bot.waitForTimeout(800);
ok(/Bloqueado/.test(await bot.locator('.copilot').innerText()) && await bot.locator('.copilot .gbar').count() === 1, 'copiloto bloqueado al principio, con su barra de progreso');
const locked = await bot.evaluate(() => new Promise((r) => chrome.runtime.sendMessage({ type: 'botCopilot', copilot: { on: true } }, r)));
ok(!locked.ok && /desbloquea/.test(locked.error), 'no se puede encender a la fuerza');
// Simulación con 22 operaciones y beneficio → desbloqueado
await bot.evaluate(() => chrome.storage.local.set({ blankfireBot: { config: {}, session: null, past: [{ id: 'old', startedAt: Date.now() - 864e5, endedAt: Date.now() - 8e7, budgetSol: 10, balance: 11.2, trades: 22, status: 'stopped' }] } }));
await bot.reload(); await bot.waitForTimeout(700);
ok(await bot.locator('form[data-form="copilot"]').count() === 1, 'con 22 operaciones y +1,2 SOL se desbloquea');
await bot.locator('form[data-form="copilot"] input[name="on"]').check();
await bot.fill('form[data-form="copilot"] input[name="maxSol"]', '0.05');
await bot.click('form[data-form="copilot"] button[type="submit"]'); await bot.waitForTimeout(400);
let store = await bot.evaluate(() => chrome.storage.local.get('blankfireBot').then((g) => g.blankfireBot));
ok(store.copilot.on && store.copilot.maxSol === 0.05, 'encendido con 0,05 SOL por aviso');
await bot.click('form[data-form="start"] button'); 
await bot.waitForFunction(() => document.querySelectorAll('.log .ev').length >= 2, null, { timeout: 25000 }).catch(() => {});
await bot.waitForTimeout(800);
store = await bot.evaluate(() => chrome.storage.local.get('blankfireBot').then((g) => g.blankfireBot));
const buy = store.session.log.find((l) => l.kind === 'buy');
ok(buy?.symbol === 'FROG' && /que sigues/.test(buy.agents.smarts.notes[0].t) && buy.agents.smarts.notes[0].v.n === 'Ansem', 'el bot compra FROG y el agente de dinero sabe que «Ansem, que sigues, compró hace un rato»');
const sig = (store.signals || []).find((x) => x.kind === 'buy');
ok(sig?.symbol === 'FROG' && sig.sizeSol === 0.05 && sig.stopPct === store.session.config.stopPct && /trade\.padre\.gg\/trade\/solana\//.test(sig.url), 'aviso del copiloto: FROG, 0,05 SOL, con el stop y el enlace de Padre');
ok(await bot.locator('.sigs li').count() >= 1, 'el aviso aparece en la ventana del bot');
await bot.screenshot({ path: TDIR + 't43-bot-copilot-es.png', fullPage: true });
// Panel de Padre en esa moneda
const pp = await ctx.newPage(); pp.on('pageerror', (e) => errs.push('padre: ' + e.message));
await pp.goto('https://trade.padre.gg/trade/solana/' + ADDR.FROG); await pp.waitForTimeout(3500);
const card = await pp.evaluate(() => document.querySelector('#fogueo-root')?.shadowRoot?.querySelector('.cop-card')?.innerText || '');
ok(/Copiloto: el bot compraría aquí/.test(card) && /0,05 SOL/.test(card) && /wallet aparte/.test(card), 'en Padre, el panel enseña el aviso del copiloto en esa moneda');
// Venta: el bot cierra (a mano) y el copiloto avisa de vender
await bot.evaluate((k) => new Promise((r) => chrome.runtime.sendMessage({ type: 'botSell', key: k }, r)), 'solana:' + ADDR.FROG);
await pp.waitForTimeout(800);
store = await bot.evaluate(() => chrome.storage.local.get('blankfireBot').then((g) => g.blankfireBot));
ok(store.signals.some((x) => x.kind === 'sell' && x.symbol === 'FROG'), 'al vender, el copiloto avisa de vender');
const card2 = await pp.evaluate(() => document.querySelector('#fogueo-root')?.shadowRoot?.querySelector('.cop-card')?.innerText || '');
ok(/el bot vendería aquí/.test(card2), 'y el panel de Padre cambia a «el bot vendería aquí»');
// Inglés
await pg.bringToFront(); await pg.click('[data-act="lang"]'); await pg.waitForTimeout(400);
const en = await pg.locator('#app').innerText();
const esLines = en.split('\n').filter((x) => /[áéíóúñ¿]| de la | para /i.test(x));
ok(/Trending themes/.test(en) && !esLines.length, 'en inglés: ' + (esLines.slice(0, 5).join(' | ') || 'sin restos'));
await pg.screenshot({ path: TDIR + 't43-radar-en.png', fullPage: true });
await pg.setViewportSize({ width: 760, height: 1000 }); await pg.waitForTimeout(300);
const over = await pg.evaluate(() => [...document.querySelectorAll('.app *')].filter((e) => { const r = e.getBoundingClientRect(); return r.width && r.right > document.documentElement.clientWidth + 1; }).map((e) => e.className).slice(0, 4));
ok(over.length === 0, 'pantalla estrecha: nada se sale ' + over.join(','));
ok(errs.length === 0, 'sin errores de JavaScript ' + errs.join(' | '));
await ctx.close();
console.log(fails ? `${fails} fallos` : 'TODO OK'); process.exit(fails ? 1 : 0);
