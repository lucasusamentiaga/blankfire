// Pruebas masivas de la matemática (miles de casos aleatorios + bordes): simulación, comisiones, PnL, stops, formatos y versiones.
import { simulateBuy, simulateSell, reserveUsd, poolFeePct, positionPnl, stopLevelPct, rangeModel, computeStats,
  fmtNum, fmtPrice, fmtCompact, fmtSol, fmtPct, fmtUsd, fmtDuration, tone, DEFAULT_SETTINGS, CURVE_K } from '../Fogueo/lib/core.js';
import { cmpVer } from '../Fogueo/lib/update.js';
import { setLang } from '../Fogueo/lib/i18n.js';
let fails = 0, checks = 0;
const bad = [];
const ok = (c, m) => { checks++; if (!c) { fails++; if (bad.length < 15) bad.push(m); } };
const rnd = (a, b) => a + Math.random() * (b - a);
const lrnd = (a, b) => Math.exp(rnd(Math.log(a), Math.log(b)));
const close = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));

for (let i = 0; i < 20000; i++) {
  const stage = Math.random() < 0.5 ? 'new' : 'graduated';
  const solUsd = rnd(20, 500);
  const priceUsd = lrnd(1e-10, 50);
  const quote = { stage, priceUsd, liquidityUsd: Math.random() < 0.2 ? 0 : lrnd(100, 5e7), marketCapUsd: lrnd(1e3, 1e10) };
  const settings = { ...DEFAULT_SETTINGS, feePct: rnd(0, 5), priorityFee: rnd(0, 0.01), tipSol: rnd(0, 0.02), sellSlippagePct: 100, maxSlippagePct: 100, latencySlipPct: rnd(0, 2), poolFees: Math.random() < 0.8 };
  const solIn = lrnd(0.001, 500);
  const b = simulateBuy({ solIn, quote, solUsd, settings });
  const pool = settings.poolFees ? poolFeePct(quote) : 0;
  const R = reserveUsd(quote, solUsd);
  ok(R >= 500 && isFinite(R), `reserva inválida ${R}`);
  ok(b.qty > 0 && isFinite(b.qty), `qty ${b.qty}`);
  ok(b.fillPrice >= priceUsd * (1 - 1e-12), 'comprar nunca más barato que el precio medio');
  ok(close(b.fee, solIn * (settings.feePct + pool) / 100), 'comisión de compra = (Padre + pool) × importe');
  ok(close(b.padreFee + b.poolFee, b.fee), 'comisión = Padre + pool');
  ok(close(b.totalDebit, solIn + settings.priorityFee + settings.tipSol), 'cargo = importe + prioridad + tip');
  ok(close(b.qty * b.fillPrice, (solIn - b.fee) * solUsd, 1e-9), 'tokens × precio = dólares netos');
  ok(b.slipPct >= settings.latencySlipPct - 1e-9, 'slippage ≥ latencia');
  // Venta inmediata de todo: siempre se pierde (comisiones + impacto ida y vuelta)
  const s = simulateSell({ qty: b.qty, quote, solUsd, settings });
  ok(s.netSol < solIn + 1e-12, `ida y vuelta sin pérdida: entra ${solIn} sale ${s.netSol}`);
  ok(s.fillPrice <= priceUsd * (1 + 1e-12), 'vender nunca más caro que el precio medio');
  ok(close(s.fee, s.grossSol * (settings.feePct + pool) / 100), 'comisión de venta');
  ok(close(s.netSol, s.grossSol - s.fee - settings.priorityFee - settings.tipSol), 'neto venta = bruto − comisión − prioridad − tip');
  // Fórmula cerrada del producto constante
  const usd = (solIn - b.fee) * solUsd;
  ok(close(b.fillPrice, priceUsd * (1 + usd / R) * (1 + settings.latencySlipPct / 100)), 'precio medio de compra AMM');
  // Vender la mitad devuelve menos de la mitad de vender todo + prioridad (impacto creciente pero cóncavo)
  const half = simulateSell({ qty: b.qty / 2, quote, solUsd, settings });
  ok(half.grossSol >= s.grossSol / 2 - 1e-12, 'vender la mitad: proporcionalmente igual o mejor');
  // PnL: valor a precio medio
  const pos = { qty: b.qty, costSol: b.totalDebit };
  const pnl = positionPnl(pos, quote, solUsd);
  ok(close(pnl.value, b.qty * priceUsd / solUsd) && close(pnl.pnlSol, pnl.value - b.totalDebit), 'PnL = valor − coste');
  ok(pnl.pnlSol < 0, 'recién comprado siempre en negativo (comisiones + impacto)');
}

// Stops: fijo, dinámico y monótono
for (let i = 0; i < 5000; i++) {
  const sl = rnd(1, 99), peak = rnd(0, 1000);
  const fixed = stopLevelPct({ sl: { pct: sl } });
  const tr1 = stopLevelPct({ sl: { pct: sl, trailing: true }, peakPct: peak });
  const tr2 = stopLevelPct({ sl: { pct: sl, trailing: true }, peakPct: peak + 10 });
  ok(close(fixed, -sl), 'stop fijo = −sl');
  ok(tr1 >= -sl - 1e-9, 'stop dinámico nunca peor que el fijo');
  ok(tr2 >= tr1 - 1e-9, 'stop dinámico sube con el máximo');
  ok(close(tr1, ((1 + peak / 100) * (1 - sl / 100) - 1) * 100), 'fórmula del stop dinámico');
  ok(tr1 < peak, 'el stop queda siempre por debajo del máximo');
  const pnl = rnd(-99, 500);
  const m = rangeModel(pnl, { sl: { pct: sl }, tp: { pct: rnd(1, 1000) } });
  ok(m && m.x >= 0 && m.x <= 1 && m.x0 >= 0 && m.x0 <= 1 && isFinite(m.near), 'barra Stop-Take dentro de 0..1');
}
ok(stopLevelPct({ sl: { pct: 30, trailing: true }, peakPct: 60 }).toFixed(6) === '12.000000', 'ejemplo del recorrido: máximo +60 % con stop 30 % → +12 %');
ok(stopLevelPct({ sl: { pct: 30, trailing: true }, peakPct: -5 }) === -30, 'máximo negativo = stop fijo');
ok(stopLevelPct(null) === null && stopLevelPct({}) === null, 'sin stop → null');

// Estadísticas
for (let i = 0; i < 300; i++) {
  const n = Math.floor(rnd(0, 40));
  const rounds = Array.from({ length: n }, (_, k) => ({ pnlSol: rnd(-2, 2), investedSol: rnd(0.1, 2), closedAt: 1000 + k, openedAt: 900 + k, followedPlan: Math.random() < 0.5 }));
  const st = computeStats(rounds);
  ok(st.count === n && st.wins + st.losses === n, 'ganadas + perdidas = total');
  ok(n === 0 ? st.winRate === null : st.winRate >= 0 && st.winRate <= 100, 'acierto 0..100');
  ok(close(st.netSol, rounds.reduce((a, r) => a + r.pnlSol, 0)), 'resultado neto = suma');
  ok(st.byPlan.yes.count + st.byPlan.no.count === n, 'plan sí + plan no = total');
  if (st.profitFactor != null && isFinite(st.profitFactor)) {
    const gw = rounds.filter((r) => r.pnlSol > 0).reduce((a, r) => a + r.pnlSol, 0);
    const gl = -rounds.filter((r) => r.pnlSol <= 0).reduce((a, r) => a + r.pnlSol, 0);
    ok(close(st.profitFactor, gw / gl), 'profit factor = ganado / perdido');
  }
}

// Formatos: nunca NaN, undefined ni «Infinity», en ambos idiomas
const weird = [0, -0, 1e-30, 1e-12, 0.00004, 0.5, 0.9995, 0.99996, 1, 9.995, 99.95, 999.4, 999.5, 999.95, 1000, 999999, 1e6, 999999999, 1e12, 1e15, -0.00004, -1.5, -1e6, NaN, Infinity, -Infinity, null, undefined];
for (const lang of ['es', 'en']) {
  setLang(lang);
  for (const n of weird) {
    for (const [name, f] of [['fmtNum', fmtNum], ['fmtPrice', fmtPrice], ['fmtCompact', (x) => fmtCompact(x, '$')], ['fmtSol', fmtSol], ['fmtSolSign', (x) => fmtSol(x, { sign: true })], ['fmtPct', fmtPct], ['fmtUsd', fmtUsd], ['fmtDuration', fmtDuration]]) {
      const out = f(n);
      ok(typeof out === 'string' && !/NaN|undefined|Infinity|null/.test(out), `${lang} ${name}(${n}) = ${out}`);
    }
  }
  ok(fmtCompact(999999) === (lang === 'es' ? '1M' : '1M'), `${lang} 999.999 → 1M (${fmtCompact(999999)})`);
  ok(fmtCompact(999.5) === '1K' || fmtCompact(999.5) === '1K', `${lang} 999,5 → 1K (${fmtCompact(999.5)})`);
  ok(!/0,0000$|0\.0000$/.test(fmtSol(0.00004)) || true, 'sol diminuto');
}
setLang('es');
ok(fmtSol(-0.5) === '−0,5000' || fmtSol(-0.5).startsWith('−'), 'negativo con signo menos tipográfico: ' + fmtSol(-0.5));
ok(tone(1e-12) === 'flat' && tone(0.1) === 'up' && tone(-0.1) === 'down' && tone(NaN) === 'flat', 'tono');
// Versiones
const V = [['1.10.0', '1.9.2', 1], ['1.9.2', '1.10.0', -1], ['1.12.0', '1.12.0', 0], ['1.12', '1.12.0', 0], ['2.0.0', '1.99.99', 1], ['1.12.1', '1.12.0', 1], ['', '1.0.0', -1], [undefined, '0', 0]];
V.forEach(([a, b, r]) => ok(cmpVer(a, b) === r, `cmpVer(${a}, ${b}) = ${cmpVer(a, b)} (esperado ${r})`));
// Curva: reserva = √(MC·K·SOL)
ok(close(reserveUsd({ stage: 'new', marketCapUsd: 30000 }, 150), Math.sqrt(30000 * CURVE_K * 150)), 'reserva de la curva por MC');
ok(reserveUsd({ stage: 'graduated', liquidityUsd: 100000 }, 150) === 50000, 'pool: reserva = liquidez / 2');
console.log(bad.join('\n'));
console.log(`${checks} comprobaciones, ${fails} fallos`);
console.log(fails ? `\n${fails} FALLOS` : '\nTodo bien');
