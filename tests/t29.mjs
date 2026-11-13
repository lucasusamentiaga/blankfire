// Pro · funciones puras: «Qué pasó después» (series, hechos, errores) y licencia.
import { buildSeries, tradeFacts, tradeFlags, tradeContext, candleWindow } from '../Fogueo/lib/review.js';
import * as pro from '../Fogueo/lib/pro.js';
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log((c ? 'OK  ' : 'FAIL') + ' ' + m); };
const MIN = 60e3, T0 = 1_800_000_000_000;

// Trade: compra a 1.0 en T0, venta a 1.2 a los 10 min; después sube a 3.0 (a los 20 min) y cae a 0.9 (60 min).
const round = { id: 'r1', openedAt: T0, closedAt: T0 + 10 * MIN, avgEntryUsd: 1, exitMidUsd: 1.2, investedSol: 1, returnedSol: 1.2, pnlSol: 0.2, pnlPct: 20, feesSol: 0.02, reason: 'manual', slAtEntry: false, fills: [] };
const candles = [];
for (let m = -20; m <= 70; m++) {
  const p = m < -15 ? 0.5 : m < 0 ? 0.5 + (m + 15) * (0.5 / 15) : m <= 10 ? 1 + m * 0.02 : m <= 30 ? 1.2 + (m - 10) * 0.09 : Math.max(0.9, 3 - (m - 30) * 0.07);
  candles.push([(T0 + m * MIN) / 1000, p, p * 1.01, p * 0.99, p, 100]);
}
const samples = [[T0 + 10 * MIN + 5000, 1.21], [T0 + 12 * MIN, 1.4]];
const s = buildSeries(candles, samples);
ok(s.length >= candles.length && s.every((x, i) => !i || x.t >= s[i - 1].t), `buildSeries ordena y une (${s.length} puntos)`);
ok(s.some((x) => x.src === 'bf'), 'Las muestras propias ganan a la vela del mismo instante');
ok(buildSeries([[NaN], ['x', 1, 1, 1, 0], null], [[0, 5], [T0, -1]]).length === 0, 'Datos basura se descartan');

const now = T0 + 80 * MIN;
const f = tradeFacts(round, s, now);
ok(Math.abs(f.prePumpPct - 100) < 6, `Subida antes de entrar ≈ +100 % (${f.prePumpPct?.toFixed(1)})`);
ok(f.afterMaxPct > 140 && f.afterMaxPct < 160, `Máximo después ≈ +150 % sobre la venta (${f.afterMaxPct?.toFixed(1)})`);
ok(f.afterMaxMin >= 19 && f.afterMaxMin <= 21, `…a los ~20 min (${f.afterMaxMin})`);
ok(f.after60Pct != null && f.after60Pct < 0, `A los 60 min por debajo de la venta (${f.after60Pct?.toFixed(1)})`);
ok(f.coverMin === 60, `Cobertura 60 min (${f.coverMin})`);
ok(Math.abs(f.missedSol - 1.2 * f.afterMaxPct / 100) < 1e-9, 'SOL que se dejó = devuelto × subida');
const fl = tradeFlags(round, f, { sizePct: 50, revengeMin: 2 });
const ids = fl.errors.map((e) => e.id);
ok(ids.includes('fomo') && ids.includes('soldEarly') && ids.includes('oversized') && ids.includes('noStop') && ids.includes('revenge'), `Errores: ${ids.join(', ')}`);
ok(fl.errors.length <= 5 && fl.errors[0].sev === 'high', 'Máximo 5 errores, los graves primero');

// Trade que acaba bien: stop salta y luego se hunde → aciertos
const r2 = { ...round, id: 'r2', reason: 'sl', slAtEntry: true, pnlPct: -15, pnlSol: -0.15, returnedSol: 0.85, exitMidUsd: 0.85 };
const c2 = []; for (let m = -20; m <= 70; m++) { const p = m <= 10 ? 1 - Math.max(0, m) * 0.015 : 0.85 * Math.exp(-(m - 10) / 15); c2.push([(T0 + m * MIN) / 1000, p, p, p, p, 1]); }
const f2 = tradeFacts(r2, buildSeries(c2), now);
const fl2 = tradeFlags(r2, f2, {});
ok(fl2.wins.some((w) => w.id === 'stopSaved') && fl2.wins.some((w) => w.id === 'goodExit') && fl2.wins.some((w) => w.id === 'hadStop'), `Aciertos: ${fl2.wins.map((w) => w.id).join(', ')}`);
ok(!fl2.errors.some((e) => e.id === 'noStop' || e.id === 'stopTight'), 'Sin falsos errores en el trade bien gestionado');

// Venta reciente: sin datos futuros, nada se inventa
const fresh = tradeFacts(round, s.filter((x) => x.t <= T0 + 12 * MIN), T0 + 12 * MIN);
ok(fresh.after15Pct === null && fresh.after60Pct === null && fresh.coverMin <= 2, 'Venta reciente: sin «a los 15/60 min»');
ok(tradeFacts(round, [], now).afterMaxPct === null, 'Serie vacía: sin cifras');

// Contexto
const acc = { startBalance: 10, equity: [{ t: T0 - 5 * MIN, v: 4 }], rounds: [round, { id: 'p', closedAt: T0 - 2 * MIN, pnlSol: -1 }] };
const cx = tradeContext(round, acc);
ok(cx.sizePct === 25 && cx.revengeMin === 2, `Contexto: tamaño ${cx.sizePct} %, venganza ${cx.revengeMin} min`);
const w = candleWindow(round, now);
ok(w.timeframe === 'minute' && w.aggregate === 1 && w.limit >= 90, 'Ventana de velas de 1 min');
const wl = candleWindow({ openedAt: T0, closedAt: T0 + 3 * 24 * 60 * MIN }, T0 + 4 * 24 * 60 * MIN);
ok(wl.limit <= 1000, 'Ventana larga: ≤ 1000 velas');

// Licencia
ok(pro.proSelling() === false && pro.isPro(null) === true && pro.proState(null) === 'beta', 'Sin tienda configurada: Pro beta gratis para todos');
pro.PRO_CONFIG.checkoutUrl = 'https://x.lemonsqueezy.com/buy/1'; pro.PRO_CONFIG.storeId = 7; pro.PRO_CONFIG.productId = 9;
const n = Date.now();
ok(pro.isPro(null) === false && pro.proState({}) === 'free', 'Vendiendo: sin licencia → bloqueado');
ok(pro.isPro({ status: 'active', key: 'k', validatedAt: n - 3600e3 }, n) === true, 'Licencia activa y comprobada → Pro');
ok(pro.isPro({ status: 'active', key: 'k', validatedAt: n - 20 * 24 * 3600e3 }, n) === false && pro.proState({ status: 'active', key: 'k', validatedAt: 0 }, n) === 'stale', 'Sin comprobar 20 días → caduca la gracia');
ok(pro.proState({ status: 'expired', key: 'k' }) === 'expired', 'Licencia caducada');
ok(pro.licenseMatches({ store_id: 7, product_id: 9 }) && !pro.licenseMatches({ store_id: 8, product_id: 9 }) && !pro.licenseMatches({ store_id: 7, product_id: 1 }) && !pro.licenseMatches(null), 'Solo valen licencias de tu tienda y producto');
ok(pro.maskKey('ABCD-1234-5678-WXYZ') === 'ABCD…WXYZ' && pro.maskKey('') === '', 'La clave se enseña enmascarada');

console.log(fails ? `\n${fails} FALLO(S)` : '\nTodo OK');
process.exit(fails ? 1 : 0);
