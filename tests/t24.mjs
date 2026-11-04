// Cuadros de texto (1.11): avisos con fichas, importe con $ y % del saldo, escala de orden límite,
// notas que crecen y mini-gráficos en los recorridos (ES y EN).
import { chromium } from 'playwright';
const TDIR = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
import fs from 'fs';
const EXT = new URL('../Fogueo', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), SOL = 'So11111111111111111111111111111111111111112';
const A = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log((c ? 'OK  ' : 'FAIL') + ' ' + m); };
const SPANISH = /\b(Recibes|Pagas|comisiones|entrada|máximo|vendes|Hoy|límite|compran|Empiezas|Ajustes|Compra hecha|Venta hecha|No se pudo|prioridad|para comprar|tu orden|Revisa|posiciones|Nuevo par|Graduado)\b/;
async function run(lang) {
  let price = 0.00002;
  const L = lang === 'en' ? 'en-US' : 'es-ES';
  const ctx = await chromium.launchPersistentContext(TDIR+'p24-' + Date.now(), { headless: true, channel: 'chromium', locale: L, viewport: { width: 1100, height: 900 }, args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--lang=' + L] });
  await ctx.route('https://api.dexscreener.com/**', (r) => {
    const u = r.request().url();
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
  const R = (fn, a) => pg.evaluate(fn, a);
  const root = () => document.querySelector('#fogueo-root').shadowRoot;
  const tag = `[${lang}] `;
  await P.locator('[data-act="onboarded"]').click().catch(() => {});
  // importe
  await P.locator('[data-ref="amount"]').fill('1');
  const amt = await R(() => { const r = document.querySelector('#fogueo-root').shadowRoot; return { meta: r.querySelector('[data-ref="amtMeta"]').textContent, bar: r.querySelector('[data-ref="amtBar"]').className, tf: r.querySelector('[data-ref="amtBar"] > i').style.transform }; });
  ok(/≈ \$150\b/.test(amt.meta) && /10%/.test(amt.meta) && /lo/.test(amt.bar) && /0\.1/.test(amt.tf), tag + 'Importe: 1 SOL muestra ≈ $150 y el 10 % del saldo, barra verde (' + amt.meta + ')');
  await P.locator('[data-ref="amount"]').fill('5');
  ok(/hi/.test(await R(() => document.querySelector('#fogueo-root').shadowRoot.querySelector('[data-ref="amtBar"]').className)), tag + 'Importe: 5 SOL (50 %) pone la barra en rojo');
  await P.locator('[data-ref="amount"]').fill('0,25');
  // orden límite
  await P.locator('[data-act="otype"][data-o="limit"]').click();
  await P.locator('[data-ref="limitMc"]').fill('10K');
  const lim = await R(() => { const r = document.querySelector('#fogueo-root').shadowRoot; const e = r.querySelector('.lim-track em'); return { has: !!r.querySelector('.lim-scale'), left: e?.style.left }; });
  ok(lim.has && parseFloat(lim.left) === 50, tag + 'Orden límite: escala con tu objetivo a mitad de camino (MC 20K → 10K): ' + lim.left);
  await P.locator('[data-act="otype"][data-o="market"]').click();
  // nota
  await P.locator('[data-act="note"][data-for="buyNote"]').click();
  const h0 = await P.locator('[data-ref="buyNote"]').evaluate((e) => e.offsetHeight);
  await P.locator('[data-ref="buyNote"]').fill('línea 1\nlínea 2\nlínea 3\nlínea 4\nlínea 5');
  const h1 = await P.locator('[data-ref="buyNote"]').evaluate((e) => e.offsetHeight);
  ok(await P.locator('[data-act="note"][data-for="buyNote"]').getAttribute('aria-expanded') === 'true' && h1 > h0, tag + `Nota: el botón se marca abierto y el cuadro crece con el texto (${h0} → ${h1} px)`);
  // aviso de compra
  await P.locator('[data-act="buy"]').click(); await pg.waitForTimeout(500);
  const t1 = await R(() => { const t = document.querySelector('#fogueo-root').shadowRoot.querySelector('.toast'); return { cls: t.className, title: t.querySelector('strong')?.textContent, stats: [...t.querySelectorAll('.t-stat')].map((s) => s.textContent), txt: t.innerText }; });
  ok(/rich/.test(t1.cls) && t1.stats.length === 3 && /BONK/.test(t1.title), tag + 'Aviso de compra: título + 3 fichas → ' + t1.title + ' | ' + t1.stats.join(' / '));
  if (lang === 'en') ok(!SPANISH.test(t1.txt), tag + 'Aviso de compra sin restos en español');
  // venta parcial
  price *= 1.4; await pg.waitForTimeout(3200);
  await P.locator('[data-act="side"][data-side="sell"]').click(); await P.locator('[data-act="sellpct"][data-pct="50"]').click(); await P.locator('[data-act="sell"]').click(); await pg.waitForTimeout(500);
  const t2 = await R(() => { const t = document.querySelector('#fogueo-root').shadowRoot.querySelector('.toast'); return { stats: [...t.querySelectorAll('.t-stat')].map((s) => s.className + ':' + s.textContent), txt: t.innerText }; });
  ok(t2.stats.length === 3 && /t-stat up/.test(t2.stats[2]), tag + 'Aviso de venta: resultado en verde → ' + t2.stats.join(' / '));
  if (lang === 'en') ok(!SPANISH.test(t2.txt), tag + 'Aviso de venta sin restos en español');
  // error con prioridad
  const host = await ctx.newPage(); await host.goto(`chrome-extension://${extId}/popup/popup.html`);
  await host.evaluate(() => new Promise((res) => chrome.storage.local.get('fogueo', ({ fogueo }) => { fogueo.settings.maxSlippagePct = 0.0001; chrome.storage.local.set({ fogueo }, res); })));
  await host.close(); await pg.bringToFront(); await pg.waitForTimeout(300);
  await P.locator('[data-act="side"][data-side="buy"]').click();
  await P.locator('[data-act="quick"]').nth(1).click(); await P.locator('[data-act="buy"]').click(); await pg.waitForTimeout(500);
  const t3 = await R(() => { const t = document.querySelector('#fogueo-root').shadowRoot.querySelector('.toast'); const kids = [...t.querySelector('.t-main').children].map((c) => c.tagName + '.' + c.className); return { cls: t.className, kids, stat: t.querySelector('.t-stat')?.className, txt: t.innerText }; });
  ok(/err/.test(t3.cls) && t3.kids.join(',') === 'STRONG.,P.,DIV.t-stats,P.t-note' && /down/.test(t3.stat), tag + 'Aviso de error: título, motivo, ficha de prioridad cobrada y nota (' + t3.kids.join(',') + ')');
  if (lang === 'en') ok(!SPANISH.test(t3.txt), tag + 'Aviso de error sin restos en español: ' + t3.txt.split('\n')[0]);
  await P.locator('[data-act="closeToast"]').click();
  // recorrido completo
  await P.locator('.foot [data-act="tour"]').click(); await pg.waitForTimeout(500);
  await pg.locator('#fogueo-root [data-tour="all"]').click(); await pg.waitForTimeout(300);
  let viz = 0, steps = 0, spanish = [];
  for (let i = 0; i < 40; i++) {
    const st = await R(() => { const r = document.querySelector('#fogueo-root').shadowRoot; const v = r.querySelector('.tour-viz'); return v ? { on: !v.hidden && v.textContent.trim().length > 0, txt: v.innerText, title: r.querySelector('#tour-title')?.textContent } : null; });
    if (!st) break;
    steps++; if (st.on) viz++;
    if (lang === 'en' && st.on && SPANISH.test(st.txt)) spanish.push(st.title + ': ' + st.txt.replace(/\s+/g, ' '));
    await pg.keyboard.press('ArrowRight'); await pg.waitForTimeout(250);
  }
  ok(steps >= 29 && viz >= 18, tag + `Recorrido del panel: ${viz} de ${steps} tarjetas llevan mini-gráfico`);
  if (lang === 'en') ok(!spanish.length, tag + 'Mini-gráficos del recorrido sin español' + (spanish.length ? ': ' + spanish.join(' | ') : ''));
  // recorrido de la ventana
  const pop = await ctx.newPage(); pop.on('pageerror', (e) => errs.push('POP ' + e.message));
  await pop.goto(`chrome-extension://${extId}/popup/popup.html`); await pop.waitForTimeout(1000); await pop.keyboard.press('Escape'); await pop.waitForTimeout(300);
  await pop.locator('.help-btn').first().click(); await pop.waitForTimeout(400); await pop.locator('[data-pt="all"]').click(); await pop.waitForTimeout(300);
  let pviz = 0, psp = [];
  for (let i = 0; i < 20; i++) {
    const st = await pop.evaluate(() => { const v = document.querySelector('.ptour-viz'); return v ? { on: !v.hidden && v.textContent.trim().length > 0, txt: v.innerText } : null; });
    if (!st) break;
    if (st.on) { pviz++; if (lang === 'en' && SPANISH.test(st.txt)) psp.push(st.txt.replace(/\s+/g, ' ')); }
    await pop.keyboard.press('ArrowRight'); await pop.waitForTimeout(300);
  }
  ok(pviz >= 7 && !psp.length, tag + `Recorrido de la ventana: ${pviz} tarjetas con mini-gráfico` + (psp.length ? ' · español: ' + psp.join(' | ') : ''));
  ok(!errs.length, tag + 'Sin errores JS' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await ctx.close();
}
await run('es');
await run('en');
console.log(fails ? `\n${fails} FALLOS` : '\nTodo bien');
