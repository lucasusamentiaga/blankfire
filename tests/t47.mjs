// Seguridad (RugCheck), indicadores, restricciones y repaso del bot: lógica pura.
import { exitReason, applyPace, safetyAgent, indicators, indicatorAgent, rsi, ema, guardrails, badHours, checklist, filterPair, cleanConfig, debateAgent, decide, freshSession, BOT_DEFAULTS } from '../Fogueo/lib/bot.js';
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log((c ? 'OK  ' : 'FAIL') + ' ' + m); };
const R = (name, level = 'warn', value = '') => ({ name, level, value });

// --- Seguridad
let s = safetyAgent(null, { need: true });
ok(s.veto && s.score === -1, 'sin informe y exigiéndolo: veta');
s = safetyAgent(null, { need: false });
ok(!s.veto && s.score === null, 'sin informe y sin exigirlo: no opina');
s = safetyAgent({ risks: [], score_normalised: 1, lpLockedPct: 100 });
ok(!s.veto && s.score > 0 && s.checks.filter((c) => c.ok).length >= 3, 'limpia: a favor, con autoridades y liquidez en verde');
for (const [n, lvl] of [['Mint Authority still enabled', 'danger'], ['Freeze Authority still enabled', 'danger'], ['Creator history of rugged tokens', 'danger'], ['Low Liquidity', 'danger'], ['Token-2022 transfer fee enabled', 'warn'], ['Permanent Delegate', 'danger']]) {
  ok(!!safetyAgent({ risks: [R(n, lvl)], score_normalised: 10, lpLockedPct: 100 }).veto, `veta: ${n}`);
}
ok(!!safetyAgent({ risks: [R('Single holder ownership', 'danger', '50.92%')], score_normalised: 43 }).veto, 'una wallet con el 51 %: veta');
s = safetyAgent({ risks: [R('Single holder ownership', 'warn', '20.23%')], score_normalised: 29, lpLockedPct: 99.9 });
ok(!s.veto && s.bearW.length >= 1, 'una wallet con el 20 %: en contra, sin veto');
ok(!!safetyAgent({ risks: [], score_normalised: 80, lpLockedPct: 100 }).veto, 'riesgo 80/100: veta');
s = safetyAgent({ risks: [R('Mutable metadata')], score_normalised: 7, lpLockedPct: 22 });
ok(!s.veto && s.bearW.some(([, n]) => /bloqueada/.test(n.t)), 'liquidez poco bloqueada: en contra');
s = safetyAgent({ risks: [R('Algo nuevo raro', 'danger')], score_normalised: 10 });
ok(!s.veto && s.bearW[0][0] === 0.3, 'riesgo desconocido «danger»: pesa en contra sin vetar');
ok(safetyAgent({ risks: [R('Mint Authority still enabled', 'danger'), R('Mint Authority still enabled', 'danger')] }).checks.filter((c) => !c.ok).length === 1, 'riesgos repetidos no se cuentan dos veces');

// --- Indicadores
ok(rsi([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]) === 100, 'RSI de una subida limpia = 100');
ok(rsi([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]) === 50, 'RSI plano = 50');
ok(rsi([1, 2, 3]) === null, 'RSI sin datos suficientes = null');
ok(Math.abs(ema([2, 2, 2, 2], 3) - 2) < 1e-12, 'EMA de constante = constante');
const T0 = 1.7e9;
const mk = (closes, vols) => closes.map((c, i) => [T0 + i * 60, i ? closes[i - 1] : c, Math.max(c, i ? closes[i - 1] : c) * 1.01, Math.min(c, i ? closes[i - 1] : c) * 0.99, c, vols ? vols[i] : 100]);
ok(indicators(mk([1, 2, 3])) === null, 'pocas velas: sin indicadores');
const up = mk(Array.from({ length: 60 }, (_, i) => 1 + i * 0.01 + (i % 2 === 0 ? -0.03 : 0)), Array.from({ length: 60 }, (_, i) => (i >= 55 ? 500 : 100)));
const iu = indicators(up.slice().reverse());   // GeckoTerminal las da de nueva a vieja
ok(iu && iu.ema9 > iu.ema21 && iu.volSpike >= 4.9 && iu.green >= 3, 'subida con pico de volumen: medias y volumen bien leídos (aunque vengan al revés)');
let a = indicatorAgent(iu);
ok(a.score > 0 && a.bullW.some(([, n]) => /volumen/.test(n.t)), 'subida con volumen: a favor');
const dump = mk(Array.from({ length: 60 }, (_, i) => (i < 40 ? 1 + i * 0.05 : 3 - (i - 40) * 0.09)), Array.from({ length: 60 }, (_, i) => (i >= 55 ? 600 : 100)));
a = indicatorAgent(indicators(dump));
ok(a.score < 0 && a.bearW.some(([, n]) => /máximo/.test(n.t)) && a.bearW.some(([, n]) => /rojas/.test(n.t)), 'desplome con volumen rojo: en contra');
ok(indicatorAgent(null).score === null, 'sin velas: no opina');
ok(indicators([[1, 'x', 2, 3, 4, 5], ...mk(Array(30).fill(1))]).n === 30, 'filas rotas se ignoran');

// --- Debate con seguridad e indicadores
const pair = { chainId: 'solana', baseToken: { address: 'A', symbol: 'A' }, priceUsd: '0.001', liquidity: { usd: 80000 }, marketCap: 500000, txns: { h1: { buys: 30, sells: 5 } }, volume: { h1: 50000 }, pairCreatedAt: Date.now() - 3600e3, info: { socials: [{}] } };
const veto = debateAgent(pair, { safety: safetyAgent({ risks: [R('Freeze Authority still enabled', 'danger')] }) });
ok(veto.veto && decide({ smarts: { score: 1 }, trends: { score: 1 }, debate: veto, router: { ok: true } }, cleanConfig()).action === 'skip', 'el veto de seguridad para la compra aunque el resto sea perfecto');

// --- Filtros nuevos
const cfg = cleanConfig();
ok(filterPair(pair, cfg).some((n) => /operaciones/.test(n.t)), 'pocas operaciones en 1 h: se salta');
ok(filterPair({ ...pair, txns: { h1: { buys: 60, sells: 20 } } }, cfg).length === 0, 'con operaciones suficientes pasa');
ok(filterPair({ ...pair, priceUsd: null, txns: { h1: { buys: 60, sells: 20 } } }, cfg).some((n) => /precio/.test(n.t)), 'sin precio: se salta');
ok(cleanConfig({ maxLossStreak: 99, solDropPct: -3, filters: { minTxnsH1: -1 } }).maxLossStreak === 10 && cleanConfig({ solDropPct: -3 }).solDropPct === 0 && cleanConfig({ filters: { minTxnsH1: -1 } }).filters.minTxnsH1 === 0, 'restricciones acotadas');
ok(cleanConfig({}).filters.needSafety === true && cleanConfig({ filters: { needSafety: false } }).filters.needSafety === false, 'exigir seguridad: sí por defecto, se puede quitar');

// --- Restricciones
const now = Date.UTC(2026, 10, 25, 15, 0);
const ses = freshSession({}, now - 5 * 3600e3);
ses.closed = [1, 2, 3].map((i) => ({ pnlSol: -0.1, closedAt: now - (10 - i) * 60e3, openedAt: now - 3600e3 }));
ok(/pérdidas seguidas/.test(guardrails(ses, { now })?.t || ''), '3 pérdidas seguidas: descansa');
ok(guardrails(ses, { now: now + 31 * 60e3 }) === null, 'pasado el descanso, vuelve');
ses.closed.push({ pnlSol: 0.2, closedAt: now - 60e3, openedAt: now - 3600e3 });
ok(guardrails(ses, { now }) === null, 'una ganancia corta la racha');
ok(/SOL cae/.test(guardrails(ses, { now, solH1: -4 })?.t || '') && guardrails(ses, { now, solH1: -2 }) === null, 'SOL −4 % en 1 h: no compra; −2 %: sí');
const h15 = (d) => ({ openedAt: Date.UTC(2026, 10, 20 + d, 15, 10), closedAt: Date.UTC(2026, 10, 20 + d, 15, 30), pnlSol: d === 0 ? 0.05 : -0.1 });
const hist = [0, 1, 2, 3, 4].map(h15);
ok(badHours(hist).join() === '15', 'hora mala detectada (15 h, 1 de 5 ganadas)');
ok(badHours(hist, -60).join() === '16', 'con el huso de Madrid es la hora local (16 h)');
ok(badHours(hist.slice(0, 3)).length === 0, 'con menos de 4 operaciones no se juzga');
const ses2 = freshSession({}, now - 3600e3);
ok(/a esta hora/.test(guardrails(ses2, { now, pastClosed: hist })?.t || ''), 'en la hora mala no compra');
ok(guardrails({ ...ses2, config: { ...ses2.config, avoidBadHours: false } }, { now, pastClosed: hist }) === null, 'se puede desactivar');

// --- Una ganadora no se convierte en perdedora (ritmo Rápido: el stop que sigue al precio quedaría bajo el coste)
const fastCfg = applyPace(cleanConfig({}), 'fast');
const pz = { entryPrice: 1, openedAt: Date.now(), costSol: 0.03, rtCostSol: 0.00075 };   // 2,5 % de ida y vuelta
ok(exitReason({ ...pz, peak: 1.07 }, 1.024, fastCfg)?.id === 'trail', 'subió +7 % y vuelve a +2,4 %: sale antes de perder (comisiones 2,5 %)');
ok(exitReason({ ...pz, peak: 1.07 }, 1.03, fastCfg) === null, 'si sigue por encima del coste, aguanta');
ok(exitReason({ ...pz, peak: 1.03 }, 1.02, fastCfg) === null, 'sin haber cubierto de sobra el coste, no actúa (manda el stop normal)');
ok(exitReason({ entryPrice: 1, openedAt: Date.now(), peak: 1.07 }, 1.024, fastCfg) === null, 'posiciones antiguas sin dato de coste: igual que antes');

// --- Repaso
const ck = checklist({ pair, safety: safetyAgent({ risks: [], score_normalised: 1, lpLockedPct: 100 }), ind: indicatorAgent(iu), router: { ok: true, costPct: 6.2 }, smarts: { score: 0.4 }, trends: { score: -0.1 } }, cfg);
ok(ck.length >= 7 && ck.some((c) => c.ok === false) && ck.some((c) => c.ok === true), 'el repaso junta todo en sí / no');
ok(JSON.stringify(ck).length < 4000, 'el repaso ocupa poco en el registro');
console.log(fails ? `${fails} fallos` : 'TODO OK'); process.exit(fails ? 1 : 0);
