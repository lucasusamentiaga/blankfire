import * as C from '../Fogueo/lib/core.js';
import { setLang } from '../Fogueo/lib/i18n.js';
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log((c ? 'OK  ' : 'FAIL') + ' ' + m); };
const S = { ...C.DEFAULT_SETTINGS };
const q = { priceUsd: 0.00005, liquidityUsd: 40000, marketCapUsd: 50000 };
// compra → venta inmediata pierde exactamente costes + slippage
const b = C.simulateBuy({ solIn: 1, quote: q, solUsd: 180, settings: S });
const s = C.simulateSell({ qty: b.qty, quote: q, solUsd: 180, settings: S });
const rt = s.netSol - b.totalDebit;
ok(rt < 0 && rt > -0.06, 'Ida y vuelta a mismo precio: pierde solo costes (' + rt.toFixed(4) + ' SOL)');
ok(Math.abs(b.fee - 0.013) < 1e-12 && Math.abs(b.totalDebit - 1.001) < 1e-12, 'Compra en pool: 1 % Padre + 0,3 % pool dentro de lo invertido, prioridad aparte');
const cq = { priceUsd: 2.9239948398207282e-06, liquidityUsd: 3136.68, marketCapUsd: 2923.99, stage: 'new' };
const cb = C.simulateBuy({ solIn: 1, quote: cq, solUsd: 104.18, settings: S });
ok(Math.abs(cb.fee - 0.0225) < 1e-12, 'Curva de pump.fun: 1 % Padre + 1,25 % curva = ' + cb.fee);
const sinLiq = C.reserveUsd({ ...cq, liquidityUsd: null }, 104.18), conLiq = C.reserveUsd(cq, 104.18);
ok(Math.abs(sinLiq / conLiq - 1) < 0.01, `Reserva de la curva por fórmula (${sinLiq.toFixed(0)} $) ≈ liquidez de Jupiter (${conLiq.toFixed(0)} $)`);
// Precio real en la curva: comprar 1 SOL en un token de 2,9K de MC. Exacto: x·y=k con vSOL≈30,06 → impacto ≈ 0,98/30,06 ≈ 3,2 %
ok(cb.slipPct > 3 && cb.slipPct < 4.5, 'Slippage de 1 SOL en la curva recién creada ≈ 3-4 % (' + cb.slipPct.toFixed(2) + ' %)');
ok(C.simulateBuy({ solIn: 1, quote: cq, solUsd: 104.18, settings: { ...S, poolFees: false } }).fee === 0.01, 'Sin comisión de pool: solo Padre');
// slippage crece con el tamaño
const big = C.simulateBuy({ solIn: 50, quote: q, solUsd: 180, settings: S });
ok(big.slipPct > b.slipPct && !big.ok, 'Orden grande: más slippage y falla con máximo 15 % (' + big.slipPct.toFixed(1) + ' %)');
// vender más no da proporcionalmente más (impacto)
const s2 = C.simulateSell({ qty: b.qty * 2, quote: q, solUsd: 180, settings: S });
ok(s2.grossSol < 2 * s.grossSol, 'Vender el doble rinde menos del doble (impacto)');
// entradas inválidas
ok(!C.simulateBuy({ solIn: 0, quote: q, solUsd: 180, settings: S }).ok, 'Compra 0 rechazada');
ok(!C.simulateBuy({ solIn: 1, quote: { priceUsd: 0 }, solUsd: 180, settings: S }).ok, 'Sin precio rechazada');
ok(!C.simulateSell({ qty: -1, quote: q, solUsd: 180, settings: S }).ok, 'Venta negativa rechazada');
// formatos
setLang('es');
const fp = [[0.0000045, '$0,0₅45'], [0.000045, '$0,0₄45'], [0.0045, '$0,0045'], [0.45, '$0,45'], [1.5, '$1,50'], [12345, '$12.345'], [1e-12, '$0,0₁₁1']];
fp.forEach(([n, e]) => ok(C.fmtPrice(n) === e, `fmtPrice(${n}) = ${C.fmtPrice(n)} (esperado ${e})`));
const fc = [[0.000174, '0,000174'], [0.5, '0,5'], [999, '999'], [999999, '1M'], [999.6, '1K'], [1500, '1,5K'], [2.3e9, '2,3B'], [-5200, '−5,2K'], [99950, '100K']];
fc.forEach(([n, e]) => ok(C.fmtCompact(n) === e, `fmtCompact(${n}) = ${C.fmtCompact(n)} (esperado ${e})`));
ok(C.fmtSol(-0.00004) === '−0,00', 'fmtSol diminuto: ' + C.fmtSol(-0.00004));
ok(C.fmtDuration(59600) === '1 min' && C.fmtDuration(3600e3 * 50) === '2,1 d', 'fmtDuration: ' + C.fmtDuration(59600) + ' / ' + C.fmtDuration(3600e3 * 50));
setLang('en'); ok(C.fmtPrice(0.0000045) === '$0.0₅45' && C.fmtSol(1234.5) === '1,234.5', 'Formato inglés: ' + C.fmtPrice(0.0000045) + ' ' + C.fmtSol(1234.5)); setLang('es');
// estadísticas
const R = (p, t, extra = {}) => ({ pnlSol: p, investedSol: 1, closedAt: t, openedAt: t - 1000, feesSol: 0.01, ...extra });
const st = C.computeStats([R(1, 1), R(-0.5, 2), R(-0.5, 3), R(0, 4), R(2, 5)]);
ok(st.wins === 2 && st.losses === 3 && st.maxLossStreak === 3, 'Rachas y conteo (empate cuenta como pérdida)');
ok(Math.abs(st.profitFactor - 3) < 1e-9, 'Profit factor 3');
ok(C.computeStats([]).winRate === null, 'Sin trades: acierto vacío');
// rango
const m = C.rangeModel(150, { tp: { pct: 100 }, sl: { pct: 30 } });
ok(m.x === 1 && m.near >= 1, 'Rango satura más allá del TP');
const m2 = C.rangeModel(10, { sl: { pct: 30, trailing: true }, peakPct: 40 }, 10);
ok(m2 && m2.x === 0, 'Stop dinámico en +10 con resultado +10: punto en el stop');
console.log(fails ? `\n${fails} FALLOS` : '\nTodo bien');
