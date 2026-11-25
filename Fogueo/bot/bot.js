// Blankfire — ventana del bot de práctica. Todo se pinta desde el estado que guarda el service worker.
import { tr, setLang, getLang, locale } from '../lib/i18n.js';
import { pagesNav } from '../lib/pages-nav.js';
import { fmtSol, fmtPct, fmtCompact, fmtDuration, fmtPrice, roundTripPct, DEFAULT_SETTINGS } from '../lib/core.js';
import { BOT_KEY, BOT_DEFAULTS, STOP_MIN, STOP_MAX, RECAP_MS, EXIT_TEXT, copilotGate, cleanCopilot, COPILOT_UNLOCK } from '../lib/bot.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const send = (msg) => new Promise((res) => chrome.runtime.sendMessage(msg, (r) => res(r || { ok: false, error: chrome.runtime.lastError?.message })));

let store = null, filter = 'all', open = new Set(), busy = false, userSettings = DEFAULT_SETTINGS;
let real = null, realBackup = null, realBusy = false;

const AGENTS = {
  smarts: { name: 'Dinero inteligente', what: 'Lee quién compra, cuánto y con qué prisa' },
  trends: { name: 'Tendencias', what: 'Momento del precio, temas de moda y promoción' },
  debate: { name: 'Debate', what: 'Un toro y un oso discuten; el oso puede vetar' },
  router: { name: 'Ruta y slippage', what: 'Tamaño, impacto en el precio y margen de la orden' },
};

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
        <div class="id-r"><h1>${tr('Bot de práctica')}</h1><span class="status st-${cls}"><i></i>${tr(label)}</span></div>
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
  return `<section class="ledger" aria-label="${esc(tr('Números de la sesión'))}">
    <dl>
      <div><dt>${tr('Valor de la sesión')}</dt><dd class="num big">${fmtSol(eq)} <small>/ ${fmtSol(c.budgetSol)} SOL</small></dd></div>
      <div><dt>${tr('Resultado')}</dt><dd class="num ${tone(res)}">${fmtSol(res, { sign: true })} SOL <small>${fmtPct(resPct, 1, { sign: true })}</small></dd></div>
      <div><dt>${tr('Operaciones')}</dt><dd class="num">${s.closed.length} <small>${s.closed.length ? tr('{w} ganadas', { w: wins }) : ''}</small></dd></div>
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
  } else body = `<ul>${(a.notes || []).map((n) => `<li>${say(n)}</li>`).join('')}</ul>`;
  return `<section class="agent ag-${id}">
    <header><h4>${tr(def.name)}</h4>${id === 'router' ? `<span class="tag ${a.ok ? 'ok' : 'no'}">${tr(a.ok ? 'ruta lista' : 'sin ruta')}</span>` : scoreBar(a.score)}</header>
    ${body}
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
    <div class="agents" ${isOpen ? '' : 'hidden'}>${['smarts', 'trends', 'debate', 'router'].map((k) => agentBlock(k, l.agents[k])).join('')}</div>
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

function costBox(cfg) {
  const size = (cfg.budgetSol * cfg.sizePct) / 100;
  const rt = roundTripPct(size, userSettings);
  if (rt == null) return '';
  const tip = Number(userSettings.tipSol) || 0, prio = Number(userSettings.priorityFee) || 0;
  const bad = rt > cfg.maxCostPct;
  return `<div class="cost ${bad ? 'bad' : rt > cfg.stopPct / 2 ? 'warn' : 'ok'}" data-ref="cost">
    <p>${tr('Cada entrada de {s} SOL pierde un {c} solo en entrar y salir (Padre {f} + {t} SOL por orden). Un stop del {st} te costaría en total un {tot}.', { s: fmtSol(size), c: fmtPct(rt, 1), f: fmtPct(userSettings.feePct ?? 1, 1), t: fmtSol(tip + prio), st: fmtPct(-cfg.stopPct, 1), tot: fmtPct(-(cfg.stopPct + rt), 1) })}</p>
    ${bad ? `<p><b>${tr('El bot no comprará con este tamaño: sube el saldo o el % por entrada, o baja la propina de Jito en Ajustes.')}</b></p>` : ''}
  </div>`;
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
      </form></section>`;
  }
  if (!real.unlocked) {
    return `<section class="side-s realb">${head}
      <p class="sm2">${tr('Wallet del bot')}: <code class="addr">${esc(shortA(real.address))}</code></p>
      <p class="hint">${tr('Está cerrada (se cierra sola al cerrar Opera). Mientras esté cerrada, el bot no compra ni vende con dinero real.')}</p>
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
    </details>
    <p class="muted sm2">${tr('Con Opera cerrado no vigila nada. Si dejas posiciones abiertas y cierras, al volver tendrás que abrir la wallet para que el bot pueda venderlas.')}</p>
  </section>`;
}

// ---------- Límites y filtros ----------
function field(name, label, value, { min, max, step = 1, unit = '', disabled = false, note = '' } = {}) {
  return `<label class="fld"><span class="fl">${tr(label)}</span>
    <span class="fi"><input type="number" name="${name}" value="${value}" min="${min}" max="${max}" step="${step}" inputmode="decimal" ${disabled ? 'disabled' : ''}><em>${tr(unit)}</em></span>
    ${note ? `<small>${tr(note)}</small>` : ''}</label>`;
}
function limits(cfg, live) {
  const f = cfg.filters;
  return `<form class="side-s limits" data-form="cfg" novalidate>
    <h3>${tr('Límites duros')}</h3>
    ${live ? field('budgetSol', 'Saldo de la sesión', cfg.budgetSol, { min: 0.1, max: 1000, step: 0.1, unit: 'SOL', disabled: true, note: 'Fijo hasta que termine la sesión.' }) : ''}
    <label class="fld"><span class="fl">${tr('Stop duro')}</span>
      <span class="fr"><span class="ends" aria-hidden="true">−6</span><input type="range" name="stopPct" min="${STOP_MIN}" max="${STOP_MAX}" step="0.5" value="${cfg.stopPct}" style="--p:${((cfg.stopPct - STOP_MIN) / (STOP_MAX - STOP_MIN)) * 100}%" aria-valuetext="${fmtPct(-cfg.stopPct, 1)}"><span class="ends" aria-hidden="true">−8</span><output class="num">${fmtPct(-cfg.stopPct, 1)}</output></span>
      <small>${tr('Siempre entre −6 % y −8 %. Se revisa cada 30 s: en una caída brusca puede salir algo peor.')}</small></label>
    ${costBox(cfg)}
    <div class="row2">
      ${field('sizePct', 'Cada entrada', cfg.sizePct, { min: 2, max: 25, unit: '% del saldo' })}
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
      ${field('f.maxH1Pct', 'Saltar si ya subió en 1 h más de', f.maxH1Pct, { min: 20, max: 10000, step: 10, unit: '%' })}
      <label class="chk"><input type="checkbox" name="f.needSocials" ${f.needSocials ? 'checked' : ''}> ${tr('Saltar monedas sin web ni redes')}</label>
      <p class="muted">${tr('Además, el escudo anti-rug veta las copias de monedas famosas y los gráficos con dibujo de rug.')}</p>
    </details>
    <button class="btn small" type="submit">${tr(live ? 'Aplicar a esta sesión' : 'Guardar')}</button>
  </form>`;
}

// ---------- Sin sesión: cómo decide ----------
function intro(cfg, past) {
  const steps = [
    ['Filtros', 'Descarta lo que no cumple tus mínimos: liquidez, market cap, edad, volumen, redes.'],
    ...Object.values(AGENTS).map((a) => [a.name, a.what]),
    ['Ejecutor', 'Junta las notas (35 % dinero, 25 % tendencias, 40 % debate) y solo compra si pasa el mínimo y hay ruta.'],
  ];
  return `<section class="intro">
    <h2>${tr('Así decide')}</h2>
    <ol class="flow">${steps.map(([n, w]) => `<li><b>${tr(n)}</b><span>${tr(w)}</span></li>`).join('')}</ol>
    <p class="hint">${tr('Mira el mercado cada 2 minutos y vigila las abiertas cada 30 segundos, aunque cierres esta pestaña (Opera tiene que seguir abierto).')}</p>
    <div class="go">
      <label class="fld"><span class="fl">${tr('Saldo de la sesión')}</span><small>${tr('Fijo: no se puede rellenar a mitad de sesión.')}</small><span class="fi"><input type="number" name="budgetSol" form="startForm" value="${cfg.budgetSol}" min="0.1" max="1000" step="0.1"><em>SOL</em></span></label>
      <form id="startForm" data-form="start"><button class="btn primary" type="submit">${tr('Arrancar sesión')}</button></form>
    </div>
    <p class="real">${tr('Dinero real: cuando la simulación vaya en positivo, se desbloquean el copiloto y el modo automático (columna derecha). Blankfire nunca te pedirá la frase de recuperación de tu Phantom.')}</p>
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
  if (ae && $('#app').contains(ae) && ae.form && ['cfg', 'copilot', 'realCreate', 'realUnlock', 'realCfg', 'realWithdraw', 'realKey'].includes(ae.form.dataset.form)) return;   // no pisar lo que escribe
  $('#app').innerHTML = `${header(s)}
    ${s ? ledger(s) : ''}
    <main class="grid">
      <div class="main-col">${s ? stream(s) : intro(cfg, store.past)}${s && !live ? intro(cfg, store.past) : ''}</div>
      <aside class="side">${s ? positions(s) : ''}${s ? recaps(s) : ''}${copilotBlock()}${realBlock()}${limits(cfg, live)}</aside>
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
    const v = el.type === 'checkbox' ? el.checked : Number(el.value);
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
  if (a === 'realSellOne') { b.disabled = true; b.textContent = tr('Vendiendo…'); await realAct('realSellOne', { addr: b.dataset.addr }); return; }

  if (a === 'scan') { busy = true; render(); await act('botScanNow'); busy = false; render(); }
});

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
  if (f === 'realUnlock') { const btn = e.target.querySelector('button'); btn.disabled = true; const r = await realAct('realUnlock', { password: e.target.pw.value }); btn.disabled = false; if (r) toast(tr('Wallet abierta hasta que cierres Opera.')); return; }
  if (f === 'realCfg') { const t = e.target; const r = await realAct('realConfig', { config: { maxSol: Number(t.maxSol.value), maxPerDay: Number(t.maxPerDay.value), maxDailyLossSol: Number(t.maxDailyLossSol.value), maxOpen: Number(t.maxOpen.value) } }); if (r) toast(tr('Guardado.')); return; }
  if (f === 'realWithdraw') { const t = e.target, btn = t.querySelector('button[type="submit"]'); btn.disabled = true; const r = await realAct('realWithdraw', { sol: Number(t.sol.value), all: t.all.checked, password: t.pw.value }); btn.disabled = false; if (r) toast(tr('Retirado a tu Phantom.')); return; }
  if (f === 'copilot') { const t = e.target; const r = await act('botCopilot', { copilot: { on: t.on.checked, maxSol: Number(t.maxSol.value), maxPerDay: Number(t.maxPerDay.value), ttlMin: Number(t.ttlMin.value) } }); if (r) toast(tr('Guardado.')); }
  if (f === 'start') {
    const budget = Number($('input[name="budgetSol"][form="startForm"]')?.value);
    const form = $('form[data-form="cfg"]');
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
