// Bot de práctica: filtros, agentes, ejecutor, límites duros y resumen de 12 h (lógica pura).
import {
  cleanConfig, freshSession, filterPair, smartsAgent, trendsAgent, debateAgent, routerAgent, decide, councilScore,
  exitReason, entrySize, lossHit, sessionEquity, makeRecap, metaWords, pushLog, LOG_MAX, BOT_DEFAULTS,
} from '../Fogueo/lib/bot.js';
import { simulateBuy, simulateSell, DEFAULT_SETTINGS } from '../Fogueo/lib/core.js';
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log((c ? 'OK  ' : 'FAIL') + ' ' + m); };
const NOW = Date.UTC(2026, 10, 24, 22, 0);
const pair = (o = {}) => ({
  chainId: 'solana', dexId: 'pumpswap', priceUsd: '0.0005', pairCreatedAt: NOW - 3 * 3600e3,
  baseToken: { address: o.addr || 'AAA', name: o.name || 'Moon Frog', symbol: o.symbol || 'FROG' },
  liquidity: { usd: o.liq ?? 60000 }, marketCap: o.mc ?? 400000, volume: { m5: o.v5 ?? 6000, h1: o.v1 ?? 40000 },
  txns: { m5: { buys: o.b5 ?? 70, sells: o.s5 ?? 30 }, h1: { buys: o.b1 ?? 300, sells: o.s1 ?? 200 } },
  priceChange: { m5: o.m5 ?? 3, h1: o.h1 ?? 35 }, info: o.info ?? { websites: [{ url: 'x' }], socials: [{ type: 'twitter' }] },
});
const cfg = cleanConfig({});

// Límites duros: lo que llegue de la ventana nunca los rompe.
const wild = cleanConfig({ stopPct: 30, budgetSol: -5, sizePct: 90, maxOpen: 50, filters: { minLiqUsd: 'x' } });
ok(wild.stopPct === 8 && cleanConfig({ stopPct: 1 }).stopPct === 6 && wild.budgetSol === 0.05 && wild.sizePct === 40 && wild.maxOpen === 6 && wild.filters.minLiqUsd === BOT_DEFAULTS.filters.minLiqUsd, 'stop siempre entre −6 % y −8 %, tamaño y saldo acotados');

// Filtros.
ok(filterPair(pair(), cfg, { now: NOW }).length === 0, 'una moneda sana pasa los filtros');
const f1 = filterPair(pair({ liq: 3000, mc: 9000, h1: 500, info: {} }), cfg, { now: NOW });
ok(f1.length === 4 && f1.some((n) => /liquidez/.test(n.t)) && f1.some((n) => /llega tarde/.test(n.t)) && f1.some((n) => /redes/.test(n.t)), 'descarta poca liquidez, market cap bajo, subida tardía y sin redes');
ok(filterPair(pair(), cfg, { now: NOW, held: { AAA: 1 } })[0].t === 'ya la tiene abierta', 'no compra dos veces la misma');
ok(/hace poco/.test(filterPair(pair(), cfg, { now: NOW, recent: { AAA: NOW - 10 * 60e3 } })[0].t), 'respeta la espera tras tocar una moneda');
ok(/demasiado nueva/.test(filterPair({ ...pair(), pairCreatedAt: NOW - 5 * 60e3 }, cfg, { now: NOW })[0].t), 'salta las de menos de 15 min');

// Agentes.
const sm = smartsAgent(pair({ v1: 300000, v5: 40000 }));
ok(sm.score > 0.5 && sm.notes.length >= 2, 'dinero inteligente: compras dominantes y grandes → nota alta');
ok(smartsAgent(pair({ b5: 20, s5: 60, v5: 500 })).score < 0, 'dinero inteligente: dominan las ventas y se apaga → nota negativa');
ok(smartsAgent({ ...pair(), txns: null }).score === null, 'sin datos de operaciones se abstiene');
const meta = metaWords([pair(), pair({ addr: 'B', name: 'Frog King' }), pair({ addr: 'C', name: 'Baby Frog' }), pair({ addr: 'D', name: 'Cat' })]);
const tdA = trendsAgent(pair(), { meta, boosted: new Set(['AAA']) });
ok(tdA.score > 0.5 && tdA.notes.some((n) => n.v?.w === 'frog'), 'tendencias: detecta el tema de moda («frog») y la subida');
ok(trendsAgent(pair({ h1: -45, m5: -20 }), {}).score <= -0.6, 'tendencias: caída fuerte → nota muy negativa');
const deb = debateAgent(pair(), { smarts: sm, trends: tdA, shield: { copies: { level: 'ok', kind: 'leader' }, chart: { level: 'ok' } } });
ok(deb.score > 0.5 && !deb.veto && deb.bull.length >= 4, 'debate: argumentos a favor ganan');
const vetoed = debateAgent(pair(), { smarts: sm, trends: tdA, shield: { chart: { level: 'bad' } } });
ok(vetoed.veto && vetoed.score === -1, 'debate: el oso veta un gráfico con dibujo de rug');
ok(debateAgent(pair({ liq: 5000, mc: 400000 }), {}).veto, 'debate: veta liquidez ridícula');

// Ruta: reduce el tamaño para no mover el precio más del máximo.
const quote = { priceUsd: 0.0005, liquidityUsd: 20000, marketCapUsd: 400000, stage: 'graduated', dex: 'pumpswap', change: { m5: 4 } };
const rt = routerAgent({ quote, sizeSol: 5, solUsd: 180, settings: {}, cfg, simulateBuy });
ok(rt.ok && rt.sizeSol < 5 && rt.impactPct <= cfg.maxImpactPct && rt.slipPct >= 5 && rt.slipPct <= 25, `ruta: baja la entrada de 5 a ${rt.sizeSol?.toFixed(2)} SOL para quedarse en ${rt.impactPct?.toFixed(2)} % de impacto`);
ok(!routerAgent({ quote: { ...quote, liquidityUsd: 600 }, sizeSol: 1, solUsd: 180, settings: {}, cfg: { ...cfg, maxImpactPct: 0.5 }, simulateBuy }).ok, 'ruta: si ni la entrada mínima cabe en el impacto máximo, no hay ruta');
ok(routerAgent({ quote, sizeSol: 0.1, solUsd: 180, settings: {}, cfg, simulateBuy, jup: { route: 'Jupiter · PumpSwap', impactPct: 0.4 } }).route === 'Jupiter · PumpSwap', 'ruta: usa la de Jupiter si la hay');

// Comisiones: con la propina de Jito de Padre (0,01 SOL por orden), entradas pequeñas no compensan.
const q80 = { ...quote, liquidityUsd: 80000 };
const small = routerAgent({ quote: q80, sizeSol: 0.2, solUsd: 180, settings: DEFAULT_SETTINGS, cfg, simulateBuy, simulateSell });
ok(!small.ok && small.costPct > 10 && /comisiones/.test(small.notes[0].t), `entrada de 0,2 SOL: ida y vuelta ${small.costPct?.toFixed(1)} % → no compra`);
const big = routerAgent({ quote: q80, sizeSol: 1, solUsd: 180, settings: DEFAULT_SETTINGS, cfg, simulateBuy, simulateSell });
ok(big.ok && big.costPct < cfg.maxCostPct && big.notes.some((n) => /ida y vuelta/.test(n.t)), `entrada de 1 SOL: ida y vuelta ${big.costPct?.toFixed(1)} % → sí`);
const lowTip = routerAgent({ quote: q80, sizeSol: 0.3, solUsd: 180, settings: { ...DEFAULT_SETTINGS, tipSol: 0.001 }, cfg, simulateBuy, simulateSell });
ok(lowTip.ok && lowTip.costPct < 6, `bajando la propina a 0,001 SOL, 0,3 SOL ya compensa (${lowTip.costPct?.toFixed(1)} %)`);

// Ejecutor.
ok(decide({ smarts: sm, trends: tdA, debate: deb, router: rt }, cfg).action === 'buy', 'ejecutor: todos a favor y ruta lista → compra');
ok(decide({ smarts: sm, trends: tdA, debate: vetoed, router: rt }, cfg).action === 'skip', 'ejecutor: el veto manda');
ok(decide({ smarts: sm, trends: tdA, debate: deb, router: { ok: false, notes: [{ t: 'x' }] } }, cfg).action === 'skip', 'ejecutor: sin ruta no compra');
ok(decide({ smarts: { score: 0.1 }, trends: { score: 0 }, debate: { score: 0.1 } }, cfg).reason.t.startsWith('nota del consejo'), 'ejecutor: nota floja → descarta con el motivo');
ok(Math.abs(councilScore({ smarts: { score: 1 }, trends: { score: null }, debate: { score: 0 } }) - 0.35 / 0.75) < 1e-9, 'el consejo ignora a quien se abstiene');

// Gestión de posiciones.
const pos = { entryPrice: 1, peak: 1, openedAt: NOW - 60e3 };
ok(exitReason(pos, 0.93, cfg, NOW)?.id === 'stop' && exitReason(pos, 0.94, cfg, NOW) === null, 'stop duro al −7 % (y no antes)');
ok(exitReason(pos, 1.41, cfg, NOW)?.id === 'tp', 'objetivo al +40 %');
ok(exitReason({ ...pos, peak: 1.3 }, 1.16, cfg, NOW)?.id === 'trail', 'tras subir +30 %, vende si cae un 10 % desde el máximo');
ok(exitReason({ ...pos, openedAt: NOW - 50 * 60e3 }, 1.02, cfg, NOW)?.id === 'time', 'fuera si en 45 min no se mueve');
const s = freshSession({ budgetSol: 2 }, NOW);
ok(Math.abs(entrySize(s) - 0.4) < 1e-12 && s.balance === 2, 'cada entrada es el 20 % del saldo fijo');
ok(freshSession({}, NOW).config.budgetSol === 0.3 && Math.abs(entrySize(freshSession({}, NOW)) - 0.06) < 1e-12, 'por defecto: 0,3 SOL de sesión (unos 20 €) y entradas de 0,06 SOL');
s.balance = 1.4; s.positions.x = { costSol: 0.2, valueSol: 0.1 };
ok(Math.abs(sessionEquity(s) - 1.5) < 1e-9 && lossHit(s, 1.5) && !lossHit(s, 1.6), 'freno: con −25 % la sesión se para');

// Registro y resumen.
for (let i = 0; i < LOG_MAX + 30; i++) pushLog(s, { kind: 'skip', reason: { t: i % 2 ? 'sin web ni redes' : 'volumen bajo' } }, NOW + i);
ok(s.log.length === LOG_MAX, `el registro guarda las últimas ${LOG_MAX} decisiones`);
s.closed = [
  { symbol: 'A', closedAt: NOW + 10, pnlSol: 0.05, pnlPct: 25, exit: 'tp' },
  { symbol: 'B', closedAt: NOW + 20, pnlSol: -0.015, pnlPct: -7.4, exit: 'stop' },
  { symbol: 'C', closedAt: NOW - 1e9, pnlSol: 9, pnlPct: 900, exit: 'tp' },
];
const r = makeRecap(s, NOW, NOW + 12 * 3600e3);
ok(r.trades === 2 && r.wins === 1 && Math.abs(r.pnlSol - 0.035) < 1e-9 && r.best.symbol === 'A' && r.worst.symbol === 'B' && r.exits.stop === 1, 'resumen de 12 h: solo cuenta lo de su ventana');
ok(r.topSkips.length === 2 && r.topSkips[0].n >= 200, 'resumen: motivos de descarte más repetidos');
console.log(fails ? `${fails} fallos` : 'TODO OK'); process.exit(fails ? 1 : 0);
