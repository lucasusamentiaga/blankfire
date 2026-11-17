// Blankfire Pro — «Qué pasó después» y errores del trade, calculados sin IA.
// Todo son funciones puras: reciben el trade cerrado y la serie de precios (velas + muestras propias).

const MIN = 60e3;

// Une velas de GeckoTerminal ([t s, o, h, l, c, v]) y muestras propias ([t ms, precio]) en [{ t, p, hi, lo }].
export function buildSeries(candles = [], samples = []) {
  const pts = [];
  for (const c of candles) {
    if (!Array.isArray(c) || c.length < 5) continue;
    const t = Number(c[0]) * 1000, o = Number(c[1]), h = Number(c[2]), l = Number(c[3]), cl = Number(c[4]);
    if (!(t > 0) || !(cl > 0)) continue;
    pts.push({ t, p: cl, hi: Math.max(h || cl, o || cl, cl), lo: Math.min(l || cl, o || cl, cl), src: 'gt' });
  }
  for (const s of samples) {
    const t = Number(s?.[0]), p = Number(s?.[1]);
    if (t > 0 && p > 0) pts.push({ t, p, hi: p, lo: p, src: 'bf' });
  }
  pts.sort((a, b) => a.t - b.t);
  // Dos puntos en el mismo minuto: nos quedamos con la muestra propia (es el precio que usó la app).
  const out = [];
  for (const x of pts) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.t - x.t) < 20e3) {
      if (x.src === 'bf') out[out.length - 1] = { ...x, hi: Math.max(x.hi, last.hi), lo: Math.min(x.lo, last.lo) };
      else { last.hi = Math.max(last.hi, x.hi); last.lo = Math.min(last.lo, x.lo); }
    } else out.push(x);
  }
  return out;
}

const pct = (a, b) => (b > 0 && a > 0 ? (a / b - 1) * 100 : null);

function exitPrice(round) {
  // Precio de mercado al salir (sin el impacto de tu propia venta), para comparar con lo que vino después.
  if (round.exitMidUsd > 0) return round.exitMidUsd;
  const sells = (round.fills || []).filter((f) => f.side === 'sell' && f.price > 0);
  return sells.length ? sells[sells.length - 1].price : null;
}

function entryPrice(round) {
  if (round.avgEntryUsd > 0) return round.avgEntryUsd;
  const buy = (round.fills || []).find((f) => f.side === 'buy' && f.price > 0);
  return buy ? buy.price : null;
}

// Precio más cercano a un instante (dentro de una tolerancia).
function priceNear(series, t, tol = 3 * MIN) {
  let best = null, d = Infinity;
  for (const x of series) { const dd = Math.abs(x.t - t); if (dd < d) { d = dd; best = x; } }
  return best && d <= tol ? best.p : null;
}

function extreme(series, from, to, kind) {
  let best = null;
  for (const x of series) {
    if (x.t < from || x.t > to) continue;
    const v = kind === 'max' ? x.hi : x.lo;
    if (!best || (kind === 'max' ? v > best.v : v < best.v)) best = { v, t: x.t };
  }
  return best;
}

// Hechos del trade: antes de entrar, durante y después de vender.
export function tradeFacts(round, series, now = Date.now()) {
  const eP = entryPrice(round), xP = exitPrice(round);
  const tIn = round.openedAt, tOut = round.closedAt;
  const afterEnd = Math.min(tOut + 60 * MIN, now);
  const coverMin = Math.max(0, Math.round((Math.min(afterEnd, series.length ? series[series.length - 1].t : tOut) - tOut) / MIN));
  const pre = priceNear(series.filter((x) => x.t <= tIn), tIn - 15 * MIN, 8 * MIN);
  const peak = extreme(series, tIn, tOut, 'max');
  const maxAfter = extreme(series, tOut + 1, afterEnd, 'max');
  const minAfter = extreme(series, tOut + 1, afterEnd, 'min');
  const at = (m) => (now >= tOut + m * MIN ? priceNear(series, tOut + m * MIN, Math.max(2, m / 4) * MIN) : null);
  const f = {
    entryPrice: eP, exitPrice: xP,
    holdMin: Math.max(0, Math.round((tOut - tIn) / MIN)),
    // Cuánto venía subiendo antes de entrar: con velas, 15 min; si no, el cambio de 1 h que daba DexScreener al comprar.
    prePumpPct: pre && eP ? pct(eP, pre) : Number.isFinite(round.preChange?.h1) ? round.preChange.h1 : null,
    prePumpWin: pre && eP ? 15 : Number.isFinite(round.preChange?.h1) ? 60 : null,
    peakPct: peak && eP ? Math.max(pct(peak.v, eP), round.pnlPct ?? -Infinity) : null,   // máximo mientras estabas dentro
    afterMaxPct: maxAfter && xP ? pct(maxAfter.v, xP) : null,
    afterMaxMin: maxAfter ? Math.round((maxAfter.t - tOut) / MIN) : null,
    afterMinPct: minAfter && xP ? pct(minAfter.v, xP) : null,
    afterMinMin: minAfter ? Math.round((minAfter.t - tOut) / MIN) : null,
    after5Pct: (() => { const p = at(5); return p && xP ? pct(p, xP) : null; })(),
    after15Pct: (() => { const p = at(15); return p && xP ? pct(p, xP) : null; })(),
    after60Pct: (() => { const p = at(60); return p && xP ? pct(p, xP) : null; })(),
    coverMin,
    points: series.length,
  };
  // «Habrías ganado hasta X más» / «te ahorraste X» (aproximado: sin impacto ni comisiones extra).
  f.missedSol = f.afterMaxPct > 0 ? round.returnedSol * (f.afterMaxPct / 100) : 0;
  f.avoidedSol = f.afterMinPct < 0 ? round.returnedSol * (-f.afterMinPct / 100) : 0;
  return f;
}

// Errores y aciertos con reglas claras. Cada uno: { id, sev: 'high'|'mid'|'low', vars }
export function tradeFlags(round, facts, ctx = {}) {
  const errors = [], wins = [];
  const reason = round.reason || 'manual';
  const stopped = reason === 'sl' || reason === 'trail';
  if (facts.prePumpPct != null && facts.prePumpPct >= 40) errors.push({ id: 'fomo', sev: facts.prePumpPct >= 80 ? 'high' : 'mid', vars: { pct: facts.prePumpPct, win: facts.prePumpWin } });
  const sc = round.screen;
  if (sc?.verdict === 'avoid') errors.push({ id: 'riskyEntry', sev: 'high', vars: { risks: sc.risks || [] } });
  else if (sc?.verdict === 'care') errors.push({ id: 'riskyEntry', sev: 'low', vars: { risks: sc.risks || [], care: true } });
  if (!round.slAtEntry && round.slAtEntry !== undefined) errors.push({ id: 'noStop', sev: round.pnlPct <= -30 ? 'high' : 'mid', vars: {} });
  if (ctx.sizePct != null && ctx.sizePct > 20) errors.push({ id: 'oversized', sev: ctx.sizePct > 40 ? 'high' : 'mid', vars: { pct: ctx.sizePct } });
  if (!stopped && facts.afterMaxPct != null && facts.afterMaxPct >= 50 && round.pnlSol > -Infinity) errors.push({ id: 'soldEarly', sev: facts.afterMaxPct >= 150 ? 'high' : 'mid', vars: { pct: facts.afterMaxPct, min: facts.afterMaxMin, sol: facts.missedSol } });
  if (stopped && facts.after15Pct != null && facts.entryPrice && facts.exitPrice && facts.exitPrice * (1 + facts.after15Pct / 100) >= facts.entryPrice) errors.push({ id: 'stopTight', sev: 'mid', vars: { pct: facts.after15Pct } });
  if (facts.peakPct != null && facts.peakPct >= 30 && round.pnlPct < 0) errors.push({ id: 'gaveBack', sev: facts.peakPct >= 80 ? 'high' : 'mid', vars: { peak: facts.peakPct, pnl: round.pnlPct } });
  if (round.feesSol > 0 && round.investedSol > 0 && round.feesSol / round.investedSol >= 0.03 && Math.abs(round.pnlSol) < round.feesSol * 2) errors.push({ id: 'fees', sev: 'low', vars: { sol: round.feesSol, pct: (round.feesSol / round.investedSol) * 100 } });
  if (ctx.revengeMin != null && ctx.revengeMin <= 3) errors.push({ id: 'revenge', sev: 'mid', vars: { min: ctx.revengeMin } });
  if (round.followedPlan === false) errors.push({ id: 'noPlan', sev: 'mid', vars: {} });
  if (!stopped && round.pnlPct <= -50) errors.push({ id: 'heldLoser', sev: 'high', vars: { pnl: round.pnlPct } });
  // Aciertos
  if (facts.afterMinPct != null && facts.afterMinPct <= -25 && !(facts.afterMaxPct >= 20)) wins.push({ id: 'goodExit', vars: { pct: facts.afterMinPct, sol: facts.avoidedSol } });
  if (stopped && facts.after15Pct != null && facts.after15Pct <= -10) wins.push({ id: 'stopSaved', vars: { pct: facts.after15Pct } });
  if (sc?.verdict === 'good') wins.push({ id: 'cleanEntry', vars: {} });
  if (round.followedPlan === true) wins.push({ id: 'plan', vars: {} });
  if (round.slAtEntry) wins.push({ id: 'hadStop', vars: {} });
  const order = { high: 0, mid: 1, low: 2 };
  errors.sort((a, b) => order[a.sev] - order[b.sev]);
  return { errors: errors.slice(0, 5), wins: wins.slice(0, 3) };
}

// Contexto de la cuenta: tamaño frente al patrimonio de ese momento y si fue un trade «de venganza».
export function tradeContext(round, account) {
  const eq = (account?.equity || []).filter((x) => x.t <= round.openedAt);
  const before = eq.length ? eq[eq.length - 1].v : account?.startBalance;
  const sizePct = before > 0 && round.investedSol > 0 ? (round.investedSol / before) * 100 : null;
  const prev = (account?.rounds || []).filter((r) => r.id !== round.id && r.closedAt <= round.openedAt).sort((a, b) => b.closedAt - a.closedAt)[0];
  const revengeMin = prev && prev.pnlSol < 0 ? Math.round((round.openedAt - prev.closedAt) / MIN) : null;
  return { sizePct, revengeMin };
}

// Ventana de velas que hay que pedir: de 20 min antes de entrar a 60 min después de salir.
export function candleWindow(round, now = Date.now()) {
  const from = round.openedAt - 20 * MIN;
  const to = Math.min(round.closedAt + 60 * MIN, now);
  const span = (to - from) / MIN;
  const [timeframe, aggregate] = span <= 900 ? ['minute', 1] : span <= 4500 ? ['minute', 5] : span <= 13500 ? ['minute', 15] : ['hour', 1];
  const step = timeframe === 'hour' ? 60 * aggregate : aggregate;
  return { from, to, timeframe, aggregate, limit: Math.min(1000, Math.ceil(span / step) + 5) };
}
