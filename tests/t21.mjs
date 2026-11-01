// Rendimiento: panel abierto ~3 min con 6 posiciones y precios cambiando. Memoria, nodos del DOM y peticiones por minuto.
import { chromium } from 'playwright';
const TDIR = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
import fs from 'fs';
const EXT = new URL('../Fogueo', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), SOL = 'So11111111111111111111111111111111111111112';
const TOK = ['DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm', 'HeLp6NuQkmYB4pYWo2zYs22mESHXPQYzXbB8n4V98jwC', '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU', '3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh', '52u2Z2PZkPgX8nzzZvN7ADCroDBTRiT4VNkpAgm3pump'];
const price = Object.fromEntries(TOK.map((a, i) => [a, 0.0001 * (i + 1)]));
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log((c ? 'OK  ' : 'FAIL') + ' ' + m); };
const MIN = Number(process.env.MIN || 3);
const ctx = await chromium.launchPersistentContext(TDIR+'p21-' + Date.now(), { headless: true, channel: 'chromium', locale: 'es-ES', args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--lang=es-ES', '--js-flags=--expose-gc'] });
let dsCalls = 0, jupCalls = 0;
await ctx.route('https://api.dexscreener.com/**', (r) => {
  const u = r.request().url(); dsCalls++;
  for (const a of TOK) price[a] *= Math.exp((Math.random() - 0.5) * 0.04);
  const hit = TOK.filter((a) => u.includes(a));
  if (u.includes(SOL) && !hit.length) return r.fulfill({ json: [{ chainId: 'solana', pairAddress: 'x', baseToken: { address: SOL, symbol: 'SOL' }, quoteToken: { symbol: 'USDC' }, priceUsd: '150', liquidity: { usd: 9e6 } }] });
  const ps = hit.map((a, i) => ({ chainId: 'solana', dexId: 'raydium', pairAddress: 'P' + a.slice(0, 20), baseToken: { address: a, symbol: 'T' + TOK.indexOf(a), name: 'x' }, quoteToken: { symbol: 'SOL' }, priceUsd: String(price[a]), liquidity: { usd: 5e6 }, marketCap: price[a] * 1e9, priceChange: { m5: 1, h1: 2 }, info: {} }));
  return r.fulfill({ json: u.includes('/search') ? { pairs: ps } : ps });
});
await ctx.route('https://lite-api.jup.ag/**', (r) => { jupCalls++; r.fulfill({ json: r.request().url().includes('/price/v3') ? {} : [] }); });
const fake = fs.readFileSync(TDIR+'fake-padre.html', 'utf8');
await ctx.route('https://trade.padre.gg/**', (r) => r.fulfill({ body: fake, contentType: 'text/html' }));
let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent('serviceworker');
const extId = sw.url().split('/')[2];
const host = await ctx.newPage(); await host.goto(`chrome-extension://${extId}/popup/popup.html`); await host.waitForTimeout(800); await host.keyboard.press('Escape');
const send = (msg) => host.evaluate((m) => new Promise((res) => chrome.runtime.sendMessage(m, res)), msg);
for (const a of TOK) { await send({ type: 'resolve', address: a }); await send({ type: 'buy', key: 'solana:' + a, solIn: 0.2, slPct: 90, tpPct: 5000, trailing: true }); }
await host.close();
const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', (e) => errs.push(e.message));
await pg.goto('https://trade.padre.gg/trade/solana/' + TOK[0]); await pg.waitForTimeout(3000);
await pg.locator('#fogueo-root [data-act="onboarded"]').click().catch(() => {});
await pg.locator('#fogueo-root [data-act="view"][data-v="positions"]').click(); await pg.waitForTimeout(1000);
await pg.locator('#fogueo-root [data-act="view"][data-v="positions"]').click().catch(() => {});
const cdp = await ctx.newCDPSession(pg); await cdp.send('Performance.enable');
const metric = async () => {
  await cdp.send('HeapProfiler.collectGarbage').catch(() => {});
  const m = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]));
  const nodes = await pg.evaluate(() => document.querySelector('#fogueo-root').shadowRoot.querySelectorAll('*').length);
  return { heap: m.JSHeapUsedSize / 1e6, nodes, listeners: m.JSEventListeners, cpu: m.TaskDuration };
};
const m0 = await metric(); const ds0 = dsCalls, jup0 = jupCalls, t0 = Date.now();
const samples = [m0];
for (let i = 0; i < MIN * 2; i++) { await pg.waitForTimeout(30000); samples.push(await metric()); }
const m1 = samples[samples.length - 1]; const mins = (Date.now() - t0) / 60000;
console.log('   muestras (MB de memoria / nodos / escuchadores):', samples.map((s) => `${s.heap.toFixed(1)}/${s.nodes}/${s.listeners}`).join('  '));
ok(m1.heap - m0.heap < 3, `Memoria estable en ${mins.toFixed(1)} min: ${m0.heap.toFixed(1)} → ${m1.heap.toFixed(1)} MB`);
ok(Math.abs(m1.nodes - m0.nodes) < 40, `Elementos del panel estables: ${m0.nodes} → ${m1.nodes}`);
ok(m1.listeners - m0.listeners < 30, `Escuchadores de eventos estables: ${m0.listeners} → ${m1.listeners}`);
const cpuPct = ((m1.cpu - m0.cpu) / (mins * 60)) * 100;
ok(cpuPct < 5, `Uso de CPU de la pestaña: ${cpuPct.toFixed(2)} % de un núcleo`);
const dsPerMin = (dsCalls - ds0) / mins;
ok(dsPerMin < 60, `Peticiones a DexScreener: ${dsPerMin.toFixed(0)}/min (límite de la API: 300/min) · Jupiter: ${((jupCalls - jup0) / mins).toFixed(0)}/min`);
ok(!errs.length, 'Sin errores JS' + (errs.length ? ': ' + errs.join(' | ') : ''));
console.log(fails ? `\n${fails} FALLOS` : '\nTodo bien');
await ctx.close();
