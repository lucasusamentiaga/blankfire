// Contabilidad: 150 operaciones aleatorias y, tras cada una, las identidades contables deben cumplirse.
import { chromium } from 'playwright';
const TDIR = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const EXT = new URL('../Fogueo', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), SOL = 'So11111111111111111111111111111111111111112';
const TOK = ['52u2Z2PZkPgX8nzzZvN7ADCroDBTRiT4VNkpAgm3pump', 'Hb1DD3TgUkiU1dJsEcckuyEprLW3CuyHYsYrAUmxpump', 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263'];
const price = { [TOK[0]]: 0.00004, [TOK[1]]: 0.0005, [TOK[2]]: 0.00002 }, liq = { [TOK[0]]: 9000, [TOK[1]]: 200000, [TOK[2]]: 5e6 };
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log((c ? 'OK  ' : 'FAIL') + ' ' + m); };
const ctx = await chromium.launchPersistentContext(TDIR+'p17-' + Date.now(), { headless: true, channel: 'chromium', locale: 'es-ES', args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--lang=es-ES'] });
const pair = (a, i) => ({ chainId: 'solana', dexId: i === 0 ? 'pumpfun' : 'raydium', pairAddress: 'P' + a.slice(0, 20), baseToken: { address: a, symbol: 'T' + i, name: 'x' }, quoteToken: { symbol: 'SOL' }, priceUsd: String(price[a]), liquidity: { usd: liq[a] }, marketCap: price[a] * 1e9, priceChange: {}, info: {} });
await ctx.route('https://api.dexscreener.com/**', (r) => {
  const u = r.request().url();
  const hit = TOK.filter((a) => u.includes(a));
  if (u.includes(SOL) && !hit.length) return r.fulfill({ json: [{ chainId: 'solana', pairAddress: 'x', baseToken: { address: SOL, symbol: 'SOL' }, quoteToken: { symbol: 'USDC' }, priceUsd: '150', liquidity: { usd: 9e6 } }] });
  const ps = hit.map((a) => pair(a, TOK.indexOf(a)));
  return r.fulfill({ json: u.includes('/search') ? { pairs: ps } : ps });
});
await ctx.route('https://lite-api.jup.ag/**', (r) => r.fulfill({ json: r.request().url().includes('/price/v3') ? {} : [] }));
let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent('serviceworker');
const extId = sw.url().split('/')[2];
const pg = await ctx.newPage(); await pg.goto(`chrome-extension://${extId}/popup/popup.html`); await pg.waitForTimeout(800); await pg.keyboard.press('Escape');
const send = (msg) => pg.evaluate((m) => new Promise((res) => chrome.runtime.sendMessage(m, res)), msg);
const st = async () => (await send({ type: 'state' })).data;
for (const a of TOK) await send({ type: 'resolve', address: a });
// sin TP/SL en esta prueba: las ventas automáticas se prueban aparte
const E = 1e-9; let violations = [], ops = { buy: 0, sell: 0, initials: 0, failed: 0, rejected: 0 };
function check(s, step) {
  const A = s.account, start = A.startBalance;
  const fills = A.fills;
  const buys = fills.filter((f) => f.side === 'buy' && !f.failed), sells = fills.filter((f) => f.side === 'sell' && !f.failed), failed = fills.filter((f) => f.failed);
  const cash = start - buys.reduce((a, f) => a + f.sol, 0) + sells.reduce((a, f) => a + f.sol, 0) - failed.reduce((a, f) => a + f.priorityFee, 0);
  if (Math.abs(cash - A.balance) > E) violations.push(`#${step} saldo ${A.balance} ≠ flujo de caja ${cash}`);
  const openCost = Object.values(A.positions).reduce((a, p) => a + p.costSol, 0);
  const realized = sells.reduce((a, f) => a + f.pnlSol, 0);
  const viaPnl = start - openCost + realized - failed.reduce((a, f) => a + f.priorityFee, 0);
  if (Math.abs(viaPnl - A.balance) > E) violations.push(`#${step} saldo ≠ inicial − coste abierto + PnL realizado − fallidas`);
  for (const p of Object.values(A.positions)) {
    if (!(p.qty > 0) || p.costSol < -E) violations.push(`#${step} posición inválida qty ${p.qty} coste ${p.costSol}`);
    const inv = p.fills.filter((f) => f.side === 'buy').reduce((a, f) => a + f.sol, 0);
    const ret = p.fills.filter((f) => f.side === 'sell').reduce((a, f) => a + f.sol, 0);
    const basisSold = p.fills.filter((f) => f.side === 'sell').reduce((a, f) => a + (f.sol - f.pnlSol), 0);
    if (Math.abs(inv - p.investedSol) > E || Math.abs(ret - p.returnedSol) > E) violations.push(`#${step} invertido/recuperado no cuadra`);
    if (Math.abs(p.investedSol - basisSold - p.costSol) > 1e-8) violations.push(`#${step} coste restante ${p.costSol} ≠ invertido − coste vendido ${p.investedSol - basisSold}`);
    const tq = p.fills.filter((f) => f.side === 'buy').reduce((a, f) => a + f.qty, 0) - p.fills.filter((f) => f.side === 'sell').reduce((a, f) => a + f.qty, 0);
    if (Math.abs(tq - p.qty) > Math.max(1e-6, p.qty * 1e-9)) violations.push(`#${step} tokens ${p.qty} ≠ comprados − vendidos ${tq}`);
    // Coste medio: las compras promedian con lo que queda; las ventas no cambian el precio medio.
    let q = 0, avg = 0;
    for (const f of p.fills) { if (f.side === 'buy') { avg = (avg * q + f.price * f.qty) / (q + f.qty); q += f.qty; } else q -= f.qty; }
    if (Math.abs(avg / p.avgEntryUsd - 1) > 1e-9) violations.push(`#${step} precio medio de entrada ${p.avgEntryUsd} ≠ ${avg}`);
  }
  for (const r of A.rounds) {
    const sp = r.fills.filter((f) => f.side === 'sell').reduce((a, f) => a + f.pnlSol, 0);
    if (Math.abs(r.pnlSol - (r.returnedSol - r.investedSol)) > E || Math.abs(sp - r.pnlSol) > 1e-8) violations.push(`#${step} ronda ${r.symbol}: PnL ${r.pnlSol} ≠ ventas ${sp}`);
    if (Math.abs(r.pnlPct - (r.pnlSol / r.investedSol) * 100) > 1e-7) violations.push(`#${step} % de la ronda mal`);
  }
}
let seed = 7; const R = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
for (let i = 0; i < 150; i++) {
  const a = TOK[Math.floor(R() * 3)], key = 'solana:' + a;
  price[a] *= Math.exp((R() - 0.48) * 0.5);                 // paseo aleatorio del precio
  if (R() < 0.08) liq[a] = R() < 0.5 ? 1500 : [9000, 200000, 5e6][TOK.indexOf(a)];
  const s = await st(); const has = !!s.account.positions[key]; const x = R();
  let r;
  if (!has || x < 0.4) { r = await send({ type: 'buy', key, solIn: +(R() * 1.5 + 0.01).toFixed(3) }); ops.buy++; }
  else if (x < 0.85) { r = await send({ type: 'sell', key, pct: [10, 25, 50, 75, 100][Math.floor(R() * 5)] }); ops.sell++; }
  else { r = await send({ type: 'sellInitials', key }); ops.initials++; }
  if (r?.ok && r.data && r.data.ok === false) ops.failed++;
  if (!r?.ok) ops.rejected++;
  check(await st(), i);
}
const s = await st();
ok(!violations.length, `150 operaciones (${ops.buy} compras, ${ops.sell} ventas, ${ops.initials} recuperar invertido; ${ops.failed} fallidas por slippage, ${ops.rejected} rechazadas): todas las identidades contables se cumplen` + (violations.length ? '\n   ' + violations.slice(0, 8).join('\n   ') : ''));
ok(s.account.rounds.length > 5, `${s.account.rounds.length} rondas cerradas comprobadas`);
// estadísticas del popup = cálculo a mano sobre las rondas
const totalPnl = s.account.rounds.reduce((a, r) => a + r.pnlSol, 0);
const stats = await pg.evaluate(async () => { const m = await import(chrome.runtime.getURL('lib/core.js')); const st = (await chrome.storage.local.get('fogueo')).fogueo; return m.computeStats(st.account.rounds); });
ok(Math.abs(stats.netSol - totalPnl) < 1e-9, `Estadísticas: resultado neto ${stats.netSol.toFixed(6)} = suma de rondas`);
console.log(fails ? `\n${fails} FALLOS` : '\nTodo bien');
await ctx.close();
