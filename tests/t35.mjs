// «Optimizar Padre»: el botón del popup abre la confirmación en el panel, que recorre el modal de ajustes de Padre,
// pone P1/P2/P3, MEV y las pastillas de Trenches, guarda copia y se puede deshacer.
import { chromium } from 'playwright';
import fs from 'fs';
process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = '1';
const TDIR = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const EXT = new URL('../Fogueo', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), SOL = 'So11111111111111111111111111111111111111112';
const A = 'NewTAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPpump';
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log((c ? 'OK  ' : 'FAIL') + ' ' + m); };
const lang = process.argv[2] || 'es';
const ctx = await chromium.launchPersistentContext(TDIR + 'p35-' + Date.now(), { headless: true, channel: 'chromium', locale: lang === 'en' ? 'en-US' : 'es-ES', viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2, args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`] });
const pair = { chainId: 'solana', dexId: 'pumpfun', pairAddress: 'PNEWaaaaaaaaaaaaaaaaaaaaaaaaaaa', baseToken: { address: A, symbol: 'NEWT', name: 'new' }, quoteToken: { symbol: 'SOL' }, priceUsd: '0.00001', liquidity: { usd: 0 }, marketCap: 10000, priceChange: { m5: 1, h1: 2 }, info: {} };
await ctx.route('https://api.dexscreener.com/**', (r) => { const u = r.request().url(); if (u.includes(SOL) && !u.includes(A)) return r.fulfill({ json: [{ chainId: 'solana', pairAddress: 'x', baseToken: { address: SOL, symbol: 'SOL' }, quoteToken: { symbol: 'USDC' }, priceUsd: '150', liquidity: { usd: 9e6 } }] }); return r.fulfill({ json: u.includes('/search') ? { pairs: [pair] } : [pair] }); });
await ctx.route('https://lite-api.jup.ag/**', (r) => r.fulfill({ json: r.request().url().includes('/price/v3') ? {} : [] }));
await ctx.route('https://api.jup.ag/**', (r) => r.fulfill({ status: 401, body: '' }));
await ctx.route('https://api.geckoterminal.com/**', (r) => r.fulfill({ status: 404, body: '' }));
await ctx.route('https://raw.githubusercontent.com/**', (r) => r.fulfill({ status: 404, body: '' }));
await ctx.route('https://**.supabase.co/**', (r) => r.fulfill({ json: { ok: true, raised: 0, goal: 50, supporters: 0 } }));
const fake = fs.readFileSync(TDIR + 'fake-padre.html', 'utf8');
const fakeSettings = fs.readFileSync(TDIR + 'fake-padre-settings.js', 'utf8');
let withGear = true;
await ctx.route('https://trade.padre.gg/**', (r) => r.fulfill({ body: fake.replace('</body>', (withGear ? `<script>${fakeSettings}</script>` : '') + '</body>'), contentType: 'text/html' }));
let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent('serviceworker');
const extId = sw.url().split('/')[2];
const pop = await ctx.newPage(); await pop.setViewportSize({ width: 392, height: 600 });
await pop.goto(`chrome-extension://${extId}/popup/popup.html`); await pop.waitForTimeout(700);
const host = await ctx.newPage(); await host.goto(`chrome-extension://${extId}/popup/popup.html`); await host.waitForTimeout(500);
const send = (m) => host.evaluate((m) => new Promise((r) => chrome.runtime.sendMessage(m, r)), m);
await send({ type: 'saveUi', ui: { popupToured: true, onboarded: true, panelToured: true } });
await send({ type: 'saveSettings', settings: { lang } });
// Sin Padre abierto: el popup lo dice
let r = await send({ type: 'padreOptimizeOpen' });
ok(r.ok && r.data.opened === false, 'Sin pestaña de Padre: el popup pide abrir trade.padre.gg');
const errs = [];
const pg = await ctx.newPage(); pg.on('pageerror', (e) => errs.push(e.message));
await pg.goto('https://trade.padre.gg/trade/solana/' + A); await pg.waitForTimeout(3500);
const P = pg.locator('#fogueo-root');
// Botón del popup → confirmación en el panel
await pop.bringToFront(); await pop.reload(); await pop.waitForTimeout(800);
await pop.click('[data-tab="settings"]'); await pop.waitForTimeout(300);
await pop.locator('[data-act="padreOptimize"]').scrollIntoViewIfNeeded();
await pop.screenshot({ path: TDIR + `t35-popup-${lang}.png` });
const t0 = Date.now();
await pop.click('[data-act="padreOptimize"]').catch(() => {}); await pg.waitForTimeout(900);
ok(await P.locator('.popt [data-act="padreApply"]').count() === 1, 'El botón del popup abre la confirmación en el panel de Padre');
const box = async () => pg.evaluate(() => { const b = document.querySelector('#fogueo-root').shadowRoot.querySelector('.fx').getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: Math.min(b.height, 900 - b.y) }; });
await pg.screenshot({ path: TDIR + `t35-confirm-${lang}.png`, clip: await box() });
ok(await pg.evaluate(() => window.__padreState.presets[1].buy.tip) === '0.01', 'Antes de confirmar no se toca nada');
// Aplicar
await P.locator('[data-act="padreApply"]').click();
await pg.waitForFunction(() => document.querySelector('#fogueo-root').shadowRoot.querySelector('.popt [data-act="padreCancel"].btn-brand, .popt .popt-err'), null, { timeout: 90000 }).catch(() => {});
const S = await pg.evaluate(() => window.__padreState);
console.log('tardó', Math.round((Date.now() - t0) / 1000), 's');
console.log(JSON.stringify(S.presets));
const txt = await P.locator('.popt').innerText();
ok(S.presets[1].buy.prio === '0.001' && S.presets[1].buy.tip === '0.001' && S.presets[1].buy.slip === '25' && S.presets[1].sell.slip === '40', 'P1 (nuevos pares): 0,001 · 0,001 · 25 % / venta 40 %');
ok(S.presets[2].buy.prio === '0.0005' && S.presets[2].buy.slip === '12' && S.presets[2].sell.slip === '25' && S.presets[2].sell.tip === '0.001', 'P2 (graduados): 0,0005 · 0,001 · 12 % / venta 25 %');
ok(S.presets[3].buy.tip === '0.005' && S.presets[3].sell.slip === '50' && S.presets[3].buy.mev === true, 'P3 (urgente) con MEV Secure (estaba en Off)');
ok(S.toggles['trenches-token-audit-snipers-holding'] && S.toggles['trenches-token-audit-bundles'] && S.toggles['instant-trade-general-button-cooldown'], 'Activa las pastillas que faltaban en Trenches y la pausa anti doble clic');
ok(!S.open, 'Cierra el modal de ajustes al terminar');
console.log(JSON.stringify(txt.slice(0,200))); ok(/(cambiado|changed) [0-9]+ /.test(txt), 'Resumen de cambios');
const st = (await send({ type: 'state' })).data.settings;
ok(st.tipSol === 0.001 && st.priorityFee === 0.001 && st.maxSlippagePct === 25 && st.sellSlippagePct === 40 && st.mevSecure === true, 'La práctica pasa a cobrar como el nuevo P1');
const bk = await host.evaluate(() => chrome.storage.local.get('blankfirePadreBackup').then((x) => x.blankfirePadreBackup));
ok(bk?.plan?.presets?.[0]?.buy?.tip === '0.01' && bk.plan.toggles.length >= 9, 'Guarda copia de los ajustes anteriores');
await pg.screenshot({ path: TDIR + `t35-done-${lang}.png`, clip: await box() });
// Preset activo de Padre frente al tipo de token
await P.locator('.popt [data-act="padreCancel"]').click(); await pg.waitForTimeout(300);
await pg.evaluate(() => window.__setBar(1)); await pg.waitForTimeout(5500);
ok(await P.locator('[data-ref="padreSync"] .psync').count() === 0, 'Token en curva con P1 optimizado activo: ningún aviso');
await pg.evaluate(() => window.__setBar(2)); await pg.waitForTimeout(5500);
const hint = await P.locator('[data-ref="padreSync"]').innerText();
ok(/P1/.test(hint) && /(curva|curve)/.test(hint), 'Token en curva con P2 activo: avisa de cambiar a P1 → ' + hint.trim());
await pg.evaluate(() => window.__setBar(1));
// Segunda vez: no cambia nada
await pg.evaluate(() => document.querySelector('#fogueo-root').shadowRoot.querySelector('[data-act="padreOpt"]')?.click());
await pg.waitForTimeout(400);
if (!(await P.locator('.popt [data-act="padreApply"]').count())) await send({ type: 'padreOptimizeOpen' });
await pg.waitForTimeout(400);
ok(await P.locator('.popt [data-act="padreUndo"]').count() === 1, 'Con copia guardada ofrece «Deshacer lo anterior»');
// Deshacer
await P.locator('.popt [data-act="padreUndo"]').click();
await pg.waitForFunction(() => document.querySelector('#fogueo-root').shadowRoot.querySelector('.popt [data-act="padreCancel"].btn-brand, .popt .popt-err'), null, { timeout: 90000 }).catch(() => {});
const S2 = await pg.evaluate(() => window.__padreState);
ok(S2.presets[1].buy.tip === '0.01' && S2.presets[2].buy.prio === '0.002' && S2.presets[3].buy.mev === false && S2.presets[3].sell.slip === '40', 'Deshacer devuelve los presets originales (incluido MEV Off en P3)');
ok(S2.toggles['trenches-token-audit-bundles'] === false && S2.toggles['instant-trade-general-button-cooldown'] === false, 'Deshacer devuelve los interruptores originales');
ok(!(await host.evaluate(() => chrome.storage.local.get('blankfirePadreBackup').then((x) => x.blankfirePadreBackup))), 'Tras deshacer se borra la copia');
// Error: Padre sin botón de ajustes
withGear = false;
await pg.goto('https://trade.padre.gg/trade/solana/' + A); await pg.waitForTimeout(3000);
await send({ type: 'padreOptimizeOpen' }); await pg.waitForTimeout(500);
await P.locator('.popt [data-act="padreApply"]').click().catch(() => {}); await pg.waitForTimeout(1500);
ok(await P.locator('.popt .popt-err').count() === 1, 'Si no encuentra los ajustes de Padre lo explica y no rompe nada');
console.log('errores:', JSON.stringify(errs));
ok(errs.length === 0, 'Sin errores de JavaScript');
console.log(fails ? `${fails} FALLOS` : 'TODO OK');
await ctx.close();
fs.rmSync(TDIR + fs.readdirSync(TDIR).find((d) => d.startsWith('p35-')), { recursive: true, force: true });
process.exit(fails ? 1 : 0);
