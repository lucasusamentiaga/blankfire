// Barrido visual completo (ES y EN): panel y ventana en todos sus estados. Busca restos en español en inglés,
// textos cortados o que se salen, «NaN»/«undefined» y errores JS, y guarda capturas de cada estado.
import { chromium } from 'playwright';
const TDIR = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
import fs from 'fs';
const EXT = new URL('../Fogueo', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), SOL = 'So11111111111111111111111111111111111111112';
const A = '52u2Z2PZkPgX8nzzZvN7ADCroDBTRiT4VNkpAgm3pump', B = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
const OUT = TDIR+'vis27'; fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT);
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log((c ? 'OK  ' : 'FAIL') + ' ' + m); };
const SPANISH = /[áéíóúñ¿¡]|\b(de|del|la|el|los|las|tu|tus|con|sin|para|por|que|una|más|hoy|ahora|Comprar|Vender|Saldo|Ajustes|Historial|Posiciones|Cartera|Estadísticas|Cerrar|Guardar|Recargar|Nueva|Precio|Comisión|Prioridad|Cancelar|Libre|Abierto|Volver|Atajos|Orden|Ganadoras|Perdedoras|Todas|Exportar|Reiniciar|Recibes|Pagas|Resultado)\b/;
const ALLOW = /Cambiar a español|Blankfire|Padre|DOUG|BONK|Doug the Dog|Bonk|Rompe|nota de prueba|Instagram|GitHub|lucasuazz_|pump\.fun|Raydium|PumpSwap|Jupiter|DexScreener|actualizar\.bat|Fogueo/;
async function scan(page, rootSel, where, lang) {
  const r = await page.evaluate(({ rootSel, SP, AL, lang }) => {
    const SPANISH = new RegExp(SP.source, SP.flags), ALLOW = new RegExp(AL.source, AL.flags);
    const root = rootSel === 'panel' ? document.querySelector('#fogueo-root').shadowRoot : document;
    const vis = (el) => { const s = getComputedStyle(el); const b = el.getBoundingClientRect(); return s.visibility !== 'hidden' && s.display !== 'none' && b.width > 0 && b.height > 0 && !el.closest('[hidden]'); };
    const found = { spanish: [], weird: [], overflow: [] };
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const el = n.parentElement; const t = n.nodeValue.trim();
      if (!t || !el || !vis(el) || el.closest('textarea, script, style')) continue;
      if (/NaN|undefined|\[object|Infinity|null\b/.test(t)) found.weird.push(t.slice(0, 60));
      if (lang === 'en' && SPANISH.test(t.replace(ALLOW, ''))) found.spanish.push(t.slice(0, 70));
    }
    root.querySelectorAll('[aria-label],[title],[placeholder]').forEach((el) => {
      if (lang !== 'en') return;
      for (const a of ['aria-label', 'title', 'placeholder']) { const v = el.getAttribute(a); if (v && SPANISH.test(v.replace(ALLOW, ''))) found.spanish.push(`@${a}: ${v.slice(0, 60)}`); }
    });
    // Textos que se salen de su caja (sin estar recortados a propósito con ellipsis)
    root.querySelectorAll('*').forEach((el) => {
      if (!vis(el) || !el.childNodes.length) return;
      const s = getComputedStyle(el);
      if (el.scrollWidth > el.clientWidth + 2 && s.overflowX === 'visible' && s.textOverflow !== 'ellipsis' && ![...el.childNodes].every((c) => c.nodeType !== 3) && el.clientWidth > 0 && s.display !== 'inline') {
        found.overflow.push(`${el.tagName.toLowerCase()}.${[...el.classList].join('.')} (${el.scrollWidth}>${el.clientWidth}): ${el.textContent.trim().slice(0, 40)}`);
      }
    });
    // Contenedores con scroll: no debe poder desplazarse en horizontal
    root.querySelectorAll('*').forEach((el) => {
      const s = getComputedStyle(el);
      if (/(auto|scroll)/.test(s.overflowX) && el.scrollWidth > el.clientWidth + 1) found.overflow.push(`SCROLL HORIZONTAL en ${el.tagName.toLowerCase()}.${[...el.classList].join('.')} (${el.scrollWidth}>${el.clientWidth})`);
    });
    return found;
  }, { rootSel, SP: { source: SPANISH.source, flags: SPANISH.flags }, AL: { source: ALLOW.source, flags: 'g' }, lang });
  return r;
}
const all = { spanish: new Set(), weird: new Set(), overflow: new Set() };
async function run(lang) {
  let price = 0.0000045;
  const L = lang === 'en' ? 'en-US' : 'es-ES';
  const ctx = await chromium.launchPersistentContext(TDIR+'p27-' + Date.now(), { headless: true, channel: 'chromium', locale: L, viewport: { width: 1200, height: 950 }, deviceScaleFactor: 2, args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--lang=' + L] });
  await ctx.route('https://raw.githubusercontent.com/**', (r) => r.fulfill({ json: r.request().url().includes('manifest') ? { version: '9.9.9' } : { releases: { '9.9.9': { es: ['Novedad de prueba'], en: ['Test change'] } } } }));
  await ctx.route('https://api.dexscreener.com/**', (r) => {
    const u = r.request().url();
    if (u.includes(SOL) && !u.includes(A) && !u.includes(B)) return r.fulfill({ json: [{ chainId: 'solana', pairAddress: 'x', baseToken: { address: SOL, symbol: 'SOL' }, quoteToken: { symbol: 'USDC' }, priceUsd: '182.4', liquidity: { usd: 9e6 } }] });
    const ps = [];
    if (u.includes(A)) ps.push({ chainId: 'solana', dexId: 'pumpfun', pairAddress: 'PA1', baseToken: { address: A, symbol: 'DOUG', name: 'Doug the Dog' }, quoteToken: { symbol: 'SOL' }, priceUsd: String(price), liquidity: { usd: 21000 }, marketCap: price * 1e9, priceChange: { m5: 12.4, h1: -3.1 }, pairCreatedAt: Date.now() - 7 * 60000, info: {} });
    if (u.includes(B)) ps.push({ chainId: 'solana', dexId: 'raydium', pairAddress: 'PB1', baseToken: { address: B, symbol: 'BONK', name: 'Bonk' }, quoteToken: { symbol: 'SOL' }, priceUsd: '0.00002', liquidity: { usd: 5e6 }, marketCap: 2e9, priceChange: { m5: -1, h1: 2 }, info: {} });
    return r.fulfill({ json: u.includes('/search') ? { pairs: ps } : ps });
  });
  await ctx.route('https://lite-api.jup.ag/**', (r) => r.fulfill({ json: r.request().url().includes('/price/v3') ? {} : [{ id: A, symbol: 'DOUG', name: 'Doug the Dog', usdPrice: price, launchpad: 'pump.fun' }] }));
  const fake = fs.readFileSync(TDIR+'fake-padre.html', 'utf8');
  await ctx.route('https://trade.padre.gg/**', (r) => r.fulfill({ body: fake, contentType: 'text/html' }));
  let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent('serviceworker');
  const extId = sw.url().split('/')[2];
  const boot = await ctx.newPage(); await boot.goto(`chrome-extension://${extId}/popup/popup.html`);
  await boot.evaluate(() => new Promise((res) => chrome.runtime.sendMessage({ type: 'checkUpdate', force: true }, res))); await boot.close();
  const errs = [];
  const pg = await ctx.newPage(); pg.on('pageerror', (e) => errs.push(e.message));
  const P = (s) => pg.locator('#fogueo-root').locator(s);
  const shot = async (n) => {
    const fx = await pg.evaluate(() => { const r = document.querySelector('#fogueo-root').shadowRoot.querySelector('.fx').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
    await pg.screenshot({ path: `${OUT}/${lang}-${n}.png`, clip: { x: Math.max(0, fx.x - 8), y: Math.max(0, fx.y - 8), width: fx.w + 16, height: Math.min(950 - Math.max(0, fx.y - 8), fx.h + 16) } });
    const f = await scan(pg, 'panel', n, lang);
    f.spanish.forEach((x) => all.spanish.add(`[${lang} panel ${n}] ${x}`)); f.weird.forEach((x) => all.weird.add(`[${lang} panel ${n}] ${x}`)); f.overflow.forEach((x) => all.overflow.add(`[${lang} panel ${n}] ${x}`));
  };
  await pg.goto('https://trade.padre.gg/trade/solana/' + A); await pg.waitForTimeout(2800);
  await shot('01-bienvenida');
  await P('[data-act="onboarded"]').click().catch(() => {}); await pg.waitForTimeout(500);
  await shot('02-token');
  await P('.reco-toggle, [data-act="reco"]').first().click().catch(() => {}); await pg.waitForTimeout(400); await shot('03-ajustes-recomendados');
  await P('[data-act="quick"]').nth(2).click(); await P('.opt.sl label').click(); await P('.opt.tp label').click(); await P('.opt.trail label, [data-ref="trailBtn"]').first().click().catch(() => {});
  await P('[data-act="note"][data-for="buyNote"]').click(); await P('[data-ref="buyNote"]').fill('nota de prueba');
  await pg.waitForTimeout(300); await shot('04-formulario');
  await P('[data-act="otype"][data-o="limit"]').click(); await P('[data-ref="limitMc"]').fill('3K'); await pg.waitForTimeout(300); await shot('05-limite');
  await P('[data-act="otype"][data-o="market"]').click();
  await P('[data-act="buy"]').click(); await pg.waitForTimeout(900); await shot('06-comprado');
  price *= 1.35; await pg.waitForTimeout(4200); await shot('07-posicion-sube');
  await P('[data-act="editTarget"]').first().click().catch(() => {}); await pg.waitForTimeout(300); await shot('08-editar-stop');
  await pg.keyboard.press('Escape');
  await P('[data-act="side"][data-side="sell"]').click(); await pg.waitForTimeout(300); await shot('09-vender');
  await P('[data-act="sellpct"][data-pct="50"]').click(); await P('[data-act="sell"]').click(); await pg.waitForTimeout(800); await shot('10-venta-parcial');
  await P('[data-act="view"][data-v="positions"]').first().click(); await pg.waitForTimeout(600); await shot('11-lista');
  await P('[data-act="view"][data-v="keys"]').first().click(); await pg.waitForTimeout(400); await shot('12-atajos');
  for (let i = 0; i < 4; i++) {
    const inTrade = await pg.evaluate(() => { const v = document.querySelector('#fogueo-root').shadowRoot.querySelector('[data-ref="viewTrade"]'); return v && !v.hidden && v.getBoundingClientRect().height > 0; });
    if (inTrade) break;
    await P('.back:visible').first().click().catch(() => {}); await pg.waitForTimeout(350);
  }
  await shot('12b-antes-de-cerrar');
  await P('[data-act="side"][data-side="sell"]').click().catch(() => {}); await P('[data-act="sellpct"][data-pct="100"]').click({ timeout: 5000 }); await P('[data-act="sell"]').click(); await pg.waitForTimeout(1300); await shot('13-cierre');
  await P('.tag-chip').first().click(); await P('[data-act="plan"][data-v="yes"]').click(); await pg.waitForTimeout(200); await shot('14-revision');
  await P('[data-act="reviewSave"]').click(); await pg.waitForTimeout(600);
  await P('.head').dblclick(); await pg.waitForTimeout(500); await shot('15-minimizado'); await P('.head').dblclick(); await pg.waitForTimeout(400);
  // otro token (graduado / normal)
  await pg.goto('https://trade.padre.gg/trade/solana/' + B); await pg.waitForTimeout(2500); await shot('16-token-normal');
  // ventana
  const pop = await ctx.newPage(); pop.on('pageerror', (e) => errs.push('POP ' + e.message));
  await pop.setViewportSize({ width: 400, height: 640 });
  const pshot = async (n) => {
    await pop.screenshot({ path: `${OUT}/${lang}-p${n}.png`, fullPage: true });
    const f = await scan(pop, 'doc', n, lang);
    f.spanish.forEach((x) => all.spanish.add(`[${lang} ventana ${n}] ${x}`)); f.weird.forEach((x) => all.weird.add(`[${lang} ventana ${n}] ${x}`)); f.overflow.forEach((x) => all.overflow.add(`[${lang} ventana ${n}] ${x}`));
  };
  await pop.goto(`chrome-extension://${extId}/popup/popup.html`); await pop.waitForTimeout(1200);
  await pop.keyboard.press('Escape'); await pop.waitForTimeout(400);
  // posición abierta en BONK y orden límite para llenar la cartera
  await pop.evaluate((B) => new Promise((res) => chrome.runtime.sendMessage({ type: 'resolve', address: B }, () => chrome.runtime.sendMessage({ type: 'buy', key: 'solana:' + B, solIn: 0.4, slPct: 30, tpPct: 100 }, () => chrome.runtime.sendMessage({ type: 'placeOrder', key: 'solana:' + B, mc: 1.5e9, solIn: 0.2 }, res)))), B);
  await pop.waitForTimeout(1500);
  await pshot('01-cartera');
  await pop.locator('[data-tab="history"]').click(); await pop.waitForTimeout(400); await pshot('02-historial');
  await pop.locator('[data-hf="loss"]').click(); await pop.waitForTimeout(300); await pshot('03-filtro-vacio');
  await pop.locator('[data-hf="all"]').click(); await pop.locator('[data-row]').first().click(); await pop.waitForTimeout(600); await pshot('04-detalle');
  await pop.locator('[data-tab="stats"]').click(); await pop.waitForTimeout(600); await pshot('05-estadisticas');
  await pop.locator('[data-tab="settings"]').click(); await pop.waitForTimeout(500); await pshot('06-ajustes');
  await pop.locator('[data-act="reset"]').click().catch(() => {}); await pop.waitForTimeout(300); await pshot('07-reiniciar');
  await pop.locator('[data-act="resetNo"]').click().catch(() => {});
  ok(!errs.length, `[${lang}] Sin errores JS` + (errs.length ? ': ' + errs.join(' | ') : ''));
  await ctx.close();
}
await run('es');
await run('en');
const show = (k, label) => { const arr = [...all[k]]; ok(!arr.length, `${label}: ${arr.length}` + (arr.length ? '\n     ' + arr.slice(0, 40).join('\n     ') : '')); };
show('spanish', 'Restos en español en la versión inglesa');
show('weird', 'Textos con NaN/undefined');
show('overflow', 'Textos que se salen de su caja');
console.log(fails ? `\n${fails} FALLOS` : '\nTodo bien');
