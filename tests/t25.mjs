// Aviso de nueva versión (1.12): GitHub con versión nueva → tarjeta en panel y ventana, posponer, buscar a mano,
// «recién actualizado», recarga real de la extensión y GitHub caído.
import { chromium } from 'playwright';
const TDIR = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
import fs from 'fs';
const EXT = new URL('../Fogueo', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), SOL = 'So11111111111111111111111111111111111111112';
const A = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
const CUR = JSON.parse(fs.readFileSync(EXT + '/manifest.json', 'utf8')).version;
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log((c ? 'OK  ' : 'FAIL') + ' ' + m); };
let ghVersion = '9.9.9', ghDown = false, ghHits = 0;
const NOTES = { releases: { '9.9.9': { es: ['Primera novedad', 'Segunda novedad'], en: ['First thing', 'Second thing'] } } };
async function run(lang) {
  const L = lang === 'en' ? 'en-US' : 'es-ES';
  ghVersion = '9.9.9'; ghDown = false;
  const ctx = await chromium.launchPersistentContext(TDIR+'p25-' + Date.now(), { headless: true, channel: 'chromium', locale: L, viewport: { width: 1100, height: 900 }, deviceScaleFactor: 2, args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--lang=' + L] });
  await ctx.route('https://raw.githubusercontent.com/**', (r) => {
    ghHits++;
    if (ghDown) return r.fulfill({ status: 503, body: 'down' });
    const u = r.request().url();
    if (u.includes('manifest.json')) return r.fulfill({ json: { manifest_version: 3, version: ghVersion } });
    if (u.includes('updates.json')) return r.fulfill({ json: NOTES });
    return r.fulfill({ status: 404, body: '' });
  });
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
  const tag = `[${lang}] `;
  const errs = [];
  // Al instalarse ya comprobó GitHub (antes de que existieran los mocks): forzamos otra comprobación con los mocks puestos.
  const boot = await ctx.newPage(); await boot.goto(`chrome-extension://${extId}/popup/popup.html`);
  const first = await boot.evaluate(() => new Promise((res) => chrome.storage.local.get('blankfireUpdate', (g) => res(g.blankfireUpdate))));
  console.log('   comprobación al instalar:', JSON.stringify(first));
  await boot.evaluate(() => new Promise((res) => chrome.runtime.sendMessage({ type: 'checkUpdate', force: true }, res)));
  await boot.close();
  const pg = await ctx.newPage(); pg.on('pageerror', (e) => errs.push(e.message));
  await pg.goto('https://trade.padre.gg/trade/solana/' + A); await pg.waitForTimeout(2800);
  const P = pg.locator('#fogueo-root');
  await P.locator('[data-act="onboarded"]').click().catch(() => {});
  await pg.waitForTimeout(600);
  const card = await pg.evaluate(() => { const r = document.querySelector('#fogueo-root').shadowRoot; const u = r.querySelector('.upd'); return u ? { txt: u.innerText, notes: u.querySelectorAll('.upd-notes li').length, nw: u.querySelector('.upd-new')?.textContent, old: u.querySelector('.upd-old')?.textContent, dot: r.querySelector('.head .mark').classList.contains('has-upd') } : null; });
  ok(card && card.nw === '9.9.9' && card.old === CUR && card.notes === 2 && card.dot, tag + `Panel: tarjeta «${CUR} → 9.9.9» con 2 novedades y punto en la llama`);
  if (lang === 'en') ok(card && /New version available/.test(card.txt) && /First thing/.test(card.txt) && !/Nueva versión|Recargar|Más tarde/.test(card.txt), tag + 'Tarjeta en inglés con novedades en inglés');
  await P.locator('.upd').screenshot({ path: `${TDIR}shots25-${lang}-panel.png` });
  // Posponer
  await P.locator('.upd [data-upd="later"].upd-link').click(); await pg.waitForTimeout(600);
  const after = await pg.evaluate(() => { const r = document.querySelector('#fogueo-root').shadowRoot; return { card: !!r.querySelector('.upd'), dot: r.querySelector('.head .mark').classList.contains('has-upd') }; });
  ok(!after.card && after.dot, tag + '«Más tarde»: la tarjeta se va (24 h) y queda el punto en la llama');
  // Ventana: se ve aunque esté pospuesto + fila de versión
  const pop = await ctx.newPage(); pop.on('pageerror', (e) => errs.push('POP ' + e.message));
  await pop.setViewportSize({ width: 400, height: 640 });
  await pop.goto(`chrome-extension://${extId}/popup/popup.html`); await pop.waitForTimeout(1000); await pop.keyboard.press('Escape'); await pop.waitForTimeout(400);
  ok(await pop.locator('#updArea .upd').count() === 1, tag + 'Ventana: la tarjeta sale aunque la pospusieras en el panel');
  await pop.screenshot({ path: `${TDIR}shots25-${lang}-popup.png` });
  await pop.locator('[data-tab="settings"]').click(); await pop.waitForTimeout(400);
  const vr = await pop.locator('.ver-row').innerText();
  ok(vr.includes(CUR) && /9\.9\.9/.test(vr), tag + 'Ajustes: fila de versión → ' + vr.replace(/\s+/g, ' '));
  // Publicas la misma versión que tienes (ya actualizado) → buscar a mano lo quita
  ghVersion = CUR;
  await pop.locator('[data-act="checkUpd"]').click(); await pop.waitForTimeout(1500);
  const vr2 = await pop.locator('.ver-row').innerText();
  ok(await pop.locator('#updArea .upd').count() === 0 && (lang === 'en' ? /Up to date/ : /Al día/).test(vr2), tag + 'Buscar actualizaciones con GitHub al día: «' + vr2.replace(/\s+/g, ' ') + '»');
  ok(await pg.evaluate(() => !document.querySelector('#fogueo-root').shadowRoot.querySelector('.head .mark').classList.contains('has-upd')), tag + 'El punto de la llama desaparece');
  // GitHub caído: nada se rompe
  ghDown = true;
  await pop.locator('[data-act="checkUpd"]').click(); await pop.waitForTimeout(1500);
  ok(await pop.locator('#updArea .upd').count() === 0 && await pop.locator('.ver-row').count() === 1, tag + 'GitHub caído: sin aviso falso y la ventana sigue bien');
  ghDown = false;
  // Recién actualizado
  await pop.evaluate((cur) => new Promise((res) => chrome.storage.local.get('blankfireUpdate', (g) => chrome.storage.local.set({ blankfireUpdate: { ...(g.blankfireUpdate || {}), justUpdated: { from: '1.0.0', to: cur, seen: false } } }, res))), CUR);
  await pg.bringToFront(); await pg.waitForTimeout(700);
  const done = await pg.evaluate(() => { const u = document.querySelector('#fogueo-root').shadowRoot.querySelector('.upd.done'); return u ? u.innerText : null; });
  ok(!!done && /1\.0\.0/.test(done), tag + 'Tras actualizar: tarjeta de celebración «1.0.0 → ' + CUR + '»');
  await P.locator('.upd.done').screenshot({ path: `${TDIR}shots25-${lang}-done.png` });
  await P.locator('.upd.done .upd-btn').click(); await pg.waitForTimeout(600);
  ok(await pg.evaluate(() => !document.querySelector('#fogueo-root').shadowRoot.querySelector('.upd')), tag + 'Se cierra y no vuelve');
  // Recarga real de la extensión desde la tarjeta
  if (lang === 'es') {
    ghVersion = '9.9.9';
    await pop.evaluate(() => new Promise((res) => chrome.storage.local.set({ blankfireUpdate: { latest: '9.9.9', checkedAt: Date.now() } }, res)));
    await pop.close();
    await pg.waitForTimeout(600);
    const stBefore = await pg.evaluate(() => document.querySelector('#fogueo-root').shadowRoot.querySelector('[data-ref="bal"]').textContent);
    const nav = pg.waitForNavigation({ timeout: 8000 }).catch(() => null);
    await P.locator('.upd [data-upd="reload"]').click();
    await nav; await pg.waitForTimeout(3500);
    const back = await pg.evaluate(() => { const r = document.querySelector('#fogueo-root')?.shadowRoot; return r ? { bal: r.querySelector('[data-ref="bal"]')?.textContent, upd: !!r.querySelector('.upd') } : null; });
    ok(back && back.bal === stBefore && back.upd, 'Recargar Blankfire: la extensión se recarga, la pestaña también, el panel vuelve con el mismo saldo (' + JSON.stringify(back) + ')');
  }
  ok(!errs.length, tag + 'Sin errores JS' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await ctx.close();
}
await run('es');
await run('en');
console.log('peticiones a GitHub:', ghHits);
console.log(fails ? `\n${fails} FALLOS` : '\nTodo bien');
