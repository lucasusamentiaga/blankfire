// Stop dinámico (caída % desde el máximo), stop fijo, take profit y compra al 100 % del saldo.
import { chromium } from 'playwright';
const TDIR = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
import fs from 'fs';
const EXT = new URL('../Fogueo', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), SOL = 'So11111111111111111111111111111111111111112';
const A = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
let p = 0.00002;
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log((c ? 'OK  ' : 'FAIL') + ' ' + m); };
const ctx = await chromium.launchPersistentContext(TDIR+'p18-' + Date.now(), { headless: true, channel: 'chromium', locale: 'es-ES', args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--lang=es-ES'] });
await ctx.route('https://api.dexscreener.com/**', (r) => {
  const u = r.request().url();
  if (u.includes(SOL) && !u.includes(A)) return r.fulfill({ json: [{ chainId: 'solana', pairAddress: 'x', baseToken: { address: SOL, symbol: 'SOL' }, quoteToken: { symbol: 'USDC' }, priceUsd: '150', liquidity: { usd: 9e6 } }] });
  const ps = [{ chainId: 'solana', dexId: 'raydium', pairAddress: 'PX', baseToken: { address: A, symbol: 'BONK', name: 'Bonk' }, quoteToken: { symbol: 'SOL' }, priceUsd: String(p), liquidity: { usd: 1e9 }, marketCap: p * 1e9, priceChange: {}, info: {} }];
  return r.fulfill({ json: u.includes('/search') ? { pairs: ps } : ps });
});
await ctx.route('https://lite-api.jup.ag/**', (r) => r.fulfill({ json: r.request().url().includes('/price/v3') ? {} : [] }));
const fake = fs.readFileSync(TDIR+'fake-padre.html', 'utf8');
await ctx.route('https://trade.padre.gg/**', (r) => r.fulfill({ body: fake, contentType: 'text/html' }));
let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent('serviceworker');
const extId = sw.url().split('/')[2];
const pg = await ctx.newPage(); await pg.goto(`chrome-extension://${extId}/popup/popup.html`); await pg.waitForTimeout(800); await pg.keyboard.press('Escape');
const send = (msg) => pg.evaluate((m) => new Promise((res) => chrome.runtime.sendMessage(m, res)), msg);
const st = async () => (await send({ type: 'state' })).data;
const key = 'solana:' + A;
await send({ type: 'resolve', address: A });
await send({ type: 'saveSettings', settings: { latencySlipPct: 0, priorityFee: 0, feePct: 0, poolFees: false } });   // sin costes: el % es solo precio
const tick = async () => { await new Promise((r) => setTimeout(r, 2700)); await send({ type: 'tick', key }); await new Promise((r) => setTimeout(r, 900)); };
// stop dinámico 30 %
await send({ type: 'buy', key, solIn: 1, slPct: 30, trailing: true });
p *= 2; await tick();                                          // +100 % → máximo
let s = await st(); ok(Math.abs(s.account.positions[key]?.peakPct - 100) < 0.5, 'Máximo registrado: +' + s.account.positions[key]?.peakPct.toFixed(1) + ' %');
p *= 0.75; await tick();                                       // cae un 25 % desde el máximo → aún no
s = await st(); ok(!!s.account.positions[key], 'Cae un 25 % desde el máximo (resultado +50 %): el stop del 30 % aún no salta');
p *= 0.92; await tick();                                       // total −31 % desde el máximo → salta
s = await st(); const r1 = s.account.rounds[0];
ok(!s.account.positions[key] && r1?.reason === 'trail' && Math.abs(r1.pnlPct - 38) < 1, `Cae un 31 % desde el máximo: salta el dinámico y cierra en ${r1?.pnlPct.toFixed(1)} % (máximo +100 % × 0,69)`);
// stop fijo 20 %
p = 0.00002; await send({ type: 'buy', key, solIn: 1, slPct: 20, trailing: false });
p *= 1.5; await tick(); p *= 0.6; await tick();               // +50 % y luego −10 % desde la entrada
s = await st(); ok(!!s.account.positions[key], 'Stop fijo −20 %: subir y bajar a −10 % no lo dispara (el fijo no sigue al máximo)');
p *= 0.85; await tick();                                       // −23,5 %
s = await st(); ok(!s.account.positions[key] && s.account.rounds[0].reason === 'sl', 'Stop fijo salta por debajo de −20 %: ' + s.account.rounds[0].pnlPct.toFixed(1) + ' %');
// take profit
p = 0.00002; await send({ type: 'buy', key, solIn: 1, tpPct: 60 });
p *= 1.59; await tick(); s = await st(); ok(!!s.account.positions[key], 'Take +60 %: a +59 % aún no vende');
p *= 1.02; await tick(); s = await st(); ok(!s.account.positions[key] && s.account.rounds[0].reason === 'tp', 'Take salta a +62 %: ' + s.account.rounds[0].pnlPct.toFixed(1) + ' %');
// ampliar una posición ganadora conserva el mismo precio máximo
p = 0.00002; await send({ type: 'buy', key, solIn: 1, slPct: 30, trailing: true });
p *= 2; await tick(); p *= 0.9; await send({ type: 'buy', key, solIn: 1, slPct: 30, trailing: true });
s = await st(); const pos = s.account.positions[key];
// precio máximo = 2x la 1.ª entrada. Valor de todo a ese precio / coste total
const peakPrice = 0.00004, value = pos.qty * peakPrice / 150, expect = (value / pos.costSol - 1) * 100;
ok(Math.abs(pos.peakPct - expect) < 0.01, `Al ampliar, el máximo se reexpresa sobre el nuevo coste: ${pos.peakPct.toFixed(2)} % (esperado ${expect.toFixed(2)} %)`);
await send({ type: 'sell', key, pct: 100 });
// 100 % del saldo con priority fee
await send({ type: 'saveSettings', settings: { priorityFee: 0.001, sizeMode: 'pct' } });
const pad = await ctx.newPage(); await pad.goto('https://trade.padre.gg/trade/solana/' + A); await pad.waitForTimeout(2500);
const P = pad.locator('#fogueo-root');
await P.locator('[data-act="onboarded"]').click().catch(() => {});
await P.locator('[data-ref="amount"]').fill('100'); await pad.waitForTimeout(400);
const disabled = await P.locator('[data-ref="buyForm"] .go').isDisabled();
ok(!disabled, 'Modo «% del saldo»: el 100 % se puede comprar (deja sitio para la priority fee)');
await P.locator('[data-ref="buyForm"] .go').click(); await pad.waitForTimeout(1500);
s = await st(); ok(s.account.balance >= -1e-12 && s.account.balance < 0.001 && !!s.account.positions[key], 'Tras comprar el 100 %: saldo ' + s.account.balance.toFixed(6) + ' SOL, nunca negativo');
console.log(fails ? `\n${fails} FALLOS` : '\nTodo bien');
await ctx.close();
