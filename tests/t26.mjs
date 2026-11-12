// Contabilidad: 60 operaciones al azar (compras, ventas parciales, recuperar inversión, órdenes límite, fallos por slippage)
// con precios que suben y bajan. Al final, el saldo cuadra al céntimo con trades cerrados y prioridades de las fallidas.
import { chromium } from 'playwright';
const TDIR = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const EXT = new URL('../Fogueo', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), SOL = 'So11111111111111111111111111111111111111112';
const TOK = ['DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm', '52u2Z2PZkPgX8nzzZvN7ADCroDBTRiT4VNkpAgm3pump'];
const price = { [TOK[0]]: 0.00002, [TOK[1]]: 1.5, [TOK[2]]: 0.000006 };
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log((c ? 'OK  ' : 'FAIL') + ' ' + m); };
const ctx = await chromium.launchPersistentContext(TDIR+'p26-' + Date.now(), { headless: true, channel: 'chromium', locale: 'es-ES', args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--lang=es-ES'] });
await ctx.route('https://raw.githubusercontent.com/**', (r) => r.fulfill({ status: 404, body: '' }));
await ctx.route('https://api.dexscreener.com/**', (r) => {
  const u = r.request().url();
  const hit = TOK.filter((a) => u.includes(a));
  if (u.includes(SOL) && !hit.length) return r.fulfill({ json: [{ chainId: 'solana', pairAddress: 'x', baseToken: { address: SOL, symbol: 'SOL' }, quoteToken: { symbol: 'USDC' }, priceUsd: '150', liquidity: { usd: 9e6 } }] });
  const ps = hit.map((a, i) => ({ chainId: 'solana', dexId: a.endsWith('pump') ? 'pumpfun' : 'raydium', pairAddress: 'P' + a.slice(0, 12), baseToken: { address: a, symbol: 'T' + TOK.indexOf(a), name: 'x' }, quoteToken: { symbol: 'SOL' }, priceUsd: String(price[a]), liquidity: { usd: a.endsWith('pump') ? 30000 : 400000 }, marketCap: price[a] * 1e9, priceChange: {}, info: {} }));
  return r.fulfill({ json: u.includes('/search') ? { pairs: ps } : ps });
});
await ctx.route('https://lite-api.jup.ag/**', (r) => r.fulfill({ json: r.request().url().includes('/price/v3') ? {} : [] }));
let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent('serviceworker');
const extId = sw.url().split('/')[2];
const host = await ctx.newPage(); await host.goto(`chrome-extension://${extId}/popup/popup.html`); await host.waitForTimeout(600);
const send = (m) => host.evaluate((m) => new Promise((res) => chrome.runtime.sendMessage(m, res)), m);
const st = async () => (await send({ type: 'state' })).data;
await send({ type: 'reset', startBalance: 20 });
for (const a of TOK) await send({ type: 'resolve', address: a });
const ops = { buy: 0, sell: 0, ini: 0, fail: 0, order: 0 };
for (let i = 0; i < 60; i++) {
  for (const a of TOK) price[a] *= Math.exp((Math.random() - 0.45) * 0.25);
  const a = TOK[Math.floor(Math.random() * 3)], key = 'solana:' + a;
  await new Promise((r) => setTimeout(r, 2100));   // la caché de precios dura 2 s
  const s = await st(); const pos = s.account.positions[key];
  const roll = Math.random();
  if (!pos || roll < 0.4) {
    const tight = Math.random() < 0.1;
    if (tight) await send({ type: 'saveSettings', settings: { maxSlippagePct: 0.1 } });
    const r = await send({ type: 'buy', key, solIn: +(Math.random() * 1.5 + 0.05).toFixed(3), slPct: Math.random() < 0.5 ? 40 : undefined, tpPct: Math.random() < 0.5 ? 80 : undefined, trailing: Math.random() < 0.5 });
    if (tight) await send({ type: 'saveSettings', settings: { maxSlippagePct: 15 } });
    if (r.ok && r.data?.ok === false) ops.fail++; else if (r.ok) ops.buy++;
  } else if (roll < 0.55) { const r = await send({ type: 'sellInitials', key }); if (r.ok && r.data?.ok) ops.ini++; }
  else if (roll < 0.65) { const r = await send({ type: 'placeOrder', key, mc: price[a] * 1e9 * 0.9, solIn: 0.2 }); if (r.ok) ops.order++; }
  else { const r = await send({ type: 'sell', key, pct: [25, 50, 100][Math.floor(Math.random() * 3)] }); if (r.ok && r.data?.ok) ops.sell++; }
  await send({ type: 'tick', key });
}
// Cerrar todo y cancelar órdenes
let s = await st();
for (const o of s.account.orders) await send({ type: 'cancelOrder', id: o.id });
await new Promise((r) => setTimeout(r, 2100));
for (const k of Object.keys(s.account.positions)) await send({ type: 'sell', key: k, pct: 100 });
s = await st();
const A = s.account;
const roundsPnl = A.rounds.reduce((x, r) => x + r.pnlSol, 0);
const failedFees = A.fills.filter((f) => f.failed).reduce((x, f) => x + (f.priorityFee || 0), 0);
console.log('   operaciones:', JSON.stringify(ops), '· trades cerrados:', A.rounds.length, '· fallidas:', A.fills.filter((f) => f.failed).length);
ok(Object.keys(A.positions).length === 0 && A.orders.length === 0, 'Todo cerrado al final');
const expected = A.startBalance + roundsPnl - failedFees;
ok(Math.abs(A.balance - expected) < 1e-9, `Saldo cuadra: ${A.balance.toFixed(9)} = 20 + Σ trades (${roundsPnl.toFixed(6)}) − prioridades fallidas (${failedFees.toFixed(4)}) → ${expected.toFixed(9)}`);
// Cada trade: pnl = devuelto − invertido; comisiones registradas ≥ 0
ok(A.rounds.every((r) => Math.abs(r.pnlSol - (r.returnedSol - r.investedSol)) < 1e-9 && (r.feesSol ?? 0) >= 0), 'Cada trade: resultado = devuelto − invertido, comisiones ≥ 0');
// Suma de fills: compras restan, ventas suman
const fillsNet = A.fills.reduce((x, f) => x + (f.failed ? -f.priorityFee : f.side === 'buy' ? -(f.sol + (f.priorityFee ?? 0)) : f.sol), 0);
ok(Math.abs(A.startBalance + fillsNet - A.balance) < 1e-6, `Movimientos cuadran con el saldo (${(A.startBalance + fillsNet).toFixed(6)} vs ${A.balance.toFixed(6)})`);
ok(A.balance >= 0, 'Saldo nunca negativo');
// Curva de patrimonio: último punto = saldo (sin posiciones)
ok(Math.abs(A.equity[A.equity.length - 1].v - A.balance) < 1e-6, 'Último punto del gráfico = saldo actual');
console.log(fails ? `\n${fails} FALLOS` : '\nTodo bien');
await ctx.close();
