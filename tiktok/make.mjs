// Blankfire · vídeos de TikTok hechos en tu PC, gratis.
// 1) Graba la app (con datos de ejemplo, sin tocar tu cuenta) en vertical 1080x1920.
// 2) Pone encima el gancho, los textos y el cierre con la tipografía de Blankfire.
// 3) Monta el MP4 con ffmpeg (sin música: la eliges tú en TikTok al publicar, que es legal y da alcance).
//
// Uso:  node make.mjs --today            (los dos de hoy: ES y EN)
//       node make.mjs --idea=rug --lang=es
//       node make.mjs --all               (todas las ideas, para revisar)
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const EXT = path.join(ROOT, 'Fogueo');
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').split('=').slice(1).join('=') || d;
const has = (k) => process.argv.includes(`--${k}`);
const OUT = path.resolve(arg('out', path.join(HERE, 'cola')));
const W = 432, H = 768, DPR = 2.5;            // 1080x1920 de verdad, con la letra grande (como en el móvil)
const FPS = 30;
let FFMPEG = process.env.FFMPEG || 'ffmpeg';
try { const m = await import('ffmpeg-static'); if (m.default && fs.existsSync(m.default)) FFMPEG = m.default; } catch { /* se usa el del sistema */ }
const IDEAS = JSON.parse(fs.readFileSync(path.join(HERE, 'ideas.json'), 'utf8')).ideas;
const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);

// ---------- Datos de ejemplo (nunca tu cuenta ni dinero real) ----------
const SOL = 'So11111111111111111111111111111111111111112';
const NOW = Date.now();
const T = {
  GOOD: { sym: 'FROG', name: 'Moon Frog', px: 0.0005, liq: 80000, mc: 500000, h1: 40, m5: 4, b5: 80, s5: 30, v5: 30000, v1: 200000 },
  RUG: { sym: 'RUGME', name: 'Frog Cash', px: 0.0002, liq: 50000, mc: 300000, h1: 25, m5: 2, b5: 90, s5: 20, v5: 30000, v1: 200000 },
  BABY: { sym: 'BFROG', name: 'Baby Frog', px: 0.00009, liq: 30000, mc: 90000, h1: -8, m5: 1, b5: 30, s5: 25, v5: 8000, v1: 60000 },
  KING: { sym: 'KFROG', name: 'King Frog', px: 0.0002, liq: 40000, mc: 200000, h1: 12, m5: 3, b5: 50, s5: 20, v5: 12000, v1: 90000 },
  LATE: { sym: 'LATE', name: 'Late Train', px: 0.001, liq: 90000, mc: 900000, h1: 650, m5: 10, b5: 60, s5: 40, v5: 9000, v1: 90000 },
  TINY: { sym: 'TINY', name: 'Tiny Thing', px: 0.00001, liq: 2000, mc: 9000, h1: 10, m5: 1, b5: 10, s5: 10, v5: 100, v1: 1000 },
};
// Direcciones de ejemplo válidas en base58 (sin 0, O, I ni l), para que la app las acepte.
const SAFE = { GOOD: 'FRoGm', RUG: 'RuGme', BABY: 'BFRoG', KING: 'KFRoG', LATE: 'LATEt', TINY: 'TiNYt' };
const ADDR = Object.fromEntries(Object.keys(T).map((k) => [k, (SAFE[k] + 'x'.repeat(40)).slice(0, 40) + 'pump']));
const pairOf = (k) => { const t = T[k]; return {
  chainId: 'solana', dexId: 'pumpswap', pairAddress: 'P' + ADDR[k], pairCreatedAt: NOW - 3 * 3600e3,
  baseToken: { address: ADDR[k], name: t.name, symbol: t.sym }, quoteToken: { symbol: 'SOL' },
  priceUsd: String(t.px), liquidity: { usd: t.liq }, marketCap: t.mc, fdv: t.mc,
  volume: { m5: t.v5, h1: t.v1 }, txns: { m5: { buys: t.b5, sells: t.s5 }, h1: { buys: t.b5 * 5, sells: t.s5 * 5 } },
  priceChange: { m5: t.m5, h1: t.h1 }, info: { websites: [{ url: 'https://x' }], socials: [{ type: 'twitter', url: 'https://x' }] },
}; };
const candles = (rug) => Array.from({ length: 60 }, (_, i) => { const t = Math.floor(NOW / 1000) - (60 - i) * 60; const o = 1 + i * 0.006 + Math.sin(i / 3) * 0.01; const c = rug && i === 50 ? o * 0.35 : o * 1.006; return [t, o, Math.max(o, c) * 1.01, Math.min(o, c) * 0.99, c, 600 + ((i * 137) % 700) + (i > 54 ? 1500 : 0)]; });

async function mockNetwork(ctx) {
  await ctx.route('https://api.dexscreener.com/**', (route) => {
    const u = route.request().url();
    if (u.includes('/token-boosts/')) return route.fulfill({ json: ['GOOD', 'KING'].map((k) => ({ chainId: 'solana', tokenAddress: ADDR[k], amount: 100 })) });
    if (u.includes('/token-profiles/')) return route.fulfill({ json: ['RUG', 'BABY', 'LATE', 'TINY'].map((k) => ({ chainId: 'solana', tokenAddress: ADDR[k] })) });
    if (u.includes('/search')) return route.fulfill({ json: { pairs: [] } });
    if (u.includes(SOL)) return route.fulfill({ json: [{ chainId: 'solana', baseToken: { address: SOL, symbol: 'SOL' }, quoteToken: { symbol: 'USDC' }, priceUsd: '140', liquidity: { usd: 9e6 }, priceChange: { h1: 0.4 } }] });
    return route.fulfill({ json: Object.keys(T).filter((k) => u.includes(ADDR[k])).map(pairOf) });
  });
  await ctx.route('https://api.rugcheck.xyz/**', (r) => {
    const u = r.request().url();
    const bad = u.includes(ADDR.BABY);
    return r.fulfill({ json: bad ? { risks: [{ name: 'Freeze Authority still enabled', level: 'danger', value: '' }], score_normalised: 78, lpLockedPct: 0 } : { risks: [], score_normalised: 1, lpLockedPct: 100 } });
  });
  await ctx.route('https://api.geckoterminal.com/**', (route) => {
    const u = route.request().url();
    const k = Object.keys(T).find((x) => u.includes(ADDR[x]));
    if (u.includes('/pools?')) return route.fulfill({ json: { data: [{ attributes: { address: 'POOL' + (k || '') } }] } });
    if (u.includes('/trades')) return route.fulfill({ json: { data: Array.from({ length: 12 }, (_, i) => ({ attributes: { kind: i % 3 ? 'buy' : 'sell', volume_in_usd: String(300 + ((i * 977) % 4000)), tx_from_address: ['Wha1e', 'Dump', 'BoTz', 'Ape'][i % 4] + 'x'.repeat(39), block_timestamp: new Date(NOW - i * 70e3).toISOString() } })) } });
    return route.fulfill({ json: { data: { attributes: { ohlcv_list: candles(u.includes('POOLRUG')) } } } });
  });
  await ctx.route('https://lite-api.jup.ag/**', (r) => {
    const u = r.request().url();
    if (u.includes('/swap/v1/quote')) return r.fulfill({ json: { priceImpactPct: '0.004', routePlan: [{ swapInfo: { label: 'Pump.fun Amm' } }] } });
    return r.fulfill({ json: u.includes('/price/v3') ? {} : [] });
  });
  await ctx.route('https://trade.padre.gg/**', (r) => r.fulfill({ status: 204, body: '' }));
}

// ---------- Escenas: lo que se ve de la app ----------
const smooth = (page, y, ms = 1400) => page.evaluate(([y, ms]) => new Promise((res) => {
  const from = scrollY, t0 = performance.now(), ease = (t) => 1 - (1 - t) ** 4;
  const step = (now) => { const k = Math.min(1, (now - t0) / ms); scrollTo(0, from + (y - from) * ease(k)); k < 1 ? requestAnimationFrame(step) : res(); };
  requestAnimationFrame(step);
}), [y, ms]);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const SCENES = {
  // El bot decidiendo: registro, compra abierta con sus agentes y el repaso de sí / no.
  async bot(page, send) {
    await send({ type: 'botStart', config: { budgetSol: 2, pace: 'balanced', usePace: true } });
    await page.waitForFunction(() => document.querySelectorAll('.ev.k-buy').length > 0, null, { timeout: 30000 });
    await page.reload(); await page.waitForSelector('.ev.k-buy');
    await page.evaluate(() => scrollTo(0, 0));
    return async () => {
      const top = (sel) => page.evaluate((sel) => { const el = document.querySelector(sel); return el ? el.getBoundingClientRect().top + scrollY - 90 : null; }, sel);
      await wait(2600);
      await smooth(page, await top('.ev.k-buy'), 1200); await wait(500);
      await page.click('.ev.k-buy .ev-row'); await wait(1400);
      // Recorre los agentes en el orden en que hablan los textos: seguridad, dinero, indicadores, debate.
      for (const sel of ['.ev.k-buy .agent:nth-child(1)', '.ev.k-buy .agent:nth-child(2)', '.ev.k-buy .agent:nth-child(4)', '.ev.k-buy .agent:nth-child(5)', '.ev.k-buy .ag-checks']) {
        const y = await top(sel); if (y != null) { await smooth(page, y, 1300); await wait(1900); }
      }
      await wait(1500);
    };
  },
  // Lo que cuestan las comisiones según lo que metes, y los ritmos.
  async costs(page, send) {
    return async () => {
      await wait(2200);
      const inp = page.locator('input[name="budgetSol"][form="startForm"]');
      for (const v of ['0.05', '0.3', '2']) { await inp.fill(''); await inp.type(v, { delay: 120 }); await wait(1500); }
      await smooth(page, await page.evaluate(() => document.querySelector('.paces').getBoundingClientRect().top + scrollY - 140), 1400); await wait(600);
      for (const k of ['fast', 'calm', 'balanced']) { await page.locator(`.pace input[value="${k}"]`).check(); await wait(1500); }
      await smooth(page, await page.evaluate(() => document.querySelector('[data-ref="cost"]').getBoundingClientRect().top + scrollY - 260), 1600); await wait(3200);
    };
  },
  // El radar: temas que se repiten y su detalle.
  async radar(page, send) {
    await page.goto(page.url().replace(/bot\/bot\.html.*/, 'radar/radar.html'));
    await page.waitForSelector('.th-row', { timeout: 20000 });
    return async () => {
      await wait(2400);
      await page.locator('.th-row').first().click(); await wait(2200);
      await smooth(page, 200, 1600); await wait(1800);
      const w = page.locator('.coins [data-act="whales"]').first();
      if (await w.count()) { await w.click(); await page.waitForSelector('.flows', { timeout: 8000 }).catch(() => {}); await wait(800); await smooth(page, await page.evaluate(() => (document.querySelector('.flows, .tape, .whales') || document.body).getBoundingClientRect().top + scrollY - 120), 2200); }
      await wait(3600);
    };
  },
};

// ---------- Grabación (fotogramas JPEG con su instante, como hace Chrome al compartir pantalla) ----------
async function record(sceneName, lang, dir) {
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-tiktok-'));
  const ctx = await chromium.launchPersistentContext(prof, { headless: true, channel: 'chromium', viewport: { width: W, height: H }, deviceScaleFactor: DPR, locale: lang === 'en' ? 'en-US' : 'es-ES',
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, `--lang=${lang === 'en' ? 'en-US' : 'es-ES'}`] });
  try {
    await mockNetwork(ctx);
    let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent('serviceworker');
    const id = sw.url().split('/')[2];
    const page = await ctx.newPage();
    await page.goto(`chrome-extension://${id}/bot/bot.html`); await page.waitForTimeout(600);
    const send = (m) => page.evaluate((m) => new Promise((r) => chrome.runtime.sendMessage(m, r)), m);
    await send({ type: 'saveUi', ui: { popupToured: true, onboarded: true, panelToured: true } });
    await send({ type: 'saveSettings', settings: { lang } });
    await page.reload(); await page.waitForTimeout(900);
    // Sin barra de desplazamiento en el vídeo.
    await page.addStyleTag({ content: 'html{scrollbar-width:none}::-webkit-scrollbar{display:none}' });
    const play = await SCENES[sceneName](page, send);
    await page.addStyleTag({ content: 'html{scrollbar-width:none}::-webkit-scrollbar{display:none}' });
    const frames = [];
    const cdp = await ctx.newCDPSession(page);
    let t0 = 0, n = 0, on = false;
    cdp.on('Page.screencastFrame', ({ data, sessionId }) => {
      cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
      if (!on) return;
      const f = path.join(dir, `f${String(n++).padStart(5, '0')}.jpg`);
      fs.writeFileSync(f, Buffer.from(data, 'base64'));
      frames.push({ f, t: (Date.now() - t0) / 1000 });
    });
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 90, maxWidth: W * DPR, maxHeight: H * DPR, everyNthFrame: 1 });
    t0 = Date.now(); on = true;
    await play();
    on = false;
    const total = (Date.now() - t0) / 1000;
    await cdp.send('Page.stopScreencast').catch(() => {});
    return { frames, total };
  } finally {
    await ctx.close().catch(() => {});
    fs.rmSync(prof, { recursive: true, force: true });
  }
}

// ---------- Textos encima (PNG transparentes con la tipografía de Blankfire) ----------
const FONT = (f) => pathToFileURL(path.join(EXT, 'fonts', f)).href;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const CSS = `
@font-face { font-family: D; font-weight: 800; src: url(${FONT('outfit-800.woff2')}) format('woff2'); }
@font-face { font-family: B; font-weight: 600; src: url(${FONT('barlow-latin-600-normal.woff2')}) format('woff2'); }
html, body { margin: 0; background: transparent; width: 1080px; height: 1920px; overflow: hidden; }
.hook { position: absolute; left: 70px; right: 70px; top: 300px; padding: 44px 48px; border-radius: 28px; background: oklch(0.83 0.15 78); color: oklch(0.21 0.045 70);
  font: 800 76px/1.08 D; letter-spacing: -0.01em; text-wrap: balance; box-shadow: 0 6px 0 oklch(0.6 0.12 70); }
.beat { position: absolute; left: 60px; right: 60px; bottom: 360px; display: flex; justify-content: center; }
.beat span { padding: 26px 36px; border-radius: 22px; background: oklch(0.16 0.01 75 / 0.94); color: #fff; font: 800 62px/1.12 D; text-align: center; text-wrap: balance; outline: 3px solid oklch(0.83 0.15 78 / 0.9); }
.tag { position: absolute; bottom: 150px; left: 50%; transform: translateX(-50%); white-space: nowrap; padding: 12px 20px; border-radius: 999px; background: oklch(0.16 0.01 75 / 0.85); color: oklch(0.88 0.15 84); font: 600 30px B; }
.out { position: absolute; inset: 0; display: grid; place-content: center; gap: 34px; text-align: center; background: oklch(0.185 0.008 75); color: #fff; }
.out .mark { font: 800 120px/1 D; color: oklch(0.83 0.15 78); letter-spacing: -0.01em; }
.out p { margin: 0 90px; font: 800 64px/1.15 D; text-wrap: balance; }
.out small { font: 600 36px B; color: oklch(0.8 0.01 80); }
`;
async function renderCards(idea, lang, dir) {
  const v = idea[lang];
  const b = await chromium.launch({ headless: true });
  const page = await b.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  const shot = async (name, html) => {
    const f = path.join(dir, `${name}.html`);
    fs.writeFileSync(f, `<!doctype html><meta charset="utf-8"><style>${CSS}</style>${html}`);
    await page.goto(pathToFileURL(f).href); await page.evaluate(() => document.fonts.ready);
    const png = path.join(dir, `${name}.png`);
    await page.screenshot({ path: png, omitBackground: true });
    return png;
  };
  const cards = {
    hook: await shot('hook', `<div class="hook">${esc(v.hook)}</div>`),
    tag: await shot('tag', `<div class="tag">${esc(lang === 'en' ? 'Demo · example data' : 'Demo · datos de ejemplo')}</div>`),
    beats: [],
    out: await shot('out', `<div class="out"><div class="mark">Blankfire</div><p>${esc(v.cta)}</p><small>${esc(lang === 'en' ? 'Practice first. Real money later.' : 'Primero practica. El dinero real, después.')}</small></div>`),
  };
  for (let i = 0; i < v.beats.length; i++) cards.beats.push(await shot(`beat${i}`, `<div class="beat"><span>${esc(v.beats[i])}</span></div>`));
  await b.close();
  return cards;
}

// ---------- Montaje ----------
function compose({ frames, total }, cards, outFile, dir) {
  // Fotogramas con su duración real (la grabación no va a ritmo fijo).
  const list = path.join(dir, 'frames.txt');
  let txt = '';
  for (let i = 0; i < frames.length; i++) {
    const d = (frames[i + 1]?.t ?? total) - frames[i].t;
    txt += `file '${frames[i].f.replace(/\\/g, '/').replace(/'/g, "'\\''")}'\nduration ${Math.max(0.001, d).toFixed(3)}\n`;
  }
  txt += `file '${frames.at(-1).f.replace(/\\/g, '/').replace(/'/g, "'\\''")}'\n`;
  fs.writeFileSync(list, txt);
  const OUTRO = 2.6, HOOK = 3.2;
  const len = Math.max(12, total) + OUTRO;
  const beatStart = HOOK, beatEnd = len - OUTRO - 0.3;
  const per = (beatEnd - beatStart) / cards.beats.length;
  const inputs = ['-f', 'concat', '-safe', '0', '-i', list];
  const over = [];
  const add = (png, a, b, fade = 0.25) => { inputs.push('-loop', '1', '-t', String(len), '-i', png); over.push({ i: over.length + 1, a, b, fade }); };
  add(cards.tag, 0.3, len - OUTRO);
  add(cards.hook, 0, HOOK, 0.2);
  cards.beats.forEach((p, k) => add(p, beatStart + k * per + 0.15, beatStart + (k + 1) * per - 0.15));   // sin solaparse al cambiar de texto
  add(cards.out, len - OUTRO, len + 1, 0.3);
  inputs.push('-f', 'lavfi', '-t', String(len), '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100');
  let fc = `[0:v]fps=${FPS},scale=1080:1920:flags=lanczos,setsar=1,tpad=stop_mode=clone:stop_duration=${OUTRO + 1}[v0];`;
  let last = 'v0';
  for (const o of over) {
    fc += `[${o.i}:v]format=rgba,fade=t=in:st=${o.a.toFixed(2)}:d=${o.fade}:alpha=1,fade=t=out:st=${Math.max(o.a, o.b - o.fade).toFixed(2)}:d=${o.fade}:alpha=1[o${o.i}];`;
    fc += `[${last}][o${o.i}]overlay=0:0:enable='between(t,${o.a.toFixed(2)},${o.b.toFixed(2)})'[v${o.i}];`;
    last = `v${o.i}`;
  }
  fc = fc.replace(/;$/, '');
  const audioIdx = over.length + 1;
  execFileSync(FFMPEG, ['-y', '-loglevel', 'error', ...inputs, '-filter_complex', fc, '-map', `[${last}]`, '-map', `${audioIdx}:a`,
    '-t', len.toFixed(2), '-r', String(FPS), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-profile:v', 'high',
    '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', outFile], { stdio: 'inherit', windowsHide: true });
  return len;
}

async function makeOne(idea, lang) {
  const day = new Date().toISOString().slice(0, 10);
  const name = `${day}-${idea.id}-${lang}`;
  const work = fs.mkdtempSync(path.join(os.tmpdir(), `bf-${name}-`));
  try {
    log(`grabando «${idea.id}» (${lang}) …`);
    const rec = await record(idea.scene, lang, work);
    if (rec.frames.length < 30) throw new Error(`muy pocos fotogramas (${rec.frames.length})`);
    const cards = await renderCards(idea, lang, work);
    fs.mkdirSync(OUT, { recursive: true });
    const mp4 = path.join(OUT, `${name}.mp4`);
    const secs = compose(rec, cards, mp4, work);
    fs.writeFileSync(path.join(OUT, `${name}.txt`), `${idea[lang].desc}\n`);
    log(`listo: ${mp4} (${secs.toFixed(1)} s, ${(fs.statSync(mp4).size / 1e6).toFixed(1)} MB)`);
    return mp4;
  } finally { fs.rmSync(work, { recursive: true, force: true }); }
}

// La idea de cada día rota por la fecha (misma idea en ES y EN, con textos propios).
const dayIndex = Math.floor(Date.now() / 864e5);
let jobs = [];
if (has('all')) jobs = IDEAS.flatMap((i) => [[i, 'es'], [i, 'en']]);
else if (arg('idea')) jobs = [[IDEAS.find((i) => i.id === arg('idea')), arg('lang', 'es')]];
else { const i = IDEAS[dayIndex % IDEAS.length]; jobs = [[i, 'es'], [i, 'en']]; }
if (jobs.some(([i]) => !i)) { console.error('No existe esa idea. Mira ideas.json.'); process.exit(1); }
let bad = 0;
for (const [i, l] of jobs) { try { await makeOne(i, l); } catch (e) { bad++; console.error(`falló «${i.id}» (${l}): ${e.message}`); } }
// Copia a OneDrive (si lo tienes) para tenerlos en el móvil.
const od = process.env.OneDrive && path.join(process.env.OneDrive, 'Blankfire TikTok');
if (od && !has('no-onedrive')) { try { fs.mkdirSync(od, { recursive: true }); for (const f of fs.readdirSync(OUT)) if (f.startsWith(new Date().toISOString().slice(0, 10))) fs.copyFileSync(path.join(OUT, f), path.join(od, f)); } catch (e) { console.error('OneDrive:', e.message); } }
process.exit(bad ? 1 : 0);
