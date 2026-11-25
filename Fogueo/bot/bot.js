// Blankfire — ventana del bot de práctica. Todo se pinta desde el estado que guarda el service worker.
import { tr, setLang, getLang, locale } from '../lib/i18n.js';
import { pagesNav } from '../lib/pages-nav.js';
import { fmtSol, fmtPct, fmtCompact, fmtDuration, fmtPrice, roundTripPct, DEFAULT_SETTINGS } from '../lib/core.js';
import { BOT_KEY, BOT_DEFAULTS, STOP_MIN, STOP_MAX, RECAP_MS, EXIT_TEXT, copilotGate, cleanCopilot, COPILOT_UNLOCK, PACES, costSettings, paceTimes } from '../lib/bot.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const send = (msg) => new Promise((res) => chrome.runtime.sendMessage(msg, (r) => res(r || { ok: false, error: chrome.runtime.lastError?.message })));

let store = null, filter = 'all', open = new Set(), busy = false, userSettings = DEFAULT_SETTINGS, advOpen = false;
let real = null, realBackup = null, realBusy = false;
const DESKTOP = !!globalThis.blankfireDesktop;   // dentro de la app de escritorio (sin Opera)
const closesWhen = () => tr(DESKTOP ? 'al salir de la app' : 'al cerrar Opera');

const AGENTS = {
  smarts: { name: 'Dinero inteligente', what: 'Lee quién compra, cuánto y con qué prisa' },
  trends: { name: 'Tendencias', what: 'Momento del precio, temas de moda y promoción' },
  debate: { name: 'Debate', what: 'Un toro y un oso discuten; el oso puede vetar' },
  router: { name: 'Ruta y slippage', what: 'Tamaño, impacto en el precio y margen de la orden' },
  safety: { name: 'Seguridad', what: 'Informe de RugCheck: autoridades, holders, liquidez bloqueada, historial del creador' },
  ind: { name: 'Indicadores', what: 'Velas de 1 min: RSI, medias, picos de volumen y distancia al máximo' },
};
const AGENT_ORDER = ['safety', 'smarts', 'trends', 'ind', 'debate', 'router'];

// Números marcados por lib/bot.js («%+:12.5», «%:3», «$:15000») → texto en el idioma actual.
function fmtVar(v) {
  if (typeof v !== 'string') return esc(v);
  const m = /^(%\+|%|\$|S):(-?[\d.]+)$/.exec(v);
  if (!m) return esc(tr(v));
  const n = Number(m[2]);
  if (m[1] === '$') return esc(fmtCompact(n, '$'));
  if (m[1] === 'S') return esc(fmtSol(n));
  return esc(fmtPct(n, Math.abs(n) < 10 && n % 1 ? 1 : 0, { sign: m[1] === '%+' }));
}
function say(n) {
  if (!n) return '';
  const vars = n.v ? Object.fromEntries(Object.entries(n.v).map(([k, v]) => [k, fmtVar(v)])) : null;
  return vars ? tr(n.t, vars) : esc(tr(n.t));
}
const time = (ts) => new Date(ts).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });
const day = (ts) => new Date(ts).toLocaleDateString(locale(), { day: 'numeric', month: 'short' });
const tone = (n) => (n > 0 ? 'up' : n < 0 ? 'down' : 'flat');

function scoreBar(s, label) {
  if (s == null) return `<span class="sbar na" aria-label="${esc(tr('sin opinión'))}"><i></i></span>`;
  const w = Math.min(50, Math.abs(s) * 50);
  return `<span class="sbar" role="img" aria-label="${esc(label || tr('nota {s}', { s: s.toFixed(2) }))}"><i class="${s >= 0 ? 'pos' : 'neg'}" style="${s >= 0 ? 'left:50%' : `left:${50 - w}%`};width:${w}%"></i></span>`;
}

// ---------- Cabecera y números de la sesión ----------
const STATUS = {
  running: ['En marcha', 'run'], paused: ['En pausa', 'pause'], stopped: ['Terminada', 'idle'], halted: ['Parada por pérdida', 'halt'],
};
function header(s) {
  const [label, cls] = s ? STATUS[s.status] || STATUS.stopped : ['Sin sesión', 'idle'];
  const live = s && ['running', 'paused'].includes(s.status);
  const ctl = !live
    ? ''
    : `${s.status === 'running' ? `<button class="btn" data-act="pause">${tr('Pausar')}</button>` : `<button class="btn" data-act="resume">${tr('Reanudar')}</button>`}
       <button class="btn danger" data-act="stop">${tr('Terminar y cerrar todo')}</button>`;
  return `<header class="bar">
    <div class="id">
      <svg class="mark" viewBox="0 0 100 100" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="M57 5C61 25 79 38 79 62A29 29 0 0 1 21 62C21 47 28 38 36 31C37 39 41 43 45 45C43 31 49 17 57 5ZM50 48.5A13.5 13.5 0 0 1 50 75.5A13.5 13.5 0 0 1 50 48.5Z"/></svg>
      <div class="id-t">
        <div class="id-r"><h1>${tr('Bot de práctica')}</h1><span class="status st-${cls}"><i></i>${tr(label)}</span>${s && live ? `<span class="chip">${tr(PACE_TXT[s.config.pace]?.[0] || 'Equilibrado')}</span>` : ''}</div>
        <p class="paper">${tr('SOL de práctica con saldo propio: no toca tu cuenta de Blankfire ni ninguna wallet.')}</p>
      </div>
    </div>
    <div class="ctl">
      ${pagesNav('bot')}<button class="lang" data-act="lang" aria-label="${getLang() === 'en' ? 'Cambiar a español' : 'Switch to English'}">${getLang() === 'en' ? 'ES' : 'EN'}</button>
      ${ctl}
    </div>
  </header>`;
}

function ledger(s) {
  const c = s.config;
  const eq = s.balance + Object.values(s.positions).reduce((a, p) => a + (p.valueSol ?? p.costSol), 0);
  const res = eq - c.budgetSol, resPct = (eq / c.budgetSol - 1) * 100;
  const wins = s.closed.filter((x) => x.pnlSol > 0).length;
  const lossUsed = Math.max(0, Math.min(1, -resPct / c.maxLossPct));
  const next = s.lastRecapAt + RECAP_MS - Date.now();
  const nOpen = Object.keys(s.positions).length;
  // Lo que se han llevado las comisiones (cerradas + lo que costaría salir de las abiertas).
  const fees = s.closed.reduce((a, x) => a + (x.feesSol || 0), 0) + Object.values(s.positions).reduce((a, p) => a + (p.rtCostSol || 0), 0);
  return `<section class="ledger" aria-label="${esc(tr('Números de la sesión'))}">
    <dl>
      <div><dt>${tr('Valor de la sesión')}</dt><dd class="num big">${fmtSol(eq)} <small>/ ${fmtSol(c.budgetSol)} SOL</small></dd></div>
      <div><dt>${tr('Resultado')}</dt><dd class="num ${tone(res)}">${fmtSol(res, { sign: true })} SOL <small>${fmtPct(resPct, 1, { sign: true })}</small></dd></div>
      <div><dt>${tr('Operaciones')}</dt><dd class="num">${s.closed.length} <small>${s.closed.length ? tr('{w} ganadas', { w: wins }) : ''}</small></dd></div>
      <div><dt>${tr('En comisiones')}</dt><dd class="num">${fmtSol(fees)} <small>SOL</small></dd></div>
      <div><dt>${tr('Abiertas')}</dt><dd class="num">${nOpen} <small>/ ${c.maxOpen}</small></dd></div>
      <div><dt>${tr('Próximo resumen')}</dt><dd class="num">${['running', 'paused'].includes(s.status) ? tr('en {t}', { t: fmtDuration(Math.max(0, next)) }) : '—'}</dd></div>
    </dl>
    <div class="lossmeter" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(lossUsed * 100)}" aria-label="${esc(tr('Pérdida máxima de la sesión'))}">
      <span class="lm-track"><i style="width:${(lossUsed * 100).toFixed(1)}%" class="${lossUsed > 0.66 ? 'hot' : ''}"></i></span>
      <span class="lm-txt">${tr('Freno de pérdida: se para solo al {p}', { p: fmtPct(-c.maxLossPct, 0) })}</span>
    </div>
    ${s.status === 'halted' && s.haltReason ? `<p class="halted">${say(s.haltReason)}</p>` : ''}
  </section>`;
}

// ---------- Registro de decisiones ----------
const KIND = {
  buy: ['Compra', 'k-buy'], sell: ['Venta', 'k-sell'], skip: ['Descarta', 'k-skip'], recap: ['Resumen', 'k-recap'],
  info: ['Aviso', 'k-sys'], start: ['Inicio', 'k-sys'], stop: ['Fin', 'k-sys'], halt: ['Freno', 'k-halt'],
};
function agentBlock(id, a) {
  if (!a) return '';
  const def = AGENTS[id];
  let body = '';
  if (id === 'debate') {
    const li = (list) => (list?.length ? list.map((n) => `<li>${say(n)}</li>`).join('') : `<li class="muted">${tr('nada')}</li>`);
    body = a.veto ? `<p class="veto">${tr('Veto')}: ${say(a.veto)}</p>` : '';
    body += `<div class="pros"><b>${tr('A favor')}</b><ul>${li(a.bull)}</ul></div><div class="cons"><b>${tr('En contra')}</b><ul>${li(a.bear)}</ul></div>`;
  } else {
    body = a.veto && id !== 'debate' ? `<p class="veto">${tr('Veto')}: ${say(a.veto)}</p>` : '';
    const notes = (a.notes || []).filter((n) => !a.veto || n.t !== a.veto.t);
    body += notes.length ? `<ul>${notes.map((n) => `<li>${say(n)}</li>`).join('')}</ul>` : '';
  }
  return `<section class="agent ag-${id}">
    <header><h4>${tr(def.name)}</h4>${id === 'router' ? `<span class="tag ${a.ok ? 'ok' : 'no'}">${tr(a.ok ? 'ruta lista' : 'sin ruta')}</span>` : scoreBar(a.score)}</header>
    ${body}
  </section>`;
}
// Repaso de sí / no de la decisión y enlaces para comprobarlo tú.
function checksBlock(l) {
  const list = l.agents?.checks || [];
  const mark = (ok) => (ok === true ? ['ok', '✓', 'sí'] : ok === false ? ['no', '✕', 'no'] : ['na', '–', 'sin datos']);
  const items = list.map((c) => { const [cls, ic, sr] = mark(c.ok); return `<li class="ck ${cls}"><i aria-hidden="true">${ic}</i><span class="sr">${tr(sr)}: </span>${say(c.n)}</li>`; }).join('');
  const a = esc(l.addr || '');
  return `<section class="agent ag-checks">
    <header><h4>${tr('Repaso')}</h4></header>
    ${items ? `<ul class="cklist">${items}</ul>` : ''}
    ${a ? `<p class="verify">${tr('Compruébalo tú')}: <a href="https://rugcheck.xyz/tokens/${a}" target="_blank" rel="noopener">RugCheck</a> · <a href="https://solscan.io/token/${a}" target="_blank" rel="noopener">Solscan</a> · <a href="https://dexscreener.com/solana/${a}" target="_blank" rel="noopener">DexScreener</a> · <a href="https://trade.padre.gg/trade/solana/${a}" target="_blank" rel="noopener">Padre</a></p>` : ''}
  </section>`;
}
function logRow(l, i) {
  const [label, cls] = KIND[l.kind] || KIND.info;
  const id = `${l.at}-${i}`;
  let main = '';
  if (l.kind === 'sell') main = `${tr(EXIT_TEXT[l.exit] || EXIT_TEXT.manual, { v: l.ch != null ? tr('precio {p}', { p: fmtPct(l.ch, 1, { sign: true }) }) : '—', m: l.mins })} · <b class="${tone(l.pnlSol)} num">${fmtSol(l.pnlSol, { sign: true })} SOL (${fmtPct(l.pnlPct, 1, { sign: true })})</b> <span class="more">${tr('con comisiones')}</span>`;
  else if (l.kind === 'buy') main = `${tr('{s} SOL a {p}', { s: fmtSol(l.sol), p: fmtPrice(l.price) })} · ${say(l.reason)}`;
  else if (l.kind === 'recap') main = tr(l.recap.trades === 1 ? '1 operación · {pnl} SOL' : '{n} operaciones · {pnl} SOL', { n: l.recap.trades, pnl: fmtSol(l.recap.pnlSol, { sign: true }) });
  else main = say(l.reason) + (l.more?.length ? ` <span class="more">${tr('y {n} más', { n: l.more.length })}</span>` : '');
  const hasAgents = !!l.agents;
  const sym = l.symbol && l.agents ? `<span class="sym">${esc(l.symbol)}</span>` : l.symbol ? `<a class="sym" href="https://trade.padre.gg/trade/solana/${esc(l.addr)}" target="_blank" rel="noopener">${esc(l.symbol)}</a>` : '<span class="sym none">·</span>';
  const head = `<span class="t num">${time(l.at)}</span>${sym}<span class="kind ${cls}">${tr(label)}</span><span class="why">${main}</span>${l.score != null ? scoreBar(l.score) : '<span></span>'}`;
  if (!hasAgents) return `<li class="ev ${cls}"><div class="ev-row">${head}</div></li>`;
  const isOpen = open.has(id);
  return `<li class="ev ${cls}">
    <button class="ev-row" data-act="toggle" data-id="${id}" aria-expanded="${isOpen}">${head}</button>
    <div class="agents" ${isOpen ? '' : 'hidden'}>${AGENT_ORDER.map((k) => agentBlock(k, l.agents[k])).join('')}${checksBlock(l)}</div>
  </li>`;
}
function stream(s) {
  const want = (l) => filter === 'all' || (filter === 'trades' ? ['buy', 'sell', 'recap', 'halt'].includes(l.kind) : l.kind === 'skip');
  const rows = s.log.map((l, i) => [l, i]).filter(([l]) => want(l)).reverse().slice(0, 150);
  const seg = (k, t) => `<button role="tab" aria-selected="${filter === k}" data-act="filter" data-f="${k}">${tr(t)}</button>`;
  return `<section class="stream">
    <header class="sec-h">
      <h2>${tr('Registro de decisiones')}</h2>
      <div class="seg" role="tablist">${seg('all', 'Todo')}${seg('trades', 'Operaciones')}${seg('skip', 'Descartes')}</div>
      ${s.status === 'running' ? `<button class="btn small" data-act="scan" ${busy ? 'disabled' : ''}>${tr(busy ? 'Buscando…' : 'Buscar ahora')}</button>` : ''}
    </header>
    <p class="hint">${tr('Cada fila es una decisión. Pulsa las que tienen nota para ver qué dijo cada agente.')}</p>
    ${rows.length ? `<ol class="log">${rows.map(([l, i]) => logRow(l, i)).join('')}</ol>` : `<p class="empty">${tr(s.status === 'running' ? 'Mirando el mercado… la primera búsqueda tarda unos segundos.' : 'Nada que enseñar con este filtro.')}</p>`}
  </section>`;
}

// ---------- Columna lateral ----------
function positions(s) {
  const list = Object.values(s.positions);
  const c = s.config;
  const rows = list.map((p) => {
    const ch = p.lastPrice ? (p.lastPrice / p.entryPrice - 1) * 100 : 0;
    const pnl = (p.valueSol ?? p.costSol) - p.costSol;
    // Barra: de −stop a +objetivo, con la entrada marcada.
    const lo = -c.stopPct, hi = c.tpPct, at = (x) => ((Math.max(lo, Math.min(hi, x)) - lo) / (hi - lo)) * 100;
    return `<li class="pos">
      <div class="pos-h"><a class="sym" href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.symbol)}</a><span class="num ${tone(ch)}">${fmtPct(ch, 1, { sign: true })}</span></div>
      <div class="range" aria-hidden="true"><i class="${tone(ch)}" style="left:${Math.min(at(0), at(ch))}%;width:${Math.abs(at(ch) - at(0))}%"></i><b style="left:${at(0)}%"></b></div>
      <div class="pos-f"><span>${tr('stop {s} · objetivo {t}', { s: fmtPct(-c.stopPct, 1), t: fmtPct(c.tpPct, 0, { sign: true }) })}</span><span class="num ${tone(pnl)}">${fmtSol(pnl, { sign: true })} SOL</span></div>
      <div class="pos-f"><span>${tr('hace {t} · {r}', { t: fmtDuration(Date.now() - p.openedAt), r: esc(tr(p.route || '')) })}</span><button class="link" data-act="sell" data-key="${esc(p.key)}">${tr('Vender ya')}</button></div>
    </li>`;
  }).join('');
  return `<section class="side-s"><h3>${tr('Posiciones abiertas')}</h3>${list.length ? `<ul class="plist">${rows}</ul>` : `<p class="empty sm">${tr('Ninguna. Solo entra cuando el consejo pasa de {m}.', { m: c.minScore.toFixed(2) })}</p>`}</section>`;
}
function recapCard(r) {
  const exits = Object.entries(r.exits || {}).map(([k, n]) => `${n} ${tr({ stop: 'por stop', tp: 'en objetivo', trail: 'por giro', time: 'por tiempo', halt: 'por freno', manual: 'a mano' }[k] || k)}`).join(' · ');
  return `<li class="recap">
    <div class="rc-h"><span>${day(r.from)} ${time(r.from)}–${time(r.to)}${r.final ? ` · ${tr('final')}` : ''}</span><b class="num ${tone(r.pnlSol)}">${fmtSol(r.pnlSol, { sign: true })} SOL</b></div>
    <p>${r.trades ? tr(r.trades === 1 ? '1 operación, {w} ganada ({p})' : '{n} operaciones, {w} ganadas ({p})', { n: r.trades, w: r.wins, p: fmtPct((r.winRate || 0) * 100, 0) }) : tr('Sin operaciones cerradas.')}${exits ? ` ${exits}.` : ''}</p>
    ${r.best && r.trades > 1 ? `<p>${tr('Mejor {a} ({x}) · peor {b} ({y})', { a: esc(r.best.symbol), x: fmtPct(r.best.pnlPct, 1, { sign: true }), b: esc(r.worst.symbol), y: fmtPct(r.worst.pnlPct, 1, { sign: true }) })}</p>` : ''}
    ${r.topSkips?.length ? `<p class="muted">${tr('Más descartadas por: {l}', { l: r.topSkips.map((x) => `${say(x)} (${x.n})`).join(', ') })}</p>` : ''}
  </li>`;
}
function recaps(s) {
  const list = s.recaps.slice().reverse();
  return `<section class="side-s"><h3>${tr('Resúmenes cada 12 h')}</h3>${list.length ? `<ul class="rlist">${list.slice(0, 6).map(recapCard).join('')}</ul>` : `<p class="empty sm">${tr('El primero llega a las 12 h de arrancar (o al terminar la sesión).')}</p>`}</section>`;
}

// Lo que se lleva cada operación solo por entrar y salir, con los costes con los que simula el bot.
function costBox(cfg) {
  const size = (cfg.budgetSol * cfg.sizePct) / 100;
  const cs = costSettings(userSettings, cfg);
  const rt = roundTripPct(size, cs);
  if (rt == null) return '';
  const bad = rt > cfg.maxCostPct;
  const how = cfg.costModel === 'padre'
    ? tr('Padre {f} + {t} SOL por orden', { f: fmtPct(cs.feePct ?? 1, 1), t: fmtSol((Number(cs.tipSol) || 0) + (Number(cs.priorityFee) || 0)) })
    : tr('wallet del bot: comisión del pool + ~{t} SOL de red por orden', { t: fmtSol(cs.priorityFee) });
  return `<div class="cost ${bad ? 'bad' : rt > cfg.stopPct / 2 ? 'warn' : 'ok'}" data-ref="cost">
    <p><b class="num">${fmtPct(rt, 1)}</b> ${tr('se va en comisiones en cada entrada de {s} SOL, solo por entrar y salir ({h}).', { s: fmtSol(size), h: how })}</p>
    <p class="muted">${tr('Para no perder, cada operación tiene que ganar de media más que eso. Un stop del {st} te cuesta en total un {tot}.', { st: fmtPct(-cfg.stopPct, 1), tot: fmtPct(-(cfg.stopPct + rt), 1) })}</p>
    ${bad ? `<p><b>${tr('Con este tamaño no comprará (máximo {m}): sube el saldo o el % por entrada.', { m: fmtPct(cfg.maxCostPct, 0) })}</b></p>` : ''}
  </div>`;
}

// Camino al dinero real: tres pasos, siempre a la vista, para que se entienda qué falta.
function moneyPath() {
  const g = copilotGate(store);
  const pct = Math.min(100, (g.trades / COPILOT_UNLOCK.trades) * 100);
  const step = !g.ok ? 1 : real?.config?.mode === 'auto' ? 3 : 2;
  const li = (n, t, d) => `<li class="${step > n ? 'done' : step === n ? 'now' : ''}"><b>${n}</b><div><strong>${tr(t)}</strong><span>${d}</span></div></li>`;
  return `<section class="side-s copilot ${g.ok ? '' : 'locked'}">
    <h3>${tr('Camino al dinero real')}</h3>
    <ol class="path">
      ${li(1, 'Practicar', !g.ok ? `${tr('{t} de {n} operaciones cerradas, y en positivo tras comisiones', { t: g.trades, n: COPILOT_UNLOCK.trades })} · <span class="num ${tone(g.net)}">${fmtSol(g.net, { sign: true })} SOL</span>` : tr('Hecho: la práctica va en positivo.'))}
      ${li(2, 'Copiloto', tr('Te avisa de cada compra y venta para que la hagas tú.'))}
      ${li(3, 'Automático', tr('Opera solo con una wallet propia y tus límites.'))}
    </ol>
    ${!g.ok ? `<div class="gbar" role="meter" aria-valuemin="0" aria-valuemax="${COPILOT_UNLOCK.trades}" aria-valuenow="${g.trades}" aria-label="${esc(tr('Operaciones simuladas'))}"><i style="width:${pct}%"></i></div>` : ''}
  </section>`;
}

// ---------- Copiloto con dinero real (fase 5) ----------
function copilotBlock() {
  const g = copilotGate(store), c = cleanCopilot(store.copilot || {});
  const pct = Math.min(100, (g.trades / COPILOT_UNLOCK.trades) * 100);
  const sigs = (store.signals || []).slice(-6).reverse();
  const lock = !g.ok;
  return `<section class="side-s copilot ${lock ? 'locked' : c.on ? 'on' : ''}">
    <header class="sec-h"><h3>${tr('Copiloto con dinero real')}</h3><span class="status st-${c.on && !lock ? 'run' : 'idle'}"><i></i>${tr(lock ? 'Bloqueado' : c.on ? 'Activo' : 'Apagado')}</span></header>
    <p class="hint">${tr('Cuando el bot compra o vende en la simulación, te avisa con tamaño, slippage y stop para que lo hagas tú en Padre con tu wallet aparte. Blankfire nunca firma ni toca tu wallet.')}</p>
    ${lock ? `<div class="gate">
        <p>${tr('Se desbloquea cuando la simulación demuestre algo: {n} operaciones cerradas y resultado positivo tras comisiones.', { n: COPILOT_UNLOCK.trades })}</p>
        <div class="gbar" role="meter" aria-valuemin="0" aria-valuemax="${COPILOT_UNLOCK.trades}" aria-valuenow="${g.trades}" aria-label="${esc(tr('Operaciones simuladas'))}"><i style="width:${pct}%"></i></div>
        <p class="num"><span>${tr('{t} de {n} operaciones', { t: g.trades, n: COPILOT_UNLOCK.trades })}</span> · <span class="${tone(g.net)}">${fmtSol(g.net, { sign: true })} SOL</span></p>
      </div>` : `<form class="cop" data-form="copilot">
        <label class="chk"><input type="checkbox" name="on" ${c.on ? 'checked' : ''}> ${tr('Avisarme de cada compra y venta del bot')}</label>
        <div class="row2">
          ${field('maxSol', 'Máximo por compra', c.maxSol, { min: 0.01, max: 5, step: 0.01, unit: 'SOL' })}
          ${field('maxPerDay', 'Avisos de compra al día', c.maxPerDay, { min: 1, max: 30, unit: '' })}
        </div>
        ${field('ttlMin', 'El aviso caduca a los', c.ttlMin, { min: 1, max: 15, unit: 'min' })}
        <p class="muted sm2">${tr('Empieza con poco: lo que la simulación aguanta no siempre lo aguanta tu cabeza con dinero real.')}</p>
        <button class="btn small" type="submit">${tr('Guardar')}</button>
      </form>`}
    ${sigs.length ? `<ul class="sigs">${sigs.map((x) => `<li><span class="kind ${x.kind === 'buy' ? 'k-buy' : 'k-sell'}">${tr(x.kind === 'buy' ? 'Compra' : 'Venta')}</span><a class="sym" href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.symbol)}</a><span class="num muted">${x.kind === 'buy' ? `${fmtSol(x.sizeSol)} SOL` : x.ch != null ? fmtPct(x.ch, 1, { sign: true }) : ''}</span><span class="muted">${time(x.at)}</span></li>`).join('')}</ul>` : ''}
  </section>`;
}

// ---------- Modo automático con dinero real ----------
const shortA = (a) => (a ? `${a.slice(0, 4)}…${a.slice(-4)}` : '');
function realBlock() {
  if (!real) return '';
  const g = real.gate;
  const head = `<header class="sec-h"><h3>${tr('Dinero real automático')}</h3><span class="status st-${real.config.mode === 'auto' && real.unlocked ? 'run' : real.has && !real.unlocked ? 'pause' : 'idle'}"><i></i>${tr(!g.ok ? 'Bloqueado' : !real.has ? 'Sin wallet' : !real.unlocked ? 'Cerrada' : real.config.mode === 'auto' ? 'Operando' : 'Apagado')}</span></header>`;
  const intro = `<p class="hint">${tr('El bot copia sus decisiones con SOL de verdad desde una wallet propia que crea Blankfire. Tu Phantom no se toca: le mandas tú poca SOL y puedes retirarla cuando quieras, solo a tu Phantom.')}</p>`;
  if (!g.ok) return `<section class="side-s realb">${head}${intro}<p class="muted sm2">${tr('Se desbloquea igual que el copiloto: {n} operaciones simuladas y resultado positivo ({t} de {n}).', { n: COPILOT_UNLOCK.trades, t: g.trades })}</p></section>`;
  if (realBackup) {
    return `<section class="side-s realb">${head}
      <div class="backup" role="alert">
        <p><b>${tr('Guarda esta clave privada ahora. Solo la verás esta vez.')}</b></p>
        <p class="muted sm2">${tr('Con ella puedes recuperar la wallet del bot en Phantom si borras la extensión. Quien la tenga, tiene el dinero: no la mandes a nadie, no le hagas captura y no la pegues en ninguna web.')}</p>
        <code class="secret" data-ref="secret">${esc(realBackup.backup)}</code>
        <button class="btn small" data-act="copySecret">${tr('Copiar')}</button>
        <p class="sm2">${tr('Dirección de la wallet del bot (aquí le mandas SOL desde Phantom):')}</p>
        <code class="addr">${esc(realBackup.address)}</code>
        <label class="chk"><input type="checkbox" data-ref="savedOk"> ${tr('La he guardado en un sitio seguro')}</label>
        <button class="btn small primary" data-act="backupDone">${tr('Hecho')}</button>
      </div></section>`;
  }
  if (!real.has) {
    return `<section class="side-s realb">${head}${intro}
      <form class="cop" data-form="realCreate" autocomplete="off">
        <label class="fld"><span class="fl">${tr('Contraseña de la wallet del bot')}</span><span class="fi"><input type="password" name="pw" autocomplete="new-password"></span><small>${tr('Mínimo 10 caracteres, con letras y números o símbolos. Si la olvidas, solo podrás recuperar el dinero con la copia de seguridad.')}</small></label>
        <label class="fld"><span class="fl">${tr('Repítela')}</span><span class="fi"><input type="password" name="pw2" autocomplete="new-password"></span></label>
        <label class="fld"><span class="fl">${tr('Tu dirección de Phantom (para retirar)')}</span><span class="fi"><input name="to" spellcheck="false" autocomplete="off"></span><small>${tr('Solo se podrá retirar a esta dirección. No se puede cambiar después.')}</small></label>
        <label class="chk"><input type="checkbox" name="risk"> ${tr('Entiendo que el bot puede perder lo que le meta')}</label>
        <button class="btn small primary" type="submit" ${realBusy ? 'disabled' : ''}>${tr(realBusy ? 'Creando…' : 'Crear wallet del bot')}</button>
      </form>
      ${moveInForm()}</section>`;
  }
  if (real.movedAt) {
    return `<section class="side-s realb">${head}
      <p class="sm2">${tr('Wallet del bot')}: <code class="addr">${esc(shortA(real.address))}</code></p>
      <p class="hint">${tr(DESKTOP ? 'Esta wallet opera ahora desde la extensión de Opera. Aquí queda apagada para que nunca operen las dos a la vez.' : 'Esta wallet opera ahora desde la app de escritorio. Aquí queda apagada para que nunca operen las dos a la vez.')}</p>
      <button class="btn small" data-act="realReclaim">${tr('Usarla aquí otra vez')}</button>
      <p class="muted sm2">${tr('Antes, apaga el modo real en el otro sitio.')}</p>
    </section>`;
  }
  if (!real.unlocked) {
    return `<section class="side-s realb">${head}
      <p class="sm2">${tr('Wallet del bot')}: <code class="addr">${esc(shortA(real.address))}</code></p>
      <p class="hint">${tr('Está cerrada (se cierra sola {w}). Mientras esté cerrada, el bot no compra ni vende con dinero real.', { w: closesWhen() })}</p>
      <form class="cop" data-form="realUnlock"><label class="fld"><span class="fl">${tr('Contraseña')}</span><span class="fi"><input type="password" name="pw" autocomplete="current-password"></span></label>
      <button class="btn small primary" type="submit" ${realBusy ? 'disabled' : ''}>${tr(realBusy ? 'Abriendo…' : 'Abrir')}</button></form>
      ${Object.keys(real.positions).length ? `<p class="warnp">${tr('Tiene {n} posiciones abiertas con dinero real sin vigilar. Ábrela para que el bot pueda venderlas.', { n: Object.keys(real.positions).length })}</p>` : ''}
    </section>`;
  }
  const c = real.config, pos = Object.values(real.positions);
  const kindTxt = { buy: 'Compra', sell: 'Venta', skip: 'Salta', error: 'Error', halt: 'Freno', info: 'Aviso', withdraw: 'Retirada' };
  const sayL = (l) => (l.t ? (l.v ? tr(l.t, Object.fromEntries(Object.entries(l.v).map(([k, v]) => [k, esc(tr(String(v)))]))) : esc(tr(l.t))) : '');
  return `<section class="side-s realb on">${head}
    <div class="rbal"><div><span>${tr('Saldo')}</span><b class="num">${real.balance == null ? '—' : `${fmtSol(real.balance)} SOL`}</b></div>
      <div><span>${tr('Wallet del bot')}</span><button class="link mono" data-act="copyAddr">${esc(shortA(real.address))}</button></div></div>
    ${real.balErr ? `<p class="warnp">${esc(real.balErr)}</p>` : real.balance === 0 ? `<p class="hint">${tr('Mándale SOL desde Phantom a la dirección de la wallet del bot (pulsa para copiarla). Empieza con poco.')}</p>` : ''}
    <label class="chk big"><input type="checkbox" data-act="realMode" ${c.mode === 'auto' ? 'checked' : ''}> ${tr('Que el bot opere él solo con dinero real')}</label>
    <form class="cop" data-form="realCfg">
      <div class="row2">
        ${field('maxSol', 'Máximo por compra', c.maxSol, { min: 0.01, max: 2, step: 0.01, unit: 'SOL' })}
        ${field('maxPerDay', 'Compras al día', c.maxPerDay, { min: 1, max: 30, unit: '' })}
      </div>
      <div class="row2">
        ${field('maxDailyLossSol', 'Pérdida máxima al día', c.maxDailyLossSol, { min: 0.01, max: 10, step: 0.01, unit: 'SOL' })}
        ${field('maxOpen', 'Abiertas a la vez', c.maxOpen, { min: 1, max: 5, unit: '' })}
      </div>
      <p class="muted sm2">${tr('Si en un día pierde la cantidad máxima, el modo real se apaga solo. El stop de cada operación es el del bot (−6 % a −8 %), pero con dinero real se suma la comisión y el slippage.')}</p>
      <button class="btn small" type="submit">${tr('Guardar límites')}</button>
    </form>
    <button class="btn danger" data-act="realPanic">${tr('Pánico: apagar y vender todo')}</button>
    ${pos.length ? `<p class="sub-h">${tr('Abiertas con dinero real')}</p><ul class="rpos">${pos.map((p) => {
      const st = p.sellPending ? ['warn', tr('venta pendiente')] : p.pending ? ['info', tr('sin confirmar')] : p.orphan ? ['warn', tr('sin apuntar')] : null;
      return `<li><a class="sym" href="https://trade.padre.gg/trade/solana/${esc(p.addr)}" target="_blank" rel="noopener">${esc(p.symbol)}</a>
        <span class="num">${p.lamportsIn ? `${fmtSol(p.lamportsIn / 1e9)} SOL` : '—'}</span>
        ${st ? `<span class="tag ${st[0]}">${st[1]}</span>` : `<span class="muted">${time(p.at)}</span>`}
        <button class="link" data-act="realSellOne" data-addr="${esc(p.addr)}">${tr('Vender ya')}</button></li>`;
    }).join('')}</ul>` : ''}
    ${real.log.length ? `<p class="sub-h">${tr('Registro con dinero real')}</p><ul class="rlog">${real.log.slice().reverse().slice(0, 12).map((l) => `<li class="rl-${l.kind}"><span class="t num">${time(l.at)}</span><span class="kind">${tr(kindTxt[l.kind] || 'Aviso')}</span><span>${l.symbol ? `<b>${esc(l.symbol)}</b> ` : ''}${l.kind === 'sell' ? `<b class="num ${tone(l.pnl)}">${fmtSol(l.pnl, { sign: true })} SOL</b>` : l.kind === 'buy' || l.kind === 'withdraw' ? `${fmtSol(l.sol)} SOL` : ''} ${sayL(l)}${l.sig ? ` <a class="link" href="https://solscan.io/tx/${esc(l.sig)}" target="_blank" rel="noopener">${tr('ver')}</a>` : ''}</span></li>`).join('')}</ul>` : ''}
    <details class="rmore"><summary>${tr('Retirar, cerrar y copia de seguridad')}</summary>
      <form class="cop" data-form="realWithdraw">
        <p class="sm2">${tr('Se retira siempre a tu Phantom')}: <code class="addr">${esc(shortA(real.withdrawTo))}</code></p>
        <div class="row2">${field('sol', 'Cantidad', '', { min: 0.001, max: 1000, step: 0.001, unit: 'SOL' })}
        <label class="chk"><input type="checkbox" name="all"> ${tr('Todo')}</label></div>
        <label class="fld"><span class="fl">${tr('Contraseña')}</span><span class="fi"><input type="password" name="pw" autocomplete="current-password"></span></label>
        <button class="btn small" type="submit" ${realBusy ? 'disabled' : ''}>${tr('Retirar a mi Phantom')}</button>
      </form>
      <div class="rbtns"><button class="btn small" data-act="realLock">${tr('Cerrar la wallet ahora')}</button></div>
      <form class="cop" data-form="realKey">
        <label class="fld"><span class="fl">${tr('Contraseña (para ver la copia o borrar)')}</span><span class="fi"><input type="password" name="pw" autocomplete="current-password"></span></label>
        <div class="rbtns"><button class="btn small ghost" type="submit" value="export">${tr('Ver copia de seguridad')}</button><button class="btn small ghost danger" type="submit" value="delete">${tr('Borrar wallet vacía')}</button></div>
      </form>
      <form class="cop" data-form="realMove">
        <p class="sm2"><b>${tr(DESKTOP ? 'Llevarla a la extensión de Opera' : 'Llevarla a la app de escritorio')}</b></p>
        <p class="muted sm2">${tr('Se guarda un archivo con la clave cifrada con tu contraseña. Aquí se apaga para que nunca operen las dos a la vez. Necesita no tener posiciones abiertas.')}</p>
        <label class="fld"><span class="fl">${tr('Contraseña')}</span><span class="fi"><input type="password" name="pw" autocomplete="current-password"></span></label>
        <button class="btn small" type="submit" ${realBusy ? 'disabled' : ''}>${tr('Guardar archivo y apagar aquí')}</button>
      </form>
    </details>
    <p class="muted sm2">${tr('Con Opera cerrado no vigila nada. Si dejas posiciones abiertas y cierras, al volver tendrás que abrir la wallet para que el bot pueda venderlas.')}</p>
  </section>`;
}

function moveInForm() {
  return `<details class="rmore"><summary>${tr(DESKTOP ? '¿Ya la tenías en la extensión? Tráela' : '¿La tenías en la app de escritorio? Tráela')}</summary>
    <form class="cop" data-form="realMoveIn">
      <label class="fld"><span class="fl">${tr('Archivo de la wallet del bot')}</span><span class="fi"><input type="file" name="file" accept=".json,application/json"></span></label>
      <label class="fld"><span class="fl">${tr('Contraseña de esa wallet')}</span><span class="fi"><input type="password" name="pw" autocomplete="current-password"></span></label>
      <button class="btn small" type="submit" ${realBusy ? 'disabled' : ''}>${tr('Traer wallet')}</button>
    </form></details>`;
}

// ---------- Límites y filtros ----------
function field(name, label, value, { min, max, step = 1, unit = '', disabled = false, note = '' } = {}) {
  return `<label class="fld"><span class="fl">${tr(label)}</span>
    <span class="fi"><input type="number" name="${name}" value="${value}" min="${min}" max="${max}" step="${step}" inputmode="decimal" ${disabled ? 'disabled' : ''}><em>${tr(unit)}</em></span>
    ${note ? `<small>${tr(note)}</small>` : ''}</label>`;
}
function limits(cfg, live) {
  const f = cfg.filters;
  return `<details class="side-s adv" ${advOpen ? 'open' : ''}><summary>${tr('Ajustes avanzados')}<span class="muted">${tr(PACE_TXT[cfg.pace]?.[0] || 'Equilibrado')}</span></summary><form class="limits" data-form="cfg" novalidate>
    <p class="hint">${tr('Elegir un ritmo ya los ajusta todos. Toca esto solo si sabes lo que cambias.')}</p>
    <label class="chk"><input type="checkbox" name="padreCosts" ${cfg.costModel === 'padre' ? 'checked' : ''}> ${tr('Simular con las comisiones de mi Padre (en vez de las de la wallet del bot)')}</label>
    ${live ? field('budgetSol', 'Saldo de la sesión', cfg.budgetSol, { min: 0.1, max: 1000, step: 0.1, unit: 'SOL', disabled: true, note: 'Fijo hasta que termine la sesión.' }) : ''}
    <label class="fld"><span class="fl">${tr('Stop duro')}</span>
      <span class="fr"><span class="ends" aria-hidden="true">−6</span><input type="range" name="stopPct" min="${STOP_MIN}" max="${STOP_MAX}" step="0.5" value="${cfg.stopPct}" style="--p:${((cfg.stopPct - STOP_MIN) / (STOP_MAX - STOP_MIN)) * 100}%" aria-valuetext="${fmtPct(-cfg.stopPct, 1)}"><span class="ends" aria-hidden="true">−8</span><output class="num">${fmtPct(-cfg.stopPct, 1)}</output></span>
      <small>${tr('Siempre entre −6 % y −8 %. Se revisa cada 30 s: en una caída brusca puede salir algo peor.')}</small></label>
    ${live ? costBox(cfg) : ''}
    <div class="row2">
      ${field('sizePct', 'Cada entrada', cfg.sizePct, { min: 2, max: 40, unit: '% del saldo' })}
      ${field('maxOpen', 'A la vez', cfg.maxOpen, { min: 1, max: 6, unit: 'posiciones' })}
    </div>
    <div class="row2">
      ${field('tpPct', 'Objetivo', cfg.tpPct, { min: 10, max: 300, unit: '%' })}
      ${field('maxLossPct', 'Freno de la sesión', cfg.maxLossPct, { min: 5, max: 60, unit: '% de pérdida' })}
    </div>
    <div class="row2">
      ${field('trailPct', 'Giro desde el máximo', cfg.trailPct, { min: 4, max: 30, unit: '%' })}
      ${field('maxHoldMin', 'Tiempo máximo', cfg.maxHoldMin, { min: 5, max: 480, unit: 'min' })}
    </div>
    <div class="row2">
      ${field('maxCostPct', 'Coste máximo ida y vuelta', cfg.maxCostPct, { min: 2, max: 15, step: 0.5, unit: '%' })}
      ${field('maxImpactPct', 'Impacto máximo', cfg.maxImpactPct, { min: 0.5, max: 10, step: 0.5, unit: '%' })}
    </div>
    <details class="filters">
      <summary>${tr('Restricciones: cuándo no compra')}</summary>
      <div class="row2">
        ${field('maxLossStreak', 'Pérdidas seguidas', cfg.maxLossStreak, { min: 0, max: 10, unit: 'y descansa', note: '0 = nunca descansa' })}
        ${field('streakPauseMin', 'Descanso', cfg.streakPauseMin, { min: 0, max: 240, unit: 'min' })}
      </div>
      ${field('solDropPct', 'No comprar si SOL cae en 1 h más de', cfg.solDropPct, { min: 0, max: 20, step: 0.5, unit: '%', note: '0 = no mirar el mercado' })}
      <label class="chk"><input type="checkbox" name="avoidBadHours" ${cfg.avoidBadHours ? 'checked' : ''}> ${tr('No comprar en las horas en que el bot pierde de forma clara')}</label>
      <p class="muted">${tr('Una hora cuenta como mala con al menos 4 operaciones, saldo negativo y menos de un 35 % de aciertos (sumando sesiones anteriores).')}</p>
    </details>
    <details class="filters">
      <summary>${tr('Filtros para saltarse monedas')}</summary>
      <div class="row2">
        ${field('f.minLiqUsd', 'Liquidez mínima', f.minLiqUsd, { min: 0, max: 1e8, step: 1000, unit: 'USD' })}
        ${field('f.minVolH1Usd', 'Volumen 1 h mínimo', f.minVolH1Usd, { min: 0, max: 1e9, step: 1000, unit: 'USD' })}
      </div>
      <div class="row2">
        ${field('f.minMcUsd', 'Market cap mínimo', f.minMcUsd, { min: 0, max: 1e10, step: 1000, unit: 'USD' })}
        ${field('f.maxMcUsd', 'Market cap máximo', f.maxMcUsd, { min: 1e4, max: 1e11, step: 10000, unit: 'USD' })}
      </div>
      <div class="row2">
        ${field('f.minAgeMin', 'Edad mínima', f.minAgeMin, { min: 0, max: 1440, unit: 'min' })}
        ${field('f.maxAgeH', 'Edad máxima', f.maxAgeH, { min: 1, max: 8760, unit: 'h' })}
      </div>
      <div class="row2">
        ${field('f.maxH1Pct', 'Saltar si ya subió en 1 h más de', f.maxH1Pct, { min: 20, max: 10000, step: 10, unit: '%' })}
        ${field('f.minTxnsH1', 'Operaciones 1 h mínimas', f.minTxnsH1, { min: 0, max: 100000, step: 10, unit: 'órdenes' })}
      </div>
      <label class="chk"><input type="checkbox" name="f.needSocials" ${f.needSocials ? 'checked' : ''}> ${tr('Saltar monedas sin web ni redes')}</label>
      <label class="chk"><input type="checkbox" name="f.needSafety" ${f.needSafety ? 'checked' : ''}> ${tr('Saltar monedas sin informe de seguridad (RugCheck)')}</label>
      <p class="muted">${tr('Siempre veta: autoridad de emisión o de congelar activa, impuestos ocultos, creador con rugs, una wallet con más del 25 %, liquidez ridícula, copias de monedas famosas y gráficos con dibujo de rug.')}</p>
    </details>
    <button class="btn small" type="submit">${tr(live ? 'Aplicar a esta sesión' : 'Guardar')}</button>
  </form></details>`;
}

// ---------- Sin sesión: empezar en tres decisiones ----------
const PACE_TXT = {
  calm: ['Prudente', 'Pocas operaciones, muy elegidas. Aguanta hasta 45 min.'],
  balanced: ['Equilibrado', 'Lo recomendado para empezar. Sale antes y mira cada minuto.'],
  fast: ['Rápido', 'Muchas operaciones cortas. Cada una paga comisiones: solo compensa si acierta más.'],
};
function paceRow(k, cfg) {
  const p = PACES[k], on = cfg.pace === k, t = paceTimes({ pace: k }, DESKTOP);
  return `<label class="pace ${on ? 'on' : ''}">
    <input type="radio" name="pace" value="${k}" ${on ? 'checked' : ''}>
    <span class="pace-t"><b>${tr(PACE_TXT[k][0])}</b><span>${tr(PACE_TXT[k][1])}</span></span>
    <span class="pace-n num"><span>${tr('mira cada {s}', { s: fmtDuration(t.scanMs) })}</span><span>${fmtPct(p.tpPct, 0, { sign: true })} / ${fmtPct(-p.stopPct, 0)}</span></span>
  </label>`;
}
function intro(cfg, past) {
  const steps = [
    ['Restricciones', 'No mira nada tras una racha de pérdidas, con SOL cayendo o en tus horas malas.'],
    ['Filtros', 'Descarta lo que no cumple tus mínimos: liquidez, market cap, edad, volumen, operaciones, redes.'],
    ...AGENT_ORDER.map((k) => [AGENTS[k].name, AGENTS[k].what]),
    ['Ejecutor', 'Junta las notas (35 % dinero, 25 % tendencias, 40 % debate, que ya incluye seguridad e indicadores) y solo compra si pasa el mínimo, nadie veta y hay ruta.'],
  ];
  const care = [
    'Ningún filtro ve el futuro: un rug puede llegar después de comprar. El stop es lo único que te protege.',
    'En caídas bruscas el stop sale peor de lo marcado: el precio llega con segundos de retraso.',
    'Más operaciones no es más ganancia: cada una paga comisiones. Los bots de los vídeos enseñan las rachas buenas, no la cuenta del mes.',
    'RugCheck puede equivocarse o no responder. Sin su informe, el bot no compra (puedes cambiarlo en Ajustes avanzados).',
    'Una racha buena en práctica no garantiza nada con dinero real: empieza con muy poco y súbelo despacio.',
    DESKTOP ? 'Con el PC apagado o la app cerrada (Salir en la bandeja) no vigila nada. Antes de apagar, pulsa «Terminar y cerrar todo» o vende tú.' : 'Con Opera cerrado no vigila nada. Antes de apagar el PC, pulsa «Terminar y cerrar todo» o vende tú. La app de escritorio lo vigila sin Opera.',
  ];
  return `<section class="intro">
    <h2>${tr('Pon a prueba el bot')}</h2>
    <p class="lede">${tr('Practica con SOL de mentira y las mismas comisiones que pagaría de verdad. Cuando la práctica vaya en positivo, se desbloquea el dinero real.')}</p>
    <form id="startForm" data-form="start" class="start">
      <div class="q">
        <label class="ql" for="budgetSol">${tr('¿Con cuánto practicas?')}</label>
        <p class="qh">${tr('Pon lo mismo que piensas meter de verdad. 20 € son unos 0,13 SOL.')}</p>
        <span class="fi big"><input id="budgetSol" type="number" name="budgetSol" form="startForm" value="${cfg.budgetSol}" min="0.05" max="1000" step="0.01" inputmode="decimal"><em>SOL</em></span>
      </div>
      <fieldset class="q">
        <legend class="ql">${tr('¿A qué ritmo?')}</legend>
        ${!DESKTOP ? `<p class="qh">${tr('En Opera mira como mucho cada 30 s. En la app de escritorio, «Rápido» va de verdad rápido.')}</p>` : ''}
        <div class="paces">${['calm', 'balanced', 'fast'].map((k) => paceRow(k, cfg)).join('')}</div>
      </fieldset>
      ${costBox(cfg)}
      <button class="btn primary big" type="submit">${tr('Arrancar práctica')}</button>
    </form>
    <h3>${tr('Ten cuidado con')}</h3>
    <ul class="care">${care.map((c) => `<li>${tr(c)}</li>`).join('')}</ul>
    <details class="how"><summary>${tr('Cómo decide, paso a paso')}</summary>
      <ol class="flow">${steps.map(([n, w]) => `<li><b>${tr(n)}</b><span>${tr(w)}</span></li>`).join('')}</ol>
    </details>
    ${past?.length ? `<h3>${tr('Sesiones anteriores')}</h3><ul class="past">${past.slice(0, 6).map((p) => `<li><span>${day(p.startedAt)}</span><span class="num">${fmtSol(p.budgetSol)} → ${fmtSol(p.balance)} SOL</span><span class="num ${tone(p.balance - p.budgetSol)}">${fmtPct((p.balance / p.budgetSol - 1) * 100, 1, { sign: true })}</span><span>${tr(p.trades === 1 ? '1 operación' : '{n} operaciones', { n: p.trades })}</span></li>`).join('')}</ul>` : ''}
  </section>`;
}

// ---------- Pintar ----------
function render() {
  if (!store) return;
  const s = store.session, live = s && ['running', 'paused'].includes(s.status);
  // Configuración completa aunque lo guardado esté a medias (versiones viejas o datos tocados a mano).
  const raw = (live ? s.config : store.config) || {};
  const cfg = { ...BOT_DEFAULTS, ...raw, filters: { ...BOT_DEFAULTS.filters, ...(raw.filters || {}) } };
  // No repintar mientras escribes en un formulario (se perdería lo escrito).
  const ae = document.activeElement;
  if (ae && $('#app').contains(ae) && ae.form && ['cfg', 'start', 'copilot', 'realCreate', 'realUnlock', 'realCfg', 'realWithdraw', 'realKey', 'realMove', 'realMoveIn'].includes(ae.form.dataset.form) && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName) && !['radio', 'checkbox', 'submit', 'button', 'file'].includes(ae.type)) return;   // no pisar lo que escribe
  $('#app').innerHTML = `${header(s)}
    ${s ? ledger(s) : ''}
    <main class="grid">
      <div class="main-col">${s ? stream(s) : intro(cfg, store.past)}${s && !live ? intro(cfg, store.past) : ''}</div>
      <aside class="side">${s ? positions(s) : ''}${moneyPath()}${copilotGate(store).ok ? copilotBlock() + realBlock() : ''}${s ? recaps(s) : ''}${limits(cfg, live)}</aside>
    </main>`;
  document.title = `Blankfire · ${tr('Bot de práctica')}`;
}

function toast(msg, bad) {
  const t = $('#toast');
  t.textContent = msg; t.className = 'toast' + (bad ? ' bad' : ''); t.hidden = false;
  clearTimeout(toast.h); toast.h = setTimeout(() => { t.hidden = true; }, 3200);
}

function readCfg(form) {
  const out = { filters: {} };
  for (const el of form.querySelectorAll('input[name]')) {
    if (el.disabled) continue;
    if (el.type !== 'checkbox' && (el.value.trim() === '' || !Number.isFinite(Number(el.value)))) continue;   // vacío: se queda como estaba
    if (el.type === 'radio') { if (el.checked) out[el.name] = el.value; continue; }
    const v = el.type === 'checkbox' ? el.checked : Number(el.value);
    if (el.name === 'padreCosts') { out.costModel = v ? 'padre' : 'wallet'; continue; }
    if (el.name.startsWith('f.')) out.filters[el.name.slice(2)] = v; else out[el.name] = v;
  }
  return out;
}

async function act(type, extra = {}) {
  const r = await send({ type, ...extra });
  if (!r.ok) { toast(r.error || tr('Algo falló.'), true); return null; }
  store = r.data; render();
  return r.data;
}

document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const a = b.dataset.act;
  if (a === 'toggle') { const id = b.dataset.id; open.has(id) ? open.delete(id) : open.add(id); render(); return; }
  if (a === 'filter') { filter = b.dataset.f; render(); return; }
  if (a === 'lang') {
    const next = getLang() === 'en' ? 'es' : 'en';
    setLang(next); document.documentElement.lang = next;
    await send({ type: 'saveSettings', settings: { lang: next } });
    render(); return;
  }
  if (a === 'pause') return act('botPause');
  if (a === 'resume') return act('botResume');
  if (a === 'stop') {
    if (b.dataset.armed !== '1') { b.dataset.armed = '1'; b.textContent = tr('¿Seguro? Pulsa otra vez'); setTimeout(() => { if (b.isConnected) { b.dataset.armed = ''; b.textContent = tr('Terminar y cerrar todo'); } }, 4000); return; }
    await act('botStop'); toast(tr('Sesión terminada. Tienes el resumen a la derecha.')); return;
  }
  if (a === 'sell') { b.disabled = true; await act('botSell', { key: b.dataset.key }); return; }
  if (a === 'copyAddr') { try { await navigator.clipboard.writeText(real.address); toast(tr('Dirección copiada.')); } catch { toast(real.address); } return; }
  if (a === 'copySecret') { try { await navigator.clipboard.writeText(realBackup.backup); toast(tr('Copiada. Pégala en un sitio seguro y borra el portapapeles.')); } catch { /* selección manual */ } return; }
  if (a === 'backupDone') { if (!$('[data-ref="savedOk"]')?.checked) { toast(tr('Marca que la has guardado.'), true); return; } realBackup = null; await loadReal(); return; }
  if (a === 'realMode') { const r = await realAct('realConfig', { config: { mode: b.checked ? 'auto' : 'off' } }); if (!r) b.checked = !b.checked; return; }
  if (a === 'realPanic') {
    if (b.dataset.armed !== '1') { b.dataset.armed = '1'; b.textContent = tr('¿Seguro? Pulsa otra vez'); setTimeout(() => { if (b.isConnected) { b.dataset.armed = ''; b.textContent = tr('Pánico: apagar y vender todo'); } }, 4000); return; }
    realBusy = true; render(); await realAct('realPanic'); realBusy = false; toast(tr('Modo real apagado. Vendiendo lo abierto.')); return;
  }
  if (a === 'realLock') { await realAct('realLock'); return; }
  if (a === 'realReclaim') { await realAct('realReclaim'); return; }
  if (a === 'realSellOne') { b.disabled = true; b.textContent = tr('Vendiendo…'); await realAct('realSellOne', { addr: b.dataset.addr }); return; }

  if (a === 'scan') { busy = true; render(); await act('botScanNow'); busy = false; render(); }
});

// Campos numéricos: vacío o inválido = se queda como estaba (nunca se guarda un cero sin querer).
const numIn = (el) => (el && el.value.trim() !== '' && Number.isFinite(Number(el.value)) ? Number(el.value) : undefined);
const defined = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
document.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target.dataset.form;
  if (f === 'cfg') { const r = await act('botConfig', { config: readCfg(e.target) }); if (r) toast(tr('Guardado.')); }
  if (f === 'realCreate') {
    const t = e.target;
    if (t.pw.value !== t.pw2.value) { toast(tr('Las contraseñas no coinciden.'), true); return; }
    if (!t.risk.checked) { toast(tr('Marca que entiendes el riesgo.'), true); return; }
    const btn = t.querySelector('button[type="submit"]'), label = btn.textContent;
    btn.disabled = true; btn.textContent = tr('Creando…');
    const r = await send({ type: 'realCreate', password: t.pw.value, withdrawTo: t.to.value });
    btn.disabled = false; btn.textContent = label;
    if (!r.ok) { toast(r.error, true); return; }
    realBackup = r.data; document.activeElement?.blur(); await loadReal(); return;
  }
  if (f === 'realKey') {
    const pw = e.target.pw.value, what = e.submitter?.value;
    if (!pw) { toast(tr('Escribe la contraseña.'), true); return; }
    if (what === 'export') { const r = await send({ type: 'realExport', password: pw }); if (r.ok) { realBackup = { backup: r.data.backup, address: real.address }; e.target.reset(); render(); } else toast(r.error, true); }
    else { const r = await realAct('realDelete', { password: pw }); if (r) toast(tr('Wallet del bot borrada.')); }
    return;
  }
  if (f === 'realMove') {
    const t = e.target, pw = t.pw.value;
    if (!pw) { toast(tr('Escribe la contraseña.'), true); return; }
    const r = await send({ type: 'realMoveOut', password: pw });
    if (!r.ok) { toast(r.error, true); return; }
    const blob = new Blob([JSON.stringify(r.data.bundle, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `blankfire-wallet-bot-${r.data.bundle.address.slice(0, 6)}.json`;
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    t.reset(); toast(tr('Archivo guardado. Ábrelo en el otro sitio con «Traer wallet».')); await loadReal(); return;
  }
  if (f === 'realMoveIn') {
    const t = e.target, file = t.file.files?.[0];
    if (!file) { toast(tr('Elige el archivo de la wallet del bot.'), true); return; }
    if (file.size > 20000) { toast(tr('Ese archivo no es una wallet del bot de Blankfire.'), true); return; }
    const text = await file.text();
    const r = await realAct('realMoveIn', { bundle: text, password: t.pw.value });
    if (r) toast(tr('Wallet traída y abierta. El modo real sigue apagado hasta que lo enciendas.'));
    return;
  }
  if (f === 'realUnlock') { const btn = e.target.querySelector('button'); btn.disabled = true; const r = await realAct('realUnlock', { password: e.target.pw.value }); btn.disabled = false; if (r) toast(tr(DESKTOP ? 'Wallet abierta hasta que salgas de la app.' : 'Wallet abierta hasta que cierres Opera.')); return; }
  if (f === 'realCfg') { const t = e.target; const r = await realAct('realConfig', { config: defined({ maxSol: numIn(t.maxSol), maxPerDay: numIn(t.maxPerDay), maxDailyLossSol: numIn(t.maxDailyLossSol), maxOpen: numIn(t.maxOpen) }) }); if (r) toast(tr('Guardado.')); return; }
  if (f === 'realWithdraw') { const t = e.target, btn = t.querySelector('button[type="submit"]'); btn.disabled = true; const r = await realAct('realWithdraw', { sol: Number(t.sol.value), all: t.all.checked, password: t.pw.value }); btn.disabled = false; if (r) toast(tr('Retirado a tu Phantom.')); return; }
  if (f === 'copilot') { const t = e.target; const r = await act('botCopilot', { copilot: defined({ on: t.on.checked, maxSol: numIn(t.maxSol), maxPerDay: numIn(t.maxPerDay), ttlMin: numIn(t.ttlMin) }) }); if (r) toast(tr('Guardado.')); }
  if (f === 'start') {
    const budget = Number($('input[name="budgetSol"][form="startForm"]')?.value);
    // Un saldo vacío o mal escrito (p. ej. con coma en un navegador en inglés) no arranca con el mínimo a escondidas.
    if (!(budget >= 0.05 && budget <= 1000)) { toast(tr('Escribe un saldo entre 0,05 y 1000 SOL (con punto: 0.13).'), true); return; }
    const form = $('form[data-form="cfg"]');
    document.activeElement?.blur?.();
    await act('botStart', { config: { ...(form ? readCfg(form) : {}), budgetSol: budget } });
  }
});
document.addEventListener('input', (e) => {
  if (e.target.name === 'stopPct') {
    const v = Number(e.target.value), o = e.target.parentElement.querySelector('output');
    if (o) o.textContent = fmtPct(-v, 1);
    e.target.style.setProperty('--p', `${((v - STOP_MIN) / (STOP_MAX - STOP_MIN)) * 100}%`);
    e.target.setAttribute('aria-valuetext', fmtPct(-v, 1));
  }
  if (['budgetSol', 'sizePct', 'stopPct', 'maxCostPct'].includes(e.target.name)) {
    const form = $('form[data-form="cfg"]'), box = $('[data-ref="cost"]');
    if (!form || !box) return;
    const live = store.session && ['running', 'paused'].includes(store.session.status);
    const base = (live ? store.session.config : store.config) || BOT_DEFAULTS;
    const intro = $('input[name="budgetSol"][form="startForm"]');
    const next = { ...base, ...readCfg(form), filters: base.filters };
    if (!live && intro) next.budgetSol = Number(intro.value) || base.budgetSol;
    box.outerHTML = costBox(next);
  }
});
// Elegir ritmo: se guarda al momento y ajusta todos los valores (se ven en Ajustes avanzados).
document.addEventListener('change', async (e) => {
  if (e.target.name !== 'pace' || e.target.type !== 'radio') return;
  const budget = Number($('input[name="budgetSol"][form="startForm"]')?.value);
  await act('botConfig', { config: { pace: e.target.value, usePace: true, ...(budget > 0 ? { budgetSol: budget } : {}) } });
});
document.addEventListener('toggle', (e) => { if (e.target.classList?.contains('adv')) advOpen = e.target.open; }, true);
document.addEventListener('focusout', () => setTimeout(() => { if (!$('#app').contains(document.activeElement) || !document.activeElement?.form) render(); }, 0));

async function realAct(type, extra = {}) {
  const r = await send({ type, ...extra });
  if (!r.ok) { toast(r.error, true); return null; }
  real = r.data; document.activeElement?.blur?.(); render();
  return r.data;
}
async function loadReal() { const r = await send({ type: 'realState' }); if (r.ok) real = r.data; render(); }
chrome.storage.onChanged.addListener((ch, area) => { if (area === 'local' && ch.blankfireReal) { clearTimeout(loadReal.t); loadReal.t = setTimeout(loadReal, 300); } });
setInterval(() => { if (!document.hidden) loadReal(); }, 60e3);

// El service worker guarda; aquí solo se escucha (con un respiro para no repintar 10 veces por segundo).
let pending = null;
chrome.storage.onChanged.addListener((ch, area) => {
  if (area !== 'local' || !ch[BOT_KEY]) return;
  store = ch[BOT_KEY].newValue || store;
  clearTimeout(pending); pending = setTimeout(render, 120);
});
setInterval(render, 30e3);   // relojes («hace 3 min», «próximo resumen en…»)

(async () => {
  const st = await send({ type: 'state' });
  setLang(st.data?.settings?.lang); document.documentElement.lang = getLang();
  if (st.data?.settings) userSettings = { ...DEFAULT_SETTINGS, ...st.data.settings };
  const r = await send({ type: 'botState' });
  store = r.ok ? r.data : { config: BOT_DEFAULTS, session: null, past: [] };
  render();
  loadReal();
})();
