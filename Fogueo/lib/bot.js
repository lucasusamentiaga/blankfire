// Blankfire — Bot de práctica (lógica pura, sin red ni DOM).
// Cuatro agentes opinan por separado sobre cada moneda candidata y un ejecutor decide con límites duros.
// Todo en SOL ficticios con un saldo propio de sesión: nunca toca la cuenta del usuario ni una wallet real.
//
// Las notas de cada agente se guardan como { t: texto en español, v: variables } y se traducen al pintarlas,
// así el registro cambia de idioma con el resto de la extensión.

export const BOT_KEY = 'blankfireBot';
export const STOP_MIN = 6, STOP_MAX = 8;
export const RECAP_MS = 12 * 3600e3;
export const LOG_MAX = 400;

export const BOT_DEFAULTS = {
  budgetSol: 10,         // saldo fijo de la sesión (no se puede rellenar a mitad)
  sizePct: 10,           // cada entrada usa este % del saldo de la sesión
  maxOpen: 3,            // posiciones abiertas a la vez
  stopPct: 7,            // stop duro, siempre entre 6 % y 8 %
  tpPct: 40,             // recoge todo al +40 %
  trailArmPct: 15,       // a partir de +15 % activa el stop que sigue al precio…
  trailPct: 10,          // …que vende si cae un 10 % desde el máximo
  maxHoldMin: 45,        // si en 45 min no ha hecho nada (< +5 %), fuera
  maxLossPct: 25,        // si la sesión pierde un 25 %, el bot se para solo
  cooldownMin: 60,       // no repite la misma moneda en 1 h
  minScore: 0.3,         // nota mínima del consejo (de −1 a +1) para entrar
  maxImpactPct: 3,       // la ruta reduce el tamaño hasta mover el precio ≤ 3 %
  maxCostPct: 8,         // entrar y salir al momento no puede costar más de un 8 % (comisiones + impacto)
  filters: {
    minLiqUsd: 15000,
    minMcUsd: 25000,
    maxMcUsd: 5000000,
    minAgeMin: 15,
    maxAgeH: 72,
    minVolH1Usd: 5000,
    maxH1Pct: 300,       // ya subió más de ×4 en la última hora: llegas tarde
    needSocials: true,
  },
};

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const num = (x) => (Number.isFinite(Number(x)) ? Number(x) : null);
const note = (t, v) => (v ? { t, v } : { t });
// Los números de las notas se guardan marcados y la ventana los formatea en el idioma de cada momento:
// «%+:12.5» → «+12,5 %» / «+12.5%», «%:12.5» sin signo, «$:15000» → «$15K», «S:1.25» → «1,25» SOL.
const pctTxt = (x, d = 0, signed = true) => `${signed ? '%+' : '%'}:${Math.round(x * 10 ** d) / 10 ** d}`;
const usdTxt = (x) => `$:${Math.round(x)}`;
const pctAbs = (x, d = 0) => pctTxt(x, d, false);

// Configuración saneada: lo que venga de la ventana nunca rompe los límites duros.
export function cleanConfig(c = {}) {
  const d = BOT_DEFAULTS, f = { ...d.filters, ...(c.filters || {}) };
  const n = (v, def, a, b) => { const x = Number(v); return Number.isFinite(x) ? clamp(x, a, b) : def; };
  return {
    budgetSol: n(c.budgetSol, d.budgetSol, 0.1, 1000),
    sizePct: n(c.sizePct, d.sizePct, 2, 25),
    maxOpen: Math.round(n(c.maxOpen, d.maxOpen, 1, 6)),
    stopPct: n(c.stopPct, d.stopPct, STOP_MIN, STOP_MAX),
    tpPct: n(c.tpPct, d.tpPct, 10, 300),
    trailArmPct: n(c.trailArmPct, d.trailArmPct, 5, 100),
    trailPct: n(c.trailPct, d.trailPct, 4, 30),
    maxHoldMin: Math.round(n(c.maxHoldMin, d.maxHoldMin, 5, 480)),
    maxLossPct: n(c.maxLossPct, d.maxLossPct, 5, 60),
    cooldownMin: Math.round(n(c.cooldownMin, d.cooldownMin, 5, 1440)),
    minScore: n(c.minScore, d.minScore, 0, 0.9),
    maxImpactPct: n(c.maxImpactPct, d.maxImpactPct, 0.5, 10),
    maxCostPct: n(c.maxCostPct, d.maxCostPct, 2, 15),
    filters: {
      minLiqUsd: n(f.minLiqUsd, d.filters.minLiqUsd, 0, 1e8),
      minMcUsd: n(f.minMcUsd, d.filters.minMcUsd, 0, 1e10),
      maxMcUsd: n(f.maxMcUsd, d.filters.maxMcUsd, 1e4, 1e11),
      minAgeMin: n(f.minAgeMin, d.filters.minAgeMin, 0, 1440),
      maxAgeH: n(f.maxAgeH, d.filters.maxAgeH, 1, 24 * 365),
      minVolH1Usd: n(f.minVolH1Usd, d.filters.minVolH1Usd, 0, 1e9),
      maxH1Pct: n(f.maxH1Pct, d.filters.maxH1Pct, 20, 10000),
      needSocials: f.needSocials !== false,
    },
  };
}

export function freshSession(config, now = Date.now()) {
  const cfg = cleanConfig(config);
  return {
    id: 's' + now.toString(36), startedAt: now, status: 'running', haltReason: null,
    config: cfg, balance: cfg.budgetSol, positions: {}, closed: [], log: [], recaps: [],
    lastScanAt: 0, lastRecapAt: now, seen: {}, stats: { scanned: 0, skipped: 0, buys: 0 },
  };
}

// ---------- Filtros: descartes rápidos antes de gastar peticiones en los agentes ----------
export function filterPair(pair, cfg, { now = Date.now(), held = {}, recent = {} } = {}) {
  const f = cfg.filters, why = [];
  const addr = pair?.baseToken?.address;
  if (pair?.chainId !== 'solana' || !addr) return [note('no es de Solana')];
  if (held[addr]) return [note('ya la tiene abierta')];
  if (recent[addr] && now - recent[addr] < cfg.cooldownMin * 60e3) return [note('la tocó hace poco (espera {m} min)', { m: cfg.cooldownMin })];
  const liq = num(pair.liquidity?.usd) || 0, mc = num(pair.marketCap ?? pair.fdv) || 0;
  const ageMin = pair.pairCreatedAt ? (now - pair.pairCreatedAt) / 60e3 : null;
  const volH1 = num(pair.volume?.h1) || 0, h1 = num(pair.priceChange?.h1);
  if (liq < f.minLiqUsd) why.push(note('liquidez {v} (mínimo {m})', { v: usdTxt(liq), m: usdTxt(f.minLiqUsd) }));
  if (mc < f.minMcUsd) why.push(note('market cap {v} (mínimo {m})', { v: usdTxt(mc), m: usdTxt(f.minMcUsd) }));
  if (mc > f.maxMcUsd) why.push(note('market cap {v} (máximo {m})', { v: usdTxt(mc), m: usdTxt(f.maxMcUsd) }));
  if (ageMin != null && ageMin < f.minAgeMin) why.push(note('tiene {m} min: demasiado nueva', { m: Math.max(0, Math.round(ageMin)) }));
  if (ageMin != null && ageMin > f.maxAgeH * 60) why.push(note('tiene más de {h} h', { h: f.maxAgeH }));
  if (volH1 < f.minVolH1Usd) why.push(note('volumen de la última hora {v}', { v: usdTxt(volH1) }));
  if (h1 != null && h1 > f.maxH1Pct) why.push(note('ya subió {v} en una hora: llega tarde', { v: pctTxt(h1) }));
  const info = pair.info || {};
  if (f.needSocials && !(info.socials?.length || info.websites?.length)) why.push(note('sin web ni redes'));
  return why;
}

// ---------- Agente 1 · Dinero inteligente ----------
// Mientras no sigamos wallets concretas (fase 4), lee el flujo de órdenes: quién compra, cuánto y con qué prisa.
export function smartsAgent(pair, { tracked = null, now = Date.now() } = {}) {
  const t5 = pair?.txns?.m5, t1 = pair?.txns?.h1;
  // Wallets que sigues (Radar): si alguna ha comprado hace poco, es la señal más fuerte que hay.
  const follow = tracked?.length ? note('{n}, que sigues, compró hace {m} min', { n: tracked[0].name || tracked[0].wallet.slice(0, 4) + '…', m: Math.max(0, Math.round((now - Math.max(...tracked.map((x) => x.at))) / 60e3)) }) : null;
  if (!t5 || !t1) return { id: 'smarts', score: follow ? 0.4 : null, notes: follow ? [follow] : [note('sin datos de operaciones')] };
  const b5 = +t5.buys || 0, s5 = +t5.sells || 0, b1 = +t1.buys || 0, s1 = +t1.sells || 0;
  const v5 = num(pair.volume?.m5) || 0, v1 = num(pair.volume?.h1) || 0;
  if (b1 + s1 < 20) return { id: 'smarts', score: follow ? 0.1 : -0.3, notes: [...(follow ? [follow] : []), note('solo {n} operaciones en una hora: nadie mira', { n: b1 + s1 })] };
  const r5 = b5 + s5 ? b5 / (b5 + s5) : 0.5, r1 = b1 / (b1 + s1);
  const avg = v1 / (b1 + s1), accel = v1 > 0 ? (v5 * 12) / v1 : 0;
  let score = 0; const notes = [];
  if (r5 >= 0.6) { score += 0.4; notes.push(note('{p} de las órdenes de 5 min son compras', { p: pctAbs(r5 * 100) })); }
  else if (r5 <= 0.42) { score -= 0.4; notes.push(note('dominan las ventas ({p} compras)', { p: pctAbs(r5 * 100) })); }
  if (avg >= 300 && r1 >= 0.55) { score += 0.3; notes.push(note('compras grandes: {v} de media', { v: usdTxt(avg) })); }
  else if (avg < 40) { score -= 0.2; notes.push(note('órdenes diminutas ({v} de media): huele a bots', { v: usdTxt(avg) })); }
  if (accel >= 1.5 && r5 > 0.5) { score += 0.3; notes.push(note('el volumen acelera (×{x} sobre la media de la hora)', { x: accel.toFixed(1) })); }
  else if (accel < 0.5) { score -= 0.3; notes.push(note('el volumen se apaga')); }
  if (follow) { score += 0.4; notes.unshift(follow); }
  if (!notes.length) notes.push(note('flujo neutro'));
  return { id: 'smarts', score: clamp(score, -1, 1), notes, data: { r5, r1, avg, accel } };
}

// ---------- Agente 2 · Tendencias ----------
const STOP_WORDS = new Set(['the', 'of', 'and', 'coin', 'token', 'sol', 'on', 'a', 'el', 'la', 'de', 'inu', 'ai']);
export const words = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w.length >= 3 && !STOP_WORDS.has(w));
// Temas que se repiten entre las monedas que están saliendo ahora (el «meta»).
export function metaWords(pairs) {
  const count = new Map();
  for (const p of pairs || []) for (const w of new Set([...words(p?.baseToken?.name), ...words(p?.baseToken?.symbol)])) count.set(w, (count.get(w) || 0) + 1);
  return count;
}
export function trendsAgent(pair, ctx = {}) {
  const addr = pair?.baseToken?.address;
  let score = 0; const notes = [];
  const h1 = num(pair?.priceChange?.h1), m5 = num(pair?.priceChange?.m5);
  if (h1 != null) {
    if (h1 >= 10 && h1 <= 150) { score += 0.3; notes.push(note('sube {v} en la última hora', { v: pctTxt(h1) })); }
    else if (h1 > 150) { score -= 0.2; notes.push(note('ya ha corrido mucho ({v} en 1 h)', { v: pctTxt(h1) })); }
    else if (h1 <= -30) { score -= 0.4; notes.push(note('cae {v} en la última hora', { v: pctTxt(h1) })); }
  }
  if (m5 != null && m5 <= -15) { score -= 0.3; notes.push(note('se desploma ahora mismo ({v} en 5 min)', { v: pctTxt(m5) })); }
  const meta = ctx.meta;
  if (meta) {
    const hot = [...new Set(words(pair?.baseToken?.name).concat(words(pair?.baseToken?.symbol)))].map((w) => [w, (meta.get(w) || 0) - 1]).filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1])[0];
    if (hot) { score += 0.3; notes.push(note('tema de moda: «{w}» ({n} monedas más)', { w: hot[0], n: hot[1] })); }
  }
  if (ctx.boosted?.has(addr)) { score += 0.1; notes.push(note('alguien paga por promocionarla en DexScreener')); }
  if (!notes.length) notes.push(note('sin tendencia clara'));
  return { id: 'trends', score: clamp(score, -1, 1), notes };
}

// ---------- Agente 3 · Debate (toro contra oso, con derecho a veto) ----------
export function debateAgent(pair, { smarts, trends, shield } = {}) {
  const bull = [], bear = []; let veto = null;
  const liq = num(pair?.liquidity?.usd) || 0, mc = num(pair?.marketCap ?? pair?.fdv) || 0;
  const ratio = mc ? liq / mc : 0;
  if (ratio >= 0.12) bull.push([0.2, note('liquidez sana para su tamaño ({p} del market cap)', { p: pctAbs(ratio * 100) })]);
  else if (ratio < 0.05) bear.push([0.35, note('poca liquidez para su tamaño ({p} del market cap)', { p: pctAbs(ratio * 100, 1) })]);
  if (smarts?.score > 0.3) bull.push([0.3, note('el dinero entra con fuerza')]);
  if (smarts?.score < -0.2) bear.push([0.3, note('el dinero sale')]);
  if (trends?.score > 0.3) bull.push([0.25, note('va con la tendencia')]);
  if (trends?.score < -0.2) bear.push([0.25, note('va contra la tendencia')]);
  const info = pair?.info || {};
  if ((info.socials?.length || 0) + (info.websites?.length || 0) >= 2) bull.push([0.1, note('tiene web y redes')]);
  const ch = shield?.chart, cp = shield?.copies;
  if (ch?.level === 'bad') veto = note('el gráfico tiene dibujo de rug');
  else if (ch?.level === 'warn') bear.push([0.3, note('el gráfico enseña señales raras')]);
  if (cp?.level === 'bad') veto = veto || note('copia de una moneda famosa anterior');
  else if (cp?.level === 'warn') bear.push([0.25, note('hay copias con el mismo nombre')]);
  else if (cp?.kind === 'leader') bull.push([0.15, note('es la que va ganando entre las de su nombre')]);
  if (ratio > 0 && ratio < 0.02) veto = veto || note('liquidez ridícula: no podrías salir');
  const sum = (a) => a.reduce((s, [w]) => s + w, 0);
  const score = clamp(sum(bull) - sum(bear), -1, 1);
  return { id: 'debate', score: veto ? -1 : score, veto, bull: bull.map(([, n]) => n), bear: bear.map(([, n]) => n), notes: veto ? [veto] : [] };
}

// ---------- Agente 4 · Ruta y slippage ----------
// simulateBuy viene de core.js (mismo modelo de impacto que el panel). jup: cotización de Jupiter si la hay.
export function routerAgent({ quote, sizeSol, solUsd, settings, cfg, simulateBuy, simulateSell, jup }) {
  let size = sizeSol, sim = null;
  for (let i = 0; i < 8; i++) {
    sim = simulateBuy({ solIn: size, quote, solUsd, settings: { ...settings, maxSlippagePct: 99 } });
    if (!sim || !(sim.qty > 0)) break;
    if (sim.impactPct <= cfg.maxImpactPct || size <= 0.02) break;
    size = Math.max(0.02, size * 0.7);
  }
  if (!sim || !(sim.qty > 0)) return { id: 'router', ok: false, score: null, notes: [note('sin precio para calcular la ruta')] };
  if (sim.impactPct > cfg.maxImpactPct) return { id: 'router', ok: false, score: -1, notes: [note('ni con la entrada mínima baja de {v} de impacto', { v: pctAbs(sim.impactPct, 1) })] };
  // Ida y vuelta al mismo precio: lo que se pierde solo por comisiones, coste por transacción e impacto.
  let costPct = null;
  if (simulateSell) {
    const back = simulateSell({ qty: sim.qty, quote, solUsd, settings: { ...settings, sellSlippagePct: 99 } });
    if (Number.isFinite(back?.netSol) && sim.totalDebit > 0) costPct = (1 - back.netSol / sim.totalDebit) * 100;
  }
  if (costPct != null && costPct > cfg.maxCostPct) {
    return { id: 'router', ok: false, score: -1, costPct, notes: [note('entrar y salir costaría un {v} solo en comisiones: con este tamaño no compensa', { v: pctAbs(costPct, 1) })] };
  }
  const vol = Math.abs(num(quote?.change?.m5) || 0);
  const slip = clamp(Math.ceil(sim.slipPct * 1.5 + vol / 2 + 3), 5, 25);
  const route = jup?.route || (quote?.stage === 'new' ? 'curva de lanzamiento' : quote?.dex || 'pool');
  const notes = [note('entrada de {s} SOL, impacto {i}', { s: `S:${Math.round(size * 1e4) / 1e4}`, i: pctAbs(sim.impactPct, 2) }), note('slippage máximo {v} · ruta: {r}', { v: pctAbs(slip), r: route })];
  if (costPct != null) notes.push(note('ida y vuelta: {v} en comisiones e impacto', { v: pctAbs(costPct, 1) }));
  if (size < sizeSol * 0.99) notes.unshift(note('reduce la entrada para no mover el precio'));
  if (jup?.impactPct != null && Math.abs(jup.impactPct - sim.impactPct) > 2) notes.push(note('Jupiter calcula {v} de impacto', { v: pctAbs(jup.impactPct, 1) }));
  return { id: 'router', ok: true, score: 0, sizeSol: size, slipPct: slip, impactPct: sim.impactPct, costPct, route, notes };
}

// ---------- Ejecutor: junta los votos y decide ----------
export const WEIGHTS = { smarts: 0.35, trends: 0.25, debate: 0.4 };
export function councilScore({ smarts, trends, debate }) {
  let s = 0, w = 0;
  for (const [k, a] of Object.entries({ smarts, trends, debate })) if (a && a.score != null) { s += a.score * WEIGHTS[k]; w += WEIGHTS[k]; }
  return w ? s / w : null;
}
export function decide({ smarts, trends, debate, router }, cfg) {
  const score = councilScore({ smarts, trends, debate });
  if (debate?.veto) return { action: 'skip', score: -1, reason: debate.veto };
  if (score == null) return { action: 'skip', score, reason: note('los agentes no tienen datos suficientes') };
  if (score < cfg.minScore) return { action: 'skip', score, reason: note('nota del consejo {s} (mínimo {m})', { s: score.toFixed(2), m: cfg.minScore.toFixed(2) }) };
  if (!router?.ok) return { action: 'skip', score, reason: router?.notes?.[0] || note('sin ruta') };
  return { action: 'buy', score, reason: note('nota del consejo {s}', { s: score.toFixed(2) }) };
}

// Tamaño de la siguiente entrada: % del saldo de la sesión, nunca más de lo que queda.
export function entrySize(session) {
  const eq = session.config.budgetSol;
  return Math.min(session.balance, Math.max(0.02, (eq * session.config.sizePct) / 100));
}

// ---------- Gestión de cada posición abierta ----------
// pos: { entryPrice, peak, openedAt }. Devuelve el motivo de salida o null.
export function exitReason(pos, price, cfg, now = Date.now()) {
  if (!(price > 0) || !(pos?.entryPrice > 0)) return null;
  const ch = (price / pos.entryPrice - 1) * 100;
  const peak = Math.max(pos.peak || pos.entryPrice, price);
  const fromPeak = (price / peak - 1) * 100;
  const peakCh = (peak / pos.entryPrice - 1) * 100;
  if (ch <= -cfg.stopPct + 1e-9) return { id: 'stop', ch };
  if (ch >= cfg.tpPct - 1e-9) return { id: 'tp', ch };
  if (peakCh >= cfg.trailArmPct && fromPeak <= -cfg.trailPct) return { id: 'trail', ch };
  if (now - pos.openedAt > cfg.maxHoldMin * 60e3 && ch < 5) return { id: 'time', ch };
  return null;
}
export const EXIT_TEXT = {
  stop: 'stop duro ({v})', tp: 'objetivo cumplido ({v})', trail: 'el precio se dio la vuelta desde el máximo ({v})',
  time: 'no se movió en {m} min ({v})', halt: 'sesión parada ({v})', manual: 'cerrada a mano ({v})',
};

// Valor de la sesión: saldo libre + lo que darían las abiertas si se vendieran ahora (valueSol[k], en SOL).
export function sessionEquity(session, valueSol = {}) {
  let v = session.balance;
  for (const [k, p] of Object.entries(session.positions)) v += Number.isFinite(valueSol[k]) ? valueSol[k] : (p.valueSol ?? p.costSol);
  return v;
}

// Pérdida máxima de la sesión: si se pasa, el bot se para (y no vuelve a arrancar solo).
export function lossHit(session, equity) {
  return (equity / session.config.budgetSol - 1) * 100 <= -session.config.maxLossPct;
}

// ---------- Registro ----------
export function pushLog(session, entry, now = Date.now()) {
  session.log.push({ at: now, ...entry });
  if (session.log.length > LOG_MAX) session.log.splice(0, session.log.length - LOG_MAX);
}

// ---------- Resumen de 12 horas ----------
export function makeRecap(session, from, to) {
  const closed = session.closed.filter((c) => c.closedAt >= from && c.closedAt < to);
  const pnl = closed.reduce((s, c) => s + c.pnlSol, 0);
  const wins = closed.filter((c) => c.pnlSol > 0).length;
  const reasons = new Map();
  session.log.filter((l) => l.at >= from && l.at < to && l.kind === 'skip' && l.reason).forEach((l) => {
    const r = reasons.get(l.reason.t) || { t: l.reason.t, v: l.reason.v, n: 0 };
    r.n++; reasons.set(l.reason.t, r);
  });
  const topSkips = [...reasons.values()].sort((a, b) => b.n - a.n).slice(0, 3);
  const exits = {};
  closed.forEach((c) => { exits[c.exit] = (exits[c.exit] || 0) + 1; });
  const best = closed.slice().sort((a, b) => b.pnlPct - a.pnlPct)[0] || null;
  const worst = closed.slice().sort((a, b) => a.pnlPct - b.pnlPct)[0] || null;
  const scanned = session.log.filter((l) => l.at >= from && l.at < to && (l.kind === 'skip' || l.kind === 'buy')).length;
  return {
    from, to, trades: closed.length, wins, losses: closed.length - wins, pnlSol: pnl,
    winRate: closed.length ? wins / closed.length : null, best: best && { symbol: best.symbol, pnlPct: best.pnlPct },
    worst: worst && { symbol: worst.symbol, pnlPct: worst.pnlPct }, exits, topSkips, scanned,
    balance: session.balance, open: Object.keys(session.positions).length,
  };
}

// ---------- Fase 5 · Copiloto con dinero real ----------
// El bot no firma ni toca ninguna wallet: cuando decide comprar o vender en la simulación, te avisa con
// tamaño, slippage y stop para que lo hagas tú en Padre (con una wallet aparte y poco saldo).
// Se desbloquea solo cuando la simulación ha demostrado algo: suficientes operaciones y resultado positivo tras comisiones.
export const COPILOT_UNLOCK = { trades: 20, netSol: 0 };
export const COPILOT_DEFAULTS = { on: false, maxSol: 0.1, maxPerDay: 5, ttlMin: 3 };

export function cleanCopilot(c = {}) {
  const n = (v, d, a, b) => { const x = Number(v); return Number.isFinite(x) ? Math.min(b, Math.max(a, x)) : d; };
  return {
    on: c.on === true,
    maxSol: n(c.maxSol, COPILOT_DEFAULTS.maxSol, 0.01, 5),
    maxPerDay: Math.round(n(c.maxPerDay, COPILOT_DEFAULTS.maxPerDay, 1, 30)),
    ttlMin: Math.round(n(c.ttlMin, COPILOT_DEFAULTS.ttlMin, 1, 15)),
  };
}

// Todas las operaciones simuladas cerradas (sesión actual y anteriores guardadas).
export function copilotGate(store) {
  const s = store?.session;
  let trades = (store?.past || []).reduce((a, p) => a + (p.trades || 0), 0);
  let net = (store?.past || []).reduce((a, p) => a + ((p.balance ?? p.budgetSol) - p.budgetSol), 0);
  if (s) {
    trades += s.closed.length;
    net += s.closed.reduce((a, c) => a + c.pnlSol, 0);
  }
  const ok = trades >= COPILOT_UNLOCK.trades && net > COPILOT_UNLOCK.netSol;
  return { ok, trades, net, need: Math.max(0, COPILOT_UNLOCK.trades - trades) };
}

// Señales enviadas hoy (para el límite diario).
export function signalsToday(signals, now = Date.now()) {
  const d = new Date(now); d.setHours(0, 0, 0, 0);
  return (signals || []).filter((x) => x.kind === 'buy' && x.at >= d.getTime()).length;
}
