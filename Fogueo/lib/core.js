// Blankfire — lógica pura compartida (sin acceso a chrome.*).
import { tr, locale } from './i18n.js';
// La usan el service worker, el popup y el panel dentro de Padre.

export const DEFAULT_SETTINGS = {
  startBalance: 10,      // SOL ficticios al crear la cuenta
  feePct: 1,             // comisión de Padre por operación (%)
  priorityFee: 0.001,    // SOL por transacción: priority fee (los valores por defecto son los de Padre, preset P1)
  tipSol: 0.01,          // SOL por transacción: propina a Jito (Padre la paga con el modo MEV «Secure»)
  mevSecure: true,       // con MEV protegido una orden fallida no llega a la cadena y no cuesta nada
  maxSlippagePct: 20,    // compra: si el precio se mueve más que esto, la orden falla
  sellSlippagePct: 40,   // venta: Padre deja más margen para poder salir
  latencySlipPct: 0.3,   // deslizamiento extra por latencia (%)
  quickBuys: [0.1, 0.25, 0.5, 1],
  defaultTpPct: 100,
  defaultSlPct: 30,
  useTp: false,
  useSl: false,
  useTrail: false,
  sizeMode: 'sol',        // 'sol' | 'pct' (porcentaje del saldo)
  quickPcts: [5, 10, 25, 50],
  dailyLossLimit: 0,      // SOL; 0 = sin límite
  pnlUnit: 'sol',         // 'sol' | 'usd'
  autoPreset: false,      // aplicar los ajustes recomendados al abrir cada token
  poolFees: true,         // sumar la comisión del pool (curva de pump.fun, PumpSwap…) a la de Padre
  screenBadges: true,     // marcar en Trenches las monedas que pasan el chequeo
  screenRigor: 'normal',  // 'strict' | 'normal' | 'loose'
  strictShield: true,     // pedir confirmación antes de comprar una moneda con señales de rug
};

// ---------- Ajustes recomendados por tipo de token ----------
// Orientativos: puntos de partida razonables para practicar, no reglas fijas.
export const PRESETS = {
  new: {
    id: 'new',
    name: 'Nuevo par',
    where: 'en la bonding curve de pump.fun',
    intro: 'Aún no tiene pool propio: cotiza en la curva de lanzamiento. Es la zona más rápida y peligrosa: la mayoría no llega a graduarse y muchas se van a cero en minutos.',
    sizePct: 2, maxSlippagePct: 25, sellSlippagePct: 40, priorityFee: 0.001, tipSol: 0.001, slPct: 30, trailing: true, tpPct: 100,
    why: {
      size: 'Con tantos tokens que mueren pronto, entrar pequeño te deja equivocarte muchas veces sin vaciar la cuenta.',
      slippage: 'Hay poca liquidez y muchos bots: el precio salta entre que pulsas y se ejecuta. Entre un 25 y un 40 % si quieres entrar en los primeros segundos; con menos, muchas órdenes fallarían.',
      priority: 'Con 0,001 de prioridad y 0,001 de tip la orden entra rápido. El tip de 0,01 que trae Padre por defecto son 0,02 SOL por compra y venta: con 0,1 SOL de trade, un 20 % se va solo en eso.',
      stop: 'Las caídas son bruscas. El stop dinámico te saca si el impulso muere, pero te deja correr si sigue subiendo.',
      take: 'Doblar es un objetivo realista en la curva. Al llegar, recupera lo invertido y deja el resto corriendo gratis.',
    },
    tip: 'Antes de entrar, mira en Padre el % de la curva, qué hace el dev y cuánto tienen los top holders.',
  },
  graduated: {
    id: 'graduated',
    name: 'Graduado',
    where: 'ya migrado a su propio pool',
    intro: 'Superó la curva y ya cotiza en un pool con más liquidez (PumpSwap, Raydium…). Menos riesgo de ir a cero que un par nuevo, pero las primeras horas tras graduarse siguen siendo muy volátiles.',
    sizePct: 4, maxSlippagePct: 12, sellSlippagePct: 25, priorityFee: 0.0005, tipSol: 0.001, slPct: 20, trailing: true, tpPct: 60,
    why: {
      size: 'Ya pasó el primer filtro y hay más liquidez: el riesgo de quedarte atrapado es menor, puedes usar algo más de tamaño.',
      slippage: 'Con más liquidez tu orden mueve menos el precio. Entre un 10 y un 15 % basta y evita ejecuciones malas o que te hagan sándwich.',
      priority: 'Hay menos carrera por el bloque que en la curva: con 0,0005 de prioridad y un tip pequeño basta.',
      stop: 'Tras graduarse es habitual una caída fuerte por ventas. Si pierde un 20 %, probablemente tu idea no se cumple.',
      take: 'Se mueve algo más lento que en la curva; un objetivo más corto se alcanza más a menudo.',
    },
    tip: 'Fíjate en si el volumen se mantiene después de graduarse: si se apaga, el precio suele desinflarse.',
  },
};

export const LAUNCH_DEXES = ['pumpfun', 'moonshot', 'moonit', 'launchlab', 'boop', 'bonk', 'letsbonk', 'believe', 'meteoradbc', 'dbc', 'heaven'];

export const REVIEW_TAGS = [
  { id: 'plan', label: 'Con plan' },
  { id: 'narrativa', label: 'Narrativa' },
  { id: 'volumen', label: 'Volumen' },
  { id: 'fomo', label: 'FOMO' },
  { id: 'prisa', label: 'Con prisa' },
  { id: 'venganza', label: 'Venganza' },
  { id: 'tarde', label: 'Entré tarde' },
  { id: 'aguante', label: 'Aguanté de más' },
];

export function startOfDay(ts = Date.now()) {
  const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime();
}

// PnL realizado (ventas, incluidas parciales) y fees de órdenes fallidas desde `since`.
export function realizedSince(account, since) {
  let total = 0;
  for (const f of account.fills || []) {
    if (f.t < since) continue;
    if (f.failed) total -= f.priorityFee || 0;   // coste de la orden fallida (0 con MEV protegido)
    else if (f.side === 'sell') total += f.pnlSol || 0;
  }
  return total;
}

export const MIN_RESERVE_USD = 2500;

// ---------- Simulación de ejecución ----------
// Modelo AMM de producto constante: R = reserva del lado SOL/USD (≈ liquidez/2).
// Comprar A dólares → precio medio = p · (1 + A/R).
// Vender V dólares → precio medio = p · R / (R + V).

// Curva de pump.fun: x·y = k con reservas virtuales (30 SOL · 1.073M de tokens al nacer) y 1.000M de suministro.
// De ahí sale la reserva de SOL a partir del market cap: vSOL = √(MC_SOL · 32,19).
// (Comprobado con Jupiter: su «liquidez» de un token en la curva es justo esa reserva de SOL en dólares.)
export const CURVE_K = 32.19;

export function reserveUsd(quote, solUsd) {
  const liq = Number(quote?.liquidityUsd) || 0;
  const mc = Number(quote?.marketCapUsd) || 0;
  if (quote?.stage === 'new') {
    // En la curva toda la liquidez es el lado SOL: no se divide entre dos.
    if (liq > 0) return Math.max(liq, 500);
    if (mc > 0 && solUsd > 0) return Math.max(Math.sqrt(mc * CURVE_K * solUsd), 500);
  }
  if (liq > 0) return Math.max(liq / 2, 500);
  return Math.max(mc * 0.08, MIN_RESERVE_USD);
}

// Coste fijo de cada transacción: priority fee + tip de Jito.
export function txCost(settings) {
  const s = { ...DEFAULT_SETTINGS, ...settings };
  return (Number(s.priorityFee) || 0) + (Number(s.tipSol) || 0);
}
// Una orden que falla por slippage: con MEV protegido (bundle de Jito) no llega a la cadena y no se cobra;
// por RPC normal la transacción entra fallida y se paga la priority fee (el tip se revierte con ella).
export function failCost(settings) {
  const s = { ...DEFAULT_SETTINGS, ...settings };
  return s.mevSecure ? 0 : Number(s.priorityFee) || 0;
}

// Comisión del sitio donde cotiza el token, aparte del 1 % de Padre (comprobado en noviembre de 2026).
// 1) Si Padre ya nos dijo la tasa de ese token («Buy Tax»), es la buena: incluye cosas raras como pares
//    contra acciones tokenizadas o pools con comisión propia.
// 2) Si no, la estimamos:
//    · curva de pump.fun: 1,25 % (0,95 protocolo + 0,30 creador)
//    · curva de LaunchLab / bonk.fun y otros launchpads: ~1 %
//    · pool canónico de PumpSwap (token de pump.fun graduado): de 1,25 % a 0,30 % según el market cap en SOL
//    · Raydium AMM/CPMM: 0,25 % · resto de pools: ~0,30 %
// Tramos de PumpSwap: [market cap en SOL desde el que aplica, comisión total %]
export const PUMPSWAP_TIERS = [
  [0, 1.25], [420, 1.2], [1470, 1.15], [2460, 1.1], [3440, 1.05], [4420, 1], [9820, 0.95], [14740, 0.9],
  [19650, 0.85], [24560, 0.8], [29470, 0.75], [34380, 0.7], [39300, 0.65], [44210, 0.6], [49120, 0.55],
  [54030, 0.525], [58940, 0.5], [63850, 0.475], [68750, 0.45], [73660, 0.425], [78570, 0.4], [83480, 0.375],
  [88390, 0.35], [93300, 0.325], [98240, 0.3],
];
export function pumpswapFeePct(mcSol) {
  let fee = PUMPSWAP_TIERS[0][1];
  for (const [from, pct] of PUMPSWAP_TIERS) if (mcSol >= from) fee = pct;
  return fee;
}
export function poolFeePct(quote, solUsd) {
  const tax = Number(quote?.padreTaxPct);
  if (quote?.padreTaxPct != null && Number.isFinite(tax) && tax >= 0 && tax <= 30) return tax;
  const addr = String(quote?.address || '');
  const dex = String(quote?.dex || '').toLowerCase();
  if (quote?.stage === 'new') return dex === 'pumpfun' || dex === 'pump.fun' || /pump$/.test(addr) ? 1.25 : 1;
  if (dex === 'pumpswap' && /pump$/.test(addr)) {
    const mc = Number(quote?.marketCapUsd), sol = Number(solUsd);
    return mc > 0 && sol > 0 ? pumpswapFeePct(mc / sol) : 1.25;
  }
  if (dex === 'raydium') return 0.25;
  return 0.3;
}

export function simulateBuy({ solIn, quote, solUsd, settings }) {
  const s = { ...DEFAULT_SETTINGS, ...settings };
  const p = Number(quote?.priceUsd);
  if (!(solIn > 0)) return { ok: false, error: tr('Indica cuánto SOL quieres usar.') };
  if (!(p > 0) || !(solUsd > 0)) return { ok: false, error: tr('Sin precio en este momento.') };
  const poolPct = s.poolFees === false ? 0 : poolFeePct(quote, solUsd);
  const fee = solIn * ((s.feePct + poolPct) / 100);
  const netSol = solIn - fee;
  const usd = netSol * solUsd;
  const R = reserveUsd(quote, solUsd);
  const impactPct = (usd / R) * 100;
  const fillPrice = p * (1 + usd / R) * (1 + s.latencySlipPct / 100);
  const slipPct = (fillPrice / p - 1) * 100;
  const qty = usd / fillPrice;
  const net = txCost(s);
  const totalDebit = solIn + net;
  return {
    ok: slipPct <= s.maxSlippagePct,
    error: slipPct > s.maxSlippagePct
      ? tr('El precio se movería un {slip} y tu máximo es {max}. En real, la orden fallaría.', { slip: fmtPct(slipPct, 1), max: fmtPct(s.maxSlippagePct, 0) })
      : null,
    side: 'buy', solIn, fee, padreFee: solIn * (s.feePct / 100), poolFee: solIn * (poolPct / 100), poolPct, priorityFee: net, prio: Number(s.priorityFee) || 0, tip: Number(s.tipSol) || 0, totalDebit,
    qty, fillPrice, midPrice: p, slipPct, impactPct, usd,
  };
}

export function simulateSell({ qty, quote, solUsd, settings }) {
  const s = { ...DEFAULT_SETTINGS, ...settings };
  const p = Number(quote?.priceUsd);
  if (!(qty > 0)) return { ok: false, error: tr('No tienes tokens que vender.') };
  if (!(p > 0) || !(solUsd > 0)) return { ok: false, error: tr('Sin precio en este momento.') };
  const V = qty * p;
  const R = reserveUsd(quote, solUsd);
  const fillPrice = p * (R / (R + V)) * (1 - s.latencySlipPct / 100);
  const slipPct = (1 - fillPrice / p) * 100;
  const grossSol = (qty * fillPrice) / solUsd;
  const poolPct = s.poolFees === false ? 0 : poolFeePct(quote, solUsd);
  const fee = grossSol * ((s.feePct + poolPct) / 100);
  const net = txCost(s);
  const netSol = grossSol - fee - net;
  const maxSlip = Number(s.sellSlippagePct) || s.maxSlippagePct;
  return {
    ok: slipPct <= maxSlip,
    error: slipPct > maxSlip
      ? tr('Vender esto movería el precio un {slip} (máximo {max}). Prueba a vender menos de golpe.', { slip: fmtPct(slipPct, 1), max: fmtPct(maxSlip, 0) })
      : null,
    side: 'sell', qty, grossSol, fee, padreFee: grossSol * (s.feePct / 100), poolFee: grossSol * (poolPct / 100), poolPct, priorityFee: net, prio: Number(s.priorityFee) || 0, tip: Number(s.tipSol) || 0, netSol, maxSlip,
    fillPrice, midPrice: p, slipPct, impactPct: (V / R) * 100,
  };
}

// ---------- Posiciones ----------

// Lo que se pierde solo por entrar y salir al momento (comisiones, coste por orden e impacto), en %.
// Por defecto, una moneda típica: $80K de liquidez en PumpSwap.
export function roundTripPct(sizeSol, settings, quote = { priceUsd: 0.0005, liquidityUsd: 80000, marketCapUsd: 500000, stage: 'graduated', dex: 'pumpswap' }, solUsd = 180) {
  const b = simulateBuy({ solIn: sizeSol, quote, solUsd, settings: { ...settings, maxSlippagePct: 99 } });
  if (!b.ok) return null;
  const s = simulateSell({ qty: b.qty, quote, solUsd, settings: { ...settings, sellSlippagePct: 99 } });
  return (1 - s.netSol / b.totalDebit) * 100;
}

export function positionValueSol(pos, quote, solUsd) {
  if (!pos || !quote?.priceUsd || !solUsd) return null;
  return (pos.qty * quote.priceUsd) / solUsd;
}

export function positionPnl(pos, quote, solUsd) {
  const value = positionValueSol(pos, quote, solUsd);
  if (value == null) return null;
  const pnlSol = value - pos.costSol;
  return { value, pnlSol, pnlPct: pos.costSol > 0 ? (pnlSol / pos.costSol) * 100 : 0 };
}

// Nivel del stop en % de resultado. El dinámico salta cuando el valor cae un X % desde su máximo
// (no X puntos): con máximo +100 % y stop 30 %, salta en 2 × 0,7 = 1,4 → +40 %.
export function stopLevelPct(pos) {
  if (!pos?.sl) return null;
  if (!pos.sl.trailing) return -pos.sl.pct;
  const peak = Math.max(0, Number(pos.peakPct) || 0);
  if (peak === 0) return -pos.sl.pct;
  return ((1 + peak / 100) * (1 - pos.sl.pct / 100) - 1) * 100;
}

// Recorrido de una posición entre su stop loss (izquierda) y su take profit (derecha).
// Devuelve posiciones 0..1 para pintar la barra; null si no hay TP ni SL.
export function rangeModel(pnlPct, pos, stopLevel) {
  if (!pos || (!pos.tp && !pos.sl) || pnlPct == null || !isFinite(pnlPct)) return null;
  // stopLevel: nivel del stop en % de PnL (p. ej. −30, o +20 con stop dinámico ya en beneficios).
  const L = pos.sl ? (stopLevel ?? stopLevelPct(pos)) : Math.min(-50, pnlPct * 1.15);
  const R = pos.tp ? pos.tp.pct : Math.max(100, pnlPct * 1.15);
  const clamp = (v) => Math.min(1, Math.max(0, v));
  const at = (v) => clamp((v - L) / (R - L));
  const toTp = pos.tp ? pnlPct / pos.tp.pct : 0;
  const toSl = pos.sl ? 1 - (pnlPct - L) / Math.max(1e-9, Math.min(pos.sl.pct, R - L)) : 0;
  return { L, R, x0: at(0), x: at(pnlPct), hasSl: !!pos.sl, hasTp: !!pos.tp, near: Math.max(toTp, toSl) };
}

// Tono estable por token (para avatares sin imagen).
export function hueFor(text) {
  let h = 0;
  for (const c of String(text || '?')) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

// ---------- Estadísticas ----------

export function computeStats(rounds, { since = 0 } = {}) {
  const list = rounds.filter((r) => r.closedAt >= since);
  const wins = list.filter((r) => r.pnlSol > 0);
  const losses = list.filter((r) => r.pnlSol <= 0);
  const sum = (a) => a.reduce((acc, r) => acc + r.pnlSol, 0);
  const grossWin = sum(wins);
  const grossLoss = Math.abs(sum(losses));
  const holds = list.map((r) => r.closedAt - r.openedAt).filter((x) => x >= 0);
  const best = list.reduce((b, r) => (!b || r.pnlSol > b.pnlSol ? r : b), null);
  const worst = list.reduce((w, r) => (!w || r.pnlSol < w.pnlSol ? r : w), null);
  let streak = 0, maxLossStreak = 0;
  [...list].sort((a, b) => a.closedAt - b.closedAt).forEach((r) => {
    streak = r.pnlSol <= 0 ? streak + 1 : 0;
    maxLossStreak = Math.max(maxLossStreak, streak);
  });
  const byReason = { tp: 0, sl: 0, trail: 0, initials: 0, manual: 0 };
  list.forEach((r) => { byReason[r.reason || 'manual'] = (byReason[r.reason || 'manual'] || 0) + 1; });
  const group = (items) => {
    const w = items.filter((r) => r.pnlSol > 0).length;
    return { count: items.length, net: items.reduce((a, r) => a + r.pnlSol, 0), winRate: items.length ? (w / items.length) * 100 : null };
  };
  const byPlan = {
    yes: group(list.filter((r) => r.followedPlan === true)),
    no: group(list.filter((r) => r.followedPlan === false)),
  };
  const byTag = {};
  REVIEW_TAGS.forEach((t) => {
    const g = group(list.filter((r) => (r.tags || []).includes(t.id)));
    if (g.count) byTag[t.id] = { ...g, label: t.label };
  });
  const reviewed = list.filter((r) => r.followedPlan != null || (r.tags || []).length).length;
  return {
    byPlan, byTag, reviewed,
    count: list.length,
    wins: wins.length,
    losses: losses.length,
    winRate: list.length ? (wins.length / list.length) * 100 : null,
    netSol: sum(list),
    invested: list.reduce((a, r) => a + r.investedSol, 0),
    avgWin: wins.length ? grossWin / wins.length : null,
    avgLoss: losses.length ? -grossLoss / losses.length : null,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? Infinity : null),
    best, worst,
    avgHoldMs: holds.length ? holds.reduce((a, b) => a + b, 0) / holds.length : null,
    maxLossStreak,
    byReason,
    feesSol: list.reduce((a, r) => a + (r.feesSol || 0), 0),
  };
}

// ---------- Formato ----------

const SUB = '₀₁₂₃₄₅₆₇₈₉';
const nf = (min, max) => new Intl.NumberFormat(locale(), { minimumFractionDigits: min, maximumFractionDigits: max });
const decSep = () => (locale() === 'en-US' ? '.' : ',');

export function fmtNum(n, max = 2, min = 0) {
  if (n == null || !isFinite(n)) return '—';
  return nf(min, max).format(n);
}

// Precio en USD con ceros comprimidos: 0,0₅4213 (es) / 0.0₅4213 (en)
export function fmtPrice(n) {
  if (n == null || !isFinite(n) || n <= 0) return '—';
  if (n >= 1000) return '$' + nf(0, 0).format(n);
  if (n >= 1) return '$' + nf(2, 4).format(n);
  const s = n.toFixed(20);
  const m = s.match(/^0\.(0*)(\d+)/);
  const zeros = m[1].length;
  const digits = m[2].slice(0, 4).replace(/0+$/, '') || '0';
  if (zeros < 4) return '$' + nf(2, zeros + 4).format(n);
  const sub = String(zeros).split('').map((d) => SUB[d]).join('');
  return `$0${decSep()}0${sub}${digits}`;
}

export function fmtCompact(n, prefix = '') {
  if (n == null || !isFinite(n)) return '—';
  const a = Math.abs(n);
  const sign = n < 0 ? '−' : '';
  const units = [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']];
  // Redondeamos antes de elegir la unidad: 999.999 → «1M», no «1000K».
  for (let i = 0; i < units.length; i++) {
    const [v, u] = units[i];
    if (a < v * 0.9995 && !(i === units.length - 1 && a >= 999.5)) continue;
    const x = a / v, dig = x >= 99.95 ? 0 : x >= 9.995 ? 1 : 2;
    const r = Number(x.toFixed(dig));
    if (r >= 1000 && i > 0) { const [v2, u2] = units[i - 1]; return `${sign}${prefix}${nf(0, 2).format(a / v2)}${u2}`; }
    return `${sign}${prefix}${nf(0, dig).format(x)}${u}`;
  }
  // Menos de 1 (p. ej. 0,00017 WBTC): tres cifras significativas en vez de «0».
  if (a > 0 && a < 1) return `${sign}${prefix}${new Intl.NumberFormat(locale(), { maximumSignificantDigits: 3 }).format(a)}`;
  return `${sign}${prefix}${nf(0, a >= 100 ? 0 : 2).format(a)}`;
}

export function fmtSol(n, { sign = false, digits } = {}) {
  if (n == null || !isFinite(n)) return '—';
  const a = Math.abs(n);
  const d = digits ?? (a >= 100 ? 1 : a >= 1 ? 3 : 4);
  const s = nf(digits != null ? d : (d > 2 ? 2 : d), d).format(a);
  const pre = n < 0 ? '−' : sign && n > 0 ? '+' : '';
  return `${pre}${s}`;
}

export function fmtPct(n, digits = 1, { sign = false } = {}) {
  if (n == null || !isFinite(n)) return '—';
  const pre = n < 0 ? '−' : sign && n > 0 ? '+' : '';
  return `${pre}${nf(0, digits).format(Math.abs(n))}%`;
}

export function fmtUsd(n, { sign = false } = {}) {
  if (n == null || !isFinite(n)) return '—';
  const pre = n < 0 ? '−' : sign && n > 0 ? '+' : '';
  return `${pre}$${nf(2, 2).format(Math.abs(n))}`;
}

export function fmtDuration(ms) {
  if (ms == null || !isFinite(ms)) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = s / 3600;
  if (h < 48) return `${nf(0, 1).format(h)} h`;
  return `${nf(0, 1).format(h / 24)} d`;
}

export function fmtWhen(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });
  if (sameDay) return tr('hoy {t}', { t: time });
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return tr('ayer {t}', { t: time });
  return d.toLocaleDateString(locale(), { day: 'numeric', month: 'short' }) + ` ${time}`;
}

export function tone(n) {
  if (n == null || !isFinite(n) || Math.abs(n) < 1e-9) return 'flat';
  return n > 0 ? 'up' : 'down';
}

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
