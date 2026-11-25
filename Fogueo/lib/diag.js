// Blankfire — diagnóstico de errores sobre las operaciones cerradas (funciones puras).
// Responde a «¿dónde pierdo?»: por tramo de market cap al entrar, por repetir la misma moneda,
// por franja horaria y por cuánto tiempo aguantas. Solo saca conclusiones con muestras suficientes.

const H = 3600e3;
export const MC_BANDS = [
  { id: 'micro', max: 20e3, label: 'menos de $20K' },
  { id: 'small', max: 100e3, label: '$20K – $100K' },
  { id: 'mid', max: 500e3, label: '$100K – $500K' },
  { id: 'large', max: 2e6, label: '$500K – $2M' },
  { id: 'huge', max: Infinity, label: 'más de $2M' },
];
export const HOUR_BANDS = [[0, 4], [4, 8], [8, 12], [12, 16], [16, 20], [20, 24]];
export const HOLD_BANDS = [
  { id: 'flash', max: 2 * 60e3, label: 'menos de 2 min' },
  { id: 'short', max: 15 * 60e3, label: '2 – 15 min' },
  { id: 'mid', max: 60 * 60e3, label: '15 – 60 min' },
  { id: 'long', max: Infinity, label: 'más de 1 h' },
];
export const MIN_SAMPLE = 3;
export const REENTRY_WINDOW = 2 * H;

function group(list) {
  const n = list.length, wins = list.filter((r) => r.pnlSol > 0).length;
  const net = list.reduce((a, r) => a + (r.pnlSol || 0), 0);
  const inv = list.reduce((a, r) => a + (r.investedSol || 0), 0);
  return { n, wins, winRate: n ? (wins / n) * 100 : null, net, avg: n ? net / n : null, roi: inv > 0 ? (net / inv) * 100 : null };
}

const tokenOf = (r) => r.key || (r.address ? `${r.chain || 'solana'}:${r.address}` : r.symbol);

// Re-entrada: abriste la misma moneda menos de 2 h después de cerrar otra operación en ella.
export function markReentries(rounds) {
  const sorted = [...rounds].sort((a, b) => a.openedAt - b.openedAt);
  const lastClose = new Map(), out = new Map();
  for (const r of sorted) {
    const k = tokenOf(r), prev = lastClose.get(k);
    out.set(r.id ?? r, prev != null && r.openedAt - prev.closedAt >= 0 && r.openedAt - prev.closedAt <= REENTRY_WINDOW ? { afterLoss: prev.pnlSol <= 0 } : null);
    if (!prev || r.closedAt > prev.closedAt) lastClose.set(k, r);
  }
  return out;
}

export function diagnose(rounds, { tzOffsetMin = new Date().getTimezoneOffset() } = {}) {
  const list = (rounds || []).filter((r) => r && r.closedAt && r.openedAt);
  const all = group(list);
  const hourOf = (t) => {
    const d = new Date(t - tzOffsetMin * 60e3);
    return d.getUTCHours();
  };
  const byMc = MC_BANDS.map((b, i) => {
    const lo = i ? MC_BANDS[i - 1].max : 0;
    return { ...b, ...group(list.filter((r) => r.entryMcUsd > 0 && r.entryMcUsd >= lo && r.entryMcUsd < b.max)) };
  });
  const byHour = HOUR_BANDS.map(([a, b]) => ({ id: `${a}-${b}`, from: a, to: b, ...group(list.filter((r) => { const h = hourOf(r.openedAt); return h >= a && h < b; })) }));
  const byHold = HOLD_BANDS.map((b, i) => {
    const lo = i ? HOLD_BANDS[i - 1].max : 0;
    return { ...b, ...group(list.filter((r) => { const d = r.closedAt - r.openedAt; return d >= lo && d < b.max; })) };
  });
  const re = markReentries(list);
  const reList = list.filter((r) => re.get(r.id ?? r));
  const reentry = {
    re: group(reList),
    afterLoss: group(reList.filter((r) => re.get(r.id ?? r)?.afterLoss)),
    first: group(list.filter((r) => !re.get(r.id ?? r))),
  };
  return { all, byMc, byHour, byHold, reentry, findings: findings({ all, byMc, byHour, byHold, reentry }) };
}

// Conclusiones con pruebas. Cada una: { id, sev: 'bad'|'good', t, v } con t traducible y v sus datos.
export function findings(d) {
  const out = [];
  if (d.all.n < 5) return out;
  const ok = (g) => g.n >= MIN_SAMPLE;
  // 1) Tramo de market cap que más resta (y el que mejor te va).
  const mc = d.byMc.filter(ok);
  const worstMc = mc.filter((g) => g.net < 0).sort((a, b) => a.net - b.net)[0];
  const bestMc = mc.filter((g) => g.net > 0).sort((a, b) => b.net - a.net)[0];
  if (worstMc) out.push({ id: 'mc', sev: 'bad', t: 'Entrando con market cap de {band} pierdes: {n} operaciones, {wr} de acierto, {net} SOL.', v: { band: worstMc.label, n: worstMc.n, wr: worstMc.winRate, net: worstMc.net }, band: worstMc.id });
  if (bestMc && (!worstMc || bestMc.id !== worstMc.id)) out.push({ id: 'mcBest', sev: 'good', t: 'Donde mejor te va es entre {band}: {n} operaciones, {wr} de acierto, {net} SOL.', v: { band: bestMc.label, n: bestMc.n, wr: bestMc.winRate, net: bestMc.net }, band: bestMc.id });
  // 2) Volver a entrar en la misma moneda.
  const r = d.reentry;
  if (r.afterLoss.n >= MIN_SAMPLE && r.afterLoss.net < 0) {
    out.push({ id: 'reentryLoss', sev: 'bad', t: 'Volver a una moneda en la que acabas de perder te cuesta {net} SOL en {n} operaciones ({wr} de acierto). La primera entrada te sale mejor.', v: { n: r.afterLoss.n, wr: r.afterLoss.winRate, net: r.afterLoss.net } });
  } else if (r.re.n >= MIN_SAMPLE && r.re.net < 0 && r.first.n >= MIN_SAMPLE && (r.re.winRate ?? 0) < (r.first.winRate ?? 0)) {
    out.push({ id: 'reentry', sev: 'bad', t: 'Repetir moneda en menos de 2 h: {n} operaciones, {wr} de acierto, {net} SOL. Con la primera entrada aciertas un {wr2}.', v: { n: r.re.n, wr: r.re.winRate, net: r.re.net, wr2: r.first.winRate } });
  }
  // 3) Franja horaria con peor resultado.
  const worstH = d.byHour.filter(ok).filter((g) => g.net < 0).sort((a, b) => a.net - b.net)[0];
  if (worstH) out.push({ id: 'hour', sev: 'bad', t: 'Tu peor franja es de {a}:00 a {b}:00: {n} operaciones, {net} SOL. Si es por cansancio o por el mercado, ahí conviene operar menos.', v: { a: String(worstH.from).padStart(2, '0'), b: String(worstH.to).padStart(2, '0'), n: worstH.n, net: worstH.net }, band: worstH.id });
  // 4) Cuánto aguantas.
  const holds = d.byHold.filter(ok);
  const worstHold = holds.filter((g) => g.net < 0).sort((a, b) => a.net - b.net)[0];
  if (worstHold) out.push({ id: 'hold', sev: 'bad', t: 'Las operaciones de {band} son las que más restan: {n}, {net} SOL.', v: { band: worstHold.label, n: worstHold.n, net: worstHold.net }, band: worstHold.id });
  return out;
}
