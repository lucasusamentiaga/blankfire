// Comprobar ritmos con el pasado (lógica pura): entradas solo con lo que había antes, salidas del bot.
import { wouldEnter, runCoin, comparePaces } from '../Fogueo/lib/backtest.js';
import { applyPace, cleanConfig } from '../Fogueo/lib/bot.js';
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log((c ? 'OK  ' : 'FAIL') + ' ' + m); };
const T0 = 1.7e9;
// Subida limpia con volumen que despierta en la vela 40, luego objetivo y caída.
function series(shape) {
  const rows = []; let p = 1;
  for (let i = 0; i < 160; i++) {
    const prev = p;
    p = shape(i, p);
    const vol = i >= 38 && i <= 46 ? 900 : 100;
    rows.push([T0 + i * 60, prev, Math.max(prev, p) * 1.003, Math.min(prev, p) * 0.997, p, vol]);
  }
  return rows;
}
const pump = series((i, p) => (i < 36 ? p * (1 + (i % 2 ? 0.004 : -0.003)) : i < 90 ? p * 1.012 : p * 0.985));
const dump = series((i, p) => (i < 36 ? p * (1 + (i % 2 ? 0.004 : -0.003)) : i < 44 ? p * 1.012 : p * 0.95));
ok(!wouldEnter(pump, 20), 'sin historia suficiente no entra');
const firstEntry = pump.findIndex((_, i) => wouldEnter(pump, i));
ok(firstEntry >= 38 && firstEntry <= 48, `entra cuando despierta el volumen con tendencia (vela ${firstEntry})`);
const cal = cleanConfig(applyPace(cleanConfig({}), 'calm')), fast = cleanConfig(applyPace(cleanConfig({}), 'fast'));
const tp = runCoin(pump, fast, { costPct: 2.5 });
ok(tp[0]?.exit === 'tp' && Math.abs(tp[0].grossPct - 12) < 1e-6 && Math.abs(tp[0].netPct - 9.5) < 1e-6, 'Rápido: sale en +12 % y apunta +9,5 % tras comisiones');
const st = runCoin(dump, cal, { costPct: 2.5 });
ok(st[0] && st[0].exit === 'stop' && st[0].grossPct <= -cal.stopPct + 1e-9, 'una caída fuerte sale por stop, con la pérdida del stop (no mejor)');
ok(runCoin([[1, 'x']], fast).length === 0 && runCoin([], fast).length === 0, 'datos rotos o vacíos: ninguna operación');
const reversed = runCoin(pump.slice().reverse(), fast, { costPct: 2.5 });
ok(reversed.length === tp.length && reversed[0].exit === tp[0].exit, 'da igual el orden en que lleguen las velas');
const cmp = comparePaces([{ symbol: 'A', ohlcv: pump, costPct: 2.5 }, { symbol: 'B', ohlcv: dump, costPct: 2.5 }]);
ok(['calm', 'balanced', 'fast'].every((k) => cmp.paces[k] && Number.isFinite(cmp.paces[k].totalPct)), 'compara los tres ritmos');
ok(cmp.best === null || ['calm', 'balanced', 'fast'].includes(cmp.best), 'el mejor solo se nombra si gana y tiene operaciones suficientes');
const high = runCoin(pump, fast, { costPct: 30 });
ok(high[0].netPct < 0, 'con comisiones enormes, hasta un objetivo cumplido pierde (el coste cuenta siempre)');
console.log(fails ? `${fails} fallos` : 'TODO OK'); process.exit(fails ? 1 : 0);
