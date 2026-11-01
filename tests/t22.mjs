// Accesibilidad con axe-core: panel (dentro del Shadow DOM) y ventana del icono.
import { chromium } from 'playwright';
const TDIR = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
import fs from 'fs';
import { createRequire } from 'module';
const AXE = fs.readFileSync(process.env.AXE || createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
const EXT = new URL('../Fogueo', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), SOL = 'So11111111111111111111111111111111111111112', A = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
const ctx = await chromium.launchPersistentContext(TDIR+'p22-' + Date.now(), { headless: true, channel: 'chromium', locale: 'es-ES', args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--lang=es-ES'] });
await ctx.route('https://api.dexscreener.com/**', (r) => { const u = r.request().url(); if (u.includes(SOL) && !u.includes(A)) return r.fulfill({ json: [{ chainId: 'solana', pairAddress: 'x', baseToken: { address: SOL, symbol: 'SOL' }, quoteToken: { symbol: 'USDC' }, priceUsd: '150', liquidity: { usd: 9e6 } }] }); const ps = [{ chainId: 'solana', dexId: 'raydium', pairAddress: 'PX', baseToken: { address: A, symbol: 'BONK', name: 'Bonk' }, quoteToken: { symbol: 'SOL' }, priceUsd: '0.00002', liquidity: { usd: 5e6 }, marketCap: 2e4, priceChange: { m5: 1, h1: -2 }, info: {} }]; return r.fulfill({ json: u.includes('/search') ? { pairs: ps } : ps }); });
await ctx.route('https://lite-api.jup.ag/**', (r) => r.fulfill({ json: r.request().url().includes('/price/v3') ? {} : [] }));
await ctx.route('https://trade.padre.gg/**', (r) => r.fulfill({ body: '<!doctype html><html lang="es"><head><title>Padre</title></head><body style="background:#0a0a0a"><main><h1>Padre</h1></main></body></html>', contentType: 'text/html' }));
let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent('serviceworker');
const extId = sw.url().split('/')[2];
const report = async (pg, label, include) => {
  await pg.evaluate(AXE);
  const res = await pg.evaluate(async (inc) => { const r = await axe.run(inc ? { include: [inc] } : document, { resultTypes: ['violations'] }); return r.violations.map((v) => ({ id: v.id, impact: v.impact, n: v.nodes.length, help: v.help, ex: v.nodes.slice(0, 2).map((n) => n.target.join(' > ') + ' :: ' + (n.failureSummary || '').split('\n')[1]) })); }, include);
  console.log(`\n== ${label}: ${res.length} tipos de problema`);
  res.forEach((v) => console.log(` [${v.impact}] ${v.id} ×${v.n} — ${v.help}\n     ${v.ex.join('\n     ')}`));
};
const pg = await ctx.newPage(); await pg.goto('https://trade.padre.gg/trade/solana/' + A); await pg.waitForTimeout(2500);
await report(pg, 'Panel con bienvenida', [['#fogueo-root', '.fx']]);
await pg.locator('#fogueo-root [data-act="onboarded"]').click(); await pg.locator('#fogueo-root [data-act="quick"]').nth(1).click(); await pg.locator('#fogueo-root [data-act="buy"]').click(); await pg.waitForTimeout(1500);
await report(pg, 'Panel con posición', [['#fogueo-root', '.fx']]);
const pop = await ctx.newPage(); await pop.setViewportSize({ width: 400, height: 600 }); await pop.goto(`chrome-extension://${extId}/popup/popup.html`); await pop.waitForTimeout(1200); await pop.keyboard.press('Escape'); await pop.waitForTimeout(300);
for (const t of ['wallet', 'history', 'stats', 'settings']) { await pop.locator(`[data-tab="${t}"]`).click(); await pop.waitForTimeout(500); await report(pop, 'Ventana · ' + t); }
await ctx.close();
