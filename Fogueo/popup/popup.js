import {
  DEFAULT_SETTINGS, REVIEW_TAGS, PRESETS, computeStats, positionPnl,
  fmtSol, fmtPct, fmtCompact, fmtNum, fmtDuration, fmtWhen, fmtPrice, tone, rangeModel, hueFor,
} from '../lib/core.js';
import { tr, setLang, getLang, locale } from '../lib/i18n.js';

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const parseNum = (v) => { const n = Number(String(v).replace(/\s/g, '').replace(',', '.')); return isFinite(n) ? n : NaN; };
const send = (msg) => new Promise((resolve) => chrome.runtime.sendMessage(msg, (r) => resolve(r || { ok: false, error: chrome.runtime.lastError?.message })));

const TR_ATTRS = ['placeholder', 'aria-label', 'title'];
function translateDom(root) {
  if (getLang() !== 'en' || !root) return;
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    const par = n.parentElement;
    if (!par || par.closest('textarea, script, style, .ptour-body')) continue;
    const raw = n.nodeValue, key = raw.trim();
    if (!key) continue;
    const t = tr(key);
    if (t !== key) n.nodeValue = raw.replace(key, t);
  }
  const els = root.querySelectorAll ? [root, ...root.querySelectorAll('[placeholder],[aria-label],[title]')] : [];
  els.forEach((el) => TR_ATTRS.forEach((a) => { const v = el.getAttribute?.(a); if (v) { const t = tr(v); if (t !== v) el.setAttribute(a, t); } }));
}
const tTime = (t, sec) => new Date(t).toLocaleTimeString(locale(), sec ? { hour: '2-digit', minute: '2-digit', second: '2-digit' } : { hour: '2-digit', minute: '2-digit' });
const tDay = (t) => new Date(t).toLocaleDateString(locale(), { day: 'numeric', month: 'short' });

const REASON = { tp: ['TP', 'tp'], sl: ['SL', 'sl'], trail: ['SL din.', 'sl'], initials: ['Inicial', 'ini'] };
const reasonBadge = (r) => (REASON[r] ? `<span class="badge ${REASON[r][1]}">${REASON[r][0]}</span>` : '');

const ICON = {
  mark: '<svg viewBox="0 0 100 100" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="M57 5C61 25 79 38 79 62A29 29 0 0 1 21 62C21 47 28 38 36 31C37 39 41 43 45 45C43 31 49 17 57 5ZM50 48.5A13.5 13.5 0 0 1 50 75.5A13.5 13.5 0 0 1 50 48.5Z"/></svg>',
  code: '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M5.5 4.5L2 8l3.5 3.5M10.5 4.5L14 8l-3.5 3.5M9 3l-2 10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  camera: '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2 5.6c0-.6.4-1 1-1h2l1-1.6h4l1 1.6h2c.6 0 1 .4 1 1V12c0 .6-.4 1-1 1H3c-.6 0-1-.4-1-1z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><circle cx="8" cy="8.7" r="2.3" stroke="currentColor" stroke-width="1.3"/></svg>',
  clock: '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.4"/><path d="M8 4.8V8l2.2 1.4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
  target: '<svg viewBox="0 0 22 22" fill="none" aria-hidden="true"><circle cx="11" cy="11" r="8" stroke="currentColor" stroke-width="1.6"/><path d="M11 1.5v4M11 16.5v4M1.5 11h4M16.5 11h4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  book: '<svg viewBox="0 0 22 22" fill="none" aria-hidden="true"><path d="M4 4.5A1.5 1.5 0 015.5 3H17v14H5.5A1.5 1.5 0 004 18.5v-14z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M4 18.5A1.5 1.5 0 005.5 20H17v-3" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
  bulb: '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M5.5 11.5h5M6.3 14h3.4M8 1.8a4.3 4.3 0 00-2.6 7.7c.5.4.8.9.8 1.5v.5h3.6V11c0-.6.3-1.1.8-1.5A4.3 4.3 0 008 1.8z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>',
};

// Los números ruedan hasta su nuevo valor (sin animación si el sistema pide menos movimiento).
const reducedMotion = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
function roll(el, to, render, ms = 700) {
  if (!el) return;
  const from = el.__v;
  el.__v = to;
  cancelAnimationFrame(el.__raf);
  if (from == null || !isFinite(from) || !isFinite(to) || Math.abs(from - to) < 1e-12 || reducedMotion()) { render(to); return; }
  const t0 = performance.now();
  const step = (now) => {
    const k = Math.min(1, (now - t0) / ms), e = 1 - Math.pow(1 - k, 4);
    render(from + (to - from) * e);
    if (k < 1) el.__raf = requestAnimationFrame(step);
  };
  el.__raf = requestAnimationFrame(step);
}
let sparkShown = false;

let st = null;
let quotes = {};
let solUsd = null;
let tab = 'wallet';
let histFilter = 'all';
let statsPeriod = 'all';
let openRow = null;
let confirmReset = false;
let touring = null;

function avatar(item) {
  const initial = esc((item.symbol || '?').slice(0, 1).toUpperCase());
  return `<span class="av" style="--h:${hueFor(item.symbol)}">${item.icon ? `<img alt="" src="${esc(item.icon)}" referrerpolicy="no-referrer" data-initial="${initial}">` : initial}</span>`;
}
function fixImages(scope) {
  scope.querySelectorAll('.av img').forEach((img) => img.addEventListener('error', () => { img.parentElement.textContent = img.dataset.initial; }, { once: true }));
}

// ---------- datos ----------

async function loadState() {
  const r = await send({ type: 'state' });
  if (r.ok) st = r.data;
}

async function loadQuotes(force) {
  const keys = Object.keys(st?.account.positions || {});
  const r = await send({ type: 'quotes', keys, force });
  if (r.ok) { quotes = r.data.quotes || {}; solUsd = r.data.solUsd; }
}

function totals() {
  const acc = st.account;
  let inPos = 0, openPnl = 0, priced = true;
  Object.entries(acc.positions).forEach(([k, p]) => {
    const pnl = positionPnl(p, quotes[k], solUsd);
    if (pnl) { inPos += pnl.value; openPnl += pnl.pnlSol; } else { inPos += p.costSol; priced = false; }
  });
  const equity = acc.balance + inPos;
  return { equity, inPos, openPnl, priced, delta: equity - acc.startBalance, deltaPct: ((equity - acc.startBalance) / acc.startBalance) * 100 };
}

// ---------- render ----------

function renderSummary() {
  const t = totals();
  roll($('#equity'), t.equity, (v) => { $('#equity').innerHTML = `${fmtSol(v, { digits: 3 })}<small>SOL</small>`; });
  $('#equityDelta').className = `delta num ${tone(t.delta)}`;
  $('#equityDelta').textContent = `${fmtSol(t.delta, { sign: true })} (${fmtPct(t.deltaPct, 1, { sign: true })})`;
  $('#equityDelta').title = 'Respecto al saldo inicial de esta cuenta';
  $('#free').textContent = fmtSol(st.account.balance);
  $('#inPos').textContent = fmtSol(t.inPos);
  const op = $('#openPnl');
  op.textContent = Object.keys(st.account.positions).length ? fmtSol(t.openPnl, { sign: true }) : '—';
  op.className = `num ${tone(t.openPnl)}`;
  renderSpark(t.equity);
  const days = Math.max(0, Math.floor((Date.now() - st.account.startedAt) / 86400000));
  // «Día N» de práctica; el detalle va en el título.
  $('#since').textContent = tr('Día {n}', { n: days + 1 });
  $('#since').title = days === 0 ? tr('Creada hoy') : tr(days === 1 ? 'Creada hace {n} día' : 'Creada hace {n} días', { n: days });
  translateDom($('.summary'));
}

function renderSpark(nowEquity) {
  const pts = [...(st.account.equity || []).map((p) => p.v), nowEquity].slice(-60);
  const el = $('#spark');
  if (pts.length < 3) { el.innerHTML = ''; return; }
  const W = 118, H = 38, base = st.account.startBalance;
  let min = Math.min(...pts, base), max = Math.max(...pts, base);
  if (max - min < 1e-9) { max += 0.1; min -= 0.1; }
  const x = (i) => (i / (pts.length - 1)) * (W - 4);
  const y = (v) => 3 + (1 - (v - min) / (max - min)) * (H - 6);
  const d = pts.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const t = tone(nowEquity - base);
  // La primera vez la línea se dibuja de izquierda a derecha.
  const reveal = !sparkShown; sparkShown = true;
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" class="${reveal ? 'reveal' : ''}"><line x1="0" x2="${W - 4}" y1="${y(base).toFixed(1)}" y2="${y(base).toFixed(1)}"/><path class="${t}" d="${d}"/><circle class="${t}" cx="${x(pts.length - 1).toFixed(1)}" cy="${y(nowEquity).toFixed(1)}" r="2.6"/></svg>`;
}

function miniRange(pnl, p) {
  const m = rangeModel(pnl?.pnlPct, p);
  if (!m) return '';
  const a = Math.min(m.x0, m.x) * 100, b = Math.max(m.x0, m.x) * 100;
  return `<span class="mini-range" role="img" aria-label="${m.x >= m.x0 ? 'Hacia el take profit' : 'Hacia el stop loss'}"><i class="${m.x >= m.x0 ? 'up' : 'down'}" style="clip-path:inset(0 ${(100 - b).toFixed(1)}% 0 ${a.toFixed(1)}%)"></i><b style="left:${(m.x0 * 100).toFixed(1)}%"></b></span>`;
}

function renderWallet() {
  const v = $('[data-view="wallet"]');
  const positions = Object.entries(st.account.positions).sort((a, b) => b[1].openedAt - a[1].openedAt);
  let html = '<h2>Posiciones abiertas</h2>';
  if (!positions.length) {
    html += `<div class="blank">${ICON.target}<strong>Sin posiciones abiertas</strong>Abre cualquier token en Padre y compra desde el panel de Blankfire.</div>`;
  } else {
    html += '<div class="rows">' + positions.map(([k, p]) => {
      const pnl = positionPnl(p, quotes[k], solUsd);
      const t = tone(pnl?.pnlSol);
      const tgt = [p.sl ? `<span class="badge sl">${p.sl.trailing ? tr('SL din.') : 'SL'} −${fmtNum(p.sl.pct, 0)}%</span>` : '', p.tp ? `<span class="badge tp">TP +${fmtNum(p.tp.pct, 0)}%</span>` : ''].join('');
      return `<a class="row" href="${esc(p.url || 'https://trade.padre.gg/')}" target="_blank" rel="noopener">
        ${avatar(p)}
        <span class="r-main"><span class="r-sym"><span>$${esc(p.symbol)}</span>${tgt}</span><span class="r-sub">${fmtSol(p.costSol)} → ${pnl ? fmtSol(pnl.value) : '…'} SOL · ${fmtWhen(p.openedAt)}</span></span>
        <span class="r-end"><span class="r-pnl num ${t}">${pnl ? fmtSol(pnl.pnlSol, { sign: true }) : '—'}</span><br><span class="r-pct num ${t}">${pnl ? fmtPct(pnl.pnlPct, 1, { sign: true }) : ''}</span></span>
        ${miniRange(pnl, p)}
      </a>`;
    }).join('') + '</div>';
  }
  const orders = st.account.orders || [];
  if (orders.length) {
    html += '<h2>Órdenes límite</h2><div class="orders">' + orders.map((o) => `<div class="order">${ICON.clock}<span><b>$${esc(o.symbol)}</b> · comprar <b class="num">${fmtSol(o.solIn)} SOL</b> si MC ≤ <b class="num">${fmtCompact(o.mc, '$')}</b><small>${fmtWhen(o.createdAt)}</small></span><button data-cancel="${esc(o.id)}">Cancelar</button></div>`).join('') + '</div>';
  }
  const fills = [...st.account.fills].reverse().slice(0, 10);
  if (fills.length) {
    html += '<h2>Actividad reciente</h2><div class="act">' + fills.map((f) => {
      if (f.failed) return `<div><span class="t">${tTime(f.t)}</span><span class="fail">${tr(f.side === 'buy' ? 'Compra fallida' : 'Venta fallida')} · $${esc(f.symbol)}</span><span class="num muted">−${fmtSol(f.priorityFee)}</span></div>`;
      const what = f.side === 'buy' ? `<span class="up">Compra</span>${f.via === 'limit' ? ' <span class="badge ini">Límite</span>' : ''}` : `<span class="down">Venta</span> ${reasonBadge(f.reason)}`;
      return `<div><span class="t">${tTime(f.t)}</span><span>${what} $${esc(f.symbol)} <span class="muted">${tr('a {mc}', { mc: fmtCompact(f.mc, '$') })}</span></span><span class="num">${f.side === 'buy' ? '−' : '+'}${fmtSol(f.sol)}</span></div>`;
    }).join('') + '</div>';
  }
  v.innerHTML = html;
  fixImages(v);
  translateDom(v);
}

function roundDetail(r) {
  const fills = (r.fills || []).map((f) => `<div><span><span class="${f.side}">${f.side === 'buy' ? 'Compra' : 'Venta'}</span> ${tr('a {mc}', { mc: fmtCompact(f.mc, '$') })} · ${tTime(f.t, true)}</span><b>${f.side === 'buy' ? '−' : '+'}${fmtSol(f.sol)} SOL</b></div>`).join('');
  const note = (field, label, ph) => `<label class="field"><span>${label} <em class="saved" data-saved="${field}">guardado</em></span><textarea data-note="${field}" data-id="${esc(r.id)}" placeholder="${ph}">${esc(r[field] || '')}</textarea></label>`;
  return `<div class="detail">
    <div class="kv">
      <div><span>Invertido</span><b>${fmtSol(r.investedSol)}</b></div>
      <div><span>Recuperado</span><b>${fmtSol(r.returnedSol)}</b></div>
      <div><span>Costes</span><b>${fmtSol(r.feesSol)}</b></div>
      <div><span>MC entrada</span><b>${fmtCompact(r.entryMcUsd, '$')}</b></div>
      <div><span>MC salida</span><b>${fmtCompact(r.exitMcUsd, '$')}</b></div>
      <div><span>Duración</span><b>${fmtDuration(r.closedAt - r.openedAt)}</b></div>
    </div>
    <div class="fills">${fills}</div>
    <div class="rv">
      <div class="rv-q"><span>¿Seguiste tu plan?</span><span class="yn">
        <button data-plan="yes" data-id="${esc(r.id)}" aria-pressed="${r.followedPlan === true}">Sí</button>
        <button data-plan="no" data-id="${esc(r.id)}" aria-pressed="${r.followedPlan === false}">No</button>
      </span></div>
      <div class="tags">${REVIEW_TAGS.map((tg) => `<button class="tag-chip" data-tag="${tg.id}" data-id="${esc(r.id)}" aria-pressed="${(r.tags || []).includes(tg.id)}">${tg.label}</button>`).join('')}</div>
    </div>
    ${note('entryNote', 'Por qué entré', 'Qué viste para comprar…')}
    ${note('exitNote', 'Por qué salí', 'Qué te hizo vender…')}
    ${note('lesson', 'Qué aprendo de este trade', 'Lo que harías distinto la próxima vez…')}
    ${r.url ? `<a class="link" href="${esc(r.url)}" target="_blank" rel="noopener">Abrir el token en Padre →</a>` : ''}
  </div>`;
}

function renderHistory() {
  const v = $('[data-view="history"]');
  const all = st.account.rounds;
  const list = all.filter((r) => histFilter === 'all' || (histFilter === 'win' ? r.pnlSol > 0 : r.pnlSol <= 0));
  let html = `<div class="bar">
    <div class="pills" role="group" aria-label="Filtrar">
      ${[['all', 'Todas'], ['win', 'Ganadoras'], ['loss', 'Perdedoras']].map(([k, l]) => `<button data-hf="${k}" aria-pressed="${histFilter === k}">${l}</button>`).join('')}
    </div>
    ${all.length ? '<button class="ghost" data-act="csv">Exportar CSV</button>' : ''}
  </div>`;
  if (!list.length) {
    html += `<div class="blank">${ICON.book}<strong>${all.length ? 'Nada con este filtro' : 'Aún no has cerrado ningún trade'}</strong>${all.length ? '' : 'Cuando vendas una posición entera aparecerá aquí, con tus notas y lo que aprendiste.'}</div>`;
  } else {
    html += '<div class="rows">' + list.map((r) => {
      const t = tone(r.pnlSol);
      const isOpen = openRow === r.id;
      return `<button class="row ${isOpen ? 'open' : ''}" data-row="${esc(r.id)}" aria-expanded="${isOpen}">
        ${avatar(r)}
        <span class="r-main"><span class="r-sym"><span>$${esc(r.symbol)}</span>${reasonBadge(r.reason)}${r.followedPlan === true ? '<span class="badge plan-y" title="Seguiste tu plan">plan ✓</span>' : r.followedPlan === false ? '<span class="badge plan-n" title="No seguiste tu plan">sin plan</span>' : ''}</span>
        <span class="r-sub">${fmtWhen(r.closedAt)} · ${fmtDuration(r.closedAt - r.openedAt)}</span></span>
        <span class="r-end"><span class="r-pnl num ${t}">${fmtSol(r.pnlSol, { sign: true })}</span><br><span class="r-pct num ${t}">${fmtPct(r.pnlPct, 1, { sign: true })}</span></span>
      </button>${isOpen ? roundDetail(r) : ''}`;
    }).join('') + '</div>';
  }
  v.innerHTML = html;
  fixImages(v);
  translateDom(v);
}

function equityChart(points, period) {
  const since = periodStart(period);
  let pts = points.filter((p) => p.t >= since);
  const before = points.filter((p) => p.t < since).pop();
  if (before) pts = [{ t: since, v: before.v }, ...pts];
  const t = totals();
  pts = [...pts, { t: Date.now(), v: t.equity }];
  if (pts.length < 2) return '';
  const W = 364, H = 132, pad = { t: 10, b: 18, l: 0, r: 0 };
  const vs = pts.map((p) => p.v);
  const base = pts[0].v;
  let min = Math.min(...vs, base), max = Math.max(...vs, base);
  if (max - min < 1e-9) { max += 0.5; min -= 0.5; }
  const span = max - min; min -= span * 0.08; max += span * 0.08;
  const t0 = pts[0].t, t1 = pts[pts.length - 1].t || t0 + 1;
  // Eje x por orden de operación (no por tiempo): los trades se concentran en ráfagas.
  const x = (i) => pad.l + (i / (pts.length - 1)) * (W - pad.l - pad.r);
  const y = (v) => pad.t + (1 - (v - min) / (max - min)) * (H - pad.t - pad.b);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join('');
  const last = pts[pts.length - 1];
  const dir = last.v >= base ? 'up' : 'down';
  const area = `${d}L${x(pts.length - 1).toFixed(1)},${H - pad.b}L${x(0)},${H - pad.b}Z`;
  void t1;
  return `<div class="chart" role="img" aria-label="${tr('Evolución del patrimonio: de {a} a {b} SOL', { a: fmtSol(base), b: fmtSol(last.v) })}">
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
      <defs>
        <linearGradient id="gUp" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="oklch(0.81 0.16 152)" stop-opacity=".14"/><stop offset="1" stop-color="oklch(0.81 0.16 152)" stop-opacity="0"/></linearGradient>
        <linearGradient id="gDown" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="oklch(0.71 0.18 24)" stop-opacity=".14"/><stop offset="1" stop-color="oklch(0.71 0.18 24)" stop-opacity="0"/></linearGradient>
      </defs>
      <line class="base" x1="0" x2="${W}" y1="${y(base).toFixed(1)}" y2="${y(base).toFixed(1)}" vector-effect="non-scaling-stroke"/>
      <path class="area ${dir}" d="${area}"/>
      <path class="line ${dir}" d="${d}" vector-effect="non-scaling-stroke"/>
    </svg>
    <span class="end ${dir}" style="left:${(x(pts.length - 1) / W * 100).toFixed(2)}%;top:${(y(last.v) / H * 100).toFixed(2)}%"></span>
  </div>
  <div class="chart-cap"><span>${fmtSol(base)} SOL · ${tDay(t0)}</span><span>${tr(pts.length - 2 === 1 ? '{n} movimiento' : '{n} movimientos', { n: pts.length - 2 })}</span><span class="${dir}">${tr('{v} SOL ahora', { v: fmtSol(last.v) })}</span></div>`;
}

function periodStart(p) {
  if (p === 'today') { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); }
  if (p === 'week') return Date.now() - 7 * 86400000;
  return 0;
}

function insight(s) {
  if (!s.count) return null;
  if (s.byPlan.yes.count >= 2 && s.byPlan.no.count >= 2 && s.byPlan.yes.net > s.byPlan.no.net)
    return tr('Siguiendo tu plan llevas {a} SOL; sin seguirlo, {b}. Ese hueco es lo que te cuesta operar por impulso.', { a: fmtSol(s.byPlan.yes.net, { sign: true }), b: fmtSol(s.byPlan.no.net, { sign: true }) });
  const worstTag = Object.values(s.byTag).filter((g) => g.count >= 2 && g.net < 0).sort((a, b) => a.net - b.net)[0];
  if (worstTag && s.count >= 5) return tr('Tus trades marcados como «{tag}» suman {v} SOL. Es tu fuga principal ahora mismo.', { tag: tr(worstTag.label), v: fmtSol(worstTag.net, { sign: true }) });
  if (s.count < 5) return tr(s.count === 1 ? 'Llevas {n} trade cerrado. Con menos de 20 las estadísticas aún engañan: sigue practicando con tamaños pequeños y apuntando el porqué de cada entrada.' : 'Llevas {n} trades cerrados. Con menos de 20 las estadísticas aún engañan: sigue practicando con tamaños pequeños y apuntando el porqué de cada entrada.', { n: s.count });
  if (s.avgWin != null && s.avgLoss != null && Math.abs(s.avgLoss) > s.avgWin * 1.2)
    return tr('Tu pérdida media ({l}) es mayor que tu ganancia media ({w}). Prueba a poner stop loss más cerca o a dejar correr más las ganadoras.', { l: fmtSol(s.avgLoss), w: fmtSol(s.avgWin) });
  const gains = s.netSol + s.feesSol;
  if (gains > 0 && s.feesSol > gains * 0.35)
    return tr('Los costes ({f} SOL) se han comido un {p} de lo que ganaste antes de comisiones. Operar menos veces, con más convicción, suele mejorar esto.', { f: fmtSol(s.feesSol), p: fmtPct((s.feesSol / gains) * 100, 0) });
  if (s.maxLossStreak >= 4) return tr('Has llegado a encadenar {n} pérdidas seguidas. En real, ahí es donde se suele "revenge tradear": decide antes cuántas pérdidas seguidas te hacen parar el día.', { n: s.maxLossStreak });
  if (s.winRate != null && s.winRate >= 55 && s.netSol > 0) return tr('Vas bien: {p} de acierto y resultado positivo. Revisa en el historial qué tenían en común tus mejores entradas.', { p: fmtPct(s.winRate, 0) });
  if (s.netSol < 0) return tr('El resultado neto es negativo. Antes de pasar a dinero real, intenta encadenar varias semanas en positivo con las mismas reglas.');
  return null;
}

function planBlock(s) {
  const y = s.byPlan.yes, n = s.byPlan.no;
  if (!s.reviewed) {
    return `<h2>Plan vs. impulso</h2><p class="hint">Cuando cierres un trade, responde «¿Seguiste tu plan?» y marca etiquetas. Aquí verás cuánto ganas siguiéndolo y cuánto pierdes cuando no.</p>`;
  }
  const col = (label, g) => `<div class="pv"><span>${label}</span><b class="num ${tone(g.net)}">${g.count ? fmtSol(g.net, { sign: true }) : '—'}</b><small>${g.count} ${g.count === 1 ? 'trade' : 'trades'}${g.winRate != null ? ` · ${tr('{p} acierto', { p: fmtPct(g.winRate, 0) })}` : ''}</small></div>`;
  const tags = Object.entries(s.byTag).sort((a, b) => a[1].net - b[1].net);
  return `<h2>Plan vs. impulso</h2>
    <div class="pvs">${col('Siguiendo el plan', y)}${col('Sin seguirlo', n)}</div>
    ${tags.length ? `<div class="tagstats">${tags.map(([, g]) => `<div><span class="tag-chip static">${esc(g.label)}</span><span class="muted">${g.count}×</span><b class="num ${tone(g.net)}">${fmtSol(g.net, { sign: true })}</b></div>`).join('')}</div>` : ''}`;
}

function renderStats() {
  const v = $('[data-view="stats"]');
  const s = computeStats(st.account.rounds, { since: periodStart(statsPeriod) });
  const tip = insight(s);
  const pf = s.profitFactor === Infinity ? '∞' : s.profitFactor == null ? '—' : fmtNum(s.profitFactor, 2);
  const wr = s.winRate;
  v.innerHTML = `
    <div class="bar">
      <div class="pills" role="group" aria-label="Periodo">
        ${[['today', 'Hoy'], ['week', '7 días'], ['all', 'Todo']].map(([k, l]) => `<button data-sp="${k}" aria-pressed="${statsPeriod === k}">${l}</button>`).join('')}
      </div>
      <span class="net ${tone(s.netSol)}">${s.count ? fmtSol(s.netSol, { sign: true }) + ' SOL' : ''}</span>
    </div>
    ${equityChart(st.account.equity, statsPeriod)}
    ${s.count ? `
      <h2>Acierto</h2>
      <div class="wr">
        <div class="wr-head"><b class="${wr >= 50 ? 'up' : 'down'}">${fmtPct(wr, 0)}</b><span>${s.wins} ${tr(s.wins === 1 ? 'ganadora' : 'ganadoras')} · ${s.losses} ${tr(s.losses === 1 ? 'perdedora' : 'perdedoras')}</span></div>
        <div class="wr-bar"><i class="w" style="width:${wr}%"></i><i class="l" style="flex:1"></i></div>
      </div>
      <dl class="ledger">
        <div><dt>Ganancia media</dt><dd class="up">${s.avgWin != null ? fmtSol(s.avgWin, { sign: true }) : '—'}</dd></div>
        <div><dt>Pérdida media</dt><dd class="down">${s.avgLoss != null ? fmtSol(s.avgLoss) : '—'}</dd></div>
        <div><dt>Profit factor</dt><dd>${pf}</dd></div>
        <div><dt>Duración media</dt><dd>${fmtDuration(s.avgHoldMs)}</dd></div>
        <div><dt>Mejor trade</dt><dd class="${tone(s.best?.pnlSol)}">${s.best ? fmtSol(s.best.pnlSol, { sign: true }) : '—'}</dd></div>
        <div><dt>Peor trade</dt><dd class="${tone(s.worst?.pnlSol)}">${s.worst ? fmtSol(s.worst.pnlSol, { sign: true }) : '—'}</dd></div>
        <div><dt>Racha perdedora</dt><dd>${s.maxLossStreak}</dd></div>
        <div><dt>Costes pagados</dt><dd>${fmtSol(s.feesSol)}</dd></div>
        <div class="wide"><dt>Cierres por TP / SL / SL din. / a mano</dt><dd>${s.byReason.tp || 0} / ${s.byReason.sl || 0} / ${s.byReason.trail || 0} / ${(s.byReason.manual || 0) + (s.byReason.initials || 0)}</dd></div>
      </dl>
      ${planBlock(s)}` : `<div class="blank" style="padding-top:18px">${ICON.target}<strong>Sin trades en este periodo</strong>Las estadísticas se calculan sobre posiciones cerradas.</div>`}
    ${tip ? `<div class="tip">${ICON.bulb}<p>${esc(tip)}</p></div>` : ''}`;
  translateDom(v);
}

function renderSettings() {
  const v = $('[data-view="settings"]');
  const s = { ...DEFAULT_SETTINGS, ...st.settings };
  const hidden = !!st.ui?.panel?.hidden;
  const row = (key, label, help, unit, val, dig = 3) => `<div class="f-row"><label for="s-${key}">${label}<small>${help}</small></label><span class="inp"><input id="s-${key}" data-set="${key}" inputmode="decimal" value="${fmtNum(val, dig)}"><span>${unit}</span></span></div>`;
  v.innerHTML = `
    <h2>Simulación</h2>
    <div class="form">
      ${row('feePct', 'Comisión de Padre', 'Por cada compra y venta. Padre cobra ~1%.', '%', s.feePct, 2)}
      <div class="switch"><span>Sumar la comisión del pool<small class="muted" style="display:block;font-size:11.5px">Aparte de Padre: ~1,25 % en la curva de pump.fun y ~0,3 % en pools como PumpSwap o Raydium</small></span><button role="switch" aria-checked="${s.poolFees !== false}" data-act="poolFees" aria-label="Sumar la comisión del pool"></button></div>
      ${row('priorityFee', 'Priority fee', 'Lo que pagas a la red por transacción, también si falla.', 'SOL', s.priorityFee, 4)}
      ${row('maxSlippagePct', 'Slippage máximo', 'Si el precio se movería más, la orden falla.', '%', s.maxSlippagePct, 1)}
      ${row('latencySlipPct', 'Retraso de ejecución', 'Empeora un poco el precio, como la latencia real.', '%', s.latencySlipPct, 2)}
      <div class="f-row" style="grid-template-columns:1fr"><label>Compra rápida en SOL<small>Teclas 1–4 en el panel.</small></label></div>
      <div class="quicks">${s.quickBuys.concat([null, null, null, null]).slice(0, 4).map((q, i) => `<span class="inp"><input data-quick="${i}" inputmode="decimal" value="${q != null ? fmtNum(q, 3) : ''}" aria-label="${tr('Compra rápida {n}', { n: i + 1 })}"></span>`).join('')}</div>
      <div class="f-row" style="grid-template-columns:1fr"><label>Compra rápida en % del saldo<small>Cuando el panel está en modo «% saldo».</small></label></div>
      <div class="quicks">${s.quickPcts.concat([null, null, null, null]).slice(0, 4).map((q, i) => `<span class="inp"><input data-qpct="${i}" inputmode="decimal" value="${q != null ? fmtNum(q, 1) : ''}" aria-label="${tr('Porcentaje rápido {n}', { n: i + 1 })}"><span>%</span></span>`).join('')}</div>
    </div>

    <h2>Ajustes recomendados</h2>
    <div class="presets">
      <p class="hint">El panel detecta si el token es un <b>nuevo par</b> (todavía en la bonding curve de pump.fun) o está <b>graduado</b> (ya en su propio pool) y te propone estos ajustes, con el porqué de cada uno.</p>
      <table class="ptable">
        <thead><tr><th></th><th class="p-new">${PRESETS.new.name}</th><th class="p-grad">${PRESETS.graduated.name}</th></tr></thead>
        <tbody>
          <tr><th>Tamaño</th><td>${PRESETS.new.sizePct} ${tr('% saldo')}</td><td>${PRESETS.graduated.sizePct} ${tr('% saldo')}</td></tr>
          <tr><th>Stop</th><td>−${PRESETS.new.slPct} %${PRESETS.new.trailing ? ' ' + tr('din.') : ''}</td><td>−${PRESETS.graduated.slPct} %${PRESETS.graduated.trailing ? ' ' + tr('din.') : ''}</td></tr>
          <tr><th>Take</th><td>+${PRESETS.new.tpPct} %</td><td>+${PRESETS.graduated.tpPct} %</td></tr>
          <tr><th>Slippage máx.</th><td>${PRESETS.new.maxSlippagePct} %</td><td>${PRESETS.graduated.maxSlippagePct} %</td></tr>
          <tr><th>Prioridad</th><td>${fmtSol(PRESETS.new.priorityFee)} SOL</td><td>${fmtSol(PRESETS.graduated.priorityFee)} SOL</td></tr>
        </tbody>
      </table>
      <div class="switch"><span>Aplicarlos automáticamente<small class="muted" style="display:block;font-size:11.5px">Al abrir cada token en Padre, según su tipo</small></span><button role="switch" aria-checked="${!!s.autoPreset}" data-act="autoPreset" aria-label="Aplicar ajustes recomendados automáticamente"></button></div>
    </div>

    <h2>Disciplina</h2>
    <div class="form">
      ${row('dailyLossLimit', 'Límite de pérdida diaria', 'Si hoy pierdes esto, el panel bloquea las compras hasta mañana. 0 = sin límite.', 'SOL', s.dailyLossLimit, 3)}
      <div class="switch"><span>Mostrar el panel en Padre<small class="muted" style="display:block;font-size:11.5px">También con Alt+Shift+F</small></span><button role="switch" aria-checked="${!hidden}" data-act="panel" aria-label="Mostrar el panel en Padre"></button></div>
    </div>

    <h2>Aprender a usar Blankfire</h2>
    <div class="form">
      <div class="switch"><span>Recorrido de esta ventana<small class="muted" style="display:block;font-size:11.5px">Cartera, historial, estadísticas y ajustes</small></span><button class="ghost" data-act="tour">Empezar</button></div>
      <div class="switch"><span>Recorrido del panel en Padre<small class="muted" style="display:block;font-size:11.5px">Con Padre abierto en la pestaña actual</small></span><button class="ghost" data-act="panelTour">Empezar</button></div>
      <div class="switch"><span>Ver otra vez la guía de inicio<small class="muted" style="display:block;font-size:11.5px">Aparece arriba del panel en Padre</small></span><button class="ghost" data-act="guide">Mostrar</button></div>
      <div class="btn-row"><button class="btn brand" data-act="save">Guardar ajustes</button><span class="status" id="saveStatus" role="status"></span></div>
    </div>

    <h2>Empezar de cero</h2>
    <div class="danger">
      <p>Cierra esta cuenta y abre una nueva. El historial actual se guarda abajo en «Cuentas anteriores»; las posiciones abiertas se descartan.</p>
      <div class="f-row"><label for="s-start">Saldo inicial nuevo</label><span class="inp"><input id="s-start" inputmode="decimal" value="${fmtNum(s.startBalance, 3)}"><span>SOL</span></span></div>
      <div class="btn-row">
        ${confirmReset
          ? '<button class="btn warn" data-act="resetYes">Sí, reiniciar</button><button class="btn plain" data-act="resetNo">Cancelar</button>'
          : '<button class="btn plain" data-act="reset">Reiniciar cuenta</button>'}
      </div>
    </div>

    ${st.archive?.length ? `<h2>Cuentas anteriores</h2><div class="arch">${st.archive.map((a) => {
      const d = a.endEquity - a.startBalance;
      return `<div><span>${tDay(a.startedAt)} – ${tDay(a.endedAt)} <span class="muted">· ${a.rounds.length} trades</span></span><span class="num ${tone(d)}">${fmtSol(d, { sign: true })} SOL</span><button class="x" data-del="${esc(a.id)}" aria-label="Borrar esta cuenta del archivo">borrar</button></div>`;
    }).join('')}</div>` : ''}

    <p class="about">Blankfire no toca tu wallet ni tu cuenta de Padre: solo lee precios públicos de DexScreener y Jupiter. Los resultados son una aproximación; en real, la ejecución puede ser peor en tokens muy nuevos o con poca liquidez.</p>
    <div class="credits">
      <span class="by">${ICON.mark}<span>${tr('Hecho por')} <b>Lucas Usamentiaga</b></span></span>
      <span class="links">
        <a href="https://github.com/lucasusamentiaga" target="_blank" rel="noopener" aria-label="GitHub · lucasusamentiaga">${ICON.code}<span>GitHub</span></a>
        <a href="https://www.instagram.com/lucasuazz_/" target="_blank" rel="noopener" aria-label="Instagram · @lucasuazz_">${ICON.camera}<span>@lucasuazz_</span></a>
      </span>
    </div>`;
  translateDom(v);
}

function render() {
  if (!st) return;
  renderSummary();
  ({ wallet: renderWallet, history: renderHistory, stats: renderStats, settings: renderSettings })[tab]();
}

function moveInk() {
  const b = $(`.tabs [data-tab="${tab}"]`);
  const ink = $('.tab-ink');
  ink.style.width = `${b.offsetWidth - 16}px`;
  ink.style.transform = `translateX(${b.offsetLeft + 8}px)`;
}

// Al entrar en una pestaña, sus listas y gráficas aparecen escalonadas (solo esa vez, no en cada refresco).
function enterView() {
  const v = $(`.view[data-view="${tab}"]`);
  if (!v) return;
  v.classList.remove('enter'); void v.offsetWidth; v.classList.add('enter');
  v.querySelectorAll('.rows > *, .act > div, .ledger > div').forEach((n, i) => n.style.setProperty('--i', Math.min(i, 12)));
  clearTimeout(enterView.t);
  enterView.t = setTimeout(() => v.classList.remove('enter'), 1200);
}

// ---------- eventos ----------

function setTab(name) {
  tab = name;
  confirmReset = false;
  document.querySelectorAll('.tabs [data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
  document.querySelectorAll('.view').forEach((v) => { v.hidden = v.dataset.view !== tab; });
  moveInk();
  render();
  enterView();
  $('.views').scrollTop = 0;
}

document.addEventListener('click', async (e) => {
  const t = e.target;
  if (touring) return; // durante el recorrido solo responde la tarjeta
  const tabBtn = t.closest('[data-tab]');
  if (tabBtn) { setTab(tabBtn.dataset.tab); return; }
  const hf = t.closest('[data-hf]'); if (hf) { histFilter = hf.dataset.hf; renderHistory(); return; }
  const sp = t.closest('[data-sp]'); if (sp) { statsPeriod = sp.dataset.sp; renderStats(); return; }
  const row = t.closest('[data-row]'); if (row) { openRow = openRow === row.dataset.row ? null : row.dataset.row; renderHistory(); return; }
  const del = t.closest('[data-del]'); if (del) { await send({ type: 'deleteArchive', id: del.dataset.del }); return; }
  const cancel = t.closest('[data-cancel]'); if (cancel) { await send({ type: 'cancelOrder', id: cancel.dataset.cancel }); return; }
  const plan = t.closest('[data-plan]');
  if (plan) {
    const r = st.account.rounds.find((x) => x.id === plan.dataset.id);
    const want = plan.dataset.plan === 'yes';
    await send({ type: 'review', id: plan.dataset.id, followedPlan: r?.followedPlan === want ? null : want });
    return;
  }
  const tagB = t.closest('[data-tag]');
  if (tagB) {
    const r = st.account.rounds.find((x) => x.id === tagB.dataset.id);
    const cur = r?.tags || [];
    const tags = cur.includes(tagB.dataset.tag) ? cur.filter((x) => x !== tagB.dataset.tag) : [...cur, tagB.dataset.tag];
    await send({ type: 'review', id: tagB.dataset.id, tags });
    return;
  }
  const act = t.closest('[data-act]')?.dataset.act;
  if (!act) return;
  if (act === 'csv') exportCsv();
  if (act === 'lang') { await switchLang(); return; }
  if (act === 'tour') { startTour(); return; }
  if (act === 'panelTour') {
    const [tb] = await chrome.tabs.query({ active: true, currentWindow: true });
    const btn = t.closest('[data-act]');
    try {
      await chrome.tabs.sendMessage(tb.id, { type: 'startTour' });
      window.close();
    } catch (err) {
      btn.textContent = tr('Abre Padre primero');
    }
    return;
  }
  if (act === 'panel') {
    const btn = t.closest('[data-act]');
    const show = btn.getAttribute('aria-checked') !== 'true';
    btn.setAttribute('aria-checked', String(show));
    await send({ type: 'savePanel', panel: { hidden: !show } });
  }
  if (act === 'save') saveSettings();
  if (act === 'poolFees') {
    const btn = t.closest('[data-act]');
    const on = btn.getAttribute('aria-checked') !== 'true';
    btn.setAttribute('aria-checked', String(on));
    await send({ type: 'saveSettings', settings: { poolFees: on } });
  }
  if (act === 'autoPreset') {
    const btn = t.closest('[data-act]');
    const on = btn.getAttribute('aria-checked') !== 'true';
    btn.setAttribute('aria-checked', String(on));
    await send({ type: 'saveSettings', settings: { autoPreset: on } });
  }
  if (act === 'guide') { await send({ type: 'saveUi', ui: { onboarded: false } }); t.closest('[data-act]').textContent = tr('Listo'); }
  if (act === 'reset') { confirmReset = true; renderSettings(); }
  if (act === 'resetNo') { confirmReset = false; renderSettings(); }
  if (act === 'resetYes') {
    const sb = parseNum($('#s-start').value);
    confirmReset = false;
    const r = await send({ type: 'reset', startBalance: sb > 0 ? sb : undefined });
    if (r.ok) { st = r.data; quotes = {}; render(); }
  }
});

async function saveSettings() {
  const settings = {};
  document.querySelectorAll('[data-set]').forEach((i) => { const n = parseNum(i.value); if (isFinite(n)) settings[i.dataset.set] = n; });
  settings.quickBuys = [...document.querySelectorAll('[data-quick]')].map((i) => parseNum(i.value)).filter((n) => n > 0);
  settings.quickPcts = [...document.querySelectorAll('[data-qpct]')].map((i) => parseNum(i.value)).filter((n) => n > 0 && n <= 100);
  const r = await send({ type: 'saveSettings', settings });
  const el = $('#saveStatus');
  if (r.ok) { el.style.color = ''; el.textContent = tr('Guardado. El panel de Padre ya usa estos valores.'); }
  else { el.style.color = 'var(--fx-down)'; el.textContent = r.error || tr('No se pudo guardar.'); }
}

// Notas: guardado automático al salir del campo.
document.addEventListener('focusout', async (e) => {
  const ta = e.target.closest?.('textarea[data-note]');
  if (!ta) return;
  const r = await send({ type: 'setNote', id: ta.dataset.id, field: ta.dataset.note, value: ta.value });
  if (r.ok) {
    const flag = ta.closest('.field')?.querySelector('.saved');
    if (flag) { flag.classList.add('show'); setTimeout(() => flag.classList.remove('show'), 1400); }
  }
});

function exportCsv() {
  const head = ['simbolo', 'token', 'abierto', 'cerrado', 'invertido_sol', 'recuperado_sol', 'pnl_sol', 'pnl_pct', 'costes_sol', 'mc_entrada', 'mc_salida', 'cierre', 'por_que_entre', 'por_que_sali', 'leccion', 'siguio_plan', 'etiquetas'];
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = st.account.rounds.map((r) => [r.symbol, r.address, new Date(r.openedAt).toISOString(), new Date(r.closedAt).toISOString(), r.investedSol, r.returnedSol, r.pnlSol, r.pnlPct, r.feesSol, r.entryMcUsd, r.exitMcUsd, r.reason, r.entryNote, r.exitNote, r.lesson, r.followedPlan == null ? '' : r.followedPlan ? 'si' : 'no', (r.tags || []).join(' ')].map(q).join(','));
  const blob = new Blob(['﻿' + [head.join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `blankfire-${tr('historial')}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.fogueo) return;
  if ((changes.fogueo.newValue?.settings?.lang || null) !== (st?.settings?.lang || null) && changes.fogueo.newValue?.settings?.lang) { location.reload(); return; }
  if (touring) { touring.realSt = changes.fogueo.newValue; return; }
  st = changes.fogueo.newValue;
  // No repintamos ajustes ni una nota abierta mientras se escribe.
  const typing = document.activeElement?.matches?.('input, textarea');
  renderSummary();
  if (!typing) render();
});

async function switchLang() {
  const next = getLang() === 'en' ? 'es' : 'en';
  await send({ type: 'saveSettings', settings: { lang: next } });
  location.reload();
}

function applyStaticLang() {
  document.documentElement.lang = getLang();
  const lb = $('.lang-btn');
  if (lb) {
    lb.textContent = getLang() === 'en' ? 'ES' : 'EN';
    lb.setAttribute('aria-label', getLang() === 'en' ? 'Cambiar a español' : 'Switch to English');
    lb.title = lb.getAttribute('aria-label');
  }
  translateDom(document.querySelector('.top'));
  translateDom(document.querySelector('.summary'));
  translateDom(document.querySelector('.tabs'));
}

(async () => {
  await loadState();
  setLang(st?.settings?.lang);
  if (st && !st.settings?.lang) { st.settings = { ...st.settings, lang: getLang() }; send({ type: 'saveSettings', settings: { lang: getLang() } }); }
  applyStaticLang();
  if (st) $('#equity').__v = st.account.startBalance;
  render();
  enterView();
  requestAnimationFrame(moveInk);
  document.fonts?.ready.then(moveInk);
  await loadQuotes(true);
  render();
  if (!st.ui?.popupToured) setTimeout(startTour, 350);
  setInterval(async () => {
    if (touring || !Object.keys(st?.account.positions || {}).length) return;
    await loadQuotes();
    const typing = document.activeElement?.matches?.('input, textarea');
    renderSummary();
    if (!typing && tab === 'wallet') renderWallet();
  }, 4000);
})();

void fmtPrice;

// =====================================================================
// Recorrido guiado del popup (con datos de ejemplo; tu cuenta no se toca)
// =====================================================================

function demoPopupState(real) {
  const now = Date.now();
  const H = 3600000;
  const round = (i, sym, inv, pnlPct, reason, plan, tags, hoursAgo, holdMin, extra = {}) => ({
    id: 'demo-r' + i, key: 'solana:' + sym, symbol: sym, name: sym, icon: null, url: null,
    openedAt: now - hoursAgo * H - holdMin * 60000, closedAt: now - hoursAgo * H,
    investedSol: inv, returnedSol: inv * (1 + pnlPct / 100), pnlSol: inv * pnlPct / 100, pnlPct,
    entryMcUsd: 42000, exitMcUsd: 42000 * (1 + pnlPct / 100), feesSol: inv * 0.022, reason, followedPlan: plan, tags,
    entryNote: '', exitNote: '', lesson: '', fills: [
      { side: 'buy', t: now - hoursAgo * H - holdMin * 60000, mc: 42000, sol: inv },
      { side: 'sell', t: now - hoursAgo * H, mc: 42000 * (1 + pnlPct / 100), sol: inv * (1 + pnlPct / 100) },
    ], ...extra,
  });
  const rounds = [
    round(1, 'GORILLA', 0.5, 38.4, 'tp', true, ['plan', 'volumen'], 1, 14, { entryNote: tr('Rompe 40K con volumen y dev sin vender.'), lesson: tr('Esperar a la confirmación funcionó.') }),
    round(2, 'PEPE2', 0.5, -31.2, 'sl', false, ['fomo', 'tarde'], 3, 6),
    round(3, 'NEKO', 0.25, 64.0, 'trail', true, ['narrativa'], 5, 40),
    round(4, 'MOON', 1, -18.5, 'manual', false, ['venganza', 'prisa'], 8, 3),
    round(5, 'CATDOG', 0.25, 12.1, 'manual', true, ['plan'], 26, 22),
    round(6, 'WIF2', 0.5, -9.4, 'sl', true, ['narrativa'], 50, 12),
  ];
  let eq = 10; const equity = [{ t: now - 60 * H, v: 10 }];
  [...rounds].reverse().forEach((r) => { eq += r.pnlSol; equity.push({ t: r.closedAt, v: eq }); });
  return {
    ...real,
    ui: { ...(real.ui || {}) },
    account: {
      ...real.account,
      startedAt: now - 3 * 86400000, startBalance: 10, balance: eq - 0.75,
      positions: {
        'solana:DEMO': { id: 'demo-p1', key: 'solana:DEMO', symbol: 'DEMO', icon: null, url: null, qty: 2.18e6, costSol: 0.5, investedSol: 0.5, avgEntryUsd: 0.0000412, openedAt: now - 9 * 60000, tp: { pct: 100 }, sl: { pct: 30, trailing: true }, peakPct: 32 },
        'solana:BONKY': { id: 'demo-p2', key: 'solana:BONKY', symbol: 'BONKY', icon: null, url: null, qty: 5e5, costSol: 0.25, investedSol: 0.25, avgEntryUsd: 0.000091, openedAt: now - 40 * 60000, tp: null, sl: { pct: 25 } },
      },
      orders: [{ id: 'demo-o', key: 'solana:DEMO', symbol: 'DEMO', mc: 38000, solIn: 0.25, createdAt: now - 5 * 60000 }],
      rounds, equity,
      fills: rounds.flatMap((r) => r.fills.map((f) => ({ ...f, symbol: r.symbol, reason: f.side === 'sell' ? r.reason : undefined }))).sort((a, b) => a.t - b.t),
    },
    archive: [{ id: 'demo-a', startedAt: now - 20 * 86400000, endedAt: now - 3 * 86400000, startBalance: 10, endEquity: 8.7, rounds: new Array(23).fill(0), equity: [] }],
  };
}

const POPUP_STEPS = [
  { title: 'Tu cuenta de práctica', body: 'Esta ventana es el cuartel general de Blankfire: tu dinero ficticio, todo lo que has hecho y lo que estás aprendiendo. Te lo enseño con datos de ejemplo; tu cuenta real no se toca.' },
  { target: '.sum-eq', title: 'Patrimonio', body: 'Tu SOL libre más lo que valen ahora tus posiciones. Al lado, cuánto has ganado o perdido desde que empezaste esta cuenta.' },
  { target: '#spark', title: 'Cómo va tu cuenta', body: 'La línea muestra la evolución de tu patrimonio; la raya punteada es tu saldo inicial. Por encima, vas ganando.' },
  { target: '.facts', title: 'Libre, en juego y abierto', body: '<b>Libre</b>: SOL disponible para comprar. <b>En juego</b>: lo que valen tus posiciones. <b>Abierto</b>: lo que ganarías o perderías si cerraras todo ahora.' },
  { tab: 'wallet', target: '.rows', title: 'Cartera', body: 'Tus posiciones abiertas con su resultado en vivo, su Stop y Take, y la barra que indica hacia cuál se acerca. Toca una para abrirla en Padre.' },
  { tab: 'wallet', target: '.orders', title: 'Órdenes límite', body: 'Las compras que has dejado programadas para cuando el market cap baje. Puedes cancelarlas desde aquí.' },
  { tab: 'wallet', target: '.act', title: 'Actividad reciente', body: 'Cada compra y venta, con el market cap al que entraste o saliste. Las etiquetas indican si saltó un TP, un SL, un stop dinámico o una orden límite.' },
  { tab: 'history', target: '.bar', title: 'Historial', body: 'Todos tus trades cerrados. Filtra ganadoras o perdedoras y expórtalos a <b>CSV</b> para analizarlos en Excel o Google Sheets.' },
  { tab: 'history', open: 'demo-r1', target: '.detail', title: 'Cada trade, al detalle', body: 'Toca un trade para ver lo que invertiste y recuperaste, costes, duración y cada compra y venta. Aquí respondes <b>¿seguiste tu plan?</b>, marcas etiquetas y apuntas qué aprendes. Se guarda solo.' },
  { tab: 'stats', target: '.chart', title: 'Estadísticas', body: 'Elige Hoy, 7 días o Todo. La gráfica es tu patrimonio operación a operación: así ves si mejoras o solo tuviste suerte un día.' },
  { tab: 'stats', target: '.wr', title: 'Acierto', body: 'Qué porcentaje de trades cierras en positivo. Ojo: se puede ganar dinero acertando menos de la mitad si las ganancias son más grandes que las pérdidas.' },
  { tab: 'stats', target: '.ledger', title: 'Los números que importan', body: '<b>Profit factor</b>: lo ganado entre lo perdido (por encima de 1,5 vas bien). Ganancia y pérdida media, duración, racha de pérdidas y lo que te han costado las comisiones.' },
  { tab: 'stats', target: '.pvs', title: 'Plan vs. impulso', body: 'Lo más revelador: cuánto ganas cuando sigues tu plan frente a cuando no. Debajo, lo que suma cada etiqueta, para que veas qué hábito te cuesta más dinero.' },
  { tab: 'stats', target: '.tip', title: 'Consejo automático', body: 'Blankfire lee tus números y te señala tu fuga principal: pérdidas demasiado grandes, exceso de comisiones, rachas o un hábito concreto.' },
  { tab: 'settings', target: '.form', title: 'Simulación realista', body: 'Comisión de Padre, priority fee, slippage máximo y retraso de ejecución. Déjalos como en real para que tus resultados sean creíbles. Aquí cambias también las compras rápidas.' },
  { tab: 'settings', target: '.presets', title: 'Ajustes recomendados', body: 'Blankfire distingue <b>nuevos pares</b> (en la curva de pump.fun) y <b>graduados</b> (ya en su pool), y propone tamaño, Stop, Take, slippage y prioridad para cada uno. Aquí los comparas y puedes hacer que se apliquen solos.' },
  { tab: 'settings', target: '[data-set="dailyLossLimit"]', targetUp: '.f-row', title: 'Disciplina', body: 'Pon un límite de pérdida diaria: al alcanzarlo, el panel bloquea las compras hasta mañana. Es la regla que más cuentas salva.' },
  { tab: 'settings', target: '.danger', title: 'Empezar de cero', body: 'Abre una cuenta nueva con el saldo que quieras. La anterior queda guardada en «Cuentas anteriores» para comparar tu progreso.' },
  { tab: 'settings', target: '[data-act="panelTour"]', targetUp: '.switch', title: '¡Ya lo sabes todo!', body: 'Desde aquí puedes repetir este recorrido o lanzar el del panel dentro de Padre, que enseña cómo comprar, vender, el stop dinámico y los atajos.', final: true },
];

// Capítulos y pasos de «Lo esencial» (índices de POPUP_STEPS).
const POPUP_CHAPTERS = ['Tu cuenta', 'Cartera', 'Historial', 'Estadísticas', 'Ajustes'];
[0, 0, 0, 0, 1, 1, 1, 2, 2, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4].forEach((c, i) => { POPUP_STEPS[i].ch = c; });
[0, 1, 3, 4, 7, 8, 9, 12, 15, 16, 18].forEach((i) => { POPUP_STEPS[i].core = true; });
POPUP_STEPS[0].choose = true;
POPUP_STEPS[0].hint = 'Si cierras la ventana a medias, la próxima vez puedes seguir donde lo dejaste.';

function startTour() {
  if (touring || !st) return;
  touring = {
    i: 0, realSt: st, steps: POPUP_STEPS, mode: null, resume: st.ui?.popupTourResume || null,
    saved: { tab, openRow, histFilter, statsPeriod, quotes, solUsd },
  };
  st = demoPopupState(st);
  quotes = {
    'solana:DEMO': { priceUsd: 0.0000523, marketCapUsd: 52300 },
    'solana:BONKY': { priceUsd: 0.000084, marketCapUsd: 84000 },
  };
  solUsd = 182.4;
  histFilter = 'all'; statsPeriod = 'all';
  const layer = document.createElement('div');
  layer.className = 'ptour';
  layer.innerHTML = `
    <div class="ptour-spot"></div>
    <div class="ptour-card" role="dialog" aria-modal="true" aria-labelledby="ptour-t">
      <div class="ptour-top"><span class="ptour-count"></span><button data-pt="end">${tr('Salir')}</button></div>
      <h3 id="ptour-t"></h3><p class="ptour-body"></p><p class="ptour-hint"></p>
      <div class="ptour-bar"><i></i></div>
      <div class="ptour-nav"></div>
    </div>`;
  document.body.appendChild(layer);
  touring.layer = layer;
  layer.addEventListener('click', (e) => {
    const a = e.target.closest('[data-pt]')?.dataset.pt;
    if (a === 'next') tourGo(touring.i + 1);
    if (a === 'prev') tourGo(touring.i - 1);
    if (a === 'end') endTour();
    if (a === 'core' || a === 'all') tourChoose(a);
    if (a === 'resume') tourChoose(touring.resume.mode, touring.resume.i);
  });
  touring.onKey = (e) => {
    if (e.key === 'ArrowRight' || e.key === 'Enter') {
      e.preventDefault();
      if (touring.steps[touring.i].choose && !touring.mode) tourChoose('core'); else tourGo(touring.i + 1);
    }
    if (e.key === 'ArrowLeft') { e.preventDefault(); tourGo(touring.i - 1); }
    if (e.key === 'Escape') { e.preventDefault(); endTour(); }
  };
  document.addEventListener('keydown', touring.onKey, true);
  tourGo(0);
}

function tourChoose(mode, at = 1) {
  touring.mode = mode;
  touring.steps = mode === 'core' ? POPUP_STEPS.filter((s) => s.core) : POPUP_STEPS;
  tourGo(Math.min(Math.max(1, at), touring.steps.length - 1));
}

function tourNav(step) {
  const nav = touring.layer.querySelector('.ptour-nav');
  nav.classList.toggle('choose', !!step.choose);
  if (step.choose) {
    const nCore = POPUP_STEPS.filter((s) => s.core).length - 1, nAll = POPUP_STEPS.length - 1;
    const r = touring.resume;
    nav.innerHTML = `
      <button class="ptour-next" data-pt="core"><span>${tr('Lo esencial')}</span><small>${tr('{n} pasos', { n: nCore })}</small></button>
      <button class="ptour-alt" data-pt="all"><span>${tr('Verlo todo')}</span><small>${tr('{n} pasos', { n: nAll })}</small></button>
      ${r && r.i > 1 ? `<button class="ptour-resume" data-pt="resume">${tr('Seguir donde lo dejé (paso {i})', { i: r.i })}</button>` : ''}`;
    return;
  }
  nav.innerHTML = `<button class="ptour-prev" data-pt="prev">${tr('Atrás')}</button><button class="ptour-next" data-pt="next">${tr(step.final ? 'Terminar' : 'Siguiente')}</button>`;
}

function tourGo(i) {
  if (i >= touring.steps.length) return endTour(true);
  if (i < 0) return;
  if (i === 0) { touring.mode = null; touring.steps = POPUP_STEPS; }
  touring.i = i;
  const step = touring.steps[i];
  // Guardamos por dónde vas: si cierras la ventana, la próxima vez puedes seguir.
  if (touring.mode && i > 1) { touring.resume = null; send({ type: 'saveUi', ui: { popupTourResume: { mode: touring.mode, i } } }); }
  openRow = step.open || null;
  setTab(step.tab || 'wallet');
  const L = touring.layer;
  const total = touring.mode ? touring.steps.length - 1 : null;
  L.querySelector('.ptour-count').innerHTML = !total || i === 0
    ? `<b>${tr('Recorrido guiado')}</b>`
    : `<b>${tr(POPUP_CHAPTERS[step.ch])}</b> · ${tr('{i} de {n}', { i, n: total })}`;
  L.querySelector('h3').textContent = tr(step.title);
  L.querySelector('.ptour-body').innerHTML = tr(step.body);
  const hint = L.querySelector('.ptour-hint');
  hint.textContent = step.hint ? tr(step.hint) : ''; hint.hidden = !step.hint;
  const bar = L.querySelector('.ptour-bar');
  bar.hidden = !total;
  if (total) bar.querySelector('i').style.transform = `scaleX(${i / total})`;
  tourNav(step);
  const card = L.querySelector('.ptour-card');
  card.classList.remove('swap'); void card.offsetWidth; card.classList.add('swap');
  requestAnimationFrame(() => requestAnimationFrame(tourPlace));
}

function tourPlace() {
  if (!touring) return;
  const step = touring.steps[touring.i];
  const L = touring.layer;
  const spot = L.querySelector('.ptour-spot');
  const card = L.querySelector('.ptour-card');
  let el = step.target ? document.querySelector(step.target) : null;
  if (el && step.targetUp) el = el.closest(step.targetUp) || el;
  const views = $('.views');
  if (el && views.contains(el)) {
    const vr = views.getBoundingClientRect(), er = el.getBoundingClientRect();
    const room = vr.height - 200;
    if (er.top < vr.top + 8 || er.bottom > vr.top + room) views.scrollTop += er.top - vr.top - 12;
  }
  const r = el?.getBoundingClientRect();
  const W = window.innerWidth, H = window.innerHeight;
  if (r && r.height) {
    const pad = 5;
    const h = Math.min(r.height + pad * 2, H * 0.55);
    spot.classList.remove('none');
    Object.assign(spot.style, { width: `${r.width + pad * 2}px`, height: `${h}px`, transform: `translate(${r.left - pad}px, ${r.top - pad}px)` });
    const ch = card.offsetHeight;
    const below = r.top - pad + h + 12;
    const y = below + ch <= H - 8 ? below : Math.max(8, r.top - pad - ch - 12);
    card.style.transform = `translate(12px, ${y}px)`;
    card.dataset.side = y > r.top ? 'below' : 'above';
    card.style.setProperty('--ax', `${Math.min(Math.max(24, r.left + r.width / 2 - 12), W - 48)}px`);
  } else {
    spot.classList.add('none');
    Object.assign(spot.style, { width: '0px', height: '0px', transform: `translate(${W / 2}px, ${H / 2}px)` });
    card.style.transform = `translate(12px, ${(H - card.offsetHeight) / 2}px)`;
    card.dataset.side = 'none';
  }
}

function endTour(finished) {
  const t = touring;
  document.removeEventListener('keydown', t.onKey, true);
  t.layer.remove();
  touring = null;
  st = t.realSt;
  ({ openRow, histFilter, statsPeriod, quotes, solUsd } = t.saved);
  setTab(finished ? 'wallet' : t.saved.tab);
  send({ type: 'saveUi', ui: finished ? { popupToured: true, popupTourResume: null } : { popupToured: true } });
}
