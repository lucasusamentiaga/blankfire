// Pro de punta a punta: «Qué pasó después» + errores + análisis con IA a través del servidor de Blankfire
// (se ejecuta el código real del servidor con Gemini, Lemon Squeezy y la base de datos simulados), respaldo de GeckoTerminal
// cuando Jupiter pide clave, y licencia de pago con Lemon Squeezy (copia de la extensión con tienda configurada).
import { chromium } from 'playwright';
const TDIR = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
import fs from 'fs';
const _src_t30 = fs.readFileSync(new URL('../server/supabase/functions/blankfire-ai/index.ts', import.meta.url), 'utf8');
const _tmp_t30 = new URL('./.blankfire-ai.mjs', import.meta.url); fs.writeFileSync(_tmp_t30, _src_t30);
const { handle: serverHandle } = await import(_tmp_t30.href);
const AI_URL = 'https://testbf.supabase.co/functions/v1/blankfire-ai';
const SRC = new URL('../Fogueo', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), SOL = 'So11111111111111111111111111111111111111112';
const A = '52u2Z2PZkPgX8nzzZvN7ADCroDBTRiT4VNkpAgm3pump';
const B = 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm';
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log((c ? 'OK  ' : 'FAIL') + ' ' + m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function launch(ext, { lang = 'es', jupDown = false, serverEnv = null, aiFlag = true } = {}) {
  const st = { price: 0.00002, gtCalls: 0, gemini: [], ls: [], jupDown, aiCalls: [], serverLs: [], aiFlag, kofiCalls: 0, raised: 18.5, serverEnv: { BLANKFIRE_GEMINI_KEY: 'srv-paid-key', SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'svc', BLANKFIRE_BETA_CAP: '3', ...(serverEnv || {}) } };
  const ctx = await chromium.launchPersistentContext(TDIR + 'p30-' + Date.now(), { headless: true, channel: 'chromium', locale: lang === 'en' ? 'en-US' : 'es-ES', viewport: { width: 420, height: 760 }, args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, `--lang=${lang === 'en' ? 'en-US' : 'es-ES'}`] });
  // GitHub: misma versión publicada y el interruptor remoto de la IA (features.ai).
  const VER = JSON.parse(fs.readFileSync(ext + '/manifest.json', 'utf8')).version;
  await ctx.route('https://raw.githubusercontent.com/**', (r) => {
    const u = r.request().url();
    if (u.includes('/manifest.json')) return r.fulfill({ json: { version: VER } });
    if (u.includes('/updates.json')) return r.fulfill({ json: { features: { ai: st.aiFlag }, releases: {} } });
    return r.fulfill({ status: 404, body: '' });
  });
  await ctx.route('https://ntsjdliklscfbtczmuux.supabase.co/functions/v1/blankfire-kofi', (r) => { st.kofiCalls++; return r.fulfill({ json: { ok: true, raised: st.raised, goal: 50, supporters: 3 } }); });
  await ctx.route('https://api.dexscreener.com/**', (r) => {
    const u = r.request().url();
    if (u.includes(SOL) && !u.includes(A)) return r.fulfill({ json: [{ chainId: 'solana', pairAddress: 'x', baseToken: { address: SOL, symbol: 'SOL' }, quoteToken: { symbol: 'USDC' }, priceUsd: '150', liquidity: { usd: 9e6 } }] });
    if (u.includes(B)) return r.fulfill({ json: u.includes('/search') ? { pairs: [] } : [] });   // token que DexScreener aún no tiene
    const ps = [{ chainId: 'solana', dexId: 'pumpfun', pairAddress: 'POOLPUMP1', baseToken: { address: A, symbol: 'PEPE', name: 'Pepe' }, quoteToken: { symbol: 'SOL' }, priceUsd: String(st.price), liquidity: { usd: 30000 }, marketCap: st.price * 1e9, priceChange: {}, info: {} }];
    return r.fulfill({ json: u.includes('/search') ? { pairs: ps } : ps });
  });
  await ctx.route('https://lite-api.jup.ag/**', (r) => (st.jupDown ? r.fulfill({ status: 410, body: '' }) : r.fulfill({ json: r.request().url().includes('/price/v3') ? {} : [] })));
  await ctx.route('https://api.geckoterminal.com/**', (r) => {
    st.gtCalls++;
    const u = new URL(r.request().url());
    if (u.pathname.includes('/ohlcv/')) {
      const before = Number(u.searchParams.get('before_timestamp')), lim = Number(u.searchParams.get('limit'));
      const list = [];
      // Después de vender el precio se dispara ×3 y luego vuelve: «vendiste demasiado pronto».
      for (let i = 0; i < lim; i++) { const t = before - i * 60; const p = st.gtShape ? st.gtShape(t * 1000) : 0.00002; list.push([t, p, p, p, p, 10]); }
      return r.fulfill({ json: { data: { attributes: { ohlcv_list: list } } } });
    }
    if (u.pathname.endsWith(`/tokens/${B}`)) return r.fulfill({ json: { data: { attributes: { address: B, symbol: 'NEWB', name: 'New B', price_usd: '0.0005', fdv_usd: '500000', total_reserve_in_usd: '60000' } }, included: [{ type: 'pool', attributes: { address: 'GTPOOLB', name: 'NEWB / SOL', reserve_in_usd: '60000' }, relationships: { dex: { data: { id: 'pumpswap' } } } }] } });
    if (u.pathname.includes('/pools')) return r.fulfill({ json: { data: [{ attributes: { address: 'POOLPUMP1' } }] } });
    return r.fulfill({ status: 404, body: '' });
  });
  // Servidor de Blankfire: código real de server/…/blankfire-ai con dependencias simuladas.
  const usage = new Map();
  const lsMeta = { store_id: 77, product_id: 99 };
  const fakeFetch = async (url, init = {}) => {
    const u = String(url);
    const J = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    if (u.includes('/rest/v1/rpc/')) {
      const fn = u.split('/rpc/')[1], a = JSON.parse(init.body || '{}');
      if (fn === 'blankfire_ai_take') { const n = usage.get(a.p_subject) || 0; if (n >= a.p_cap) return J(200, -1); usage.set(a.p_subject, n + 1); return J(200, n + 1); }
      if (fn === 'blankfire_ai_refund') { usage.set(a.p_subject, Math.max(0, (usage.get(a.p_subject) || 0) - 1)); return J(200, null); }
      return J(200, null);
    }
    if (u.includes('lemonsqueezy.com')) { const p = new URLSearchParams(String(init.body)); st.serverLs.push(p.get('license_key')); return J(200, { valid: st.lsValid !== false, license_key: { status: st.lsValid === false ? 'disabled' : 'active' }, meta: lsMeta }); }
    if (u.includes('generativelanguage.googleapis.com')) {
      const body = JSON.parse(init.body);
      st.gemini.push({ url: u, key: init.headers['x-goog-api-key'], body });
      if (u.includes('gemini-flash-lite-latest')) return J(404, { error: { code: 404, message: 'not found' } });
      const out = JSON.stringify({ score: 4, verdict: lang === 'en' ? 'Decent entry, panicked exit.' : 'Entrada correcta, salida con prisa.', after: lang === 'en' ? 'It tripled after you sold.' : 'Después de vender se triplicó.', errors: [{ title: lang === 'en' ? 'Sold too early' : 'Vendiste pronto', detail: '+200 %', severity: 'high' }, { title: 'x'.repeat(200), detail: 'y', severity: 'weird' }], good: ['Stop'], lesson: lang === 'en' ? 'Set a trailing stop.' : 'Pon un stop dinámico.' });
      return J(200, { candidates: [{ content: { parts: [{ text: out }] } }] });
    }
    return J(404, {});
  };
  await ctx.route(AI_URL, async (r) => {
    const req = r.request();
    st.aiCalls.push(req.postDataJSON());
    const res = await serverHandle(new Request(req.url(), { method: req.method(), headers: req.headers(), body: req.postData() }), { ...st.serverEnv }, fakeFetch);
    return r.fulfill({ status: res.status, headers: Object.fromEntries(res.headers), body: await res.text() });
  });
  await ctx.route('https://api.lemonsqueezy.com/**', async (r) => {
    const req = r.request(); const p = new URLSearchParams(req.postData() || ''); const path = new URL(req.url()).pathname;
    st.ls.push({ path, key: p.get('license_key') });
    const meta = { store_id: 77, product_id: 99, customer_email: 'tester@example.com', variant_name: 'Lifetime' };
    if (p.get('license_key') === 'BAD0-BAD0-BAD0-BAD0') return r.fulfill({ status: 404, json: { activated: false, error: 'license_key not found.' } });
    if (p.get('license_key') === 'OTHR-OTHR-OTHR-OTHR') return r.fulfill({ json: { activated: true, valid: true, license_key: { status: 'active' }, instance: { id: 'i2' }, meta: { ...meta, store_id: 1 } } });
    if (path.endsWith('/activate')) return r.fulfill({ json: { activated: true, license_key: { status: 'active', expires_at: null }, instance: { id: 'inst-1' }, meta } });
    if (path.endsWith('/validate')) return r.fulfill({ json: { valid: st.lsValid !== false, license_key: { status: st.lsValid === false ? 'disabled' : 'active' }, instance: { id: 'inst-1' }, meta } });
    if (path.endsWith('/deactivate')) return r.fulfill({ json: { deactivated: true } });
    return r.fulfill({ status: 404, body: '' });
  });
  let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent('serviceworker');
  const extId = sw.url().split('/')[2];
  const pop = await ctx.newPage();
  const errs = []; pop.on('pageerror', (e) => errs.push(e.message));
  await pop.goto(`chrome-extension://${extId}/popup/popup.html`); await pop.waitForTimeout(600);
  const send = (m) => pop.evaluate((m) => new Promise((res) => chrome.runtime.sendMessage(m, res)), m);
  await send({ type: 'saveUi', ui: { popupToured: true, onboarded: true } });
  await send({ type: 'saveSettings', settings: { lang } });
  await send({ type: 'checkUpdate', force: true });
  return { ctx, pop, send, st, errs, extId };
}

// Hace un trade cerrado: compra, sube el precio, vende todo. Devuelve el round.
async function makeTrade(T, { sl } = {}) {
  await T.send({ type: 'reset', startBalance: 10 });
  await T.send({ type: 'resolve', address: A });
  T.st.price = 0.00002;
  const b = await T.send({ type: 'buy', key: 'solana:' + A, solIn: 4, slPct: sl });
  await sleep(2200);
  T.st.price = 0.000024;
  const s = await T.send({ type: 'sell', key: 'solana:' + A, pct: 100 });
  // Llevamos el trade 90 min al pasado (como si lo hubieras cerrado hace hora y media).
  const SH = 90 * 60e3;
  await T.pop.evaluate((SH) => new Promise((res) => chrome.storage.local.get(['fogueo', 'blankfireAfter'], (g) => {
    const r = g.fogueo.account.rounds[0];
    r.openedAt -= SH; r.closedAt -= SH; (r.fills || []).forEach((f) => { f.t -= SH; });
    g.fogueo.account.fills.forEach((f) => { f.t -= SH; });
    const a = g.blankfireAfter || {}; Object.values(a).forEach((x) => { x.closedAt -= SH; x.samples = (x.samples || []).map(([t, p]) => [t - SH, p]); });
    chrome.storage.local.set({ fogueo: g.fogueo, blankfireAfter: a }, res);
  })), SH);
  const round = (await T.send({ type: 'state' })).data.account.rounds[0];
  // Precio en GeckoTerminal: plano antes, sube tras la venta a ×3 a los ~20 min y baja después.
  const out = round.closedAt;
  T.st.gtShape = (t) => (t <= out ? 0.000024 : t <= out + 20 * 60e3 ? 0.000024 * (1 + 2 * (t - out) / (20 * 60e3)) : 0.000072);
  return { b, round };
}

// Copias de la extensión con la configuración del Pro cambiada (como lo haría el autor en lib/pro.js).
const copies = [];
function makeExt(patch) {
  const dir = TDIR + 'extpro-' + Date.now() + '-' + copies.length;
  fs.cpSync(SRC, dir, { recursive: true });
  const pj = dir + '/lib/pro.js';
  let t = fs.readFileSync(pj, 'utf8');
  for (const [k, v] of Object.entries(patch)) t = t.replace(new RegExp(`${k}: [^,]+,`), `${k}: ${JSON.stringify(v)},`);
  fs.writeFileSync(pj, t);
  copies.push(dir);
  return dir;
}
const EXT_AI = makeExt({ aiUrl: AI_URL });

// ===================== 0 · IA apagada desde GitHub: «Pronto»; con Ko-fi, barra de donaciones =====================
{
  const T = await launch(makeExt({ kofiUrl: '' }), { aiFlag: false });
  await makeTrade(T);
  await T.pop.reload(); await T.pop.waitForTimeout(700);
  await T.pop.locator('[data-tab="history"]').click(); await T.pop.locator('.row[data-row]').first().click();
  await T.pop.waitForSelector('.ap .ap-chart', { timeout: 8000 });
  ok(await T.pop.locator('.ai-cta.soon').count() === 1 && !(await T.pop.locator('[data-act="aiRun"]').count()) && !(await T.pop.locator('.sup').count()), 'IA apagada y sin Ko-fi configurado: «Pronto», sin botón ni barra');
  const r = await T.send({ type: 'aiReview', id: (await T.send({ type: 'state' })).data.account.rounds[0].id });
  ok(!r.ok && /aún no está activado/.test(r.error) && T.st.aiCalls.length === 0, 'Y el motor no llama al servidor mientras está apagada');
  await T.ctx.close();
}
{
  const EXT_K = makeExt({ kofiUrl: 'https://ko-fi.com/blankfiretest' });
  const T = await launch(EXT_K, { aiFlag: false });
  await makeTrade(T);
  await T.pop.reload(); await T.pop.waitForTimeout(900);
  await T.pop.locator('[data-tab="history"]').click(); await T.pop.locator('.row[data-row]').first().click();
  await T.pop.waitForSelector('.ap .sup', { timeout: 8000 });
  const t = await T.pop.locator('.ap .sup').innerText();
  ok(/18,5 €|18.5 €/.test(t) && /50 €/.test(t) && /3 apoyos/.test(t) && (await T.pop.locator('.ap .sup a').getAttribute('href')) === 'https://ko-fi.com/blankfiretest', 'Barra de donaciones en el trade: 18,5 € de 50 €, 3 apoyos y botón a tu Ko-fi → ' + t.replace(/\s+/g, ' '));
  const w = await T.pop.locator('.ap .sup-bar i').evaluate((e) => e.style.getPropertyValue('--p'));
  ok(w === '37.0%', 'La barra va al 37 % (' + w + ')');
  await T.pop.locator('.ap .sup').screenshot({ path: TDIR + 'vis30-kofi.png' });
  await T.pop.locator('[data-tab="settings"]').click(); await T.pop.waitForTimeout(400);
  ok(await T.pop.locator('.pro-form .sup').count() === 1, 'También en Ajustes → Blankfire Pro');
  if (process.env.AXE) {
    await T.pop.evaluate(fs.readFileSync(process.env.AXE, 'utf8'));
    const v = await T.pop.evaluate(async () => (await axe.run({ include: ['.pro-form'] }, { resultTypes: ['violations'] })).violations.map((x) => `${x.id}: ${x.nodes[0].target.join(' ')}`));
    ok(!v.length, 'Accesibilidad (axe) de los ajustes con la barra: ' + (v.join(', ') || 'sin problemas'));
  }
  const calls = T.st.kofiCalls; await T.pop.reload(); await T.pop.waitForTimeout(700);
  ok(T.st.kofiCalls === calls, 'El progreso se guarda 10 min (no se pide en cada apertura)');
  // Interruptor remoto: se enciende la IA en GitHub → aparece «Analizar» sin actualizar la extensión
  T.st.aiFlag = true;
  await T.send({ type: 'checkUpdate', force: true });
  await T.pop.reload(); await T.pop.waitForTimeout(700);
  await T.pop.locator('[data-tab="history"]').click(); await T.pop.locator('.row[data-row]').first().click();
  await T.pop.waitForSelector('[data-act="aiRun"]', { timeout: 8000 });
  ok(!(await T.pop.locator('.ap .sup').count()), 'Al encender la IA desde GitHub: botón «Analizar» y fuera la barra');
  await T.ctx.close();
}

// ===================== 1 · Beta (sin tienda): todo el Pro abierto =====================
{
  const T = await launch(EXT_AI);
  const { b, round } = await makeTrade(T);
  ok(b.ok && round?.pairAddress === 'POOLPUMP1' && round.exitMidUsd > 0 && round.slAtEntry === false, `El trade guarda pool, precio de salida y si tenía stop (${round?.pairAddress}, ${round?.exitMidUsd}, sl=${round?.slAtEntry})`);
  const after = (await T.pop.evaluate(() => chrome.storage.local.get('blankfireAfter'))).blankfireAfter || {};
  ok(after[round.id] && Array.isArray(after[round.id].samples), 'Empieza el seguimiento del precio tras vender');
  const st = await T.send({ type: 'proStatus' });
  ok(st.ok && st.data.unlocked && !st.data.selling, 'Beta: Pro desbloqueado sin licencia');
  const ad = await T.send({ type: 'afterData', id: round.id });
  ok(ad.ok && ad.data.series.length > 10 && ad.data.source !== null, `afterData: ${ad.data?.series?.length} precios (${ad.data?.source})`);
  ok(ad.ok && ad.data.flags.errors.some((e) => e.id === 'soldEarly') && ad.data.flags.errors.some((e) => e.id === 'oversized') && ad.data.flags.errors.some((e) => e.id === 'noStop'), 'Errores: vendiste pronto, posición grande, sin stop → ' + ad.data?.flags?.errors?.map((e) => e.id).join(', '));
  // UI: historial → abrir trade
  await T.pop.reload(); await T.pop.waitForTimeout(700);
  await T.pop.locator('[data-tab="history"]').click(); await T.pop.waitForTimeout(300);
  await T.pop.locator('.row[data-row]').first().click();
  await T.pop.waitForSelector('.ap .ap-chart', { timeout: 8000 });
  const txt = await T.pop.locator('.ap').innerText();
  ok(/Qué pasó después/.test(txt) && /Máximo después/.test(txt) && /Vendiste demasiado pronto/.test(txt), 'Detalle: gráfica, cifras y errores en el historial');
  ok(await T.pop.locator('[data-act="aiRun"]').count() === 1 && /nunca tu cartera/.test(txt), 'Con servidor configurado: botón «Analizar», sin pedir ninguna clave');
  await T.pop.locator('.ap').screenshot({ path: TDIR + 'vis30-after.png' });
  await T.pop.locator('[data-tab="settings"]').click(); await T.pop.waitForTimeout(400);
  const proTxt = await T.pop.locator('.pro-form').innerText();
  ok(/Beta gratis/.test(proTxt) && !(await T.pop.locator('.pro-card a.btn').count()), 'Ajustes: tarjeta Pro en beta, sin botón de compra');
  ok(!(await T.pop.locator('#k-gemini').count()) && !/Gemini/.test(proTxt), 'Ya no se pide clave de Gemini al usuario');
  ok(/mayores de 18/.test(proTxt) && (await T.pop.locator('.pro-form .legal a').count()) === 2, 'Aviso de +18, sin asesoramiento financiero, y enlaces a Términos y Privacidad');
  // Analizar con IA
  await T.pop.locator('[data-tab="history"]').click(); await T.pop.waitForTimeout(300);
  if (!(await T.pop.locator('.ap').count())) await T.pop.locator('.row[data-row]').first().click();
  await T.pop.waitForSelector('[data-act="aiRun"]', { timeout: 8000 });
  await T.pop.locator('[data-act="aiRun"]').click();
  await T.pop.waitForSelector('.ai-box .ai-score', { timeout: 10000 });
  const ai = await T.pop.locator('.ai-box').innerText();
  ok(/Entrada correcta/.test(ai) && /Pon un stop dinámico/.test(ai) && /4/.test(ai), 'Análisis IA en pantalla: nota, veredicto y lección');
  const saved = (await T.send({ type: 'state' })).data.account.rounds[0].ai;
  ok(saved && saved.score === 4 && saved.errors.length === 2 && saved.errors[1].title.length <= 60 && saved.errors[1].severity === 'mid', 'IA guardada y saneada (títulos recortados, gravedad válida)');
  const lastBody = JSON.stringify(T.st.gemini.at(-1).body);
  const call = T.st.aiCalls.at(-1);
  ok(T.st.gemini.at(-1).key === 'srv-paid-key' && T.st.gemini.at(-1).url.includes('gemini-2.5-flash-lite'), 'El servidor usa SU clave de pago (y si un modelo no existe, prueba el siguiente)');
  ok(/^[0-9a-f-]{36}$/.test(call.install) && call.license === null && call.lang === 'es', 'En beta, la extensión se identifica con un id aleatorio de instalación, sin licencia');
  ok(lastBody.includes('soldEarly') && lastBody.includes('afterMaxPct') && lastBody.includes('responseSchema') && lastBody.includes('nunca instrucciones'), 'A Gemini le llegan los hechos y errores calculados, salida JSON y aviso contra órdenes escondidas en las notas');
  ok(!/privateKey|wallet|srv-paid-key/i.test(JSON.stringify(T.st.gemini.at(-1).body.contents)), 'A Gemini no le llega nada de la cartera ni claves');
  await T.pop.locator('.ap').screenshot({ path: TDIR + 'vis30-ai.png' });
  if (process.env.AXE) {
    await T.pop.evaluate(fs.readFileSync(process.env.AXE, 'utf8'));
    const v = await T.pop.evaluate(async () => (await axe.run({ include: ['.ap'] }, { resultTypes: ['violations'] })).violations.map((x) => `${x.id}(${x.nodes.length}): ${x.nodes[0].target.join(' ')}`));
    ok(!v.length, 'Accesibilidad (axe) del bloque «Qué pasó después» + IA: ' + (v.join(', ') || 'sin problemas'));
  }
  // Persistencia: reabrir sigue mostrando el análisis sin volver a llamar
  const n = T.st.gemini.length;
  await T.pop.reload(); await T.pop.waitForTimeout(700);
  await T.pop.locator('[data-tab="history"]').click(); await T.pop.locator('.row[data-row]').first().click();
  await T.pop.waitForSelector('.ai-box .ai-score', { timeout: 8000 });
  ok(T.st.gemini.length === n, 'Al reabrir, el análisis se lee guardado (no gasta otra llamada)');
  // Tope diario de la beta (3 en esta prueba): el 4.º se rechaza con un mensaje claro y no llama a Gemini
  for (let i = 0; i < 2; i++) await T.send({ type: 'aiReview', id: round.id });
  const capped = await T.send({ type: 'aiReview', id: round.id });
  ok(!capped.ok && /Has usado los 3 análisis de hoy/.test(capped.error) && T.st.gemini.length === n + 4, 'Tope diario: «' + capped.error + '»');
  // Ancho: nada se sale
  const over = await T.pop.evaluate(() => { const box = document.querySelector('.ap').getBoundingClientRect(); return [...document.querySelectorAll('.ap *')].filter((e) => e.getBoundingClientRect().right > box.right + 1).map((e) => `${e.tagName}.${e.getAttribute('class')} ${Math.round(e.getBoundingClientRect().right)}>${Math.round(box.right)}`).slice(0, 3); });
  ok(!over.length && (await T.pop.evaluate(() => document.querySelector('.views').scrollWidth <= document.querySelector('.views').clientWidth)), 'Sin desbordes horizontales ' + over.join(','));
  // Jupiter pide clave → respaldo GeckoTerminal y aviso
  T.st.jupDown = true;
  const res = await T.send({ type: 'resolve', address: B });
  const rq = res.data?.quote;
  ok(res.ok && rq?.symbol === 'NEWB' && rq?.source === 'geckoterminal', `Token que DexScreener aún no tiene y Jupiter pide clave: sale por GeckoTerminal (${rq?.symbol}, ${rq?.source})`);
  const notice = (await T.pop.evaluate(() => chrome.storage.local.get('blankfireNotice'))).blankfireNotice || {};
  ok(notice.jupiterNeedsKey === true, 'Jupiter sin clave caído → aviso para pedir clave');
  await T.pop.locator('[data-tab="wallet"]').click(); await T.pop.waitForTimeout(400);
  ok(await T.pop.locator('.svc-note').count() === 1, 'La cartera enseña el aviso de Jupiter con botón para añadir clave');
  await T.send({ type: 'saveKeys', jupiter: 'jup-test-key-123' });
  await T.pop.waitForTimeout(500);
  ok(await T.pop.locator('.svc-note').count() === 0, 'Con clave de Jupiter, el aviso desaparece');
  ok(!T.errs.length, 'Sin errores de JavaScript en la ventana ' + T.errs.join(' | '));
  await T.ctx.close();
}

// ===================== 2 · Inglés =====================
{
  const T = await launch(EXT_AI, { lang: 'en' });
  const { round } = await makeTrade(T);
  await T.pop.reload(); await T.pop.waitForTimeout(700);
  await T.pop.locator('[data-tab="history"]').click(); await T.pop.locator('.row[data-row]').first().click();
  await T.pop.waitForSelector('.ap .ap-chart', { timeout: 8000 });
  await T.pop.locator('[data-act="aiRun"]').click();
  await T.pop.waitForSelector('.ai-box .ai-score', { timeout: 10000 });
  const txt = await T.pop.locator('.ap').innerText();
  const spanish = txt.match(/\b(después|Vendiste|Máximo|Mínimo|errores|Análisis|lección|precio|trade de|Errores)\b/gi);
  ok(/What happened next/.test(txt) && /You sold too early/.test(txt) && /Decent entry/.test(txt) && !spanish, 'EN: sección y análisis en inglés ' + (spanish || []).join(','));
  ok((await T.send({ type: 'state' })).data.account.rounds[0].ai.lang === 'en', 'La IA responde en el idioma de la app');
  await T.pop.locator('[data-tab="settings"]').click(); await T.pop.waitForTimeout(300);
  const set = await T.pop.locator('.pro-form').innerText();
  ok(/Free beta/.test(set) && /18\+ only/.test(set) && !/Usa tu propia|Pégala|mayores/.test(set), 'EN: ajustes del Pro en inglés');
  await T.pop.locator('.ap, .pro-form').first().screenshot({ path: TDIR + 'vis30-en-settings.png' }).catch(() => {});
  void round;
  await T.ctx.close();
}

// ===================== 3 · Vendiendo: licencia de Lemon Squeezy =====================
{
  const EXT = makeExt({ checkoutUrl: 'https://blankfire.lemonsqueezy.com/buy/test', storeId: 77, productId: 99, aiUrl: AI_URL });
  const T = await launch(EXT, { serverEnv: { BLANKFIRE_STORE_ID: '77', BLANKFIRE_PRODUCT_ID: '99' } });
  const { round } = await makeTrade(T);
  const lock = await T.send({ type: 'afterData', id: round.id });
  ok(!lock.ok && /plan Pro/.test(lock.error), 'Sin licencia: el motor no da los datos Pro');
  await T.pop.reload(); await T.pop.waitForTimeout(700);
  ok(await T.pop.locator('#proBadge').isHidden(), 'Sin licencia: no sale la insignia Pro');
  await T.pop.locator('[data-tab="history"]').click(); await T.pop.locator('.row[data-row]').first().click(); await T.pop.waitForTimeout(400);
  ok(await T.pop.locator('.ap.locked').count() === 1 && T.st.gtCalls === 0, 'Historial: tarjeta bloqueada con «Desbloquear Pro», sin pedir datos');
  await T.pop.locator('.ap.locked').screenshot({ path: TDIR + 'vis30-locked.png' });
  await T.pop.locator('[data-act="goPro"]').click(); await T.pop.waitForTimeout(500);
  ok((await T.pop.locator('.pro-card a.btn').getAttribute('href')) === 'https://blankfire.lemonsqueezy.com/buy/test', 'Ajustes: botón «Comprar Pro» con tu enlace de pago');
  await T.pop.locator('.pro-form').screenshot({ path: TDIR + 'vis30-buy.png' });
  await T.pop.fill('#pro-key', 'mal');
  await T.pop.locator('[data-act="proOn"]').click(); await T.pop.waitForSelector('.key-msg.bad', { timeout: 6000 });
  ok(/formato/.test(await T.pop.locator('.key-msg').innerText()) && T.st.ls.length === 0, 'Clave con mal formato: avisa sin llamar a la tienda');
  await T.pop.fill('#pro-key', 'BAD0-BAD0-BAD0-BAD0');
  await T.pop.locator('[data-act="proOn"]').click(); await T.pop.waitForTimeout(800);
  ok(/No encuentro esa licencia/.test(await T.pop.locator('.key-msg').innerText()), 'Licencia inexistente: lo dice claro');
  await T.pop.fill('#pro-key', 'OTHR-OTHR-OTHR-OTHR');
  await T.pop.locator('[data-act="proOn"]').click(); await T.pop.waitForTimeout(800);
  ok(/otro producto/.test(await T.pop.locator('.key-msg').innerText()), 'Licencia de otra tienda de Lemon Squeezy: rechazada');
  await T.pop.fill('#pro-key', 'A1B2C3D4-E5F6-4A7B-8C9D-0123456789AB');
  await T.pop.locator('[data-act="proOn"]').click(); await T.pop.waitForTimeout(900);
  ok(/Pro está activo/.test(await T.pop.locator('.key-msg').innerText()) && /tester@example.com/.test(await T.pop.locator('.pro-card').innerText()), 'Licencia buena: activa y muestra el email');
  ok(!(await T.pop.locator('.pro-card').innerText()).includes('0123456789AB') && /A1B2…89AB/.test(await T.pop.locator('.pro-card').innerText()), 'La clave sale enmascarada');
  ok(await T.pop.locator('#proBadge').isVisible(), 'Insignia Pro en la cabecera');
  const stored = (await T.pop.evaluate(() => chrome.storage.local.get(['blankfirePro', 'fogueo'])));
  ok(stored.blankfirePro.instanceId === 'inst-1' && !JSON.stringify(stored.fogueo).includes('A1B2C3D4'), 'Licencia guardada aparte del estado del panel');
  const gt0 = T.st.gtCalls;
  const ad = await T.send({ type: 'afterData', id: round.id });
  ok(ad.ok && ad.data.series.length >= 1 && ad.data.source !== 'geckoterminal' && T.st.gtCalls === gt0, `Con licencia: los datos Pro salen del seguimiento propio, sin pedir velas a GeckoTerminal (sin licencia comercial) · ${ad.data?.series?.length} puntos`);
  const air = await T.send({ type: 'aiReview', id: round.id });
  ok(air.ok && T.st.aiCalls.at(-1).license === 'A1B2C3D4-E5F6-4A7B-8C9D-0123456789AB' && T.st.serverLs.at(-1) === 'A1B2C3D4-E5F6-4A7B-8C9D-0123456789AB', 'Con licencia: el servidor la comprueba en Lemon Squeezy antes de analizar');
  // Revalidación: la tienda la desactiva → se bloquea
  T.st.lsValid = false;
  const blocked = await T.send({ type: 'aiReview', id: round.id });
  ok(!blocked.ok && /no está activa/.test(blocked.error), 'Candado real: con la licencia anulada, el servidor no analiza aunque la extensión crea que sí');
  await T.pop.locator('[data-act="proRecheck"]').click(); await T.pop.waitForTimeout(900);
  const s2 = await T.send({ type: 'proStatus' });
  ok(!s2.data.unlocked && s2.data.status === 'disabled', 'Licencia desactivada en la tienda → Pro bloqueado al comprobar');
  T.st.lsValid = true;
  await T.pop.fill('#pro-key', 'A1B2C3D4-E5F6-4A7B-8C9D-0123456789AB');
  await T.pop.locator('[data-act="proOn"]').click(); await T.pop.waitForTimeout(900);
  await T.pop.locator('[data-act="proOff"]').click(); await T.pop.waitForTimeout(900);
  const s3 = await T.send({ type: 'proStatus' });
  ok(!s3.data.unlocked && T.st.ls.some((x) => x.path.endsWith('/deactivate')), 'Desactivar en este navegador libera la licencia en la tienda');
  ok(!T.errs.length, 'Sin errores de JavaScript ' + T.errs.join(' | '));
  await T.ctx.close();
}

copies.forEach((d) => fs.rmSync(d, { recursive: true, force: true }));
console.log(fails ? `\n${fails} FALLO(S)` : '\nTodo OK');
process.exit(fails ? 1 : 0);
