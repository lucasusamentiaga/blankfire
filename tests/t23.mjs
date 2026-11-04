// Animaciones v1.10: saldo flotante, vistas, lado comprar/vender, error, aviso con barra, cierre con resultado, detalle en la ventana.
import { chromium } from 'playwright';
const TDIR = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
import fs from 'fs';
const EXT = new URL('../Fogueo', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), SOL = 'So11111111111111111111111111111111111111112';
const A = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
let price = 0.00002, down = false;
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log((c ? 'OK  ' : 'FAIL') + ' ' + m); };
const SHOTS = TDIR+'shots23'; fs.mkdirSync(SHOTS, { recursive: true });
async function run(reduced) {
  const ctx = await chromium.launchPersistentContext(TDIR+'p23-' + Date.now(), { headless: true, channel: 'chromium', locale: 'es-ES', reducedMotion: reduced ? 'reduce' : 'no-preference', viewport: { width: 1100, height: 900 }, deviceScaleFactor: 2, args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--lang=es-ES'] });
  await ctx.route('https://api.dexscreener.com/**', (r) => {
    const u = r.request().url();
    if (down && u.includes(A)) return r.fulfill({ status: 500, body: 'boom' });
    if (u.includes(SOL) && !u.includes(A)) return r.fulfill({ json: [{ chainId: 'solana', pairAddress: 'x', baseToken: { address: SOL, symbol: 'SOL' }, quoteToken: { symbol: 'USDC' }, priceUsd: '150', liquidity: { usd: 9e6 } }] });
    const ps = [{ chainId: 'solana', dexId: 'raydium', pairAddress: 'PBONK1', baseToken: { address: A, symbol: 'BONK', name: 'Bonk' }, quoteToken: { symbol: 'SOL' }, priceUsd: String(price), liquidity: { usd: 5e6 }, marketCap: price * 1e9, priceChange: { m5: 1, h1: 2 }, info: {} }];
    return r.fulfill({ json: u.includes('/search') ? { pairs: ps } : ps });
  });
  await ctx.route('https://lite-api.jup.ag/**', (r) => r.fulfill({ json: r.request().url().includes('/price/v3') ? {} : [] }));
  const fake = fs.readFileSync(TDIR+'fake-padre.html', 'utf8');
  await ctx.route('https://trade.padre.gg/**', (r) => r.fulfill({ body: fake, contentType: 'text/html' }));
  let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent('serviceworker');
  const extId = sw.url().split('/')[2];
  const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', (e) => errs.push(e.message));
  await pg.goto('https://trade.padre.gg/trade/solana/' + A); await pg.waitForTimeout(2500);
  const P = pg.locator('#fogueo-root');
  const R = (fn) => pg.evaluate(fn);
  await P.locator('[data-act="onboarded"]').click().catch(() => {});
  await pg.waitForTimeout(400);
  const tag = reduced ? '[reducido] ' : '';
  // compra → delta de saldo flotante + aviso con barra
  await P.locator('[data-act="quick"]').nth(1).click();
  await P.locator('[data-act="buy"]').click();
  await pg.waitForTimeout(350);
  const d1 = await R(() => { const r = document.querySelector('#fogueo-root').shadowRoot; const d = r.querySelector('.bal-delta'); return { delta: d?.textContent, cls: d?.className, life: !!r.querySelector('.toast.show .toast-life') }; });
  if (!reduced) {
    await P.locator('.head').screenshot({ path: SHOTS + '/delta.png' });
    ok(d1.delta && /^[−-]/.test(d1.delta) && d1.cls.includes('down'), 'Al comprar, el saldo muestra la diferencia flotando: ' + d1.delta);
  } else ok(!d1.delta, tag + 'Sin delta flotante con movimiento reducido');
  ok(d1.life, tag + 'El aviso lleva su barra de tiempo');
  await pg.waitForTimeout(1700);
  ok(await R(() => !document.querySelector('#fogueo-root').shadowRoot.querySelector('.bal-delta')), tag + 'El delta se borra solo (no deja nodos)');
  // el aviso se pausa con el ratón encima
  if (!reduced) {
    await P.locator('.toast').hover();
    await pg.waitForTimeout(6500);
    ok(await R(() => document.querySelector('#fogueo-root').shadowRoot.querySelector('.toast').classList.contains('show')), 'Con el ratón encima el aviso no se cierra');
    await pg.mouse.move(5, 5);
  }
  await pg.waitForTimeout(reduced ? 6800 : 3500);
  ok(await R(() => !document.querySelector('#fogueo-root').shadowRoot.querySelector('.toast').classList.contains('show')), tag + 'Sin el ratón, el aviso se cierra solo');
  // cambio a vender
  await P.locator('[data-act="side"][data-side="sell"]').click();
  const side = await R(() => document.querySelector('#fogueo-root').shadowRoot.querySelector('[data-ref="sellForm"]').className);
  ok(reduced ? !side.includes('from-r') : side.includes('from-r'), tag + 'Vender entra desde la derecha (' + side + ')');
  // error: venta sin saldo para la prioridad → botón niega
  await pg.evaluate(() => new Promise((res) => chrome?.runtime ? res() : res()));
  // vista posiciones
  await P.locator('[data-act="view"][data-v="positions"]').first().click();
  const lv = await R(() => { const r = document.querySelector('#fogueo-root').shadowRoot; return { wrap: r.querySelector('.list-wrap')?.className, view: r.querySelector('[data-ref="viewList"]')?.className || '' }; });
  ok(reduced ? !/enter/.test(lv.wrap) : /enter/.test(lv.wrap) && /view-in/.test(lv.view), tag + 'Posiciones: la vista entra y las filas en cascada (' + lv.wrap + ' | ' + lv.view + ')');
  await pg.waitForTimeout(3500);
  ok(await R(() => !/enter/.test(document.querySelector('#fogueo-root').shadowRoot.querySelector('.list-wrap')?.className || '')), tag + 'Al refrescar la lista no se repite la cascada');
  await P.locator('[data-act="view"][data-v="positions"]').first().click();
  // sube el precio y vende todo → revisión con barrido y cuenta
  price *= 1.6; await pg.waitForTimeout(3500);
  await P.locator('[data-act="side"][data-side="sell"]').click().catch(() => {});
  await P.locator('[data-act="sellpct"][data-pct="100"]').click();
  await P.locator('[data-act="sell"]').click();
  await pg.waitForTimeout(250);
  const rv = await R(() => { const r = document.querySelector('#fogueo-root').shadowRoot; const v = r.querySelector('.review'); return { cls: v?.className, txt: v?.querySelector('[data-ref="rvPnl"]')?.textContent, sparks: v?.querySelectorAll('.sparks i').length }; });
  if (!reduced) { await P.locator('.review').screenshot({ path: SHOTS + '/review-mid.png' }); await pg.waitForTimeout(450); await P.locator('.review').screenshot({ path: SHOTS + '/review-spark.png' }); }
  await pg.waitForTimeout(900);
  if (!reduced) await P.locator('.review').screenshot({ path: SHOTS + '/review-end.png' });
  const rv2 = await R(() => document.querySelector('#fogueo-root').shadowRoot.querySelector('[data-ref="rvPnl"]').textContent);
  const st = await pg.evaluate(() => new Promise((res) => chrome.runtime?.sendMessage ? res(null) : res(null)));
  ok(/\+/.test(rv2) && /SOL · \+/.test(rv2), tag + 'Resultado final mostrado: ' + rv2);
  if (!reduced) {
    ok(/enter/.test(rv.cls) && /rv-up/.test(rv.cls) && rv.sparks === 6, 'Trade ganador: barrido verde y chispas (' + rv.cls + ', ' + rv.sparks + ')');
    ok(rv.txt !== rv2, 'El resultado cuenta desde cero (a los 250 ms: «' + rv.txt + '»)');
  } else ok(!/enter/.test(rv.cls) && !rv.sparks && rv.txt === rv2, tag + 'Sin barrido ni chispas; el resultado sale directo');
  // al marcar una etiqueta la tarjeta no vuelve a animarse
  await R(() => { document.querySelector('#fogueo-root').shadowRoot.querySelector('.review').__mark = 1; });
  await P.locator('.tag-chip').first().click();
  ok(await R(() => { const v = document.querySelector('#fogueo-root').shadowRoot.querySelector('.review'); return v.__mark === 1 && v.querySelector('.tag-chip').getAttribute('aria-pressed') === 'true'; }), tag + 'Marcar etiquetas actualiza la tarjeta sin rehacerla (no repite la animación)');
  // error: comprar más que el saldo → nope
  await P.locator('[data-act="reviewSkip"]').click();
  await P.locator('[data-act="quick"]').nth(0).click();
  const host = await ctx.newPage(); await host.goto(`chrome-extension://${extId}/popup/popup.html`);
  await host.evaluate(() => new Promise((res) => chrome.storage.local.get('fogueo', ({ fogueo }) => { fogueo.settings.maxSlippagePct = 0.0001; chrome.storage.local.set({ fogueo }, res); })));
  await host.close(); await pg.bringToFront(); await pg.waitForTimeout(300);
  await P.locator('[data-act="buy"]').click(); await pg.waitForTimeout(150);
  const nope = await R(() => { const r = document.querySelector('#fogueo-root').shadowRoot; return { go: r.querySelector('[data-ref="buyForm"] .go').className, toast: r.querySelector('.toast')?.className }; });
  ok((reduced ? !nope.go.includes('nope') : nope.go.includes('nope')) && /err/.test(nope.toast), tag + 'Compra rechazada (slippage): botón niega y aviso de error (' + nope.go + ')');
  // ventana: abrir detalle
  const pop = await ctx.newPage(); pop.on('pageerror', (e) => errs.push('POP ' + e.message));
  await pop.goto(`chrome-extension://${extId}/popup/popup.html`); await pop.waitForTimeout(1000); await pop.keyboard.press('Escape');
  await pop.locator('[data-tab="history"]').click(); await pop.waitForTimeout(500);
  await pop.locator('[data-row]').first().click(); await pop.waitForTimeout(80);
  const dcls = await pop.locator('.detail').getAttribute('class');
  ok(reduced || /opening/.test(dcls), tag + 'Ventana: el detalle del trade se despliega (' + dcls + ')');
  await pop.waitForTimeout(600);
  await pop.evaluate(() => { document.querySelector('.detail').__mark = 1; });
  await pop.locator('textarea[data-note]').first().fill('lección');
  await pop.waitForTimeout(900);
  const kept = await pop.evaluate(() => { const d = document.querySelector('.detail'); return { same: d.__mark === 1, cls: d.className, re: getComputedStyle(d).animationName }; });
  ok(kept.same || !/opening/.test(kept.cls), tag + 'Escribir una nota no repite el despliegue (' + JSON.stringify(kept) + ')');
  if (!reduced) await pop.screenshot({ path: SHOTS + '/popup.png' });
  ok(!errs.length, tag + 'Sin errores JS' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await ctx.close();
}
await run(false);
await run(true);
console.log(fails ? `\n${fails} FALLOS` : '\nTodo bien');
