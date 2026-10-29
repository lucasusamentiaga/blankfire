// Auditoría matemática: fórmulas reescritas desde cero y comparadas con la app en miles de casos aleatorios.
import * as C from '../Fogueo/lib/core.js';
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log((c ? 'OK  ' : 'FAIL') + ' ' + m); };
const rnd = (a, b) => a + Math.random() * (b - a);
const lrnd = (a, b) => Math.exp(rnd(Math.log(a), Math.log(b)));
const rel = (a, b) => Math.abs(a - b) / Math.max(1e-30, Math.abs(b));

// ---------- 1. AMM de producto constante, hecho con reservas explícitas ----------
// x = reserva en USD, y = reserva en tokens, precio p = x / y, k = x·y.
function ammBuy({ solIn, p, R, solUsd, feePct, poolPct, latPct }) {
  const x = R, y = R / p;
  const dx = solIn * (1 - (feePct + poolPct) / 100) * solUsd;       // dólares que entran al pool
  const out = y - (x * y) / (x + dx);                                // tokens que salen (x·y = k)
  return out / (1 + latPct / 100);                                   // la latencia empeora el precio
}
function ammSell({ qty, p, R, solUsd, feePct, poolPct, latPct, prio }) {
  const x = R, y = R / p;
  const outUsd = x - (x * y) / (y + qty);                            // dólares que salen
  const gross = (outUsd * (1 - latPct / 100)) / solUsd;
  return gross * (1 - (feePct + poolPct) / 100) - prio;              // SOL netos
}
let worstBuy = 0, worstSell = 0;
for (let i = 0; i < 5000; i++) {
  const p = lrnd(1e-10, 5e4), liq = lrnd(800, 5e7), solUsd = rnd(60, 400), solIn = lrnd(0.001, 50);
  const stage = Math.random() < 0.5 ? 'new' : null;
  const q = { priceUsd: p, liquidityUsd: liq, marketCapUsd: p * 1e9, stage };
  const S = { ...C.DEFAULT_SETTINGS, feePct: rnd(0, 3), latencySlipPct: rnd(0, 2), priorityFee: rnd(0, 0.01), maxSlippagePct: 100 };
  const R = C.reserveUsd(q, solUsd), poolPct = C.poolFeePct(q);
  const b = C.simulateBuy({ solIn, quote: q, solUsd, settings: S });
  worstBuy = Math.max(worstBuy, rel(b.qty, ammBuy({ solIn, p, R, solUsd, feePct: S.feePct, poolPct, latPct: S.latencySlipPct })));
  const qty = b.qty * rnd(0.01, 3);
  const s = C.simulateSell({ qty, quote: q, solUsd, settings: S });
  worstSell = Math.max(worstSell, rel(s.netSol + S.priorityFee, ammSell({ qty, p, R, solUsd, feePct: S.feePct, poolPct, latPct: S.latencySlipPct, prio: 0 })));
}
ok(worstBuy < 1e-6, `Compra = AMM exacto con reservas (error máx. ${worstBuy.toExponential(1)} en 5.000 casos)`);
ok(worstSell < 1e-6, `Venta = AMM exacto con reservas (error máx. ${worstSell.toExponential(1)} en 5.000 casos)`);

// ---------- 2. Curva de pump.fun exacta (reservas virtuales) ----------
// Al nacer: 30 SOL virtuales y 1.073.000.191 tokens virtuales; suministro total 1.000M.
const V0S = 30, V0T = 1_073_000_191, K = V0S * V0T;
let worstCurve = 0;
for (let i = 0; i < 2000; i++) {
  const boughtSol = rnd(0, 80);                                        // SOL reales ya metidos en la curva
  const vS = V0S + boughtSol, vT = K / vS, solUsd = rnd(80, 300);
  const pSol = vS / vT, p = pSol * solUsd, mc = p * 1e9;
  const solIn = lrnd(0.01, 10);
  const q = { priceUsd: p, marketCapUsd: mc, liquidityUsd: null, stage: 'new' };
  const S = { ...C.DEFAULT_SETTINGS, latencySlipPct: 0, maxSlippagePct: 100, poolFees: true };
  const b = C.simulateBuy({ solIn, quote: q, solUsd, settings: S });
  const dx = solIn * (1 - (S.feePct + 1.25) / 100);
  const exact = vT - K / (vS + dx);
  worstCurve = Math.max(worstCurve, rel(b.qty, exact));
}
ok(worstCurve < 0.003, `Curva de pump.fun: tokens recibidos = fórmula exacta de la curva (error máx. ${(worstCurve * 100).toFixed(3)} %)`);

// ---------- 3. Ida y vuelta al mismo precio: se pierde exactamente lo esperado ----------
{
  const q = { priceUsd: 0.0001, liquidityUsd: 1e12, marketCapUsd: 1e5, stage: null };   // liquidez infinita: sin impacto
  const S = { ...C.DEFAULT_SETTINGS, latencySlipPct: 0, priorityFee: 0.001, feePct: 1 };
  const b = C.simulateBuy({ solIn: 1, quote: q, solUsd: 150, settings: S });
  const s = C.simulateSell({ qty: b.qty, quote: q, solUsd: 150, settings: S });
  const f = 1 - (1 + 0.3) / 100;
  const expected = f * f - 1 - 0.002;                                  // dos comisiones encadenadas y dos priority fees
  ok(Math.abs(s.netSol - (f * f - 0.001)) < 1e-9 && Math.abs((s.netSol - b.totalDebit) - expected) < 1e-9, `Ida y vuelta sin impacto: recibes 1 · (1−1,3 %)² − 0,001 = ${(f * f - 0.001).toFixed(6)} SOL`);
}

// ---------- 4. El slippage que se enseña es el empeoramiento real del precio ----------
{
  const q = { priceUsd: 0.00002, liquidityUsd: 20000, marketCapUsd: 20000, stage: null };
  const S = { ...C.DEFAULT_SETTINGS, latencySlipPct: 0 };
  const b = C.simulateBuy({ solIn: 2, quote: q, solUsd: 150, settings: S });
  const avg = b.usd / b.qty;
  ok(Math.abs((avg / q.priceUsd - 1) * 100 - b.slipPct) < 1e-9, `Slippage mostrado (${b.slipPct.toFixed(3)} %) = precio medio pagado vs precio actual`);
}

if (C.stopLevelPct) {
// ---------- 5. Stop dinámico: % de caída desde el máximo ----------
{
  const lvl = (peak, sl) => C.stopLevelPct({ sl: { pct: sl, trailing: true }, peakPct: peak });
  const valueAt = (pnl) => 1 + pnl / 100;
  const cases = [[0, 30], [40, 30], [100, 30], [300, 30], [60, 20]];
  const okAll = cases.every(([peak, sl]) => Math.abs(valueAt(lvl(peak, sl)) / valueAt(peak) - (1 - sl / 100)) < 1e-12);
  ok(okAll, 'Stop dinámico salta al caer exactamente un X % desde el máximo: ' + cases.map(([p, s]) => `máx +${p}%/stop ${s}% → ${lvl(p, s).toFixed(1)}%`).join(', '));
  ok(lvl(0, 30) === -30 && C.stopLevelPct({ sl: { pct: 30, trailing: false }, peakPct: 200 }) === -30, 'Sin subir, el dinámico = stop fijo; el fijo no se mueve');
}

} else ok(false, 'stopLevelPct no existe todavía');
// ---------- 6. Estadísticas contra cálculo a mano ----------
{
  const rounds = Array.from({ length: 400 }, (_, i) => ({ pnlSol: rnd(-1, 1.5) * (Math.random() < 0.05 ? 0 : 1), investedSol: rnd(0.1, 2), feesSol: rnd(0, 0.05), closedAt: 1e6 + i * 1000 + Math.floor(rnd(0, 500)), openedAt: 1e6 + i * 1000 - 5000 }));
  const s = C.computeStats(rounds);
  const w = rounds.filter((r) => r.pnlSol > 0), l = rounds.filter((r) => r.pnlSol <= 0);
  const gw = w.reduce((a, r) => a + r.pnlSol, 0), gl = -l.reduce((a, r) => a + r.pnlSol, 0);
  let st = 0, mx = 0; [...rounds].sort((a, b) => a.closedAt - b.closedAt).forEach((r) => { st = r.pnlSol <= 0 ? st + 1 : 0; mx = Math.max(mx, st); });
  ok(Math.abs(s.winRate - (w.length / rounds.length) * 100) < 1e-9 && Math.abs(s.profitFactor - gw / gl) < 1e-9 && Math.abs(s.avgWin - gw / w.length) < 1e-9 && Math.abs(s.avgLoss + gl / l.length) < 1e-9 && s.maxLossStreak === mx && Math.abs(s.netSol - (gw - gl)) < 1e-9,
    `Estadísticas (400 trades): acierto ${s.winRate.toFixed(1)} %, profit factor ${s.profitFactor.toFixed(3)}, racha ${s.maxLossStreak}, todo cuadra`);
}

// ---------- 7. Valor y PnL de una posición ----------
{
  const pos = { qty: 1e6, costSol: 0.5 };
  const pnl = C.positionPnl(pos, { priceUsd: 0.0001 }, 100);           // 1e6 · 0,0001 $ = 100 $ = 1 SOL
  ok(Math.abs(pnl.value - 1) < 1e-12 && Math.abs(pnl.pnlSol - 0.5) < 1e-12 && Math.abs(pnl.pnlPct - 100) < 1e-9, 'Posición: valor 1 SOL, coste 0,5 → +0,5 SOL (+100 %)');
}
console.log(fails ? `\n${fails} FALLOS` : '\nTodo bien');
