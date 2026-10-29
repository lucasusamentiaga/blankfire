// Blankfire — service worker: única fuente de verdad de la cuenta ficticia,
// precios (DexScreener + Jupiter para tokens recién creados) y vigilancia de Take Profit / Stop Loss.
import {
  DEFAULT_SETTINGS, simulateBuy, simulateSell, positionPnl, uid, fmtSol, fmtPct, fmtCompact,
  realizedSince, startOfDay, REVIEW_TAGS, LAUNCH_DEXES, stopLevelPct,
} from './lib/core.js';
import { tr, setLang } from './lib/i18n.js';

const KEY = 'fogueo';
const DS = 'https://api.dexscreener.com';
const JUP = 'https://lite-api.jup.ag';
const MAX_QUOTE_AGE = 15000; // no se opera con precios de más de 15 s
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const QUOTE_TTL = 2500;
const SOL_TTL = 30000;

// ---------- Estado ----------

function freshAccount(startBalance) {
  const now = Date.now();
  return {
    id: uid(), startedAt: now, startBalance, balance: startBalance,
    positions: {}, rounds: [], fills: [], orders: [],
    equity: [{ t: now, v: startBalance }],
  };
}

function freshState() {
  return { version: 1, settings: { ...DEFAULT_SETTINGS }, account: freshAccount(DEFAULT_SETTINGS.startBalance), archive: [], ui: {} };
}

async function load() {
  const got = await chrome.storage.local.get(KEY);
  let st = got[KEY];
  if (!st) { st = freshState(); await chrome.storage.local.set({ [KEY]: st }); }
  st.settings = { ...DEFAULT_SETTINGS, ...st.settings };
  st.account.orders ||= [];
  setLang(st.settings.lang);
  return st;
}

// Serializa todas las escrituras para que dos órdenes nunca se pisen.
let chain = Promise.resolve();
function mutate(fn) {
  const run = chain.then(async () => {
    const st = await load();
    const result = await fn(st);
    await chrome.storage.local.set({ [KEY]: st });
    return result;
  });
  chain = run.catch(() => {});
  return run;
}

// ---------- Precios ----------

const quoteCache = new Map(); // key -> {at, quote}
let solCache = { at: 0, usd: null };

async function getJson(url) {
  const res = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(7000) });
  if (!res.ok) throw new Error(tr('DexScreener respondió {s}', { s: res.status }));
  return res.json();
}

// Jupiter: cubre los tokens recién creados (pump.fun, bonding curve) que DexScreener aún no lista.
let jupBackoffUntil = 0;
async function jupJson(url) {
  if (Date.now() < jupBackoffUntil) throw new Error(tr('Jupiter: esperando por límite de peticiones'));
  const res = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(7000) });
  if (res.status === 429) { jupBackoffUntil = Date.now() + 6000; throw new Error(tr('Jupiter: demasiadas peticiones')); }
  if (!res.ok) throw new Error(tr('Jupiter respondió {s}', { s: res.status }));
  return res.json();
}

function jupToQuote(t) {
  launchInfo.set(t.id, { launchpad: t.launchpad || null, graduatedAt: t.graduatedAt || null, liquidityUsd: Number(t.liquidity) || null, icon: t.icon || null });
  return {
    stage: t.graduatedPool ? 'graduated' : (t.launchpad ? 'new' : null),
    graduatedAt: t.graduatedAt || null,
    pairCreatedAt: t.createdAt ? Date.parse(t.createdAt) : null,
    chain: 'solana',
    address: t.id,
    pairAddress: null,
    symbol: t.symbol,
    name: t.name,
    icon: t.icon || null,
    dex: t.launchpad || 'jupiter',
    source: 'jupiter',
    priceUsd: Number(t.usdPrice) || null,
    liquidityUsd: Number(t.liquidity) || null,
    marketCapUsd: Number(t.mcap ?? t.fdv) || null,
    change: { m5: t.stats5m?.priceChange ?? null, h1: t.stats1h?.priceChange ?? null, h24: t.stats24h?.priceChange ?? null },
    at: Date.now(),
  };
}

const SOL_ADDR = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

// Hasta 100 mints por petición.
async function jupQuotes(mints) {
  const out = {};
  const list = mints.filter((m) => SOL_ADDR.test(m));
  for (let i = 0; i < list.length; i += 100) {
    const slice = list.slice(i, i + 100);
    const arr = await jupJson(`${JUP}/tokens/v2/search?query=${slice.join(',')}`);
    (Array.isArray(arr) ? arr : []).forEach((t) => {
      if (slice.includes(t.id) && Number(t.usdPrice) > 0) out[t.id] = jupToQuote(t);
    });
  }
  return out;
}

// Tipo de token: 'new' (en la curva de lanzamiento), 'graduated' (ya en su pool) o null (token asentado).
const launchInfo = new Map(); // mint -> { launchpad, graduatedAt } (de Jupiter)

function stageFromPair(pair) {
  const addr = pair.baseToken?.address || '';
  if (LAUNCH_DEXES.includes(pair.dexId)) return 'new';
  const info = launchInfo.get(addr);
  if (info?.launchpad) return info.graduatedAt ? 'graduated' : (pair.dexId && !LAUNCH_DEXES.includes(pair.dexId) ? 'graduated' : 'new');
  if (/(pump|bonk)$/.test(addr)) return 'graduated';
  return null;
}

function pairToQuote(pair) {
  const info = launchInfo.get(pair.baseToken?.address);
  return {
    stage: stageFromPair(pair),
    graduatedAt: info?.graduatedAt || null,
    pairCreatedAt: pair.pairCreatedAt || null,
    chain: pair.chainId,
    address: pair.baseToken.address,
    pairAddress: pair.pairAddress,
    symbol: pair.baseToken.symbol,
    name: pair.baseToken.name,
    icon: pair.info?.imageUrl || info?.icon || null,
    dex: pair.dexId,
    priceUsd: Number(pair.priceUsd) || null,
    // En la bonding curve DexScreener no da liquidez: usamos la de Jupiter si la tenemos.
    liquidityUsd: Number(pair.liquidity?.usd) || (LAUNCH_DEXES.includes(pair.dexId) ? info?.liquidityUsd : null) || null,
    marketCapUsd: Number(pair.marketCap ?? pair.fdv) || null,
    change: {
      m5: pair.priceChange?.m5 ?? null,
      h1: pair.priceChange?.h1 ?? null,
      h24: pair.priceChange?.h24 ?? null,
    },
    at: Date.now(),
  };
}

const sameAddr = (a, b) => a && b && (a.startsWith('0x') ? a.toLowerCase() === b.toLowerCase() : a === b);

// Elige el par: si la dirección (o el par preferido) es un par concreto, ese;
// si no, el de más liquidez del token. Así el precio coincide con el par que enseña Padre.
function pickPair(pairs, address, preferredPair) {
  if (!Array.isArray(pairs) || !pairs.length) return null;
  const asPair = pairs.find((p) => sameAddr(p.pairAddress, address) && Number(p.priceUsd) > 0);
  if (asPair) return asPair;
  const tokenAddr = address;
  const candidates = pairs.filter((p) => sameAddr(p.baseToken?.address, tokenAddr) && Number(p.priceUsd) > 0);
  if (!candidates.length) return null;
  if (preferredPair) {
    const pref = candidates.find((p) => sameAddr(p.pairAddress, preferredPair));
    if (pref) return pref;
  }
  return candidates.sort((a, b) => (Number(b.liquidity?.usd) || 0) - (Number(a.liquidity?.usd) || 0))[0];
}

const preferredPairs = new Map(); // "cadena:token" -> par que el usuario está viendo en Padre

async function solUsd() {
  if (solCache.usd && Date.now() - solCache.at < SOL_TTL) return solCache.usd;
  try {
    const pairs = await getJson(`${DS}/tokens/v1/solana/${SOL_MINT}`);
    const best = (pairs || [])
      .filter((p) => p.baseToken?.address === SOL_MINT && /USD/.test(p.quoteToken?.symbol || '') && Number(p.priceUsd) > 0)
      .sort((a, b) => (Number(b.liquidity?.usd) || 0) - (Number(a.liquidity?.usd) || 0))[0];
    if (best) solCache = { at: Date.now(), usd: Number(best.priceUsd) };
  } catch (e) { /* probamos Jupiter */ }
  if (!solCache.usd || Date.now() - solCache.at >= SOL_TTL) {
    try {
      const j = await jupJson(`${JUP}/price/v3?ids=${SOL_MINT}`);
      const usd = Number(j?.[SOL_MINT]?.usdPrice);
      if (usd > 0) solCache = { at: Date.now(), usd };
    } catch (e) { /* conservamos el último valor */ }
  }
  return solCache.usd;
}

// Resuelve una dirección (token o par) vista en la URL de Padre.
async function resolveAddress(address) {
  const cached = [...quoteCache.values()].find((c) => sameAddr(c.quote.address, address) || sameAddr(c.quote.pairAddress, address));
  if (cached && Date.now() - cached.at < QUOTE_TTL) return cached.quote;
  let pair = null, dsError = null;
  try {
    const data = await getJson(`${DS}/latest/dex/search?q=${encodeURIComponent(address)}`);
    let asPair = (data.pairs || []).find((p) => sameAddr(p.pairAddress, address));
    const tokenAddr = asPair ? asPair.baseToken.address : address;
    const chainId = asPair?.chainId || (data.pairs || []).find((p) => sameAddr(p.baseToken?.address, tokenAddr))?.chainId;
    // Una consulta a Jupiter para saber si salió de un launchpad y si ya se graduó.
    if (chainId === 'solana' && !launchInfo.has(tokenAddr)) {
      try { await jupQuotes([tokenAddr]); } catch (e) { /* sin metadatos: deducimos por el DEX */ }
      if (!launchInfo.has(tokenAddr)) launchInfo.set(tokenAddr, { launchpad: null, graduatedAt: null, liquidityUsd: null });
    }
    // Un token graduado conserva su viejo par de la curva con un precio congelado: no lo usamos.
    const graduated = !!launchInfo.get(tokenAddr)?.graduatedAt;
    if (asPair && graduated && LAUNCH_DEXES.includes(asPair.dexId)) asPair = null;
    const pool = graduated ? (data.pairs || []).filter((p) => !LAUNCH_DEXES.includes(p.dexId)) : data.pairs;
    pair = pickPair(pool, asPair ? asPair.pairAddress : tokenAddr, null) || pickPair(pool, tokenAddr, null);
    if (asPair && pair) preferredPairs.set(`${pair.chainId}:${pair.baseToken.address}`, asPair.pairAddress);
  } catch (e) { dsError = e; }
  if (pair) {
    const q = pairToQuote(pair);
    quoteCache.set(`${q.chain}:${q.address}`, { at: Date.now(), quote: q });
    return q;
  }
  // Token recién creado (o DexScreener caído): Jupiter.
  if (SOL_ADDR.test(address)) {
    try {
      const got = await jupQuotes([address]);
      const q = got[address];
      if (q) { quoteCache.set(`solana:${address}`, { at: Date.now(), quote: q }); return q; }
    } catch (e) { if (dsError) throw dsError; }
  }
  if (dsError) throw dsError;
  return null;
}

// Refresca varias posiciones de golpe (hasta 30 por cadena y llamada).
async function refreshQuotes(keys, { force = false } = {}) {
  const out = {};
  const stale = [];
  for (const k of keys) {
    const c = quoteCache.get(k);
    if (c && !force && Date.now() - c.at < QUOTE_TTL) out[k] = c.quote; else stale.push(k);
  }
  const byChain = {};
  stale.forEach((k) => { const [chain, addr] = k.split(':'); (byChain[chain] ||= []).push(addr); });
  const missing = []; // direcciones de Solana que DexScreener no devolvió → Jupiter
  await Promise.all(Object.entries(byChain).map(async ([chain, addrs]) => {
    // Los tokens que ya sabemos que solo están en Jupiter no gastan petición en DexScreener.
    const viaJup = chain === 'solana' ? addrs.filter((a) => quoteCache.get(`solana:${a}`)?.quote.source === 'jupiter') : [];
    missing.push(...viaJup);
    const viaDs = addrs.filter((a) => !viaJup.includes(a));
    for (let i = 0; i < viaDs.length; i += 30) {
      const slice = viaDs.slice(i, i + 30);
      try {
        const pairs = await getJson(`${DS}/tokens/v1/${chain}/${slice.join(',')}`);
        slice.forEach((addr) => {
          const grad = !!launchInfo.get(addr)?.graduatedAt;
          const pool = grad ? (pairs || []).filter((p) => !LAUNCH_DEXES.includes(p.dexId)) : pairs;
          const pair = pickPair(pool, addr, preferredPairs.get(`${chain}:${addr}`));
          if (pair) {
            const q = pairToQuote(pair);
            quoteCache.set(`${chain}:${q.address}`, { at: Date.now(), quote: q });
            out[`${chain}:${addr}`] = q;
          } else if (chain === 'solana') missing.push(addr);
        });
      } catch (e) {
        if (chain === 'solana') missing.push(...slice);
      }
    }
  }));
  if (missing.length) {
    try {
      const got = await jupQuotes([...new Set(missing)]);
      Object.entries(got).forEach(([addr, q]) => {
        quoteCache.set(`solana:${addr}`, { at: Date.now(), quote: q });
        out[`solana:${addr}`] = q;
      });
    } catch (e) { /* abajo usamos la última cotización conocida */ }
  }
  // Lo que no se pudo refrescar se devuelve con su hora real (el panel avisa si está viejo).
  keys.forEach((k) => { if (!out[k] && quoteCache.get(k)) out[k] = quoteCache.get(k).quote; });
  return out;
}

// ---------- Operaciones ----------

function equityOf(st, quotes, sol) {
  let v = st.account.balance;
  for (const [k, pos] of Object.entries(st.account.positions)) {
    const q = quotes[k];
    if (q?.priceUsd && sol) v += (pos.qty * q.priceUsd) / sol;
    else v += pos.costSol; // sin precio: a coste
  }
  return v;
}

function trimHistory(st) {
  const f = st.account.fills;
  if (f.length > 4000) f.splice(0, f.length - 4000);
}

function pushEquity(st, quotes, sol) {
  trimHistory(st);
  // Las demás posiciones se valoran con su última cotización conocida (no a coste).
  quotes = { ...quotes };
  Object.keys(st.account.positions).forEach((k) => { if (!quotes[k] && quoteCache.get(k)) quotes[k] = quoteCache.get(k).quote; });
  const eq = st.account.equity;
  eq.push({ t: Date.now(), v: equityOf(st, quotes, sol) });
  if (eq.length > 2000) eq.splice(1, eq.length - 2000);
}

function priceError(msg) { const e = new Error(msg); e.code = 'NO_PRICE'; return e; }

async function doBuy({ key, solIn, tpPct, slPct, trailing, note, url, via = 'manual' }) {
  const [chain] = key.split(':');
  const sol = await solUsd();
  const quotes = await refreshQuotes([key], { force: true });
  const quote = quotes[key];
  if (!quote) throw priceError(tr('No hay precio para este token ahora mismo.'));
  if (Date.now() - quote.at > MAX_QUOTE_AGE) throw priceError(tr('El último precio es de hace {s} s y no se puede actualizar. No opero con precios viejos: inténtalo en unos segundos.', { s: Math.round((Date.now() - quote.at) / 1000) }));
  if (!sol) throw priceError(tr('No tengo el precio del SOL ahora mismo. Inténtalo en unos segundos.'));
  return mutate(async (st) => {
    const limit = Number(st.settings.dailyLossLimit) || 0;
    if (limit > 0) {
      const today = realizedSince(st.account, startOfDay());
      if (today <= -limit) {
        throw new Error(tr('Hoy ya has perdido {a} SOL y tu límite diario es {b}. Para y revisa tus trades: mañana se desbloquea.', { a: fmtSol(-today), b: fmtSol(limit) }));
      }
    }
    const sim = simulateBuy({ solIn, quote, solUsd: sol, settings: st.settings });
    if (sim.totalDebit > st.account.balance + 1e-12) {
      throw new Error(tr('Saldo insuficiente: necesitas {a} SOL y tienes {b}.', { a: fmtSol(sim.totalDebit), b: fmtSol(st.account.balance) }));
    }
    if (!sim.ok) {
      // Igual que en real: la transacción falla pero la priority fee se paga.
      st.account.balance -= st.settings.priorityFee;
      st.account.fills.push({ id: uid(), t: Date.now(), key, symbol: quote.symbol, side: 'buy', failed: true, reason: sim.error, priorityFee: st.settings.priorityFee });
      return { ok: false, error: sim.error, chargedFee: st.settings.priorityFee };
    }
    st.account.balance -= sim.totalDebit;
    const now = Date.now();
    let pos = st.account.positions[key];
    if (!pos) {
      pos = st.account.positions[key] = {
        id: uid(), key, chain, address: quote.address, pairAddress: quote.pairAddress,
        symbol: quote.symbol, name: quote.name, icon: quote.icon, url: url || null,
        qty: 0, costSol: 0, investedSol: 0, returnedSol: 0, feesSol: 0,
        avgEntryUsd: 0, entryMcUsd: quote.marketCapUsd, openedAt: now,
        tp: null, sl: null, entryNote: '', exitNote: '', lesson: '', fills: [],
      };
    }
    const prevQty = pos.qty, prevCost = pos.costSol;
    pos.qty += sim.qty;
    pos.avgEntryUsd = (pos.avgEntryUsd * prevQty + sim.fillPrice * sim.qty) / pos.qty;
    pos.costSol += sim.totalDebit;
    pos.investedSol += sim.totalDebit;
    pos.feesSol += sim.fee + sim.priorityFee;
    if (url) pos.url = url;
    if (note) pos.entryNote = pos.entryNote ? `${pos.entryNote}\n${note}` : note;
    if (tpPct > 0) pos.tp = { pct: tpPct };
    if (slPct > 0) pos.sl = { pct: slPct, trailing: !!trailing };
    // Al ampliar, el máximo se reexpresa sobre el nuevo coste (mismo precio máximo, más tokens).
    if (prevQty > 0 && (pos.peakPct ?? 0) > 0 && pos.costSol > 0) {
      const peakValue = (1 + pos.peakPct / 100) * prevCost * (pos.qty / prevQty);
      pos.peakPct = Math.max(0, (peakValue / pos.costSol - 1) * 100);
    } else pos.peakPct = Math.max(pos.peakPct ?? 0, 0);
    const fill = { id: uid(), t: now, key, symbol: quote.symbol, side: 'buy', via, sol: sim.totalDebit, qty: sim.qty, price: sim.fillPrice, mc: quote.marketCapUsd, slipPct: sim.slipPct, fee: sim.fee + sim.priorityFee };
    pos.fills.push(fill);
    st.account.fills.push(fill);
    pushEquity(st, { ...quotes }, sol);
    return { ok: true, fill, position: pos };
  }).finally(updateBadge);
}

async function doSell({ key, pct, note, reason = 'manual' }) {
  const sol = await solUsd();
  const quotes = await refreshQuotes([key], { force: true });
  const quote = quotes[key];
  if (!quote) throw priceError(tr('No hay precio para este token ahora mismo.'));
  if (Date.now() - quote.at > MAX_QUOTE_AGE) throw priceError(tr('El último precio es de hace {s} s y no se puede actualizar. No opero con precios viejos: inténtalo en unos segundos.', { s: Math.round((Date.now() - quote.at) / 1000) }));
  if (!sol) throw priceError(tr('No tengo el precio del SOL ahora mismo. Inténtalo en unos segundos.'));
  return mutate(async (st) => {
    const pos = st.account.positions[key];
    if (!pos || pos.qty <= 0) throw new Error(tr('No tienes posición en este token.'));
    if (st.account.balance < st.settings.priorityFee) throw new Error(tr('No te queda SOL para pagar la priority fee de la venta ({fee} SOL).', { fee: fmtSol(st.settings.priorityFee) }));
    const frac = Math.min(Math.max(pct, 0), 100) / 100;
    const qty = frac >= 0.9999 ? pos.qty : pos.qty * frac;
    const sim = simulateSell({ qty, quote, solUsd: sol, settings: st.settings });
    if (!sim.ok) {
      st.account.balance -= st.settings.priorityFee;
      st.account.fills.push({ id: uid(), t: Date.now(), key, symbol: pos.symbol, side: 'sell', failed: true, reason: sim.error, priorityFee: st.settings.priorityFee });
      return { ok: false, error: sim.error, chargedFee: st.settings.priorityFee };
    }
    const now = Date.now();
    const basis = pos.costSol * (qty / pos.qty);
    st.account.balance += sim.netSol;
    pos.qty -= qty;
    pos.costSol -= basis;
    pos.returnedSol += sim.netSol;
    pos.feesSol += sim.fee + sim.priorityFee;
    if (note) pos.exitNote = pos.exitNote ? `${pos.exitNote}\n${note}` : note;
    const fill = { id: uid(), t: now, key, symbol: pos.symbol, side: 'sell', sol: sim.netSol, qty, price: sim.fillPrice, mc: quote.marketCapUsd, slipPct: sim.slipPct, fee: sim.fee + sim.priorityFee, pnlSol: sim.netSol - basis, reason };
    pos.fills.push(fill);
    st.account.fills.push(fill);
    let round = null;
    if (pos.qty <= 1e-12 || frac >= 0.9999) {
      round = {
        id: pos.id, key, chain: pos.chain, address: pos.address, symbol: pos.symbol, name: pos.name, icon: pos.icon, url: pos.url,
        openedAt: pos.openedAt, closedAt: now, investedSol: pos.investedSol, returnedSol: pos.returnedSol,
        pnlSol: pos.returnedSol - pos.investedSol,
        pnlPct: pos.investedSol > 0 ? ((pos.returnedSol - pos.investedSol) / pos.investedSol) * 100 : 0,
        entryMcUsd: pos.entryMcUsd, exitMcUsd: quote.marketCapUsd, avgEntryUsd: pos.avgEntryUsd,
        feesSol: pos.feesSol, reason, entryNote: pos.entryNote, exitNote: pos.exitNote, lesson: '', fills: pos.fills,
      };
      st.account.rounds.unshift(round);
      delete st.account.positions[key];
    }
    pushEquity(st, quotes, sol);
    return { ok: true, fill, round, position: st.account.positions[key] || null };
  }).finally(updateBadge);
}

// Vender justo lo necesario para recuperar lo que queda invertido.
async function doSellInitials({ key, note }) {
  const sol = await solUsd();
  const quotes = await refreshQuotes([key], { force: true });
  const quote = quotes[key];
  if (!quote) throw priceError(tr('No hay precio para este token ahora mismo.'));
  if (Date.now() - quote.at > MAX_QUOTE_AGE) throw priceError(tr('El último precio es de hace {s} s y no se puede actualizar. No opero con precios viejos: inténtalo en unos segundos.', { s: Math.round((Date.now() - quote.at) / 1000) }));
  if (!sol) throw priceError(tr('No tengo el precio del SOL ahora mismo. Inténtalo en unos segundos.'));
  const st = await load();
  const pos = st.account.positions[key];
  if (!pos) throw new Error(tr('No tienes posición en este token.'));
  const target = pos.costSol;
  const all = simulateSell({ qty: pos.qty, quote, solUsd: sol, settings: st.settings });
  if (!(all.netSol > target)) {
    throw new Error(tr('Ahora mismo vender todo te daría {a} SOL y tienes {b} invertidos: aún no puedes recuperar la inversión.', { a: fmtSol(all.netSol), b: fmtSol(target) }));
  }
  let lo = 0, hi = pos.qty;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    const sim = simulateSell({ qty: mid, quote, solUsd: sol, settings: st.settings });
    if (sim.netSol >= target) hi = mid; else lo = mid;
  }
  const pct = Math.min(100, (hi / pos.qty) * 100 * 1.0005);
  return doSell({ key, pct, note, reason: 'initials' });
}

// ---------- Take Profit / Stop Loss ----------

let checking = false;
async function checkTriggers(onlyKeys) {
  if (checking) return;
  checking = true;
  try {
    const st = await load();
    const posKeys = Object.keys(st.account.positions).filter((k) => {
      const p = st.account.positions[k];
      return (p.tp || p.sl) && (!onlyKeys || onlyKeys.includes(k));
    });
    const orders = (st.account.orders || []).filter((o) => !onlyKeys || onlyKeys.includes(o.key));
    const keys = [...new Set([...posKeys, ...orders.map((o) => o.key)])];
    if (!keys.length) return;
    const quotes = await refreshQuotes(keys);
    const sol = await solUsd();

    for (const k of posKeys) {
      const pos = st.account.positions[k];
      const pnl = positionPnl(pos, quotes[k], sol);
      if (!pnl) continue;
      // Mismo % que ves en el panel: valor actual frente a lo invertido (con costes).
      const movePct = pnl.pnlPct;
      const peak = Math.max(pos.peakPct ?? 0, movePct);
      if (peak > (pos.peakPct ?? 0) + 0.5) {
        await mutate((s2) => { const p2 = s2.account.positions[k]; if (p2) p2.peakPct = Math.max(p2.peakPct ?? 0, peak); });
      }
      let reason = null;
      const stop = stopLevelPct({ ...pos, peakPct: peak });   // dinámico: caída de un X % desde el máximo
      if (pos.tp && movePct >= pos.tp.pct) reason = 'tp';
      else if (pos.sl && movePct <= stop) reason = pos.sl.trailing && stop > -pos.sl.pct + 1e-9 ? 'trail' : 'sl';
      if (!reason) continue;
      try {
        const res = await doSell({ key: k, pct: 100, reason });
        const title = tr({ tp: 'Take profit en ${sym}', sl: 'Stop loss en ${sym}', trail: 'Trailing stop en ${sym}' }[reason], { sym: pos.symbol });
        if (res.ok) {
          notify(title, tr('Vendido todo. Resultado: {a} SOL ({b}).', { a: fmtSol(res.round?.pnlSol, { sign: true }), b: fmtPct(res.round?.pnlPct, 1, { sign: true }) }));
          broadcast({ type: 'triggered', key: k, reason, round: res.round });
        } else {
          notify(tr('No se pudo cerrar ${sym}', { sym: pos.symbol }), res.error);
        }
      } catch (e) { /* lo reintentamos en la siguiente vuelta */ }
    }

    for (const o of orders) {
      const q = quotes[o.key];
      if (!q?.marketCapUsd || q.marketCapUsd > o.mc || Date.now() - q.at > MAX_QUOTE_AGE) continue;
      const still = await load();
      if (!still.account.orders.some((x) => x.id === o.id)) continue; // cancelada mientras tanto
      try {
        const res = await doBuy({ key: o.key, solIn: o.solIn, tpPct: o.tpPct, slPct: o.slPct, trailing: o.trailing, note: o.note, url: o.url, via: 'limit' });
        await mutate((s2) => { s2.account.orders = s2.account.orders.filter((x) => x.id !== o.id); });
        if (res.ok) {
          notify(tr('Orden límite ejecutada: ${sym}', { sym: o.symbol }), tr('Compraste {a} SOL a {b} de MC.', { a: fmtSol(o.solIn), b: fmtCompact(q.marketCapUsd, '$') }));
          broadcast({ type: 'orderFilled', key: o.key, order: o });
        } else {
          notify(tr('Orden límite fallida: ${sym}', { sym: o.symbol }), res.error);
          broadcast({ type: 'orderFailed', key: o.key, error: res.error });
        }
      } catch (e) {
        if (e.code === 'NO_PRICE') continue; // fallo de red: la orden sigue esperando
        await mutate((s2) => { s2.account.orders = s2.account.orders.filter((x) => x.id !== o.id); });
        notify(tr('Orden límite cancelada: ${sym}', { sym: o.symbol }), e.message);
        broadcast({ type: 'orderFailed', key: o.key, error: e.message });
      }
    }
  } finally {
    checking = false;
  }
}

function notify(title, message) {
  try {
    chrome.notifications.create({ type: 'basic', iconUrl: 'icons/icon128.png', title, message, priority: 1 });
  } catch (e) { /* notificaciones desactivadas */ }
}

async function broadcast(msg) {
  try {
    const tabs = await chrome.tabs.query({ url: 'https://trade.padre.gg/*' });
    tabs.forEach((t) => chrome.tabs.sendMessage(t.id, msg).catch(() => {}));
  } catch (e) { /* sin pestañas */ }
  chrome.runtime.sendMessage(msg).catch(() => {});
}

async function updateBadge() {
  const st = await load();
  const n = Object.keys(st.account.positions).length + (st.account.orders?.length || 0);
  chrome.action.setBadgeBackgroundColor({ color: '#E8B23A' });
  chrome.action.setBadgeTextColor?.({ color: '#1E1608' });
  chrome.action.setBadgeText({ text: n ? String(n) : '' });
}

// ---------- Mensajes ----------

const handlers = {
  async state() { return load(); },

  async resolve({ address }) {
    const [quote, sol] = await Promise.all([resolveAddress(address), solUsd()]);
    return { quote, solUsd: sol };
  },

  async quotes({ keys, force }) {
    const [quotes, sol] = await Promise.all([refreshQuotes(keys || [], { force }), solUsd()]);
    return { quotes, solUsd: sol };
  },

  async tick({ key, address }) {
    // El service worker puede haberse dormido y olvidado el par que ves en Padre.
    if (address && key && address !== key.split(':')[1]) preferredPairs.set(key, address);
    const [quotes, sol] = await Promise.all([refreshQuotes([key]), solUsd()]);
    checkTriggers([key]);
    return { quote: quotes[key] || null, solUsd: sol };
  },

  buy: (m) => doBuy(m),
  sell: (m) => doSell(m),
  sellInitials: (m) => doSellInitials(m),

  async placeOrder({ key, mc, solIn, tpPct, slPct, trailing, note, url }) {
    const [quote] = Object.values(await refreshQuotes([key]));
    if (!(mc > 0) || !(solIn > 0)) throw new Error(tr('Indica el market cap y la cantidad.'));
    const res = await mutate((st) => {
      if (solIn + st.settings.priorityFee > st.account.balance) throw new Error(tr('No tienes saldo para esa orden.'));
      if ((st.account.orders || []).length >= 20) throw new Error(tr('Máximo 20 órdenes pendientes.'));
      const order = {
        id: uid(), key, chain: key.split(':')[0], symbol: quote?.symbol || '?', icon: quote?.icon || null,
        url: url || null, type: 'buyBelowMc', mc, solIn, tpPct: tpPct || 0, slPct: slPct || 0, trailing: !!trailing,
        note: note || '', createdAt: Date.now(), mcAtCreation: quote?.marketCapUsd || null,
      };
      st.account.orders.push(order);
      return order;
    });
    updateBadge();
    return res;
  },

  async cancelOrder({ id }) {
    const r = await mutate((st) => { st.account.orders = (st.account.orders || []).filter((o) => o.id !== id); return true; });
    updateBadge();
    return r;
  },

  async review({ id, tags, followedPlan }) {
    return mutate((st) => {
      const round = st.account.rounds.find((r) => r.id === id);
      if (!round) throw new Error(tr('No encuentro esa operación.'));
      if (Array.isArray(tags)) round.tags = tags.filter((t) => REVIEW_TAGS.some((x) => x.id === t)).slice(0, 6);
      if (followedPlan !== undefined) round.followedPlan = followedPlan === null ? null : !!followedPlan;
      return round;
    });
  },

  async setTargets({ key, tpPct, slPct, trailing }) {
    return mutate((st) => {
      const pos = st.account.positions[key];
      if (!pos) throw new Error(tr('La posición ya no existe.'));
      if (tpPct !== undefined) pos.tp = tpPct > 0 ? { pct: tpPct } : null;
      if (slPct !== undefined) pos.sl = slPct > 0 ? { pct: Math.min(slPct, 99), trailing: trailing ?? !!pos.sl?.trailing } : null;
      if (trailing !== undefined && pos.sl) pos.sl.trailing = !!trailing;
      return pos;
    });
  },

  async setNote({ id, field, value }) {
    return mutate((st) => {
      const allowed = ['entryNote', 'exitNote', 'lesson'];
      if (!allowed.includes(field)) throw new Error(tr('Campo no válido'));
      const pos = Object.values(st.account.positions).find((p) => p.id === id);
      const round = st.account.rounds.find((r) => r.id === id);
      const target = pos || round;
      if (!target) throw new Error(tr('No encuentro esa operación.'));
      target[field] = String(value || '').slice(0, 2000);
      return true;
    });
  },

  async saveSettings({ settings }) {
    return mutate((st) => {
      const clean = {};
      const num = (v, min, max) => { const n = Number(v); return isFinite(n) ? Math.min(Math.max(n, min), max) : undefined; };
      if ('startBalance' in settings) clean.startBalance = num(settings.startBalance, 0.01, 1e6);
      if ('feePct' in settings) clean.feePct = num(settings.feePct, 0, 10);
      if ('priorityFee' in settings) clean.priorityFee = num(settings.priorityFee, 0, 1);
      if ('maxSlippagePct' in settings) clean.maxSlippagePct = num(settings.maxSlippagePct, 0.1, 100);
      if ('latencySlipPct' in settings) clean.latencySlipPct = num(settings.latencySlipPct, 0, 10);
      if ('defaultTpPct' in settings) clean.defaultTpPct = num(settings.defaultTpPct, 1, 10000);
      if ('defaultSlPct' in settings) clean.defaultSlPct = num(settings.defaultSlPct, 1, 99);
      if ('useTp' in settings) clean.useTp = !!settings.useTp;
      if ('useSl' in settings) clean.useSl = !!settings.useSl;
      if ('useTrail' in settings) clean.useTrail = !!settings.useTrail;
      if ('autoPreset' in settings) clean.autoPreset = !!settings.autoPreset;
      if ('poolFees' in settings) clean.poolFees = !!settings.poolFees;
      if ('dailyLossLimit' in settings) clean.dailyLossLimit = num(settings.dailyLossLimit, 0, 1e6);
      if ('sizeMode' in settings) clean.sizeMode = settings.sizeMode === 'pct' ? 'pct' : 'sol';
      if ('lang' in settings) clean.lang = settings.lang === 'en' ? 'en' : 'es';
      if ('pnlUnit' in settings) clean.pnlUnit = settings.pnlUnit === 'usd' ? 'usd' : 'sol';
      if (Array.isArray(settings.quickPcts)) {
        const q = settings.quickPcts.map(Number).filter((n) => n > 0 && n <= 100).slice(0, 4);
        if (q.length) clean.quickPcts = q;
      }
      if (Array.isArray(settings.quickBuys)) {
        const q = settings.quickBuys.map(Number).filter((n) => n > 0 && isFinite(n)).slice(0, 4);
        if (q.length) clean.quickBuys = q;
      }
      Object.keys(clean).forEach((k) => clean[k] === undefined && delete clean[k]);
      st.settings = { ...st.settings, ...clean };
      return st.settings;
    });
  },

  async saveUi({ ui }) {
    return mutate((st) => { st.ui = { ...st.ui, ...ui }; return true; });
  },

  async savePanel({ panel }) {
    return mutate((st) => { st.ui = { ...st.ui, panel: { ...(st.ui?.panel || {}), ...panel } }; return true; });
  },

  async reset({ startBalance }) {
    const keys = await load().then((s) => Object.keys(s.account.positions));
    const [quotes, sol] = await Promise.all([refreshQuotes(keys), solUsd()]);
    return mutate((st) => {
      const old = st.account;
      const endEquity = equityOf(st, quotes, sol);
      if (old.fills.length) {
        st.archive.unshift({
          id: old.id, startedAt: old.startedAt, endedAt: Date.now(),
          startBalance: old.startBalance, endEquity, rounds: old.rounds, equity: old.equity,
          openAtReset: Object.values(old.positions).map((p) => ({ symbol: p.symbol, costSol: p.costSol })),
        });
        st.archive = st.archive.slice(0, 20);
      }
      const sb = Number(startBalance) > 0 ? Number(startBalance) : st.settings.startBalance;
      st.settings.startBalance = sb;
      st.account = freshAccount(sb);
      return st;
    }).finally(updateBadge);
  },

  async deleteArchive({ id }) {
    return mutate((st) => { st.archive = st.archive.filter((a) => a.id !== id); return true; });
  },
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const h = handlers[msg?.type];
  if (!h) return false;
  Promise.resolve(h(msg))
    .then((data) => sendResponse({ ok: true, data }))
    .catch((e) => sendResponse({ ok: false, error: e?.message || String(e) }));
  return true;
});

// Vigilancia en segundo plano (cada 30 s, el mínimo de Chrome).
// Idioma de errores y notificaciones: sigue al ajuste guardado.
chrome.storage.local.get(KEY).then((g) => setLang(g[KEY]?.settings?.lang));
chrome.storage.onChanged.addListener((ch, area) => { if (area === 'local' && ch[KEY]) setLang(ch[KEY].newValue?.settings?.lang); });

chrome.alarms.create('fogueo-watch', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((a) => { if (a.name === 'fogueo-watch') checkTriggers(); });

chrome.runtime.onInstalled.addListener(() => { load().then(updateBadge); });
chrome.runtime.onStartup.addListener(() => { updateBadge(); });

chrome.commands?.onCommand.addListener(async (command) => {
  if (command !== 'toggle-panel') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) chrome.tabs.sendMessage(tab.id, { type: 'toggle' }).catch(() => {});
});
