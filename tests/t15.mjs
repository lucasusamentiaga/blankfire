// Recorridos en condiciones difíciles: cada paso con objetivo debe iluminar algo visible y la tarjeta caber en pantalla.
import { chromium } from 'playwright';
const TDIR = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
import fs from 'fs';
const EXT = new URL('../Fogueo', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), SOL = 'So11111111111111111111111111111111111111112';
const T = '52u2Z2PZkPgX8nzzZvN7ADCroDBTRiT4VNkpAgm3pump';
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log((c ? 'OK  ' : 'FAIL') + ' ' + m); };
const OUT = TDIR+'t15'; fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT);

async function run(name, { lang = 'es', vw = 1280, vh = 860, page = 'token', collapsed = false, realPos = false, view = null }) {
  const ctx = await chromium.launchPersistentContext(TDIR+'p15-' + Date.now(), { headless: true, channel: 'chromium', locale: lang === 'es' ? 'es-ES' : 'en-US', viewport: { width: vw, height: vh }, args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, `--lang=${lang === 'es' ? 'es-ES' : 'en-US'}`] });
  await ctx.route('https://api.dexscreener.com/**', (r) => {
    const u = r.request().url();
    if (u.includes(SOL) && !u.includes(T)) return r.fulfill({ json: [{ chainId: 'solana', pairAddress: 'x', baseToken: { address: SOL, symbol: 'SOL' }, quoteToken: { symbol: 'USDC' }, priceUsd: '180', liquidity: { usd: 9e6 } }] });
    const p = { chainId: 'solana', dexId: 'pumpswap', pairAddress: 'P1', baseToken: { address: T, symbol: 'DOUG', name: 'Doug' }, quoteToken: { symbol: 'SOL' }, priceUsd: '0.00004', liquidity: { usd: 90000 }, marketCap: 40000, priceChange: {}, info: {} };
    return r.fulfill({ json: u.includes('/search') ? { pairs: [p] } : [p] });
  });
  await ctx.route('https://lite-api.jup.ag/**', (r) => r.fulfill({ json: r.request().url().includes('/price/v3') ? {} : [] }));
  const fake = fs.readFileSync(TDIR+'fake-padre.html', 'utf8');
  await ctx.route('https://trade.padre.gg/**', (r) => r.fulfill({ body: fake, contentType: 'text/html' }));
  let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent('serviceworker');
  const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', (e) => errs.push(e.message));
  const S = (s) => pg.locator('#fogueo-root').locator(s);
  await pg.goto('https://trade.padre.gg/' + (page === 'token' ? 'trade/solana/' + T : '')); await pg.waitForTimeout(2200);
  await S('[data-act="onboarded"]').click().catch(() => {}); await pg.waitForTimeout(300);
  if (realPos) { await S('[data-act="quick"]').nth(1).click(); await S('[data-act="buy"]').click(); await pg.waitForTimeout(1500); }
  if (view) { await S(`[data-act="view"][data-v="${view}"]`).click(); await pg.waitForTimeout(300); }
  if (collapsed) { await pg.evaluate(() => document.querySelector('#fogueo-root').shadowRoot.querySelector('.head').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))); await pg.waitForTimeout(400); }
  const before = await pg.evaluate(() => chrome?.runtime ? null : null);
  await S('.foot [data-act="tour"]').click().catch(async () => { await pg.evaluate(() => document.querySelector('#fogueo-root').shadowRoot.querySelector('[data-act="tour"]').click()); });
  await pg.waitForTimeout(600);
  await S('[data-tour="all"]').click(); await pg.waitForTimeout(450);
  const bad = []; let n = 0;
  for (let i = 0; i < 40; i++) {
    const info = await pg.evaluate(() => {
      const r = document.querySelector('#fogueo-root')?.shadowRoot; const c = r?.querySelector('.tour-card'); if (!c) return null;
      const spot = r.querySelector('.tour-spot'); const sr = spot.getBoundingClientRect(); const cr = c.getBoundingClientRect();
      return { t: c.querySelector('h3').textContent, none: spot.classList.contains('none'), sw: sr.width, sh: sr.height, sy: sr.top, sb: sr.bottom, cy: cr.top, cb: cr.bottom, cx: cr.left, cr: cr.right, W: innerWidth, H: innerHeight };
    });
    if (!info) break; n++;
    const noTarget = /icono de Blankfire|Blankfire icon/.test(info.t);
    if (!noTarget && (info.none || info.sh < 8)) bad.push('sin iluminar: ' + info.t);
    if (!info.none && (info.sb < 0 || info.sy > info.H)) bad.push('fuera de pantalla: ' + info.t);
    if (info.cy < -1 || info.cb > info.H + 1 || info.cx < -1 || info.cr > info.W + 1) bad.push('tarjeta cortada: ' + info.t + ` (${Math.round(info.cy)}–${Math.round(info.cb)} de ${info.H})`);
    if (i === 6) await pg.screenshot({ path: `${OUT}/${name}.png` });
    await pg.keyboard.press('ArrowRight'); await pg.waitForTimeout(380);
  }
  ok(n === 29 && !bad.length && !errs.length, `${name}: ${n} pasos` + (bad.length ? ' → ' + bad.join(' | ') : '') + (errs.length ? ' ERR ' + errs.join(' | ') : ''));
  // tras el recorrido el panel vuelve a como estaba
  const after = await pg.evaluate(() => { const r = document.querySelector('#fogueo-root').shadowRoot; return { collapsed: r.querySelector('.fx').classList.contains('is-collapsed'), tour: !!r.querySelector('.tour') }; });
  ok(!after.tour && after.collapsed === collapsed, `${name}: panel restaurado (plegado=${after.collapsed})`);
  await ctx.close();
}
await run('es-token', {});
await run('en-token', { lang: 'en' });
await run('sin-token', { page: 'home' });
await run('plegado', { collapsed: true });
await run('con-posicion-real', { realPos: true });
await run('desde-atajos', { view: 'keys' });
await run('ventana-pequena', { vw: 760, vh: 620 });
await run('ventana-muy-pequena', { vw: 420, vh: 600 });
console.log(fails ? `\n${fails} FALLOS` : '\nTodo bien');
