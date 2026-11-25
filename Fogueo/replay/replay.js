// Blankfire — Repetición: juega una operación vela a vela sin ver el futuro y luego prueba otras entradas.
import { tr, setLang, getLang, locale } from '../lib/i18n.js';
import { fmtSol, fmtPct, fmtPrice, fmtDuration, roundTripPct, DEFAULT_SETTINGS } from '../lib/core.js';
import { testEntry, entryMap, gameResult, indexAt, startIndex } from '../lib/replay.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const send = (msg) => new Promise((res) => chrome.runtime.sendMessage(msg, (r) => res(r || { ok: false, error: chrome.runtime.lastError?.message })));
const tone = (n) => (n > 0 ? 'up' : n < 0 ? 'down' : 'flat');
const SPEEDS = [1, 2, 5];

const S = {
  list: [], beta: true, data: null, loading: false, error: null,
  cur: 0, playing: false, speed: 1, timer: null,
  mode: 'play',            // 'play' (futuro oculto) | 'study' (todo a la vista: probar entradas)
  buyIdx: null, sellIdx: null,
  rules: { stopPct: 30, tpPct: 100 }, costPct: 0, test: null, hover: null, map: null,
};

// ---------- Datos ----------
async function loadList() {
  const r = await send({ type: 'replayList' });
  if (r.ok) { S.list = r.data.rounds; S.beta = r.data.beta; }
}
async function open(msg) {
  stop();
  S.loading = true; S.error = null; S.data = null; render();
  const r = await send({ type: 'replayData', ...msg });
  S.loading = false;
  if (!r.ok) { S.error = r.error; render(); return; }
  const d = r.data;
  if (d.candles.length < 10) { S.error = tr('No hay velas suficientes de esta moneda para repetirla.'); render(); return; }
  S.data = d;
  S.rules = { stopPct: d.settings.defaultSlPct || 30, tpPct: d.settings.defaultTpPct || 100 };
  const size = d.round?.investedSol || d.settings.quickBuys?.[1] || 0.25;
  S.costPct = roundTripPct(size, { ...DEFAULT_SETTINGS, ...d.settings }) ?? 0;
  S.cur = startIndex(d.candles, d.round);
  S.mode = 'play'; S.buyIdx = null; S.sellIdx = null; S.test = null; S.map = null;
  render();
}

// ---------- Reproducción ----------
function stop() { S.playing = false; clearInterval(S.timer); S.timer = null; }
function play() {
  if (!S.data || S.mode !== 'play') return;
  if (S.cur >= S.data.candles.length - 1) return;
  S.playing = true; clearInterval(S.timer);
  S.timer = setInterval(() => { step(); }, 1000 / S.speed);
  render();
}
function step() {
  if (!S.data) return;
  if (S.cur >= S.data.candles.length - 1) { stop(); finish(); return; }
  S.cur++;
  render();
}
function finish() {
  S.mode = 'study'; S.cur = S.data.candles.length - 1;
  if (S.buyIdx != null && S.sellIdx == null) S.sellIdx = S.cur;
  S.map = entryMap(S.data.candles, S.rules, S.costPct);
  render();
}

// ---------- Gráfico ----------
let W = 900;
const H = 380, PAD = { l: 8, r: 64, t: 14, b: 26 }, STRIP = 10;
function chart() {
  const d = S.data, cs = d.candles;
  const shown = S.mode === 'play' ? S.cur + 1 : cs.length;
  // Jugando: ventana que se desliza (las últimas 80 velas y una franja de futuro tapado).
  // Estudiando: todo. Así las velas no se aplastan al principio ni se adivina cuánto queda.
  const v0 = S.mode === 'play' ? Math.max(0, shown - 80) : 0;
  const span0 = shown - v0;
  const slots = S.mode === 'play' ? Math.max(24, span0 + Math.max(8, Math.round(span0 * 0.25))) : cs.length;
  // En la partida, el eje vertical sale solo de lo que ves: si no, la escala delataría el futuro.
  const vis = cs.slice(v0, shown);
  let lo = Math.min(...vis.map((c) => c[3])), hi = Math.max(...vis.map((c) => c[2]));
  if (S.test && S.mode === 'study') { lo = Math.min(lo, S.test.entry * (1 - S.rules.stopPct / 100)); hi = Math.max(hi, S.test.entry * (1 + S.rules.tpPct / 100)); }
  const span = hi - lo || hi * 0.1; lo -= span * 0.06; hi += span * 0.06;
  const n = cs.length, plotW = W - PAD.l - PAD.r, cw = plotW / slots;
  const x = (i) => PAD.l + (i - v0) * cw + cw / 2;
  const y = (p) => PAD.t + (1 - (p - lo) / (hi - lo)) * (H - PAD.t - PAD.b - STRIP - 6);
  const bodyW = Math.max(1, cw * 0.62);
  let svg = '';
  // Rejilla de precios
  for (let k = 0; k <= 4; k++) {
    const p = lo + ((hi - lo) * k) / 4, yy = y(p);
    svg += `<line class="grid-l" x1="${PAD.l}" x2="${W - PAD.r}" y1="${yy}" y2="${yy}"/><text class="ax" x="${W - PAD.r + 6}" y="${yy + 4}">${esc(fmtPrice(p))}</text>`;
  }
  // Velas
  for (let i = v0; i < shown; i++) {
    const [, o, h, l, c] = cs[i], up = c >= o;
    svg += `<g class="cd ${up ? 'u' : 'd'}"><line x1="${x(i)}" x2="${x(i)}" y1="${y(h)}" y2="${y(l)}"/><rect x="${x(i) - bodyW / 2}" y="${y(Math.max(o, c))}" width="${bodyW}" height="${Math.max(1, Math.abs(y(o) - y(c)))}"/></g>`;
  }
  // Futuro oculto
  if (S.mode === 'play' && shown < n) {
    const fx = PAD.l + (shown - v0) * cw;
    svg += `<rect class="fog" x="${fx}" y="${PAD.t}" width="${W - PAD.r - fx}" height="${H - PAD.t - PAD.b}"/><text class="fog-t" x="${(fx + W - PAD.r) / 2}" y="${H / 2}">${esc(tr('Futuro oculto'))}</text>`;
    svg += `<line class="now" x1="${fx}" x2="${fx}" y1="${PAD.t}" y2="${H - PAD.b}"/>`;
  }
  // Tus compras/ventas reales: solo cuando el tiempo de la partida ya ha pasado por ellas
  for (const f of d.round?.fills || []) {
    const i = indexAt(cs, f.t);
    if (i < v0 || i >= shown) continue;
    svg += `<g class="real ${f.side}"><circle cx="${x(i)}" cy="${y(f.price)}" r="5"/><text x="${x(i)}" y="${y(f.price) + (f.side === 'buy' ? 19 : -11)}">${esc(tr(f.side === 'buy' ? 'tu compra' : 'tu venta'))}</text></g>`;
  }
  // Tu partida
  const mark = (i, side) => `<g class="mine ${side}"><path d="${side === 'buy' ? `M${x(i) - 7},${y(cs[i][4]) + 16} l7,-11 l7,11 z` : `M${x(i) - 7},${y(cs[i][4]) - 16} l7,11 l7,-11 z`}"/></g>`;
  if (S.buyIdx != null && S.buyIdx >= v0 && S.buyIdx < shown) svg += mark(S.buyIdx, 'buy');
  if (S.sellIdx != null && S.sellIdx >= v0 && S.sellIdx < shown) svg += mark(S.sellIdx, 'sell');
  // Probar entrada aquí
  if (S.mode === 'study' && S.test) {
    const t = S.test, x1 = x(t.entryIdx), x2 = x(t.exitIdx);
    svg += `<rect class="zone ${t.netPct >= 0 ? 'win' : 'loss'}" x="${Math.min(x1, x2)}" y="${PAD.t}" width="${Math.max(2, Math.abs(x2 - x1))}" height="${H - PAD.t - PAD.b - STRIP - 6}"/>`;
    svg += `<line class="lvl stop" x1="${x1}" x2="${W - PAD.r}" y1="${y(t.entry * (1 - S.rules.stopPct / 100))}" y2="${y(t.entry * (1 - S.rules.stopPct / 100))}"/>`;
    svg += `<line class="lvl tp" x1="${x1}" x2="${W - PAD.r}" y1="${y(t.entry * (1 + S.rules.tpPct / 100))}" y2="${y(t.entry * (1 + S.rules.tpPct / 100))}"/>`;
    svg += `<line class="lvl en" x1="${x1}" x2="${W - PAD.r}" y1="${y(t.entry)}" y2="${y(t.entry)}"/>`;
    svg += `<circle class="t-in" cx="${x1}" cy="${y(t.entry)}" r="5"/><circle class="t-out ${tone(t.netPct)}" cx="${x2}" cy="${y(t.exit)}" r="5"/>`;
  }
  // Tira de colores: qué habría salido entrando en cada vela con tus reglas (solo al estudiar)
  if (S.mode === 'study' && S.map) {
    const sy = H - PAD.b - STRIP;
    S.map.forEach((v, i) => {
      if (v == null) return;
      const a = Math.min(1, Math.abs(v) / Math.max(10, S.rules.tpPct)) * 0.85 + 0.15;
      svg += `<rect class="hs ${v >= 0 ? 'w' : 'l'}" x="${PAD.l + i * cw}" y="${sy}" width="${Math.max(1, cw)}" height="${STRIP}" style="opacity:${a.toFixed(2)}"/>`;
    });
  }
  // Hover
  if (S.hover != null && S.mode === 'study') svg += `<line class="hover" x1="${x(S.hover)}" x2="${x(S.hover)}" y1="${PAD.t}" y2="${H - PAD.b}"/>`;
  // Tiempo
  const tl = (i) => new Date(cs[i][0] * 1000).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });
  // Etiquetas de hora separadas al menos 90 px
  const every = Math.max(1, Math.ceil(90 / cw));
  const ticks = [];
  for (let i = shown - 1; i >= v0; i -= every) ticks.push(i);
  svg += ticks.map((i) => `<text class="ax t" x="${x(i)}" y="${H - 6}">${tl(i)}</text>`).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(tr('Gráfico de velas de 1 minuto'))}" data-n="${slots}">${svg}</svg>`;
}

// ---------- Paneles ----------
function controls() {
  const cs = S.data.candles, last = S.cur >= cs.length - 1;
  if (S.mode === 'study') {
    return `<div class="ctlbar">
      <p class="study-h">${tr('Pulsa cualquier vela para probar a entrar ahí con tu stop y tu objetivo.')}</p>
      <button class="btn small" data-act="restart">${tr('Jugar otra vez')}</button>
    </div>`;
  }
  return `<div class="ctlbar" role="toolbar" aria-label="${esc(tr('Controles de la repetición'))}">
    <button class="btn play" data-act="${S.playing ? 'pause' : 'play'}" ${last ? 'disabled' : ''} aria-keyshortcuts="Space">${S.playing ? `<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="4" y="3" width="3" height="10" rx="1"/><rect x="9" y="3" width="3" height="10" rx="1"/></svg>${tr('Pausa')}` : `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3.5v9l7.5-4.5z"/></svg>${tr('Reproducir')}`}</button>
    <div class="seg" role="radiogroup" aria-label="${esc(tr('Velocidad'))}">${SPEEDS.map((v) => `<button role="radio" aria-checked="${S.speed === v}" data-act="speed" data-v="${v}">${v}x</button>`).join('')}</div>
    <button class="btn small" data-act="step" ${last ? 'disabled' : ''} aria-keyshortcuts="ArrowRight">${tr('+1 vela')}</button>
    <span class="grow"></span>
    ${S.buyIdx == null ? `<button class="btn buy" data-act="buy" aria-keyshortcuts="B">${tr('Comprar aquí')}</button>`
      : S.sellIdx == null ? `<button class="btn sell" data-act="sell" aria-keyshortcuts="S">${tr('Vender aquí')}</button>` : ''}
    <button class="btn small ghost" data-act="reveal">${tr('Ver el final')}</button>
  </div>`;
}

function livePnl() {
  if (S.buyIdx == null) return '';
  const end = S.sellIdx ?? S.cur;
  const g = gameResult(S.data.candles, S.buyIdx, end, S.costPct);
  if (!g) return '';
  return `<p class="live ${tone(g.netPct)}"><span>${tr(S.sellIdx == null ? 'Tu posición ahora' : 'Tu resultado')}</span><b class="num">${fmtPct(g.netPct, 1, { sign: true })}</b><small>${tr('precio {p} · comisiones −{c}', { p: fmtPct(g.pricePct, 1, { sign: true }), c: fmtPct(S.costPct, 1) })}</small></p>`;
}

function results() {
  const d = S.data, r = d.round;
  const parts = [];
  if (S.mode === 'study') {
    const g = S.buyIdx != null ? gameResult(d.candles, S.buyIdx, S.sellIdx ?? d.candles.length - 1, S.costPct) : null;
    const real = r && r.investedSol > 0 ? (r.pnlSol / r.investedSol) * 100 : null;
    parts.push(`<div class="cmp">
      <div><span>${tr('En la repetición')}</span><b class="num ${g ? tone(g.netPct) : ''}">${g ? fmtPct(g.netPct, 1, { sign: true }) : tr('no entraste')}</b></div>
      ${real != null ? `<div><span>${tr('En la operación real')}</span><b class="num ${tone(real)}">${fmtPct(real, 1, { sign: true })}</b></div>` : ''}
      ${S.map ? (() => { const best = S.map.reduce((b, v, i) => (v != null && (b == null || v > S.map[b]) ? i : b), null); return best != null ? `<div><span>${tr('La mejor entrada posible')}</span><b class="num up">${fmtPct(S.map[best], 1, { sign: true })}</b><button class="link" data-act="testAt" data-i="${best}">${tr('ver')}</button></div>` : ''; })() : ''}
    </div>`);
    if (S.test) {
      const t = S.test, why = { stop: tr('salta el stop'), tp: tr('llega al objetivo'), end: tr('sin tocar ni stop ni objetivo hasta el final') }[t.reason];
      parts.push(`<div class="test ${tone(t.netPct)}" aria-live="polite">
        <p><b>${tr('Entrando a las {h}', { h: new Date(d.candles[t.entryIdx][0] * 1000).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' }) })}</b>: ${why}, ${tr('en {n} velas', { n: t.bars })}.</p>
        <p class="big num">${fmtPct(t.netPct, 1, { sign: true })} <small>${tr('tras comisiones')}</small></p>
        <p class="muted">${tr('Precio {p} · lo máximo que llegó a subir: {m}', { p: fmtPct(t.pricePct, 1, { sign: true }), m: fmtPct(t.peakPct, 1, { sign: true }) })}</p>
      </div>`);
    }
  }
  return parts.join('');
}

function side() {
  const rows = S.list.slice(0, 25).map((r) => `<li><button class="pick ${S.data?.round?.id === r.id ? 'on' : ''}" data-act="pick" data-id="${esc(r.id)}">
      <span class="sym">${esc(r.symbol)}</span><span class="when">${new Date(r.openedAt).toLocaleDateString(locale(), { day: 'numeric', month: 'short' })} ${new Date(r.openedAt).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' })}</span><b class="num ${tone(r.pnlSol)}">${fmtSol(r.pnlSol, { sign: true })}</b></button></li>`).join('');
  return `<aside class="side">
    <section class="side-s">
      <h3>${tr('Tus operaciones')}</h3>
      ${rows ? `<ul class="picks">${rows}</ul>` : `<p class="empty sm">${tr('Cuando cierres operaciones de práctica, aparecerán aquí para repetirlas.')}</p>`}
    </section>
    ${S.beta ? `<form class="side-s mintf" data-form="mint">
      <h3>${tr('O cualquier moneda')}</h3>
      <label class="fld"><span class="fl">${tr('Dirección del token (Solana)')}</span><span class="fi"><input name="mint" autocomplete="off" spellcheck="false" placeholder="…pump"></span><small>${tr('Repite sus últimas 6 horas.')}</small></label>
      <button class="btn small" type="submit">${tr('Cargar')}</button>
    </form>` : ''}
    <form class="side-s limits" data-form="rules">
      <h3>${tr('Tus reglas para probar entradas')}</h3>
      <div class="row2">
        <label class="fld"><span class="fl">${tr('Stop')}</span><span class="fi"><input type="number" name="stopPct" min="1" max="95" value="${S.rules.stopPct}"><em>%</em></span></label>
        <label class="fld"><span class="fl">${tr('Objetivo')}</span><span class="fi"><input type="number" name="tpPct" min="1" max="2000" value="${S.rules.tpPct}"><em>%</em></span></label>
      </div>
      ${S.data ? `<p class="hint">${tr('Comisiones de entrar y salir con este tamaño: {c}.', { c: fmtPct(S.costPct, 1) })}</p>` : ''}
    </form>
    <p class="keys">${tr('Teclas: espacio reproduce o pausa, → una vela, B compra, S vende.')}</p>
  </aside>`;
}

function render() {
  const d = S.data;
  const head = `<header class="bar">
    <div class="id">
      <svg class="mark" viewBox="0 0 100 100" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="M57 5C61 25 79 38 79 62A29 29 0 0 1 21 62C21 47 28 38 36 31C37 39 41 43 45 45C43 31 49 17 57 5ZM50 48.5A13.5 13.5 0 0 1 50 75.5A13.5 13.5 0 0 1 50 48.5Z"/></svg>
      <div class="id-t">
        <div class="id-r"><h1>${tr('Repetición')}</h1>${d ? `<span class="status st-${S.mode === 'play' ? 'run' : 'pause'}"><i></i>${esc(d.symbol || '')} · ${tr(S.mode === 'play' ? 'futuro oculto' : 'estudio')}</span>` : ''}</div>
        <p class="paper">${tr('Vuelve a vivir una operación vela a vela sin saber qué viene. Al final, prueba en qué vela habría sido mejor entrar.')}</p>
      </div>
    </div>
    <div class="ctl"><button class="lang" data-act="lang" aria-label="${getLang() === 'en' ? 'Cambiar a español' : 'Switch to English'}">${getLang() === 'en' ? 'ES' : 'EN'}</button></div>
  </header>`;
  let main;
  if (S.loading) main = `<div class="empty big-e"><span class="spin" aria-hidden="true"></span>${tr('Cargando velas…')}</div>`;
  else if (S.error) main = `<div class="empty big-e err">${esc(S.error)}</div>`;
  else if (!d) main = `<div class="intro"><h2>${tr('Elige una operación')}</h2><p class="hint">${tr('Empieza unos minutos antes de tu compra, con el futuro tapado. Reprodúcela a 1x, 2x o 5x, compra y vende cuando lo harías ahora, y compara con lo que hiciste de verdad.')}</p></div>`;
  else {
    const cs = d.candles, c = cs[S.cur];
    main = `<section class="stage">
      <div class="meta"><span class="num">${new Date(c[0] * 1000).toLocaleString(locale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span><span class="num">${esc(fmtPrice(c[4]))}</span><span>${tr('vela {i} de {n}', { i: S.cur + 1, n: cs.length })}${d.aggregate > 1 ? ` · ${tr('velas de {m} min', { m: d.aggregate })}` : ''}</span>${d.source === 'blankfire' ? `<span class="muted">${tr('precios guardados por Blankfire')}</span>` : ''}</div>
      <div class="chart-w" data-ref="chart">${chart()}</div>
      ${S.mode === 'study' ? `<div class="legend" aria-hidden="true"><span><i class="lg w"></i>${tr('entrar ahí habría ganado')}</span><span><i class="lg l"></i>${tr('habría perdido')}</span></div>` : ''}
      ${livePnl()}
      ${controls()}
      ${results()}
    </section>`;
  }
  // El gráfico usa el ancho real de la columna: así las letras y las velas no se deforman.
  const col = $('.main-col');
  W = Math.max(420, Math.round(col?.clientWidth || Math.min(1240, innerWidth) - 480));
  $('#app').innerHTML = `${head}<main class="grid">${`<div class="main-col">${main}</div>`}${side()}</main>`;
}

// ---------- Eventos ----------
function idxFromEvent(e) {
  const svg = e.target.closest('svg.chart');
  if (!svg) return null;
  const r = svg.getBoundingClientRect(), n = Number(svg.dataset.n);
  const vx = ((e.clientX - r.left) / r.width) * W;
  const i = Math.floor((vx - PAD.l) / ((W - PAD.l - PAD.r) / n));
  return i >= 0 && i < n ? i : null;
}
function doTest(i) {
  if (i == null || !S.data) return;
  S.test = testEntry(S.data.candles, i, S.rules, S.costPct);
  render();
}
document.addEventListener('click', async (e) => {
  if (S.mode === 'study' && e.target.closest('svg.chart')) { doTest(idxFromEvent(e)); return; }
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const a = b.dataset.act;
  if (a === 'pick') return open({ id: b.dataset.id });
  if (a === 'play') return play();
  if (a === 'pause') { stop(); render(); return; }
  if (a === 'step') { stop(); step(); return; }
  if (a === 'speed') { S.speed = Number(b.dataset.v); if (S.playing) play(); else render(); return; }
  if (a === 'buy') { S.buyIdx = S.cur; render(); return; }
  if (a === 'sell') { S.sellIdx = S.cur; render(); return; }
  if (a === 'reveal') { stop(); finish(); return; }
  if (a === 'restart') { S.mode = 'play'; S.cur = startIndex(S.data.candles, S.data.round); S.buyIdx = S.sellIdx = null; S.test = null; S.map = null; render(); return; }
  if (a === 'testAt') return doTest(Number(b.dataset.i));
  if (a === 'lang') {
    const next = getLang() === 'en' ? 'es' : 'en';
    setLang(next); document.documentElement.lang = next;
    await send({ type: 'saveSettings', settings: { lang: next } });
    render();
  }
});
document.addEventListener('mousemove', (e) => {
  if (S.mode !== 'study') return;
  const i = e.target.closest?.('svg.chart') ? idxFromEvent(e) : null;
  if (i !== S.hover) { S.hover = i; const w = $('[data-ref="chart"]'); if (w) w.innerHTML = chart(); }
});
document.addEventListener('submit', (e) => {
  e.preventDefault();
  if (e.target.dataset.form === 'mint') { const m = e.target.mint.value.trim(); if (m) open({ mint: m }); }
  if (e.target.dataset.form === 'rules') applyRules(e.target);
});
function applyRules(form) {
  const sp = Math.min(95, Math.max(1, Number(form.stopPct.value) || 30)), tp = Math.min(2000, Math.max(1, Number(form.tpPct.value) || 100));
  S.rules = { stopPct: sp, tpPct: tp };
  if (S.data && S.mode === 'study') { S.map = entryMap(S.data.candles, S.rules, S.costPct); if (S.test) S.test = testEntry(S.data.candles, S.test.entryIdx, S.rules, S.costPct); }
  render();
}
document.addEventListener('change', (e) => { if (e.target.form?.dataset.form === 'rules') applyRules(e.target.form); });
document.addEventListener('keydown', (e) => {
  if (!S.data || S.mode !== 'play' || e.target.closest('input')) return;
  if (e.code === 'Space') { e.preventDefault(); S.playing ? (stop(), render()) : play(); }
  else if (e.key === 'ArrowRight') { e.preventDefault(); stop(); step(); }
  else if (e.key.toLowerCase() === 'b' && S.buyIdx == null) { S.buyIdx = S.cur; render(); }
  else if (e.key.toLowerCase() === 's' && S.buyIdx != null && S.sellIdx == null) { S.sellIdx = S.cur; render(); }
});

let rz = null;
addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { render(); render(); }, 150); });

(async () => {
  const st = await send({ type: 'state' });
  setLang(st.data?.settings?.lang); document.documentElement.lang = getLang();
  document.title = `Blankfire · ${tr('Repetición')}`;
  await loadList();
  const id = new URLSearchParams(location.search).get('id');
  if (id) await open({ id }); else render();
})();
