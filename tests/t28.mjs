// Actualización REAL: se carga una copia de la extensión, se sube la versión de su manifest en disco (como hace actualizar.bat)
// y se pulsa «Recargar Blankfire». Debe volver con la versión nueva, tarjeta de celebración y los datos intactos.
import { chromium } from 'playwright';
const TDIR = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
import fs from 'fs';
const SRC = new URL('../Fogueo', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), SOL = 'So11111111111111111111111111111111111111112';
const A = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
const EXT = TDIR+'extcopy-' + Date.now();
fs.cpSync(SRC, EXT, { recursive: true });
const CUR = JSON.parse(fs.readFileSync(EXT + '/manifest.json', 'utf8')).version;
const NEXT = CUR.replace(/(\d+)$/, (n) => String(Number(n) + 1));
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log((c ? 'OK  ' : 'FAIL') + ' ' + m); };
let gh = NEXT, ghDown = false;
// Opera/Chrome con «Modo desarrollador» activado, como hace falta para cargar la extensión desde la carpeta
  // (sin él, Chromium desactiva las extensiones sin empaquetar al recargarlas).
  const UD = TDIR+'p28-' + Date.now(); fs.mkdirSync(UD + '/Default', { recursive: true });
  fs.writeFileSync(UD + '/Default/Preferences', JSON.stringify({ extensions: { ui: { developer_mode: true } } }));
  const ctx = await chromium.launchPersistentContext(UD, { headless: true, channel: 'chromium', locale: 'es-ES', viewport: { width: 1100, height: 900 }, args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--lang=es-ES'] });
await ctx.route('https://raw.githubusercontent.com/**', (r) => ghDown ? r.fulfill({ status: 503, body: '' }) : r.fulfill({ json: r.request().url().includes('manifest') ? { version: gh } : { releases: { [NEXT]: { es: ['Arreglo de prueba'], en: ['Test fix'] } } } }));
await ctx.route('https://api.dexscreener.com/**', (r) => {
  const u = r.request().url();
  if (u.includes(SOL) && !u.includes(A)) return r.fulfill({ json: [{ chainId: 'solana', pairAddress: 'x', baseToken: { address: SOL, symbol: 'SOL' }, quoteToken: { symbol: 'USDC' }, priceUsd: '150', liquidity: { usd: 9e6 } }] });
  const ps = [{ chainId: 'solana', dexId: 'raydium', pairAddress: 'PBONK1', baseToken: { address: A, symbol: 'BONK', name: 'Bonk' }, quoteToken: { symbol: 'SOL' }, priceUsd: '0.00002', liquidity: { usd: 5e6 }, marketCap: 2e4, priceChange: {}, info: {} }];
  return r.fulfill({ json: u.includes('/search') ? { pairs: ps } : ps });
});
await ctx.route('https://lite-api.jup.ag/**', (r) => r.fulfill({ json: r.request().url().includes('/price/v3') ? {} : [] }));
const fake = fs.readFileSync(TDIR+'fake-padre.html', 'utf8');
await ctx.route('https://trade.padre.gg/**', (r) => r.fulfill({ body: fake, contentType: 'text/html' }));
let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent('serviceworker');
const extId = sw.url().split('/')[2];
const popUrl = `chrome-extension://${extId}/popup/popup.html`;
const boot = await ctx.newPage(); await boot.goto(popUrl); await boot.waitForTimeout(600);
const send = (pg, m) => pg.evaluate((m) => new Promise((res) => chrome.runtime.sendMessage(m, res)), m);
// GitHub caído primero: no debe decir «Al día»
ghDown = true;
await boot.evaluate(() => chrome.storage.local.set({ blankfireUpdate: {} }));   // como recién instalada, sin respuesta de GitHub aún
await send(boot, { type: 'checkUpdate', force: true });
await boot.keyboard.press('Escape'); await boot.locator('[data-tab="settings"]').click(); await boot.waitForTimeout(500);
let vr = (await boot.locator('.ver-row').innerText()).replace(/\s+/g, ' ');
ok(/No se pudo comprobar/.test(vr) && !/Al día/.test(vr), 'GitHub caído: dice que no pudo comprobar (no «Al día») → ' + vr);
ghDown = false;
await send(boot, { type: 'checkUpdate', force: true }); await boot.waitForTimeout(500);
vr = (await boot.locator('.ver-row').innerText()).replace(/\s+/g, ' ');
ok(vr.includes(NEXT), 'GitHub vuelve: detecta la ' + NEXT + ' → ' + vr);
// Una compra, para comprobar que los datos sobreviven
await send(boot, { type: 'resolve', address: A });
await send(boot, { type: 'buy', key: 'solana:' + A, solIn: 0.5, slPct: 30 });
const before = (await send(boot, { type: 'state' })).data.account;
await boot.close();
const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', (e) => errs.push(e.message));
await pg.goto('https://trade.padre.gg/trade/solana/' + A); await pg.waitForTimeout(2800);
const P = pg.locator('#fogueo-root');
await P.locator('[data-act="onboarded"]').click().catch(() => {}); await pg.waitForTimeout(400);
ok(await P.locator('.upd .upd-new').innerText() === NEXT, `Panel: aviso ${CUR} → ${NEXT}`);
// «actualizar.bat»: los archivos nuevos llegan a la carpeta
const mf = JSON.parse(fs.readFileSync(EXT + '/manifest.json', 'utf8')); mf.version = NEXT;
fs.writeFileSync(EXT + '/manifest.json', JSON.stringify(mf, null, 2));
const nav = pg.waitForNavigation({ timeout: 15000 }).catch(() => null);
await P.locator('.upd [data-upd="reload"]').click();
await nav; await pg.waitForTimeout(4000);
const after = await pg.evaluate(() => { const r = document.querySelector('#fogueo-root')?.shadowRoot; const u = r?.querySelector('.upd'); return r ? { cls: u?.className || '', txt: u?.innerText || '', notes: u?.querySelectorAll('.upd-notes li').length || 0 } : null; });
ok(after && /done/.test(after.cls) && after.txt.includes(CUR) && after.txt.includes(NEXT) && after.notes === 1, `Tras recargar: Padre se refresca solo y sale «Blankfire actualizado ${CUR} → ${NEXT}» con su novedad`);
const host = await ctx.newPage(); await host.goto(popUrl); await host.waitForTimeout(800);
const ver = await host.evaluate(() => chrome.runtime.getManifest().version);
const now = (await send(host, { type: 'state' })).data.account;
ok(ver === NEXT, 'La extensión corre ya la versión ' + ver);
ok(Math.abs(now.balance - before.balance) < 1e-12 && Object.keys(now.positions).length === 1 && now.positions['solana:' + A].sl?.pct === 30, 'Saldo, posición y Stop intactos tras actualizar');
await host.keyboard.press('Escape'); await host.locator('[data-tab="settings"]').click(); await host.waitForTimeout(500);
vr = (await host.locator('.ver-row').innerText()).replace(/\s+/g, ' ');
ok(/Al día/.test(vr) && vr.includes(NEXT), 'Ajustes: ' + vr);
await pg.bringToFront();
await P.locator('.upd.done .upd-btn').click(); await pg.waitForTimeout(500);
await pg.reload(); await pg.waitForTimeout(2500);
ok(await pg.evaluate(() => !document.querySelector('#fogueo-root').shadowRoot.querySelector('.upd')), 'La celebración no vuelve a salir');
const al = await host.evaluate(() => new Promise((res) => chrome.alarms.getAll((a) => res(a.map((x) => x.name + ':' + x.periodInMinutes).sort()))));
ok(al.join() === 'blankfire-update:60,fogueo-watch:0.5', 'Alarmas en su sitio: ' + al.join(', '));
ok(!errs.length, 'Sin errores JS' + (errs.length ? ': ' + errs.join(' | ') : ''));
console.log(fails ? `\n${fails} FALLOS` : '\nTodo bien');
await ctx.close();
fs.rmSync(EXT, { recursive: true, force: true });
