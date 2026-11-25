// Bot de práctica de punta a punta: mercado simulado, compra con el consejo, veto anti-rug, stop duro,
// registro con los cuatro agentes, freno y resumen final. Capturas en ES y EN.
import { chromium } from 'playwright';
import fs from 'fs';
const TDIR = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const EXT = new URL('../Fogueo', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log((c ? 'OK  ' : 'FAIL') + ' ' + m); };
const SOL = 'So11111111111111111111111111111111111111112';
const NOW = Date.now();
const T = {
  GOOD: { sym: 'FROG', name: 'Moon Frog', px: 0.0005, liq: 80000, mc: 500000, h1: 40, m5: 4, b5: 80, s5: 30, v5: 30000, v1: 200000 },
  RUG: { sym: 'RUGME', name: 'Frog Cash', px: 0.0002, liq: 50000, mc: 300000, h1: 25, m5: 2, b5: 90, s5: 20, v5: 30000, v1: 200000 },
  LATE: { sym: 'LATE', name: 'Late Train', px: 0.001, liq: 90000, mc: 900000, h1: 650, m5: 10, b5: 60, s5: 40, v5: 9000, v1: 90000 },
  TINY: { sym: 'TINY', name: 'Tiny Thing', px: 0.00001, liq: 2000, mc: 9000, h1: 10, m5: 1, b5: 10, s5: 10, v5: 100, v1: 1000 },
};
const ADDR = Object.fromEntries(Object.keys(T).map((k) => [k, (k + 'x'.repeat(40)).slice(0, 40) + 'pump']));
const pairOf = (k) => { const t = T[k]; return {
  chainId: 'solana', dexId: 'pumpswap', pairAddress: 'P' + ADDR[k], pairCreatedAt: NOW - 3 * 3600e3,
  baseToken: { address: ADDR[k], name: t.name, symbol: t.sym }, quoteToken: { symbol: 'SOL' },
  priceUsd: String(t.px), liquidity: { usd: t.liq }, marketCap: t.mc, fdv: t.mc,
  volume: { m5: t.v5, h1: t.v1 }, txns: { m5: { buys: t.b5, sells: t.s5 }, h1: { buys: t.b5 * 5, sells: t.s5 * 5 } },
  priceChange: { m5: t.m5, h1: t.h1 }, info: { websites: [{ url: 'https://x' }], socials: [{ type: 'twitter', url: 'https://x' }] },
}; };
const candles = (rug) => Array.from({ length: 30 }, (_, i) => { const t = Math.floor(NOW / 1000) - (30 - i) * 60; const o = 1 + i * 0.01, c = rug && i === 20 ? o * 0.35 : o * 1.008; return [t, o, Math.max(o, c) * 1.01, Math.min(o, c) * 0.99, c, 1000 + (i * 137) % 700]; });

const ctx = await chromium.launchPersistentContext(TDIR + 'p39-' + Date.now(), { headless: true, channel: 'chromium', viewport: { width: 1440, height: 980 }, args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--lang=es-ES'] });
await ctx.route('https://api.dexscreener.com/**', (route) => {
  const u = route.request().url();
  if (u.includes('/token-boosts/')) return route.fulfill({ json: [{ chainId: 'solana', tokenAddress: ADDR.GOOD, amount: 100 }, { chainId: 'ethereum', tokenAddress: '0xabc' }] });
  if (u.includes('/token-profiles/')) return route.fulfill({ json: ['RUG', 'LATE', 'TINY'].map((k) => ({ chainId: 'solana', tokenAddress: ADDR[k] })) });
  if (u.includes('/search')) return route.fulfill({ json: { pairs: [] } });
  if (u.includes(SOL)) return route.fulfill({ json: [{ chainId: 'solana', baseToken: { address: SOL, symbol: 'SOL' }, quoteToken: { symbol: 'USDC' }, priceUsd: '180', liquidity: { usd: 9e6 } }] });
  return route.fulfill({ json: Object.keys(T).filter((k) => u.includes(ADDR[k])).map(pairOf) });
});
await ctx.route('https://api.rugcheck.xyz/**', (r) => r.fulfill({ json: { risks: [], score: 1, score_normalised: 1, lpLockedPct: 100 } }));
// (la seguridad con riesgos se prueba en t47; aquí todas salen limpias)
await ctx.route('https://api.geckoterminal.com/**', (route) => {
  const u = route.request().url();
  const k = Object.keys(T).find((x) => u.includes(ADDR[x]));
  if (u.includes('/pools?')) return route.fulfill({ json: { data: [{ attributes: { address: 'POOL' + (k || '') } }] } });
  return route.fulfill({ json: { data: { attributes: { ohlcv_list: candles(u.includes('POOLRUG')) } } } });
});
await ctx.route('https://lite-api.jup.ag/**', (r) => {
  const u = r.request().url();
  if (u.includes('/swap/v1/quote')) return r.fulfill({ json: { priceImpactPct: '0.004', routePlan: [{ swapInfo: { label: 'Pump.fun Amm' } }] } });
  return r.fulfill({ json: u.includes('/price/v3') ? {} : [] });
});
let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent('serviceworker');
const id = sw.url().split('/')[2];
const errors = [];
const pg = await ctx.newPage();
pg.on('pageerror', (e) => errors.push(e.message));
await pg.goto(`chrome-extension://${id}/bot/bot.html`); await pg.waitForTimeout(500);
await pg.evaluate(() => new Promise((res) => chrome.runtime.sendMessage({ type: 'saveSettings', settings: { lang: 'es' } }, res)));
await pg.reload(); await pg.waitForTimeout(900);
const store = () => sw.evaluate(() => chrome.storage.local.get('blankfireBot').then((g) => g.blankfireBot));

ok(/Pon a prueba el bot/.test(await pg.innerText('body')) && (await pg.locator('.flow li').count()) === 9 && (await pg.locator('.care li').count()) >= 5, 'sin sesión explica los 9 pasos (restricciones, filtros, 6 agentes, ejecutor) y de qué tener cuidado');
await pg.screenshot({ path: TDIR + 't39-intro-es.png', fullPage: true });
// Con 20 € (0,13 SOL) la ventana dice cuánto se va en comisiones y lo que hay que ganar para no perder.
await pg.fill('input[name="budgetSol"][form="startForm"]', '0.13');
await pg.waitForTimeout(150);
const costTxt = await pg.locator('[data-ref="cost"]').innerText();
ok(/comisiones/.test(costTxt) && /Para no perder/.test(costTxt) && /wallet del bot/.test(costTxt), 'con 0,13 SOL explica el coste de cada entrada (con las comisiones de la wallet del bot)');
await pg.locator('.pace input[value="fast"]').check();
await pg.waitForTimeout(500);
const cfgFast = (await store()).config;
ok(cfgFast.pace === 'fast' && cfgFast.tpPct === 12 && cfgFast.maxHoldMin === 8, 'elegir «Rápido» ajusta de golpe objetivo, tiempo y demás');
ok((await pg.locator('.pace.on').innerText()).includes('Rápido') && Number(await pg.inputValue('input[name="budgetSol"][form="startForm"]')) === 0.13, 'se marca el ritmo elegido y no se pierde el saldo escrito');
await pg.locator('.pace input[value="balanced"]').check();
await pg.waitForTimeout(400);
await pg.screenshot({ path: TDIR + 't39-cost-es.png' });
await pg.fill('input[name="budgetSol"][form="startForm"]', '10');
await pg.waitForTimeout(150);
ok(!/no comprará/.test(await pg.locator('[data-ref="cost"]').innerText()), 'con 10 SOL (entradas de 1 SOL) ya compensa');
await pg.click('form[data-form="start"] button');
await pg.waitForFunction(() => document.querySelectorAll('.log .ev').length >= 3, null, { timeout: 25000 }).catch(() => {});
await pg.waitForTimeout(800);
let b = await store();
const s = b.session;
ok(s.status === 'running' && s.config.budgetSol === 10, 'arranca con un saldo fijo de 10 SOL');
const buy = s.log.find((l) => l.kind === 'buy');
ok(buy?.symbol === 'FROG' && Object.keys(s.positions).length === 1, 'compra la moneda sana (FROG)');
ok(buy?.agents?.smarts?.score > 0 && buy.agents.trends.notes.length && buy.agents.debate.bull.length && buy.agents.router.ok, 'la compra guarda la opinión de los cuatro agentes');
ok(/Jupiter · Pump.fun Amm/.test(buy?.agents?.router?.route || ''), 'la ruta viene de Jupiter');
const rug = s.log.find((l) => l.symbol === 'RUGME');
ok(rug?.kind === 'skip' && rug.agents?.debate?.veto, 'veta la moneda con vela de rug aunque el flujo sea bueno');
ok(s.log.some((l) => l.symbol === 'LATE' && l.stage === 'filter' && /llega tarde/.test(l.reason.t)) && s.log.some((l) => l.symbol === 'TINY' && l.stage === 'filter'), 'filtros: salta la que llega tarde y la diminuta');
const p = Object.values(s.positions)[0];
ok(Math.abs(s.balance + p.costSol - 10) < 1e-9 && p.costSol <= 2.05, 'gasta ≤ 20 % del saldo (ritmo Equilibrado) y nada fuera de él');

// Abrir los detalles de la compra.
await pg.locator('.ev.k-buy .ev-row').first().click();
await pg.waitForTimeout(300);
ok((await pg.locator('.ev.k-buy .agent').count()) === 7 && /A favor/.test(await pg.locator('.ev.k-buy .agents').innerText()) && (await pg.locator('.ev.k-buy .ck.ok').count()) >= 3 && (await pg.locator('.ev.k-buy .verify a').count()) === 4, 'al pulsar la compra se ven los seis agentes, el debate, el repaso de sí / no y los enlaces para comprobarlo');
await pg.screenshot({ path: TDIR + 't39-live-es.png', fullPage: true });

// Stop duro: el precio cae un 9 %.
T.GOOD.px *= 0.91;
await pg.evaluate(() => new Promise((res) => chrome.runtime.sendMessage({ type: 'botScanNow' }, res)));
await pg.waitForTimeout(600);
b = await store();
const sell = b.session.log.find((l) => l.kind === 'sell');
ok(sell?.exit === 'stop' && sell.pnlSol < 0 && !b.session.positions[`solana:${ADDR.GOOD}`], 'el stop duro vende al caer más del 7 %');
ok(b.session.closed.length === 1 && b.session.balance < 10 && b.session.balance > 9.7, 'la pérdida queda dentro del saldo de la sesión');

// Límites: el stop no se puede poner fuera de 6–8 %, y el saldo no cambia a mitad de sesión.
const cfgR = await pg.evaluate(() => new Promise((res) => chrome.runtime.sendMessage({ type: 'botConfig', config: { stopPct: 20, budgetSol: 50 } }, res)));
ok(cfgR.data.session.config.stopPct === 8 && cfgR.data.session.config.budgetSol === 10, 'stop máximo 8 % y saldo fijo durante la sesión');
ok(await pg.locator('input[name="budgetSol"]:disabled').count() === 1, 'el saldo aparece bloqueado mientras dura la sesión');

// Pausa y fin.
await pg.click('[data-act="pause"]'); await pg.waitForTimeout(300);
ok((await store()).session.status === 'paused' && /En pausa/.test(await pg.innerText('.bar')), 'pausa');
await pg.click('[data-act="resume"]'); await pg.waitForTimeout(300);
await pg.click('[data-act="stop"]'); await pg.waitForTimeout(150);
ok((await store()).session.status === 'running', 'terminar pide un segundo clic');
await pg.click('[data-act="stop"]'); await pg.waitForTimeout(1200);
b = await store();
ok(b.session.status === 'stopped' && b.session.recaps.at(-1)?.final && Object.keys(b.session.positions).length === 0, 'al terminar cierra todo y deja un resumen final');
ok((await pg.locator('.recap').count()) >= 1 && /operaci/.test(await pg.locator('.recap').first().innerText()), 'el resumen se ve en la columna lateral');
const alarms = await sw.evaluate(() => chrome.alarms.getAll().then((a) => a.map((x) => x.name)));
ok(!alarms.includes('blankfire-bot'), 'sin sesión no queda ninguna alarma del bot');

// Nada se sale de su sitio (escritorio y estrecho) y en inglés no quedan restos en español.
const over = () => pg.evaluate(() => [...document.querySelectorAll('.app *')].filter((e) => { const r = e.getBoundingClientRect(); return r.width && r.right > document.documentElement.clientWidth + 1; }).map((e) => e.className).slice(0, 5));
ok((await over()).length === 0, 'escritorio: nada se sale por la derecha');
await pg.setViewportSize({ width: 760, height: 1000 }); await pg.waitForTimeout(300);
ok((await over()).length === 0, 'pantalla estrecha: nada se sale por la derecha ' + (await over()).join(','));
await pg.screenshot({ path: TDIR + 't39-narrow-es.png', fullPage: true });
await pg.setViewportSize({ width: 1440, height: 980 });
await pg.click('[data-act="lang"]'); await pg.waitForTimeout(400);
await pg.locator('.ev.k-buy .ev-row').first().click().catch(() => {}); await pg.waitForTimeout(300);
const en = await pg.innerText('#app');
const left = (en.match(/[^\x00-\x7F€—–→·…×−’“”«»≤✓]+/g) || []).filter((x) => !/^[\s]+$/.test(x));
const esLines = en.split('\n').filter((x) => /[áéíóúñ¿]| de la | para /i.test(x));
ok(/Practice bot/.test(en) && !esLines.length, 'en inglés: ' + (esLines.slice(0, 6).join(' | ') || 'sin restos'));
await pg.screenshot({ path: TDIR + 't39-stopped-en.png', fullPage: true });
ok(errors.length === 0, 'sin errores de JavaScript ' + errors.join(' | '));
await ctx.close();
console.log(fails ? `${fails} fallos` : 'TODO OK'); process.exit(fails ? 1 : 0);
