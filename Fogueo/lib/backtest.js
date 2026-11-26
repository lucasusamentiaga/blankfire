// Blankfire · comprobar los ritmos con el pasado.
// Aproximado y dicho así: con velas de 1 min no se ven el flujo de órdenes ni las wallets que sigues,
// así que la entrada se imita con lo que sí se ve en el gráfico (tendencia, fuerza y volumen).
// Las salidas sí son las del bot: stop, objetivo, stop que sigue al precio, protección de comisiones y tiempo.
import { PACES, applyPace, cleanConfig, exitReason } from './bot.js';
import { rsi, ema } from './bot.js';

const rowsOf = (ohlcv) => (ohlcv || [])
  .filter((r) => Array.isArray(r) && r.length >= 6 && [0, 1, 2, 3, 4, 5].every((i) => Number.isFinite(Number(r[i]))))
  .map((r) => r.map(Number)).sort((a, b) => a[0] - b[0]);

// ¿Habría entrado el bot en la vela i? (solo con lo que hay antes de ella)
export function wouldEnter(rows, i) {
  if (i < 35) return false;
  const closes = rows.slice(0, i + 1).map((r) => r[4]);
  const e9 = ema(closes.slice(-40), 9), e21 = ema(closes.slice(-60), 21);
  const last = closes.at(-1);
  if (!(e9 > e21 && last > e21)) return false;
  const r = rsi(closes.slice(-60));
  if (r == null || r < 50 || r > 80) return false;
  const vols = rows.slice(0, i + 1).map((x) => x[5]);
  const recent = vols.slice(-5).reduce((a, b) => a + b, 0) / 5;
  const prior = vols.slice(-35, -5).slice().sort((a, b) => a - b);
  const med = prior.length ? prior[Math.floor(prior.length / 2)] : 0;
  if (!(med > 0 && recent / med >= 1.5)) return false;
  const green = rows.slice(i - 4, i + 1).filter((x) => x[4] >= x[1]).length;
  return green >= 3;
}

// Recorre una moneda con un ritmo. costPct = ida y vuelta (comisiones + impacto) para el tamaño de entrada.
export function runCoin(ohlcv, cfg, { costPct = 3 } = {}) {
  const rows = rowsOf(ohlcv);
  const trades = [];
  let i = 35, cooldownUntil = -1;
  while (i < rows.length - 1) {
    if (i < cooldownUntil || !wouldEnter(rows, i)) { i++; continue; }
    // Entra al cierre de la vela que da la señal (como el bot, que llega tarde a la vela).
    const entry = rows[i][4], t0 = rows[i][0] * 1000;
    const pos = { entryPrice: entry, openedAt: t0, peak: entry, costSol: 1, rtCostSol: costPct / 100 };
    let exit = null, j = i + 1;
    for (; j < rows.length; j++) {
      const [ts, , hi, lo, cl] = rows[j];
      const now = ts * 1000 + 60e3;
      // Dentro de una vela no se sabe qué fue antes: se mira primero lo malo (el mínimo), luego lo bueno.
      const byLow = exitReason(pos, lo, cfg, now);
      if (byLow && ['stop', 'trail'].includes(byLow.id)) { exit = { id: byLow.id, px: byLow.id === 'stop' ? Math.min(entry * (1 - cfg.stopPct / 100), hi) : lo }; break; }
      const byHigh = exitReason(pos, hi, cfg, now);
      if (byHigh?.id === 'tp') { exit = { id: 'tp', px: entry * (1 + cfg.tpPct / 100) }; break; }
      pos.peak = Math.max(pos.peak, hi);
      const byClose = exitReason(pos, cl, cfg, now);
      if (byClose) { exit = { id: byClose.id, px: cl }; break; }
    }
    if (!exit) { exit = { id: 'open', px: rows.at(-1)[4] }; j = rows.length - 1; }
    const grossPct = (exit.px / entry - 1) * 100;
    trades.push({ at: t0, exit: exit.id, grossPct, netPct: grossPct - costPct, minutes: j - i });
    cooldownUntil = j + Math.max(1, Math.round(cfg.cooldownMin));
    i = j + 1;
  }
  return trades;
}

// Todos los ritmos sobre las mismas monedas. coins: [{ symbol, ohlcv, costPct }]
export function comparePaces(coins, base = {}) {
  const out = {};
  for (const pace of Object.keys(PACES)) {
    const cfg = cleanConfig(applyPace(cleanConfig(base), pace));
    const all = [];
    for (const c of coins) for (const t of runCoin(c.ohlcv, cfg, { costPct: c.costPct })) all.push({ ...t, symbol: c.symbol });
    const closed = all.filter((t) => t.exit !== 'open');
    const wins = closed.filter((t) => t.netPct > 0).length;
    const sum = closed.reduce((a, t) => a + t.netPct, 0);
    out[pace] = {
      trades: closed.length,
      wins,
      winRate: closed.length ? (wins / closed.length) * 100 : null,
      avgNetPct: closed.length ? sum / closed.length : null,
      // Resultado si cada operación usara el mismo % del saldo (el del ritmo), una detrás de otra.
      totalPct: closed.length ? (closed.reduce((eq, t) => eq * (1 + (cfg.sizePct / 100) * (t.netPct / 100)), 1) - 1) * 100 : 0,
      feesPct: closed.reduce((a, t) => a + (cfg.sizePct / 100) * ((coins.find((c) => c.symbol === t.symbol)?.costPct) || 0), 0),
      exits: closed.reduce((a, t) => ((a[t.exit] = (a[t.exit] || 0) + 1), a), {}),
    };
  }
  const ranked = Object.entries(out).filter(([, r]) => r.trades >= 3).sort((a, b) => b[1].totalPct - a[1].totalPct);
  return { paces: out, best: ranked[0]?.[1].totalPct > 0 ? ranked[0][0] : null, coins: coins.length };
}
