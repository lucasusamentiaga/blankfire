// Blankfire Pro — piezas de la ventana: «Qué pasó después», errores del trade, análisis con IA y ajustes del Pro.
import { tr } from '../lib/i18n.js';
import { fmtPct, fmtSol, fmtCompact } from '../lib/core.js';
import { maskKey, LEGAL } from '../lib/pro.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sgn = (n, d = 0) => fmtPct(n, d, { sign: true });
const mins = (m) => (m == null ? '' : m < 1 ? tr('al momento') : tr('a los {n} min', { n: m }));

const I = {
  spark: '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 1.8l1.5 4.1 4.2 1.6-4.2 1.6L8 13.2 6.5 9.1 2.3 7.5l4.2-1.6z" fill="currentColor"/><path d="M13 11.5l.6 1.5 1.4.5-1.4.6-.6 1.4-.5-1.4-1.5-.6 1.5-.5z" fill="currentColor" opacity=".7"/></svg>',
  lock: '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="1.6" stroke="currentColor" stroke-width="1.4"/><path d="M5.5 7V5.2a2.5 2.5 0 015 0V7" stroke="currentColor" stroke-width="1.4"/></svg>',
  check: '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3.5 8.4l2.9 2.9 6.1-6.6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  warn: '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 2.2l6.2 11H1.8z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M8 6.6v3.2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="8" cy="11.6" r=".9" fill="currentColor"/></svg>',
  key: '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="5.5" cy="10.5" r="3" stroke="currentColor" stroke-width="1.4"/><path d="M7.7 8.3L13.5 2.5M11 5l1.7 1.7M12.6 3.4l1.3 1.3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
};
export const PRO_ICON = I;

// ---------- Textos de los errores y aciertos calculados ----------
function flagText(f) {
  const v = f.vars || {};
  switch (f.id) {
    case 'fomo': return [tr('Entraste persiguiendo la subida'), tr('Había subido {pct} en {win} antes de tu compra. Comprar tras un pico así suele pillar el techo.', { pct: sgn(v.pct), win: v.win === 60 ? tr('la hora') : tr('los 15 min') })];
    case 'noStop': return [tr('Sin stop al entrar'), tr('Abriste sin stop loss: si el token se desploma, nada te saca a tiempo.')];
    case 'oversized': return [tr('Posición demasiado grande'), tr('Metiste el {pct} de tu patrimonio en un solo trade. Con memecoins, entre el 2 y el 10 % es lo razonable.', { pct: fmtPct(v.pct, 0) })];
    case 'soldEarly': return [tr('Vendiste demasiado pronto'), tr('Después de tu venta subió hasta {pct} {when}: aguantando habrías sacado hasta {sol} SOL más.', { pct: sgn(v.pct), when: mins(v.min), sol: fmtSol(v.sol) })];
    case 'stopTight': return [tr('Stop demasiado ajustado'), tr('Te sacó el stop y a los 15 min el precio ya había vuelto a tu entrada ({pct} sobre tu venta).', { pct: sgn(v.pct) })];
    case 'gaveBack': return [tr('Devolviste la ganancia'), tr('Llegaste a ir {peak} y cerraste en {pnl}. Un stop dinámico o vender una parte habría protegido lo ganado.', { peak: sgn(v.peak), pnl: sgn(v.pnl, 1) })];
    case 'fees': return [tr('Las comisiones se comieron el trade'), tr('Pagaste {sol} SOL en comisiones ({pct} de lo invertido) para un resultado pequeño.', { sol: fmtSol(v.sol), pct: fmtPct(v.pct, 1) })];
    case 'revenge': return [tr('Trade de venganza'), tr('Entraste {min} min después de cerrar otro en pérdidas. Tras perder, para unos minutos antes de volver a entrar.', { min: v.min })];
    case 'noPlan': return [tr('No seguiste tu plan'), tr('Lo marcaste tú: este trade se salió de lo que habías planeado.')];
    case 'heldLoser': return [tr('Aguantaste una pérdida enorme'), tr('Cerraste en {pnl} sin que saltara ningún stop. Corta antes: ninguna memecoin tiene que volver.', { pnl: sgn(v.pnl, 1) })];
    case 'goodExit': return [tr('Buena salida: después cayó {pct} y te ahorraste {sol} SOL', { pct: sgn(v.pct), sol: fmtSol(v.sol) })];
    case 'stopSaved': return [tr('El stop te protegió: a los 15 min estaba {pct} por debajo', { pct: sgn(v.pct) })];
    case 'plan': return [tr('Seguiste tu plan')];
    case 'hadStop': return [tr('Entraste con stop')];
    default: return [f.id];
  }
}

// ---------- Gráfica: 20 min antes de entrar → 60 min después de vender ----------
export function chartSvg(series, round, facts) {
  const pts = (series || []).filter((x) => x[1] > 0);
  if (pts.length < 2) return `<div class="ap-empty">${tr('Aún no hay suficientes precios para dibujar la gráfica.')}</div>`;
  const W = 352, H = 118, pad = { l: 4, r: 4, t: 14, b: 16 };
  const t0 = Math.min(pts[0][0], round.openedAt), t1 = Math.max(pts[pts.length - 1][0], round.closedAt + 60e3);
  const ys = pts.map((p) => Math.log(p[1]));
  let lo = Math.min(...ys), hi = Math.max(...ys);
  if (hi - lo < 0.02) { lo -= 0.01; hi += 0.01; }
  const x = (t) => pad.l + ((t - t0) / (t1 - t0)) * (W - pad.l - pad.r);
  const y = (p) => pad.t + (1 - (Math.log(p) - lo) / (hi - lo)) * (H - pad.t - pad.b);
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join('');
  const xIn = x(round.openedAt), xOut = x(round.closedAt);
  const exitP = facts.exitPrice;
  const yExit = exitP ? y(exitP) : null;
  const maxPt = facts.afterMaxPct != null && exitP ? pts.filter((p) => p[0] > round.closedAt).reduce((a, b) => (b[1] > a[1] ? b : a), [0, 0]) : null;
  const tone = facts.after60Pct ?? facts.afterMaxPct ?? 0;
  return `<svg class="ap-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(tr('Precio antes, durante y después del trade'))}">
    <defs><clipPath id="apc"><rect x="0" y="0" width="${W}" height="${H}"/></clipPath></defs>
    <rect class="ap-after" x="${xOut.toFixed(1)}" y="${pad.t - 6}" width="${(W - pad.r - xOut).toFixed(1)}" height="${H - pad.t - pad.b + 6}" rx="4"/>
    <rect class="ap-in" x="${xIn.toFixed(1)}" y="${pad.t - 6}" width="${Math.max(2, xOut - xIn).toFixed(1)}" height="${H - pad.t - pad.b + 6}" rx="3"/>
    ${yExit != null ? `<line class="ap-ref" x1="${xOut.toFixed(1)}" x2="${W - pad.r}" y1="${yExit.toFixed(1)}" y2="${yExit.toFixed(1)}"/>` : ''}
    <path class="ap-line ${tone >= 0 ? 'up' : 'down'}" d="${path}" clip-path="url(#apc)" pathLength="1"/>
    <line class="ap-mk" x1="${xIn.toFixed(1)}" x2="${xIn.toFixed(1)}" y1="${pad.t - 6}" y2="${H - pad.b}"/>
    <line class="ap-mk out" x1="${xOut.toFixed(1)}" x2="${xOut.toFixed(1)}" y1="${pad.t - 6}" y2="${H - pad.b}"/>
    <text class="ap-tx" x="${Math.max(xIn, 10).toFixed(1)}" y="${H - 3}" text-anchor="middle">${esc(tr('Compra'))}</text>
    <text class="ap-tx out" x="${Math.min(Math.max(xOut, xIn + 36), W - 22).toFixed(1)}" y="${H - 3}" text-anchor="middle">${esc(tr('Venta'))}</text>
    <text class="ap-tx" x="${(W - pad.r).toFixed(1)}" y="9" text-anchor="end">${esc(tr('+60 min'))}</text>
    ${maxPt && maxPt[1] > 0 && facts.afterMaxPct > 3 ? `<circle class="ap-dot up" cx="${x(maxPt[0]).toFixed(1)}" cy="${y(maxPt[1]).toFixed(1)}" r="3.5"/><text class="ap-lbl up" x="${Math.min(x(maxPt[0]), W - 30).toFixed(1)}" y="${Math.max(y(maxPt[1]) - 6, 10).toFixed(1)}" text-anchor="middle">${esc(sgn(facts.afterMaxPct))}</text>` : ''}
  </svg>`;
}

function factChips(f, round) {
  const chips = [];
  if (f.afterMaxPct != null && f.afterMaxPct > 0.5) chips.push(`<span class="ap-chip ${f.afterMaxPct > 0 ? 'up' : ''}"><small>${tr('Máximo después')}</small><b class="num">${sgn(f.afterMaxPct)}</b><em>${esc(mins(f.afterMaxMin))}</em></span>`);
  if (f.afterMinPct != null && f.afterMinPct < -0.5) chips.push(`<span class="ap-chip ${f.afterMinPct < 0 ? 'down' : ''}"><small>${tr('Mínimo después')}</small><b class="num">${sgn(f.afterMinPct)}</b><em>${esc(mins(f.afterMinMin))}</em></span>`);
  if (f.after60Pct != null) chips.push(`<span class="ap-chip ${f.after60Pct >= 0 ? 'up' : 'down'}"><small>${tr('A los 60 min')}</small><b class="num">${sgn(f.after60Pct)}</b></span>`);
  else if (f.after15Pct != null) chips.push(`<span class="ap-chip ${f.after15Pct >= 0 ? 'up' : 'down'}"><small>${tr('A los 15 min')}</small><b class="num">${sgn(f.after15Pct)}</b></span>`);
  if (f.prePumpPct != null && Math.abs(f.prePumpPct) >= 5) chips.push(`<span class="ap-chip ${f.prePumpPct >= 40 ? 'amber' : ''}"><small>${f.prePumpWin === 60 ? tr('1 h antes de entrar') : tr('15 min antes de entrar')}</small><b class="num">${sgn(f.prePumpPct)}</b></span>`);
  if (f.peakPct != null && f.peakPct > 0) chips.push(`<span class="ap-chip"><small>${tr('Tu máximo dentro')}</small><b class="num">${sgn(f.peakPct)}</b></span>`);
  let sum = '';
  if (f.missedSol > 0.0005 && f.afterMaxPct >= 15) sum = tr('Aguantando hasta el máximo habrías sacado hasta <b>{sol} SOL</b> más.', { sol: fmtSol(f.missedSol) });
  else if (f.avoidedSol > 0.0005 && f.afterMinPct <= -15) sum = tr('Vendiendo cuando vendiste te ahorraste hasta <b>{sol} SOL</b>.', { sol: fmtSol(f.avoidedSol) });
  void round;
  return `<div class="ap-chips">${chips.join('')}</div>${sum ? `<p class="ap-sum">${sum}</p>` : ''}`;
}

function coverLine(data, round) {
  const f = data.facts;
  const src = data.source === 'both' ? tr('GeckoTerminal y el seguimiento de Blankfire') : data.source === 'geckoterminal' ? 'GeckoTerminal' : data.source === 'blankfire' ? tr('el seguimiento de Blankfire') : '';
  const live = Date.now() - round.closedAt < 60 * 60e3;
  const parts = [];
  if (live) parts.push(tr('Seguimos el precio 60 min tras tu venta (llevamos {n} min).', { n: Math.round((Date.now() - round.closedAt) / 60e3) }));
  else if (f.coverMin < 50) parts.push(tr('Solo hay datos de {n} min tras tu venta.', { n: f.coverMin }));
  if (src && data.source === 'blankfire') parts.push(tr('Precios: {src}.', { src }));
  else if (src) parts.push(tr('Datos on-chain: {src}.', { src: src.replace('GeckoTerminal', '<a href="https://www.geckoterminal.com" target="_blank" rel="noopener">GeckoTerminal</a>') }));
  return parts.length ? `<p class="ap-note">${parts.join(' ')}</p>` : '';
}

// ---------- Bloque «Qué pasó después» dentro del detalle de un trade ----------
export function afterSection(round, s) {
  // s = { unlocked, selling, loading, error, data, aiLoading, aiError, aiReady }
  const head = `<div class="ap-h"><span class="ap-t">${I.spark}<span>${tr('Qué pasó después')}</span></span><span class="pro-tag">Pro</span></div>`;
  if (!s.unlocked) {
    return `<section class="ap locked">${head}
      <div class="ap-lock">${I.lock}<div><b>${tr('Mira qué hizo el precio después de vender y deja que la IA te diga tus errores.')}</b><span>${tr('Incluido en Blankfire Pro.')}</span></div></div>
      <button class="btn brand sm" data-act="goPro">${tr('Desbloquear Pro')}</button>
    </section>`;
  }
  if (s.loading && !s.data) return `<section class="ap">${head}<div class="ap-skel" aria-busy="true"><i></i><i></i><i></i></div></section>`;
  if (s.error && !s.data) return `<section class="ap">${head}<p class="ap-err">${esc(s.error)}</p><button class="ghost" data-act="afterRetry" data-id="${esc(round.id)}">${tr('Reintentar')}</button></section>`;
  const d = s.data;
  if (!d) return '';
  const fl = d.flags || { errors: [], wins: [] };
  const errs = fl.errors.map((f) => { const [t, x] = flagText(f); return `<li class="sev-${f.sev}"><i></i><div><b>${esc(t)}</b><span>${esc(x)}</span></div></li>`; }).join('');
  const wins = fl.wins.map((f) => `<li>${I.check}<span>${esc(flagText(f)[0])}</span></li>`).join('');
  return `<section class="ap">${head}
    ${chartSvg(d.series, round, d.facts)}
    ${factChips(d.facts, round)}
    ${coverLine(d, round)}
    ${errs || wins ? `<div class="ap-flags">
      ${errs ? `<p class="ap-sub">${tr('Errores detectados')}</p><ul class="ap-errs">${errs}</ul>` : `<p class="ap-none">${I.check}<span>${tr('Sin errores claros en las reglas básicas.')}</span></p>`}
      ${wins ? `<ul class="ap-wins">${wins}</ul>` : ''}
    </div>` : ''}
    ${aiBlock(round, s)}
  </section>`;
}

function aiBlock(round, s) {
  const ai = round.ai;
  if (s.aiLoading) return `<div class="ai-box loading" aria-busy="true"><div class="ai-h">${I.spark}<span>${tr('La IA está revisando tu trade…')}</span></div><div class="ap-skel"><i></i><i></i></div></div>`;
  if (!ai) {
    if (!s.aiReady) return s.support ? supportCard(s.support, 'ai') : `<div class="ai-cta soon"><div><b>${tr('Análisis con IA')}</b><span>${tr('Muy pronto: la IA revisará la entrada, el tamaño, el stop y la salida de cada trade.')}</span></div><span class="pro-tag">${tr('Pronto')}</span></div>`;
    return `<div class="ai-cta"><div><b>${tr('Análisis con IA')}</b><span>${tr('La IA revisa la entrada, el tamaño, el stop y la salida, y te da una lección concreta. Se envían los datos del trade y tus notas, nunca tu cartera.')}</span></div><button class="btn brand sm" data-act="aiRun" data-id="${esc(round.id)}">${I.spark}${tr('Analizar')}</button></div>${s.aiError ? `<p class="ap-err">${esc(s.aiError)}</p>` : ''}`;
  }
  const sc = ai.score;
  const tone = sc <= 4 ? 'down' : sc <= 6 ? 'amber' : 'up';
  const errs = (ai.errors || []).map((e) => `<li class="sev-${esc(e.severity)}"><i></i><div><b>${esc(e.title)}</b><span>${esc(e.detail)}</span></div></li>`).join('');
  const good = (ai.good || []).map((g) => `<li>${I.check}<span>${esc(g)}</span></li>`).join('');
  const ago = Math.max(0, Math.round((Date.now() - ai.at) / 60e3));
  return `<div class="ai-box">
    <div class="ai-top">
      <span class="ai-score ${tone}" style="--v:${sc / 10}" aria-label="${esc(tr('Nota de la ejecución: {n} de 10', { n: sc }))}"><b class="num">${sc}</b><small>/10</small></span>
      <div><span class="ai-k">${I.spark}${tr('Análisis con IA')}</span><p class="ai-verdict">${esc(ai.verdict)}</p></div>
    </div>
    ${ai.after ? `<p class="ai-after"><b>${tr('Después de vender')}</b> ${esc(ai.after)}</p>` : ''}
    ${errs ? `<ul class="ap-errs">${errs}</ul>` : ''}
    ${good ? `<ul class="ap-wins">${good}</ul>` : ''}
    ${ai.lesson ? `<div class="ai-lesson"><small>${tr('Para el próximo trade')}</small><p>${esc(ai.lesson)}</p></div>` : ''}
    <div class="ai-foot"><span>${esc(ai.model || 'Gemini')}${ai.cap ? ` · ${esc(tr('{n} de {c} hoy', { n: ai.used, c: ai.cap }))}` : ''} · ${ago < 1 ? tr('ahora') : ago < 90 ? tr('hace {n} min', { n: ago }) : tr('hace {n} h', { n: Math.round(ago / 60) })}${ai.coverMin < 50 ? ` · ${tr('con {n} min de datos tras vender', { n: ai.coverMin })}` : ''}</span><button class="link-btn" data-act="aiRun" data-id="${esc(round.id)}">${tr('Volver a analizar')}</button></div>
    ${s.aiError ? `<p class="ap-err">${esc(s.aiError)}</p>` : ''}
  </div>`;
}

// ---------- Barra de donaciones (Ko-fi): la meta que enciende la IA ----------
const COFFEE = '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2.5 6h9v3.2A3.8 3.8 0 0 1 7.7 13H6.3a3.8 3.8 0 0 1-3.8-3.8z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M11.5 7h.8a1.7 1.7 0 0 1 0 3.4h-1" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M5.5 2.5c-.4.7.4 1 0 1.8M8.5 2.5c-.4.7.4 1 0 1.8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>';
const euro = (n) => `${(Math.round(n * 100) / 100).toLocaleString(undefined, { maximumFractionDigits: n % 1 ? 2 : 0 })} €`;
export function supportCard(sp, where) {
  const known = typeof sp.raised === 'number';
  const pct = known ? Math.max(0, Math.min(100, (sp.raised / sp.goal) * 100)) : 0;
  const done = known && sp.raised >= sp.goal;
  return `<div class="sup ${where === 'ai' ? 'in-ai' : ''}">
    <div class="sup-h"><span class="sup-ic">${I.spark}</span><div><b>${done ? tr('¡Meta conseguida! La IA llega muy pronto') : tr('Ayuda a encender el análisis con IA')}</b>
      <span>${done ? tr('Gracias por apoyar Blankfire.') : tr('La IA cuesta dinero en cada análisis. Cuando las donaciones lleguen a {g}, se activa para todos.', { g: euro(sp.goal) })}</span></div></div>
    <div class="sup-bar" role="progressbar" aria-label="${esc(tr('Donaciones para activar la IA'))}" aria-valuemin="0" aria-valuemax="${sp.goal}" aria-valuenow="${known ? sp.raised : 0}"><i style="--p:${pct.toFixed(1)}%"></i></div>
    <div class="sup-f"><span class="num">${known ? `<b>${euro(sp.raised)}</b> ${tr('de')} ${euro(sp.goal)}` : tr('Meta: {g}', { g: euro(sp.goal) })}${sp.supporters ? ` · ${sp.supporters === 1 ? tr('1 apoyo') : tr('{n} apoyos', { n: sp.supporters })}` : ''}</span>
      <a class="btn brand sm" href="${esc(sp.url)}" target="_blank" rel="noopener">${COFFEE}${tr('Apoyar en Ko-fi')}</a></div>
  </div>`;
}

// ---------- Ajustes · Blankfire Pro ----------
export function proSettings(pro, keys, notice, ui) {
  // pro = proInfo del motor; keys = { jupiter: bool, ai: bool }; ui = { msg, busy }
  const st = !pro ? 'loading' : !pro.selling ? 'beta' : pro.unlocked ? 'active' : pro.status === 'active' ? 'stale' : pro.status && pro.status !== 'none' ? pro.status : 'free';
  const feats = [tr('Qué pasó con el precio después de vender'), tr('Errores del trade detectados al momento'), keys.ai ? tr('Análisis con IA y una lección por trade') : tr('Análisis con IA y una lección por trade (muy pronto)')];
  const legal = `<p class="legal">${tr('Solo para mayores de 18 años. Es una herramienta de práctica: nada de esto es asesoramiento financiero.')} <a href="${LEGAL.terms}" target="_blank" rel="noopener">${tr('Términos')}</a> · <a href="${LEGAL.privacy}" target="_blank" rel="noopener">${tr('Privacidad')}</a></p>`;
  let card;
  if (st === 'beta') {
    card = `<div class="pro-card beta"><div class="pro-h"><span class="pro-tag">Pro</span><b>${tr('Beta gratis')}</b></div><p>${tr('Todo el Pro funciona gratis mientras está en beta.')}</p><ul>${feats.map((x) => `<li>${I.check}${x}</li>`).join('')}</ul></div>`;
  } else if (st === 'active' || st === 'stale') {
    card = `<div class="pro-card on"><div class="pro-h"><span class="pro-tag">Pro</span><b>${st === 'active' ? tr('Activo en este navegador') : tr('Hace tiempo que no se comprueba')}</b></div>
      <p>${pro.email ? esc(pro.email) + ' · ' : ''}${tr('Licencia')} ${esc(maskKey(pro.keyHint || ''))}</p>
      ${st === 'stale' ? `<p class="warn">${tr('Conéctate a internet para volver a comprobar la licencia.')}</p>` : ''}
      <div class="btn-row"><button class="ghost" data-act="proRecheck">${tr('Comprobar ahora')}</button><button class="ghost" data-act="proOff">${tr('Desactivar en este navegador')}</button></div></div>`;
  } else {
    const why = st === 'expired' ? tr('Tu licencia ha caducado.') : st === 'disabled' ? tr('Tu licencia está desactivada.') : st === 'invalid' ? tr('La licencia ya no es válida.') : '';
    card = `<div class="pro-card"><div class="pro-h"><span class="pro-tag">Pro</span><b>${tr('Desbloquea Blankfire Pro')}</b></div>
      ${why ? `<p class="warn">${why}</p>` : ''}
      <ul>${feats.map((x) => `<li>${I.check}${x}</li>`).join('')}</ul>
      <div class="btn-row"><a class="btn brand" href="${esc(pro.checkoutUrl)}" target="_blank" rel="noopener">${tr('Comprar Pro')}</a></div>
      <p class="hint">${tr('El pago, las facturas y el IVA los gestiona Lemon Squeezy.')}</p>
      <label class="field"><span>${tr('¿Ya lo compraste? Pega la clave de licencia del email')}</span>
        <span class="key-row"><span class="inp key">${I.key}<input id="pro-key" autocomplete="off" spellcheck="false" placeholder="${esc(tr('Clave de licencia'))}"></span><button class="btn plain" data-act="proOn" ${ui.busy === 'pro' ? 'disabled' : ''}>${ui.busy === 'pro' ? tr('Activando…') : tr('Activar')}</button></span>
      </label></div>`;
  }
  const msg = (k) => (ui.msg?.[k] ? `<p class="key-msg ${ui.msg[k].ok ? 'ok' : 'bad'}" role="status">${esc(ui.msg[k].text)}</p>` : '');
  const jupWarn = notice?.jupiterNeedsKey && !keys.jupiter ? `<p class="warn">${I.warn}${tr('Jupiter ya pide clave para los tokens recién lanzados. Mientras, uso GeckoTerminal, que es algo más lento.')}</p>` : notice?.jupiterKeyBad ? `<p class="warn">${I.warn}${tr('Jupiter no acepta tu clave. Revísala en portal.jup.ag.')}</p>` : '';
  return `${card}${!keys.ai && keys.support ? supportCard(keys.support, 'settings') : ''}${msg('pro')}${legal}
    <h3 id="keys">${tr('Jupiter (opcional)')}</h3>
    <p class="hint">${tr('Solo hace falta si Jupiter deja de responder sin clave. Es gratis en <a href="https://portal.jup.ag" target="_blank" rel="noopener">portal.jup.ag</a>.')}</p>
    ${jupWarn}
    <span class="key-row"><span class="inp key">${I.key}<input id="k-jupiter" type="password" autocomplete="off" spellcheck="false" placeholder="${keys.jupiter ? esc(tr('Guardada · escribe para cambiarla')) : tr('Sin clave')}"></span><button class="btn plain" data-act="keySave" data-k="jupiter">${tr('Guardar')}</button></span>
    ${keys.jupiter ? `<div class="btn-row"><button class="ghost" data-act="keyDel" data-k="jupiter">${tr('Borrar')}</button></div>` : ''}
    ${msg('jupiter')}`;
}

export function jupiterBanner(notice, keys) {
  if (!notice?.jupiterNeedsKey || keys?.jupiter) return '';
  return `<div class="svc-note">${I.warn}<span>${tr('Jupiter ya pide clave para los tokens recién lanzados: uso un respaldo algo más lento.')} <button class="link-btn" data-act="goKeys">${tr('Añadir clave gratis')}</button></span></div>`;
}

export { fmtCompact };
