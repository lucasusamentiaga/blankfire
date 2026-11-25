// Blankfire — repetición de una operación sin ver el futuro (lógica pura).
// Velas: [t (s), open, high, low, close, volumen], de la más antigua a la más nueva.

// Qué habría pasado entrando al cierre de la vela i con un stop y un objetivo.
// Si en la misma vela se tocan los dos, cuenta el stop (lo prudente: no sabemos cuál llegó antes).
export function testEntry(candles, i, { stopPct = 30, tpPct = 100, maxBars = Infinity } = {}, costPct = 0) {
  const c = candles?.[i];
  if (!c || !(c[4] > 0)) return null;
  const entry = c[4], stop = entry * (1 - stopPct / 100), tp = entry * (1 + tpPct / 100);
  let exitIdx = candles.length - 1, exit = candles[exitIdx][4], reason = 'end';
  let peak = entry;
  for (let k = i + 1; k < candles.length && k - i <= maxBars; k++) {
    const [, , hi, lo, cl] = candles[k];
    peak = Math.max(peak, hi);
    if (lo <= stop) { exitIdx = k; exit = stop; reason = 'stop'; break; }
    if (hi >= tp) { exitIdx = k; exit = tp; reason = 'tp'; break; }
    exitIdx = k; exit = cl;
  }
  if (exitIdx === i) return { entryIdx: i, exitIdx: i, entry, exit: entry, reason: 'end', pricePct: 0, netPct: -costPct, bars: 0, peakPct: 0 };
  const pricePct = (exit / entry - 1) * 100;
  return { entryIdx: i, exitIdx, entry, exit, reason, pricePct, netPct: pricePct - costPct, bars: exitIdx - i, peakPct: (peak / entry - 1) * 100 };
}

// Resultado de entrar en cada vela con las mismas reglas: para pintar dónde habría salido bien.
export function entryMap(candles, rules, costPct = 0) {
  return candles.map((_, i) => (i < candles.length - 1 ? testEntry(candles, i, rules, costPct)?.netPct ?? null : null));
}

// Partida: compraste en la vela a y vendiste en la b (a mano), al cierre de cada una.
export function gameResult(candles, a, b, costPct = 0) {
  const ea = candles?.[a]?.[4], eb = candles?.[b]?.[4];
  if (!(ea > 0) || !(eb > 0) || b < a) return null;
  const pricePct = (eb / ea - 1) * 100;
  return { pricePct, netPct: pricePct - costPct, bars: b - a };
}

// Índice de la vela que contiene un instante (ms).
export function indexAt(candles, ms) {
  let best = -1;
  for (let i = 0; i < candles.length; i++) if (candles[i][0] * 1000 <= ms) best = i; else break;
  return best;
}

// Dónde empieza la partida: unas velas antes de tu primera compra, para que tengas contexto pero no el futuro.
export function startIndex(candles, round, lead = 20) {
  const buy = (round?.fills || []).find((f) => f.side === 'buy');
  const i = buy ? indexAt(candles, buy.t) : -1;
  return Math.max(5, Math.min(candles.length - 2, (i >= 0 ? i : 20) - lead));
}
