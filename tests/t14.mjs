// Lógica de la cuenta: ventas parciales, recuperar lo invertido, órdenes fallidas, límite diario,
// curva de patrimonio con varias posiciones, saldo insuficiente, reinicio y archivo.
import { chromium } from 'playwright';
const TDIR = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const EXT = new URL('../Fogueo', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), SOL = 'So11111111111111111111111111111111111111112';
const A = '52u2Z2PZkPgX8nzzZvN7ADCroDBTRiT4VNkpAgm3pump', B = 'Hb1DD3TgUkiU1dJsEcckuyEprLW3CuyHYsYrAUmxpump';
const price = { [A]: 0.00004, [B]: 0.0005 }, liq = { [A]: 40000, [B]: 400000 };
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log((c ? 'OK  ' : 'FAIL') + ' ' + m); };
const ctx = await chromium.launchPersistentContext(TDIR+'p14-' + Date.now(), { headless: true, channel: 'chromium', locale: process.env.L === 'en' ? 'en-US' : 'es-ES', args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, `--lang=${process.env.L === 'en' ? 'en-US' : 'es-ES'}`] });
const pair = (a) => ({ chainId: 'solana', dexId: a === A ? 'pumpfun' : 'pumpswap', pairAddress: 'P' + a.slice(0, 20), baseToken: { address: a, symbol: a === A ? 'DOUG' : 'KIM', name: 'x' }, quoteToken: { symbol: 'SOL' }, priceUsd: String(price[a]), liquidity: { usd: liq[a] }, marketCap: price[a] * 1e9, priceChange: {}, info: {} });
await ctx.route('https://api.dexscreener.com/**', (r) => {
  const u = r.request().url();
  if (u.includes(SOL) && ![A, B].some((a) => u.includes(a))) return r.fulfill({ json: [{ chainId: 'solana', pairAddress: 'x', baseToken: { address: SOL, symbol: 'SOL' }, quoteToken: { symbol: 'USDC' }, priceUsd: '180', liquidity: { usd: 9e6 } }] });
  const ps = [A, B].filter((a) => u.includes(a)).map(pair);
  return r.fulfill({ json: u.includes('/search') ? { pairs: ps } : ps });
});
await ctx.route('https://lite-api.jup.ag/**', (r) => r.fulfill({ json: r.request().url().includes('/price/v3') ? {} : [] }));
let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent('serviceworker');
const extId = sw.url().split('/')[2];
const pg = await ctx.newPage(); await pg.goto(`chrome-extension://${extId}/popup/popup.html`); await pg.waitForTimeout(800); await pg.keyboard.press('Escape');
const send = (msg) => pg.evaluate((m) => new Promise((res) => chrome.runtime.sendMessage(m, res)), msg);
const st = async () => (await send({ type: 'state' })).data;
const kA = 'solana:' + A, kB = 'solana:' + B;
await send({ type: 'resolve', address: A }); await send({ type: 'resolve', address: B });

// 1) compra, venta parcial 25 %, luego todo: la suma de PnL de las ventas = PnL de la ronda
let r = await send({ type: 'buy', key: kA, solIn: 1 });
ok(r.ok && r.data.ok, 'Compra 1 SOL de A');
price[A] *= 1.5;
r = await send({ type: 'sell', key: kA, pct: 25 }); ok(r.data.ok && !r.data.round, 'Venta parcial 25 % (posición sigue abierta)');
price[A] *= 0.8;
r = await send({ type: 'sell', key: kA, pct: 100 }); const round = r.data.round;
ok(!!round, 'Venta del resto cierra la ronda');
const sumFills = round.fills.filter((f) => f.side === 'sell').reduce((a, f) => a + f.pnlSol, 0);
ok(Math.abs(sumFills - round.pnlSol) < 1e-9, `PnL de las ventas (${sumFills.toFixed(6)}) = PnL de la ronda (${round.pnlSol.toFixed(6)})`);
let s = await st();
ok(Math.abs(s.account.balance - (10 + round.pnlSol)) < 1e-9, 'Saldo = inicial + PnL de la ronda');

// 2) recuperar lo invertido
price[A] = 0.00004;
await send({ type: 'buy', key: kA, solIn: 1 });
price[A] *= 2.2;
r = await send({ type: 'sellInitials', key: kA });
s = await st(); const pA = s.account.positions[kA];
ok(r.data.ok && pA && pA.qty > 0, 'Recuperar invertido: la posición sigue abierta');
ok(pA && Math.abs(pA.returnedSol - pA.investedSol) < 0.01, `Recuperado ≈ invertido (${pA?.returnedSol.toFixed(4)} vs ${pA?.investedSol.toFixed(4)})`);
ok(pA && pA.costSol < 0.6, 'Coste restante reducido proporcionalmente: ' + pA?.costSol.toFixed(4));

// 3) orden demasiado grande en token con poca liquidez: falla y cobra la priority fee
const before = (await st()).account.balance;
liq[A] = 3000;
r = await send({ type: 'buy', key: kA, solIn: 5 });
s = await st();
ok(r.ok && !r.data.ok && Math.abs(before - s.account.balance - s.settings.priorityFee) < 1e-12, 'Orden con slippage excesivo: falla y cobra solo la priority fee');
liq[A] = 40000;

// 4) curva de patrimonio con 2 posiciones abiertas: la otra no se valora a coste
await send({ type: 'buy', key: kB, solIn: 1 });
price[A] *= 3; await send({ type: 'quotes', keys: [kA, kB], force: true });
await send({ type: 'buy', key: kB, solIn: 0.5 });
s = await st();
const last = s.account.equity[s.account.equity.length - 1].v;
const posA = s.account.positions[kA];
const atCost = s.account.balance + posA.costSol + s.account.positions[kB].costSol;
ok(last > atCost + 0.5, `Patrimonio usa el precio actual de A, no su coste (${last.toFixed(3)} > ${atCost.toFixed(3)})`);

// 5) saldo insuficiente: mensaje traducido
r = await send({ type: 'buy', key: kB, solIn: 999 });
ok(!r.ok && /Saldo insuficiente|Insufficient balance/.test(r.error) && !/\$\{/.test(r.error), 'Saldo insuficiente: ' + r.error);

// 6) límite de pérdida diaria
await send({ type: 'saveSettings', settings: { dailyLossLimit: 0.01 } });
price[B] *= 0.5;
await send({ type: 'sell', key: kB, pct: 100 });
r = await send({ type: 'buy', key: kB, solIn: 0.1 });
ok(!r.ok && /límite|limit/.test(r.error), 'Límite diario bloquea compras: ' + (r.error || '').slice(0, 60));
await send({ type: 'saveSettings', settings: { dailyLossLimit: 0 } });

// 7) ajustes fuera de rango se recortan
await send({ type: 'saveSettings', settings: { feePct: 99, maxSlippagePct: -5, priorityFee: 7 } });
s = await st();
ok(s.settings.feePct <= 10 && s.settings.maxSlippagePct >= 0.1 && s.settings.priorityFee <= 1, `Ajustes recortados: fee ${s.settings.feePct}, slip ${s.settings.maxSlippagePct}, prio ${s.settings.priorityFee}`);
await send({ type: 'saveSettings', settings: { feePct: 1, maxSlippagePct: 15, priorityFee: 0.001 } });

// 8) reinicio: archiva la cuenta y empieza con el saldo pedido
const nRounds = (await st()).account.rounds.length;
r = await send({ type: 'reset', startBalance: 5 });
s = await st();
ok(s.account.balance === 5 && !Object.keys(s.account.positions).length && s.archive[0]?.rounds.length === nRounds, 'Reiniciar: saldo 5, sin posiciones, historial archivado');
console.log(fails ? `\n${fails} FALLOS` : '\nTodo bien');
await ctx.close();
