// Blankfire — service worker: única fuente de verdad de la cuenta ficticia,
// precios (DexScreener + Jupiter para tokens recién creados) y vigilancia de Take Profit / Stop Loss.
import {
  DEFAULT_SETTINGS, simulateBuy, simulateSell, positionPnl, uid, fmtSol, fmtPct, fmtCompact,
  realizedSince, startOfDay, REVIEW_TAGS, LAUNCH_DEXES, stopLevelPct, txCost, failCost,
} from './lib/core.js';
import { tr, setLang } from './lib/i18n.js';
import { analyzeCopies, analyzeChart } from './lib/shield.js';
import {
  BOT_KEY, BOT_DEFAULTS, RECAP_MS, EXIT_TEXT, cleanConfig, freshSession, filterPair, smartsAgent, trendsAgent, debateAgent,
  routerAgent, councilScore, decide, entrySize, exitReason, sessionEquity, lossHit, pushLog, makeRecap, metaWords,
  cleanCopilot, copilotGate, signalsToday, COPILOT_DEFAULTS,
  safetyAgent, indicators, indicatorAgent, guardrails, checklist,
  costSettings, paceTimes, applyPace,
} from './lib/bot.js';
import { themes, snapshotOf, whaleTape, recentBuys, parseSwaps } from './lib/radar.js';
import { newKeypair, keypairFromSecret, signTransaction, transferTx, closeAccountTx, TOKEN_PROGRAMS, b58encode, b58decode, b64encode, b64decode, isAddress } from './lib/solana.js';
import { seal, open as openVault, passwordProblem } from './lib/vault.js';
import { RAW, cmpVer, installedVersion, readUpdate, patchUpdate } from './lib/update.js';
import { PRO_KEY, LS_API, REVALIDATE_MS, isPro, proSelling, licenseMatches, PRO_CONFIG, maskKey, SUPPORT } from './lib/pro.js';
import { buildSeries, tradeFacts, tradeFlags, tradeContext, candleWindow } from './lib/review.js';

const KEY = 'fogueo';
const DS = 'https://api.dexscreener.com';
const JUP = 'https://lite-api.jup.ag';        // sin clave (Jupiter lo va a cerrar, sin fecha)
const JUP_KEYED = 'https://api.jup.ag';        // con clave gratuita de portal.jup.ag (60 peticiones/min)
const GT = 'https://api.geckoterminal.com/api/v2';   // respaldo sin clave (30 peticiones/min, precios algo más lentos)
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

const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// Repara datos de versiones antiguas o dañados en vez de romperse. Devuelve true si cambió algo.
function repair(st) {
  let changed = false;
  const fix = (cond, f) => { if (cond) { f(); changed = true; } };
  fix(!isObj(st.settings), () => { st.settings = {}; });
  const merged = { ...DEFAULT_SETTINGS, ...st.settings };
  fix(!(isNum(merged.startBalance) && merged.startBalance > 0), () => { merged.startBalance = DEFAULT_SETTINGS.startBalance; });
  // Cualquier ajuste numérico dañado (texto, NaN, negativo) vuelve a su valor por defecto.
  for (const [k, d] of Object.entries(DEFAULT_SETTINGS)) {
    if (typeof d === 'number') fix(!(isNum(merged[k]) && merged[k] >= 0), () => { merged[k] = d; });
    else if (typeof d === 'boolean') fix(typeof merged[k] !== 'boolean', () => { merged[k] = d; });
    else if (Array.isArray(d)) fix(!Array.isArray(merged[k]) || !merged[k].length || !merged[k].every((n) => isNum(n) && n > 0), () => { merged[k] = [...d]; });
  }
  st.settings = merged;
  fix(!isObj(st.account), () => { st.account = freshAccount(st.settings.startBalance); });
  const a = st.account;
  fix(!(isNum(a.startBalance) && a.startBalance > 0), () => { a.startBalance = st.settings.startBalance; });
  fix(!isNum(a.balance), () => { a.balance = a.startBalance; });
  fix(!isNum(a.startedAt), () => { a.startedAt = Date.now(); });
  fix(!a.id, () => { a.id = uid(); });
  fix(!isObj(a.positions), () => { a.positions = {}; });
  for (const [k, pos] of Object.entries(a.positions)) {
    fix(!isObj(pos) || !(isNum(pos.qty) && pos.qty > 0) || !isNum(pos.costSol), () => { delete a.positions[k]; });
  }
  for (const f of ['rounds', 'fills', 'orders']) fix(!Array.isArray(a[f]), () => { a[f] = []; });
  fix(!Array.isArray(a.equity) || !a.equity.length, () => { a.equity = [{ t: a.startedAt, v: a.startBalance }]; });
  fix(!Array.isArray(st.archive), () => { st.archive = []; });
  fix(!isObj(st.ui), () => { st.ui = {}; });
  fix(!st.version, () => { st.version = 1; });
  return changed;
}

async function load() {
  const got = await chrome.storage.local.get(KEY);
  let st = got[KEY];
  let save = false;
  if (!isObj(st)) { st = freshState(); save = true; }
  if (repair(st)) save = true;
  if (save) await chrome.storage.local.set({ [KEY]: st });
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

// DexScreener sirve sus respuestas desde una caché de hasta 30 s. Para que el precio sea el de ahora:
// sin caché del navegador y con un parámetro que cambia cada 2 s (las peticiones del mismo instante la comparten).
async function getJson(url) {
  const fresh = `${url}${url.includes('?') ? '&' : '?'}_=${Math.floor(Date.now() / 2000)}`;
  const res = await fetch(fresh, { headers: { accept: 'application/json' }, cache: 'no-store', signal: AbortSignal.timeout(7000) });
  if (!res.ok) throw new Error(tr('DexScreener respondió {s}', { s: res.status }));
  return res.json();
}

// Jupiter: cubre los tokens recién creados (pump.fun, bonding curve) que DexScreener aún no lista.
let jupBackoffUntil = 0;
// ---------- Clave opcional del usuario (Jupiter) ----------
// Fuera del estado principal: el panel de Padre nunca las recibe.
const KEYS_KEY = 'blankfireKeys';
let userKeys = { jupiter: '', helius: '' };
chrome.storage.local.get(KEYS_KEY).then((g) => {
  const k = g[KEYS_KEY] || {};
  userKeys = { jupiter: k.jupiter || '', helius: k.helius || '' };
  if ('gemini' in k) chrome.storage.local.set({ [KEYS_KEY]: { jupiter: k.jupiter || '', helius: k.helius || '' } });   // ya no se usa: se borra
}).catch(() => {});
chrome.storage.onChanged.addListener((ch, area) => { if (area === 'local' && ch[KEYS_KEY]) userKeys = { jupiter: '', helius: '', ...(ch[KEYS_KEY].newValue || {}) }; });

// Avisos de servicio que enseña la ventana (p. ej. «Jupiter ya pide clave»).
const NOTICE_KEY = 'blankfireNotice';
async function setNotice(patch) {
  const cur = (await chrome.storage.local.get(NOTICE_KEY))[NOTICE_KEY] || {};
  const next = { ...cur, ...patch };
  if (JSON.stringify(next) !== JSON.stringify(cur)) await chrome.storage.local.set({ [NOTICE_KEY]: next });
}

// Limpia lo que pega el usuario: comillas, espacios o «x-api-key:» delante.
function cleanJupKey(v) {
  return String(v ?? '').trim().replace(/^x-api-key\s*[:=]\s*/i, '').replace(/^['"`]+|['"`]+$/g, '').replace(/\s+/g, '').slice(0, 200);
}
// Prueba la clave con una petición mínima: 'ok', 'bad' (Jupiter la rechaza) o 'unknown' (sin conexión).
async function testJupKey(key) {
  try {
    const res = await fetch(`${JUP_KEYED}/price/v3?ids=${SOL_MINT}`, { headers: { accept: 'application/json', 'x-api-key': key }, cache: 'no-store', signal: AbortSignal.timeout(8000) });
    if (res.ok) return 'ok';
    if (res.status === 401 || res.status === 403) return 'bad';
    return 'unknown';
  } catch { return 'unknown'; }
}

// Jupiter: con clave va a api.jup.ag; sin clave, a lite-api mientras exista.
async function jupJson(path) {
  if (Date.now() < jupBackoffUntil) throw new Error(tr('Jupiter: esperando por límite de peticiones'));
  const key = (userKeys.jupiter || '').trim();
  const base = key ? JUP_KEYED : JUP;
  const headers = { accept: 'application/json' };
  if (key) headers['x-api-key'] = key;
  const res = await fetch(base + path, { headers, cache: 'no-store', signal: AbortSignal.timeout(7000) });
  if (res.status === 429) { jupBackoffUntil = Date.now() + 6000; throw new Error(tr('Jupiter: demasiadas peticiones')); }
  if (res.status === 401 || res.status === 403 || res.status === 410 || (!key && res.status === 404)) {
    jupBackoffUntil = Date.now() + 60000;   // no insistimos: usamos el respaldo un minuto
    setNotice(key ? { jupiterKeyBad: true } : { jupiterNeedsKey: true });
    throw new Error(tr('Jupiter respondió {s}', { s: res.status }));
  }
  if (!res.ok) throw new Error(tr('Jupiter respondió {s}', { s: res.status }));
  setNotice(key ? { jupiterKeyBad: false } : { jupiterNeedsKey: false });
  return res.json();
}

// GeckoTerminal: respaldo para tokens recién lanzados si Jupiter no responde.
let gtNextAt = 0;
async function gtJson(path) {
  const wait = gtNextAt - Date.now();
  if (wait > 4000) throw new Error('GeckoTerminal ocupado');   // no hacemos esperar más de 4 s a nadie
  gtNextAt = Math.max(Date.now(), gtNextAt) + 2100;   // ≤ 30 por minuto
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  const res = await fetch(GT + path, { headers: { accept: 'application/json' }, cache: 'no-store', signal: AbortSignal.timeout(8000) });
  if (res.status === 429) { gtNextAt = Date.now() + 15000; throw new Error('GeckoTerminal 429'); }
  if (!res.ok) throw new Error(`GeckoTerminal ${res.status}`);
  return res.json();
}

async function gtQuote(mint) {
  const j = await gtJson(`/networks/solana/tokens/${mint}?include=top_pools`);
  const a = j?.data?.attributes;
  const price = Number(a?.price_usd);
  if (!(price > 0)) return null;
  const pools = (j.included || []).filter((x) => x.type === 'pool');
  const top = pools[0];
  const dex = top?.relationships?.dex?.data?.id || null;
  const onCurve = dex === 'pump-fun' || (!dex && /pump$/.test(mint));
  const info = launchInfo.get(mint);
  return {
    stage: onCurve ? 'new' : info?.launchpad ? 'graduated' : (/(pump|bonk)$/.test(mint) ? 'graduated' : null),
    graduatedAt: typeof info?.graduatedAt === 'string' ? info.graduatedAt : null,
    pairCreatedAt: top?.attributes?.pool_created_at ? Date.parse(top.attributes.pool_created_at) : null,
    chain: 'solana', address: mint, pairAddress: onCurve ? null : (top?.attributes?.address || null),
    symbol: a.symbol, name: a.name, icon: a.image_url && a.image_url !== 'missing.png' ? a.image_url : (info?.icon || null),
    dex: dex || 'geckoterminal', source: 'geckoterminal',
    priceUsd: price,
    liquidityUsd: Number(a.total_reserve_in_usd) || info?.liquidityUsd || null,
    marketCapUsd: Number(a.market_cap_usd ?? a.fdv_usd) || null,
    change: { m5: null, h1: null, h24: null },
    at: Date.now(),
  };
}

function jupToQuote(t) {
  // Jupiter no siempre trae graduatedAt; si hay graduatedPool, el token ya salió de la curva.
  const gradAt = t.graduatedAt || (t.graduatedPool ? (Date.parse(t.createdAt) || 1) : null);
  launchInfo.set(t.id, { launchpad: t.launchpad || null, graduatedAt: gradAt, liquidityUsd: Number(t.liquidity) || null, icon: t.icon || null });
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
    const arr = await jupJson(`/tokens/v2/search?query=${slice.join(',')}`);
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
    graduatedAt: typeof info?.graduatedAt === 'string' ? info.graduatedAt : null,
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
      const j = await jupJson(`/price/v3?ids=${SOL_MINT}`);
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
      // Solo apuntamos «sin launchpad» si Jupiter respondió; si falló (límite, red), se vuelve a preguntar.
      try {
        await jupQuotes([tokenAddr]);
        if (!launchInfo.has(tokenAddr)) launchInfo.set(tokenAddr, { launchpad: null, graduatedAt: null, liquidityUsd: null });
      } catch (e) { /* sin metadatos: deducimos por el DEX */ }
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
  // Token recién creado (o DexScreener caído): Jupiter y, si no, GeckoTerminal.
  if (SOL_ADDR.test(address)) {
    let q = null;
    try { q = (await jupQuotes([address]))[address] || null; } catch (e) { /* respaldo abajo */ }
    if (!q) { try { q = await gtQuote(address); } catch (e) { /* nada */ } }
    if (q) { quoteCache.set(`solana:${address}`, { at: Date.now(), quote: q }); return q; }
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
    const viaJup = chain === 'solana' ? addrs.filter((a) => ['jupiter', 'geckoterminal'].includes(quoteCache.get(`solana:${a}`)?.quote.source)) : [];
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
    const want = [...new Set(missing)];
    let got = {};
    try { got = await jupQuotes(want); } catch (e) { /* Jupiter caído o pide clave: probamos GeckoTerminal */ }
    // Respaldo (máx. 3 tokens por vuelta para no pasar de 30 peticiones/min).
    for (const addr of want.filter((a) => !got[a]).slice(0, 3)) {
      try { const q = await gtQuote(addr); if (q) got[addr] = q; } catch (e) { break; }
    }
    Object.entries(got).forEach(([addr, q]) => {
      quoteCache.set(`solana:${addr}`, { at: Date.now(), quote: q });
      out[`solana:${addr}`] = q;
    });
  }
  // Lo que no se pudo refrescar se devuelve con su hora real (el panel avisa si está viejo).
  keys.forEach((k) => { if (!out[k] && quoteCache.get(k)) out[k] = quoteCache.get(k).quote; });
  for (const k of Object.keys(out)) out[k] = withTax(out[k]);
  return out;
}

// ---------- Comisión real del token según Padre («Buy Tax») ----------
// El panel la lee en la página del token y en las tarjetas de Trenches; la recordamos 6 h por token.
const TAX_KEY = 'blankfirePadreTax';
const TAX_TTL = 6 * 3600e3;
let padreTax = null;   // key → { pct, at }
async function taxMap() {
  if (!padreTax) {
    padreTax = new Map();
    try { Object.entries((await chrome.storage.local.get(TAX_KEY))[TAX_KEY] || {}).forEach(([k, v]) => { if (Date.now() - (v?.at || 0) < TAX_TTL) padreTax.set(k, v); }); } catch { /* vacío */ }
  }
  return padreTax;
}
taxMap();
function withTax(q) {
  if (!q || !padreTax) return q;
  const t = padreTax.get(`${q.chain}:${q.address}`);
  if (!t || Date.now() - t.at > TAX_TTL) return q.padreTaxPct != null ? { ...q, padreTaxPct: null } : q;
  return q.padreTaxPct === t.pct ? q : { ...q, padreTaxPct: t.pct };
}
let taxSaveTimer = null;
async function setPadreTax(list) {
  const m = await taxMap();
  let changed = false;
  for (const { key, pct } of list) {
    const n = Number(pct);
    if (!/^solana:[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(key)) || !Number.isFinite(n) || n < 0 || n > 30) continue;
    const prev = m.get(key);
    if (!prev || prev.pct !== n || Date.now() - prev.at > 600e3) { m.delete(key); m.set(key, { pct: Math.round(n * 1000) / 1000, at: Date.now() }); changed = true; }
  }
  while (m.size > 400) m.delete(m.keys().next().value);
  if (changed && !taxSaveTimer) {
    taxSaveTimer = setTimeout(() => { taxSaveTimer = null; chrome.storage.local.set({ [TAX_KEY]: Object.fromEntries(m) }).catch(() => {}); }, 5000);
  }
  return changed;
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

// Instantánea del chequeo de seguridad que manda el panel al comprar (solo números y textos cortos).
function cleanScreen(sc) {
  if (!sc || typeof sc !== 'object' || !['good', 'care', 'avoid', 'unknown'].includes(sc.verdict)) return null;
  const facts = {};
  for (const k of ['top10', 'dev', 'snipers', 'snipersN', 'insiders', 'bundles', 'liqUsd', 'mcUsd']) {
    const n = Number(sc.facts?.[k]);
    if (sc.facts?.[k] != null && Number.isFinite(n)) facts[k] = Math.round(n * 100) / 100;
  }
  for (const k of ['curve', 'devSold', 'mintAuth', 'freezeAuth']) if (typeof sc.facts?.[k] === 'boolean') facts[k] = sc.facts[k];
  const risks = (Array.isArray(sc.risks) ? sc.risks : []).slice(0, 6).map((r) => String(r).slice(0, 48));
  return { verdict: sc.verdict, risks, facts };
}

async function doBuy({ key, solIn, tpPct, slPct, trailing, note, url, screen, via = 'manual' }) {
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
      const lost = failCost(st.settings);
      st.account.balance -= lost;
      st.account.fills.push({ id: uid(), t: Date.now(), key, symbol: quote.symbol, side: 'buy', failed: true, reason: sim.error, priorityFee: lost });
      return { ok: false, error: sim.error, chargedFee: lost };
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
    if (prevQty === 0) {
      pos.slAtEntry = !!pos.sl; pos.tpAtEntry = !!pos.tp;
      // Cuánto venía subiendo justo antes de entrar (para detectar el FOMO sin pedir velas a nadie).
      pos.preChange = { m5: Number.isFinite(quote.change?.m5) ? quote.change.m5 : null, h1: Number.isFinite(quote.change?.h1) ? quote.change.h1 : null };
      // Cómo estaba la moneda al entrar según el chequeo (dev, bundles, liquidez…), para la revisión.
      const sc = cleanScreen(screen);
      if (sc) pos.screen = sc;
    }
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
    if (st.account.balance < txCost(st.settings)) throw new Error(tr('No te queda SOL para pagar la prioridad y el tip de la venta ({fee} SOL).', { fee: fmtSol(txCost(st.settings)) }));
    const frac = Math.min(Math.max(pct, 0), 100) / 100;
    const qty = frac >= 0.9999 ? pos.qty : pos.qty * frac;
    const sim = simulateSell({ qty, quote, solUsd: sol, settings: st.settings });
    if (!sim.ok) {
      const lost = failCost(st.settings);
      st.account.balance -= lost;
      st.account.fills.push({ id: uid(), t: Date.now(), key, symbol: pos.symbol, side: 'sell', failed: true, reason: sim.error, priorityFee: lost });
      return { ok: false, error: sim.error, chargedFee: lost };
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
        pairAddress: pos.pairAddress || quote.pairAddress || null, exitPriceUsd: sim.fillPrice, exitMidUsd: quote.priceUsd,
        slAtEntry: pos.slAtEntry, tpAtEntry: pos.tpAtEntry, preChange: pos.preChange || null, screen: pos.screen || null, sl: pos.sl || null, tp: pos.tp || null, peakPct: pos.peakPct ?? null,
      };
      st.account.rounds.unshift(round);
      watchAfter(round);
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
const autoFails = new Map();   // key → { n, next } de ventas automáticas fallidas

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
      // Si la venta automática falló (slippage), no reintentamos en cada vuelta: cada intento podría
      // costar la priority fee y llenar de avisos. Esperamos un poco más cada vez (15 s, 30 s, 60 s…).
      const fail = autoFails.get(k);
      if (fail && Date.now() < fail.next) continue;
      try {
        const res = await doSell({ key: k, pct: 100, reason });
        const title = tr({ tp: 'Take profit en ${sym}', sl: 'Stop loss en ${sym}', trail: 'Trailing stop en ${sym}' }[reason], { sym: pos.symbol });
        if (res.ok) {
          autoFails.delete(k);
          notify(title, tr('Vendido todo. Resultado: {a} SOL ({b}).', { a: fmtSol(res.round?.pnlSol, { sign: true }), b: fmtPct(res.round?.pnlPct, 1, { sign: true }) }));
          broadcast({ type: 'triggered', key: k, reason, round: res.round });
        } else {
          const n = (fail?.n || 0) + 1;
          autoFails.set(k, { n, next: Date.now() + Math.min(15000 * 2 ** (n - 1), 120000) });
          if (n === 1) notify(tr('No se pudo cerrar ${sym}', { sym: pos.symbol }), tr('{e} Lo reintento solo; si quieres salir ya, sube el slippage de venta o vende una parte.', { e: res.error }));
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


// ---------- Escudo anti-rug: copias del nombre y dibujo del gráfico ----------
const shieldCache = new Map();   // mint → { at, data }
const SHIELD_TTL = 90_000;
async function shieldFor({ mint, name, symbol, createdAt, mcUsd }) {
  const hit = shieldCache.get(mint);
  if (hit && Date.now() - hit.at < SHIELD_TTL) return hit.data;
  const self = { address: mint, name, symbol, createdAt, mcUsd };
  const copiesP = (async () => {
    const qs = [...new Set([symbol, name].filter((x) => x && String(x).length >= 2).map((x) => String(x).slice(0, 40)))];
    const lists = await Promise.all(qs.map((q) => getJson(`${DS}/latest/dex/search?q=${encodeURIComponent(q)}`).then((j) => j.pairs || []).catch(() => [])));
    return analyzeCopies(self, lists.flat());
  })();
  const chartP = (async () => {
    // Las velas de GeckoTerminal solo en la beta gratis (su API sin clave no incluye uso comercial).
    if (proSelling()) return null;
    const pools = await fetch(`${GT}/networks/solana/tokens/${mint}/pools?page=1`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(7000) }).then((r) => (r.ok ? r.json() : null));
    const pool = pools?.data?.[0]?.attributes?.address;
    if (!pool) return null;
    const o = await fetch(`${GT}/networks/solana/pools/${pool}/ohlcv/minute?aggregate=1&limit=90&currency=usd`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(7000) }).then((r) => (r.ok ? r.json() : null));
    const rows = o?.data?.attributes?.ohlcv_list || [];
    return { ...analyzeChart(rows), ind: indicators(rows) };
  })();
  const [copies, chart] = await Promise.all([copiesP.catch(() => null), chartP.catch(() => null)]);
  const data = { copies, chart, at: Date.now() };
  shieldCache.set(mint, { at: Date.now(), data });
  if (shieldCache.size > 200) shieldCache.delete(shieldCache.keys().next().value);
  return data;
}

// Informe de seguridad de RugCheck (gratis, 15 peticiones por minuto): caché de 10 min y freno propio.
const RC = 'https://api.rugcheck.xyz/v1';
const rcCache = new Map(); const rcHits = [];
async function rugcheckFor(mint) {
  const hit = rcCache.get(mint);
  if (hit && Date.now() - hit.at < 10 * 60e3) return hit.data;
  const now = Date.now();
  while (rcHits.length && now - rcHits[0] > 60e3) rcHits.shift();
  if (rcHits.length >= 12) return null;   // sin cupo este minuto: se vuelve a mirar en la siguiente búsqueda
  rcHits.push(now);
  const r = await fetch(`${RC}/tokens/${encodeURIComponent(mint)}/report/summary`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(8000) }).catch(() => null);
  if (!r?.ok) return null;
  const j = await r.json().catch(() => null);
  if (!j || !Array.isArray(j.risks)) return null;
  const data = { risks: j.risks.slice(0, 30).map((x) => ({ name: String(x?.name || '').slice(0, 80), value: String(x?.value || '').slice(0, 20), level: String(x?.level || '').slice(0, 10) })), score_normalised: Number(j.score_normalised), lpLockedPct: Number(j.lpLockedPct) };
  rcCache.set(mint, { at: Date.now(), data });
  if (rcCache.size > 300) rcCache.delete(rcCache.keys().next().value);
  return data;
}

const handlers = {
  async state() { return load(); },

  async shield({ mint, name, symbol, createdAt, mcUsd }) {
    if (!mint || typeof mint !== 'string' || mint.length > 64) return null;
    return shieldFor({ mint, name: String(name || '').slice(0, 60), symbol: String(symbol || '').slice(0, 20), createdAt: Number(createdAt) || null, mcUsd: Number(mcUsd) || 0 });
  },

  async resolve({ address }) {
    const [quote, sol] = await Promise.all([resolveAddress(address), solUsd()]);
    await taxMap();
    return { quote: withTax(quote), solUsd: sol };
  },

  // El botón «Optimizar Padre» del popup: pide al panel de la pestaña de Padre que abra la confirmación.
  async padreOptimizeOpen() {
    const tabs = await chrome.tabs.query({ url: 'https://trade.padre.gg/*' });
    if (!tabs.length) return { opened: false };
    const tab = tabs.find((t) => t.active) || tabs.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0];
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'padreOptimizeOpen' });
      await chrome.tabs.update(tab.id, { active: true });
      if (tab.windowId != null) await chrome.windows.update(tab.windowId, { focused: true });
      return { opened: true };
    } catch { return { opened: false, reload: true }; }
  },

  async padreTax({ items }) {
    return { changed: await setPadreTax(Array.isArray(items) ? items.slice(0, 60) : []) };
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
      if (solIn + txCost(st.settings) > st.account.balance) throw new Error(tr('No tienes saldo para esa orden.'));
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
      if ('sellSlippagePct' in settings) clean.sellSlippagePct = num(settings.sellSlippagePct, 0.1, 100);
      if ('tipSol' in settings) clean.tipSol = num(settings.tipSol, 0, 1);
      if ('mevSecure' in settings) clean.mevSecure = !!settings.mevSecure;
      if ('latencySlipPct' in settings) clean.latencySlipPct = num(settings.latencySlipPct, 0, 10);
      if ('defaultTpPct' in settings) clean.defaultTpPct = num(settings.defaultTpPct, 1, 10000);
      if ('defaultSlPct' in settings) clean.defaultSlPct = num(settings.defaultSlPct, 1, 99);
      if ('useTp' in settings) clean.useTp = !!settings.useTp;
      if ('useSl' in settings) clean.useSl = !!settings.useSl;
      if ('useTrail' in settings) clean.useTrail = !!settings.useTrail;
      if ('autoPreset' in settings) clean.autoPreset = !!settings.autoPreset;
      if ('poolFees' in settings) clean.poolFees = !!settings.poolFees;
      if ('screenBadges' in settings) clean.screenBadges = !!settings.screenBadges;
      if ('strictShield' in settings) clean.strictShield = !!settings.strictShield;
      if ('screenRigor' in settings) clean.screenRigor = ['strict', 'normal', 'loose'].includes(settings.screenRigor) ? settings.screenRigor : 'normal';
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

  async checkUpdate({ force = true } = {}) { return checkUpdate(!!force); },

  // ---------- Pro ----------
  async proStatus() { return proInfo(); },
  async proActivate({ key }) { return proActivate(key); },
  async proDeactivate() { return proDeactivate(); },
  async proRecheck() { return proValidate(true); },
  async saveKeys({ jupiter, helius }) {
    const cur = { jupiter: '', helius: '', ...((await chrome.storage.local.get(KEYS_KEY))[KEYS_KEY] || {}) };
    if (helius !== undefined) {
      const hk = String(helius || '').trim();
      if (hk && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(hk)) throw new Error(tr('Esa clave de Helius no tiene el formato de las suyas (8-4-4-4-12 letras y números).'));
      cur.helius = hk;
    }
    delete cur.gemini;   // desde 1.13.1 la IA va por el servidor de Blankfire: ya no se guarda clave de Gemini
    let check = null;
    if (jupiter !== undefined) {
      const key = cleanJupKey(jupiter);
      if (key) {
        check = await testJupKey(key);
        if (check === 'bad') return { jupiter: !!cur.jupiter, check, checkedAt: cur.checkedAt || null };
      }
      cur.jupiter = key;
      cur.checkedAt = key && check === 'ok' ? Date.now() : null;
    }
    await chrome.storage.local.set({ [KEYS_KEY]: cur });
    userKeys = cur;
    if (jupiter !== undefined) { jupBackoffUntil = 0; await setNotice({ jupiterKeyBad: false }); }
    return { jupiter: !!cur.jupiter, helius: !!cur.helius, check, checkedAt: cur.checkedAt || null };
  },
  async keysStatus() {
    const k = (await chrome.storage.local.get(KEYS_KEY))[KEYS_KEY] || {};
    const notice = (await chrome.storage.local.get(NOTICE_KEY))[NOTICE_KEY] || {};
    return { jupiter: !!k.jupiter, helius: !!k.helius, checkedAt: k.checkedAt || null, notice, ai: await aiOn() };
  },
  async afterData({ id }) { return afterData(id); },
  async replayData(msg) { return replayData(msg); },
  async replayList() { const st = await load(); return { rounds: st.account.rounds.slice(-40).reverse().map((r) => ({ id: r.id, symbol: r.symbol, openedAt: r.openedAt, closedAt: r.closedAt, pnlSol: r.pnlSol, entryMcUsd: r.entryMcUsd })), beta: !proSelling() }; },
  async supportStatus({ force } = {}) { return supportStatus(force); },
  async aiReview({ id }) { return aiReview(id); },

  // Recarga la extensión desde la carpeta (coge los archivos nuevos tras actualizar.bat). Tus datos no se tocan.
  async reloadExt() {
    // Al volver, recargamos las pestañas de Padre para que el panel nuevo entre solo.
    await chrome.storage.local.set({ blankfireReloadTabs: Date.now() });
    setTimeout(() => chrome.runtime.reload(), 150);
    return true;
  },

  async deleteArchive({ id }) {
    return mutate((st) => { st.archive = st.archive.filter((a) => a.id !== id); return true; });
  },
};

// Órdenes delicadas (wallet real, claves, bot): solo desde las ventanas de la propia extensión,
// nunca desde el script que vive dentro de la página de Padre.
const PRIVILEGED = /^(real|bot|wallet|saveKeys)/;
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const h = handlers[msg?.type];
  if (!h) return false;
  const fromExtPage = sender?.id === chrome.runtime.id && String(sender?.url || '').startsWith(chrome.runtime.getURL(''));
  if (PRIVILEGED.test(msg.type) && !fromExtPage && msg.type !== 'botState') {
    sendResponse({ ok: false, error: tr('Esta orden solo se puede dar desde las ventanas de Blankfire.') });
    return false;
  }
  Promise.resolve(h(msg))
    .then((data) => sendResponse({ ok: true, data }))
    .catch((e) => sendResponse({ ok: false, error: e?.message || String(e) }));
  return true;
});

// Vigilancia en segundo plano (cada 30 s, el mínimo de Chrome).
// Idioma de errores y notificaciones: sigue al ajuste guardado.
chrome.storage.local.get(KEY).then((g) => setLang(g[KEY]?.settings?.lang));
chrome.storage.onChanged.addListener((ch, area) => { if (area === 'local' && ch[KEY]) setLang(ch[KEY].newValue?.settings?.lang); });

// Solo se crea si no existe: recrearla en cada arranque del motor reiniciaría la cuenta atrás.
function ensureAlarm(name, periodInMinutes) {
  chrome.alarms.get(name, (a) => { if (!a || a.periodInMinutes !== periodInMinutes) chrome.alarms.create(name, { periodInMinutes }); });
}
ensureAlarm('fogueo-watch', 0.5);
chrome.alarms.onAlarm.addListener((a) => { if (a.name === 'fogueo-watch') { checkTriggers(); sampleAfter(); } });

// =====================================================================
// Pro · «Qué pasó después» — seguimos el precio 60 min tras cerrar cada trade.
// =====================================================================
const AFTER_KEY = 'blankfireAfter';
const AFTER_MIN = 60;
async function afterStore() { return (await chrome.storage.local.get(AFTER_KEY))[AFTER_KEY] || {}; }
async function watchAfter(round) {
  try {
    const all = await afterStore();
    const held = (all['open:' + round.id]?.samples || []).filter((x) => x[0] >= round.openedAt && x[0] < round.closedAt).slice(-120);
    delete all['open:' + round.id];
    all[round.id] = { key: round.key, closedAt: round.closedAt, samples: [...held, [round.closedAt, round.exitMidUsd || round.exitPriceUsd]] };
    // Limpieza: fuera lo de hace más de 7 días.
    for (const [id, w] of Object.entries(all)) if (Date.now() - (w.closedAt || w.openedAt || 0) > 7 * 24 * 3600e3) delete all[id];
    await chrome.storage.local.set({ [AFTER_KEY]: all });
  } catch (e) { /* sin seguimiento: la gráfica tendrá menos puntos */ }
}
let sampling = false;
async function sampleAfter() {
  if (sampling) return;
  sampling = true;
  try {
    const all = await afterStore();
    // También vamos guardando el precio mientras la posición está abierta (para la gráfica «durante»).
    const st = await load();
    const openIds = new Set();
    for (const pos of Object.values(st.account.positions || {})) {
      const k = 'open:' + pos.id; openIds.add(k);
      if (!all[k]) all[k] = { key: pos.key, openedAt: pos.openedAt, open: true, samples: [] };
    }
    for (const k of Object.keys(all)) if (k.startsWith('open:') && !openIds.has(k)) delete all[k];
    const live = Object.entries(all).filter(([, w]) => w.open || Date.now() - w.closedAt <= AFTER_MIN * 60e3 + 30e3);
    if (!live.length) return;
    const keys = [...new Set(live.map(([, w]) => w.key))];
    const quotes = await refreshQuotes(keys);
    let changed = false;
    for (const [, w] of live) {
      const q = quotes[w.key];
      const last = w.samples[w.samples.length - 1];
      if (q?.priceUsd > 0 && q.at && (!last || q.at - last[0] >= 25e3)) { w.samples.push([q.at, q.priceUsd]); changed = true; }
      if (w.samples.length > (w.open ? 120 : 200)) w.samples.splice(w.open ? 0 : 1, w.samples.length - (w.open ? 120 : 200));
    }
    if (changed) await chrome.storage.local.set({ [AFTER_KEY]: all });
  } catch (e) { /* lo intentamos en la siguiente vuelta */ } finally { sampling = false; }
}

// Pool en GeckoTerminal para un token (si no lo sabemos ya por DexScreener).
async function gtPoolFor(round) {
  if (round.pairAddress) return round.pairAddress;
  const j = await gtJson(`/networks/solana/tokens/${round.address}/pools?page=1`);
  return j?.data?.[0]?.attributes?.address || null;
}

async function afterData(id) {
  if (!(await proUnlocked())) throw new Error(tr('Esto es del plan Pro.'));
  const st = await load();
  const round = st.account.rounds.find((r) => r.id === id);
  if (!round) throw new Error(tr('No encuentro esa operación.'));
  const samples = (await afterStore())[id]?.samples || [];
  let candles = [], source = samples.length > 1 ? 'blankfire' : null, gtError = null;
  // Las velas de GeckoTerminal solo en la beta gratis: su API sin clave no incluye licencia comercial.
  // Con el Pro de pago, la gráfica sale del seguimiento propio de Blankfire (precios de DexScreener).
  if (!proSelling() && (round.chain === 'solana' || round.key?.startsWith('solana:'))) {
    try {
      const pool = await gtPoolFor(round);
      if (pool) {
        const w = candleWindow(round);
        const j = await gtJson(`/networks/solana/pools/${pool}/ohlcv/${w.timeframe}?aggregate=${w.aggregate}&before_timestamp=${Math.ceil(w.to / 1000)}&limit=${w.limit}&currency=usd&token=base`);
        candles = (j?.data?.attributes?.ohlcv_list || []).filter((c) => c[0] * 1000 >= w.from);
        if (candles.length) source = source ? 'both' : 'geckoterminal';
      }
    } catch (e) { gtError = e.message; }
  }
  const series = buildSeries(candles, samples);
  const facts = tradeFacts(round, series);
  const ctx = tradeContext(round, st.account);
  const flags = tradeFlags(round, facts, ctx);
  return { series: series.map((x) => [x.t, x.p]), facts, flags, ctx, source, gtError };
}

// =====================================================================
// Repetición: velas de una operación tuya (o de cualquier moneda) para jugarla sin ver el futuro.
// =====================================================================
function samplesToCandles(samples) {
  return samples.filter((x) => x?.[0] > 0 && x?.[1] > 0).map(([t, p]) => [Math.floor(t / 1000), p, p, p, p, 0]);
}
async function replayData({ id, mint } = {}) {
  const st = await load();
  const out = { candles: [], source: null, round: null, symbol: null, address: null };
  if (id) {
    const r = st.account.rounds.find((x) => x.id === id);
    if (!r) throw new Error(tr('No encuentro esa operación.'));
    out.symbol = r.symbol; out.address = r.address;
    out.round = {
      id: r.id, symbol: r.symbol, openedAt: r.openedAt, closedAt: r.closedAt, pnlSol: r.pnlSol, investedSol: r.investedSol,
      entryMcUsd: r.entryMcUsd, exitMcUsd: r.exitMcUsd,
      fills: (r.fills || []).map((f) => ({ t: f.t, side: f.side, price: f.price, sol: f.sol })),
    };
    if (!proSelling() && r.address && (r.chain === 'solana' || r.key?.startsWith('solana:'))) {
      try {
        const pool = await gtPoolFor(r);
        if (pool) {
          const from = r.openedAt - 30 * 60e3, to = Math.min(r.closedAt + 60 * 60e3, Date.now());
          const span = (to - from) / 60e3, agg = span <= 950 ? 1 : 5;
          const j = await gtJson(`/networks/solana/pools/${pool}/ohlcv/minute?aggregate=${agg}&before_timestamp=${Math.ceil(to / 1000)}&limit=${Math.min(1000, Math.ceil(span / agg) + 2)}&currency=usd&token=base`);
          out.candles = (j?.data?.attributes?.ohlcv_list || []).filter((c) => c[0] * 1000 >= from);
          out.source = 'geckoterminal'; out.aggregate = agg;
        }
      } catch (e) { out.gtError = e.message; }
    }
    if (!out.candles.length) {
      const samples = (await afterStore())[id]?.samples || [];
      out.candles = samplesToCandles(samples);
      out.source = out.candles.length ? 'blankfire' : null;
    }
  } else if (mint) {
    const m = String(mint).trim();
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(m)) throw new Error(tr('Esa dirección no parece de Solana.'));
    if (proSelling()) throw new Error(tr('La repetición de cualquier moneda solo está en la beta gratis.'));
    const pools = await gtJson(`/networks/solana/tokens/${m}/pools?page=1`);
    const top = pools?.data?.[0]?.attributes;
    if (!top?.address) throw new Error(tr('No encuentro velas de esa moneda.'));
    const j = await gtJson(`/networks/solana/pools/${top.address}/ohlcv/minute?aggregate=1&limit=360&currency=usd&token=base`);
    out.candles = j?.data?.attributes?.ohlcv_list || [];
    out.source = 'geckoterminal'; out.aggregate = 1; out.address = m;
    out.symbol = String(top.name || '').split(' / ')[0] || m.slice(0, 4);
  }
  out.candles = out.candles.map((c) => c.slice(0, 6).map(Number)).filter((c) => c[0] > 0 && c[4] > 0).sort((a, b) => a[0] - b[0]);
  out.settings = { feePct: st.settings.feePct, priorityFee: st.settings.priorityFee, tipSol: st.settings.tipSol, poolFees: st.settings.poolFees, defaultSlPct: st.settings.defaultSlPct, defaultTpPct: st.settings.defaultTpPct, quickBuys: st.settings.quickBuys };
  out.rounds = st.account.rounds.slice(-40).reverse().map((r) => ({ id: r.id, symbol: r.symbol, openedAt: r.openedAt, closedAt: r.closedAt, pnlSol: r.pnlSol, entryMcUsd: r.entryMcUsd }));
  return out;
}

// =====================================================================
// Pro · licencia (Lemon Squeezy)
// =====================================================================
async function proInfo() {
  const info = (await chrome.storage.local.get(PRO_KEY))[PRO_KEY] || {};
  return { ...info, key: undefined, keyHint: info.key ? maskKey(info.key) : '', hasKey: !!info.key, selling: proSelling(), checkoutUrl: PRO_CONFIG.checkoutUrl, unlocked: isPro(info) };
}
async function proUnlocked() { return isPro((await chrome.storage.local.get(PRO_KEY))[PRO_KEY]); }
async function lsPost(path, params) {
  const res = await fetch(`${LS_API}/${path}`, {
    method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params), signal: AbortSignal.timeout(10000),
  });
  let j = null; try { j = await res.json(); } catch { /* sin cuerpo */ }
  return { status: res.status, j: j || {} };
}
async function proActivate(rawKey) {
  const key = String(rawKey || '').trim();
  if (!/^[A-Za-z0-9-]{16,64}$/.test(key)) throw new Error(tr('Esa clave no tiene el formato de una licencia.'));
  if (!proSelling()) throw new Error(tr('El Pro aún está en beta gratis: no hace falta licencia.'));
  let r;
  try { r = await lsPost('activate', { license_key: key, instance_name: `Blankfire · ${navigator.userAgent.includes('OPR') ? 'Opera' : 'Chrome'}` }); }
  catch (e) { throw new Error(tr('No se pudo conectar con la tienda. Revisa tu conexión e inténtalo otra vez.')); }
  const lk = r.j.license_key || {};
  if (!r.j.activated) {
    const msg = String(r.j.error || '');
    if (/limit/i.test(msg)) throw new Error(tr('Esta licencia ya está activada en el máximo de navegadores. Desactívala en otro o escríbeme.'));
    if (/not found|invalid/i.test(msg) || r.status === 404) throw new Error(tr('No encuentro esa licencia. Cópiala tal cual del email de compra.'));
    throw new Error(tr('La tienda no aceptó la licencia: {e}', { e: msg || r.status }));
  }
  if (!licenseMatches(r.j.meta)) throw new Error(tr('Esa licencia es de otro producto.'));
  const info = { key, instanceId: r.j.instance?.id || null, status: lk.status === 'expired' || lk.status === 'disabled' ? lk.status : 'active', validatedAt: Date.now(), expiresAt: lk.expires_at || null, email: r.j.meta?.customer_email || null, name: r.j.meta?.customer_name || null, variant: r.j.meta?.variant_name || null };
  await chrome.storage.local.set({ [PRO_KEY]: info });
  return proInfo();
}
async function proValidate(force = false) {
  const info = (await chrome.storage.local.get(PRO_KEY))[PRO_KEY];
  if (!info?.key || !proSelling()) return proInfo();
  if (!force && Date.now() - (info.validatedAt || 0) < REVALIDATE_MS) return proInfo();
  try {
    const r = await lsPost('validate', { license_key: info.key, ...(info.instanceId ? { instance_id: info.instanceId } : {}) });
    const lk = r.j.license_key || {};
    if (r.j.valid && licenseMatches(r.j.meta)) info.status = lk.status === 'expired' ? 'expired' : 'active';
    else if (r.status >= 400 && r.status < 500 || r.j.valid === false) info.status = lk.status === 'expired' ? 'expired' : lk.status === 'disabled' ? 'disabled' : 'invalid';
    if (info.status === 'active') info.validatedAt = Date.now();
    info.expiresAt = lk.expires_at ?? info.expiresAt ?? null;
    await chrome.storage.local.set({ [PRO_KEY]: info });
  } catch (e) { /* sin conexión: vale hasta 14 días desde la última comprobación */ }
  return proInfo();
}
async function proDeactivate() {
  const info = (await chrome.storage.local.get(PRO_KEY))[PRO_KEY];
  if (info?.key && info.instanceId) { try { await lsPost('deactivate', { license_key: info.key, instance_id: info.instanceId }); } catch { /* la borramos igual */ } }
  await chrome.storage.local.remove(PRO_KEY);
  return proInfo();
}

// =====================================================================
// Pro · análisis del trade con IA
// =====================================================================
// Análisis con IA: va por el servidor de Blankfire (lib/pro.js → PRO_CONFIG.aiUrl), que usa una clave
// de Gemini de pago y comprueba la licencia. Las condiciones de Gemini no permiten el nivel gratis
// para usuarios del EEE, Suiza o Reino Unido, ni que cada consumidor use su propia clave.
const INSTALL_KEY = 'blankfireInstall';
async function installId() {
  const g = (await chrome.storage.local.get(INSTALL_KEY))[INSTALL_KEY];
  if (g && /^[A-Za-z0-9-]{16,64}$/.test(g)) return g;
  const id = crypto.randomUUID();
  await chrome.storage.local.set({ [INSTALL_KEY]: id });
  return id;
}
const AI_ERRORS = {
  not_configured: 'El análisis con IA aún no está activado en el servidor de Blankfire.',
  no_license: 'Activa tu licencia Pro para usar el análisis con IA.',
  license_inactive: 'Tu licencia no está activa. Revísala en Ajustes → Blankfire Pro.',
  license_other: 'Esa licencia es de otro producto.',
  store_down: 'No se pudo comprobar tu licencia ahora mismo. Prueba en un minuto.',
  user_cap: 'Has usado los {n} análisis de hoy. Mañana tienes más.',
  global_cap: 'Hoy se ha llegado al tope de análisis de Blankfire. Prueba mañana.',
  ai_busy: 'La IA está saturada ahora mismo. Prueba en un minuto.',
  db_down: 'El servidor de Blankfire no responde. Prueba en un minuto.',
  ai_no_credit: 'El análisis con IA está en pausa ahora mismo. Vuelve a probar más tarde.',
};
// ¿Está encendida la IA? Hace falta servidor y el interruptor remoto de updates.json.
async function aiOn() {
  if (!PRO_CONFIG.aiUrl) return false;
  return (await readUpdate()).features?.ai === true;
}
// Progreso de las donaciones de Ko-fi para la meta «activar la IA» (se guarda 10 min).
const SUPPORT_KEY = 'blankfireSupport';
async function supportStatus(force = false) {
  if (!SUPPORT.kofiUrl || !SUPPORT.statusUrl) return null;
  const cached = (await chrome.storage.local.get(SUPPORT_KEY))[SUPPORT_KEY];
  if (!force && cached && Date.now() - cached.at < 10 * 60e3) return cached;
  try {
    const r = await fetch(SUPPORT.statusUrl, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
    const j = await r.json();
    if (!j?.ok) throw new Error('bad');
    const out = { at: Date.now(), raised: Math.max(0, Number(j.raised) || 0), goal: Math.max(1, Number(j.goal) || SUPPORT.goal), supporters: Math.max(0, Number(j.supporters) || 0), url: SUPPORT.kofiUrl };
    await chrome.storage.local.set({ [SUPPORT_KEY]: out });
    return out;
  } catch {
    return cached || { at: 0, raised: null, goal: SUPPORT.goal, supporters: 0, url: SUPPORT.kofiUrl };
  }
}
async function aiServer(payload, lang) {
  if (!(await aiOn())) throw new Error(tr(AI_ERRORS.not_configured));
  const lic = (await chrome.storage.local.get(PRO_KEY))[PRO_KEY] || {};
  let res, j = null;
  try {
    res = await fetch(PRO_CONFIG.aiUrl, {
      method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(60000),
      body: JSON.stringify({ license: lic.key || null, instance: lic.instanceId || null, install: await installId(), lang, payload }),
    });
    j = await res.json();
  } catch { throw new Error(tr('No se pudo conectar con el servidor de Blankfire. Revisa tu conexión.')); }
  if (res.ok && j?.ok) return j;
  const code = j?.code || '';
  throw new Error(AI_ERRORS[code] ? tr(AI_ERRORS[code], { n: j?.cap ?? '' }) : tr('El análisis con IA falló ({e}). Prueba otra vez.', { e: code || res.status }));
}

function aiPayload(round, data, account) {
  const r2 = (n, d = 2) => (n == null || !isFinite(n) ? null : Math.round(n * 10 ** d) / 10 ** d);
  const recent = (account.rounds || []).filter((r) => r.closedAt <= round.closedAt && r.id !== round.id).slice(0, 5).map((r) => r2(r.pnlPct, 1));
  return {
    token: { symbol: round.symbol, stage: round.entryMcUsd < 70000 ? 'probable bonding curve / recién lanzado' : 'con pool propio', ...(round.screen ? { safetyAtEntry: { verdict: round.screen.verdict, risks: round.screen.risks, ...round.screen.facts } } : {}) },
    trade: {
      openedAt: new Date(round.openedAt).toISOString(), holdMin: data.facts.holdMin,
      investedSol: r2(round.investedSol, 4), returnedSol: r2(round.returnedSol, 4), pnlSol: r2(round.pnlSol, 4), pnlPct: r2(round.pnlPct, 1),
      feesSol: r2(round.feesSol, 4), entryMcUsd: r2(round.entryMcUsd, 0), exitMcUsd: r2(round.exitMcUsd, 0),
      exitReason: round.reason, stopAtEntry: round.slAtEntry ?? null, takeAtEntry: round.tpAtEntry ?? null,
      stop: round.sl ? { pct: round.sl.pct, trailing: !!round.sl.trailing } : null, take: round.tp ? { pct: round.tp.pct } : null,
      buys: (round.fills || []).filter((f) => f.side === 'buy').length, sells: (round.fills || []).filter((f) => f.side === 'sell').length,
      sizePctOfEquity: r2(data.ctx.sizePct, 1), minutesSincePreviousLoss: data.ctx.revengeMin,
    },
    facts: Object.fromEntries(Object.entries(data.facts).filter(([k]) => !['entryPrice', 'exitPrice', 'points'].includes(k)).map(([k, v]) => [k, r2(v, 1)])),
    flags: data.flags.errors.map((f) => f.id), positives: data.flags.wins.map((f) => f.id),
    trader: { followedPlan: round.followedPlan ?? null, tags: round.tags || [], entryNote: (round.entryNote || '').slice(0, 300), exitNote: (round.exitNote || '').slice(0, 300), recentTradesPnlPct: recent },
  };
}

async function aiReview(id) {
  if (!(await proUnlocked())) throw new Error(tr('Esto es del plan Pro.'));
  const data = await afterData(id);
  const st = await load();
  const round = st.account.rounds.find((r) => r.id === id);
  if (!round) throw new Error(tr('No encuentro esa operación.'));
  const lang = st.settings.lang === 'en' ? 'en' : 'es';
  const res = await aiServer(aiPayload(round, data, st.account), lang);
  const cut = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
  const out = res.ai || {};
  const ai = {
    at: Date.now(), model: cut(out.model, 40) || 'Gemini', coverMin: data.facts.coverMin, lang, used: res.used ?? null, cap: res.cap ?? null,
    score: Math.max(0, Math.min(10, Math.round(Number(out.score) || 0))),
    verdict: cut(out.verdict, 160), after: cut(out.after, 320), lesson: cut(out.lesson, 220),
    errors: (Array.isArray(out.errors) ? out.errors : []).slice(0, 4).map((e) => ({ title: cut(e?.title, 60), detail: cut(e?.detail, 220), severity: ['high', 'mid', 'low'].includes(e?.severity) ? e.severity : 'mid' })).filter((e) => e.title),
    good: (Array.isArray(out.good) ? out.good : []).slice(0, 3).map((g) => cut(g, 120)).filter(Boolean),
  };
  await mutate((s2) => { const r = s2.account.rounds.find((x) => x.id === id); if (r) r.ai = ai; return true; });
  return { ai, data };
}

// ---------- Aviso de nueva versión ----------
// Mira en GitHub la versión del manifest publicado (y sus novedades en updates.json) cada 3 h.
const UPDATE_EVERY = 3 * 3600e3;
let updChecking = null;
async function ghJson(url) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch(`${url}?t=${Date.now()}`, { cache: 'no-store', signal: ctl.signal });
    if (!r.ok) throw new Error(String(r.status));
    return await r.json();
  } finally { clearTimeout(t); }
}
async function checkUpdate(force = false) {
  if (updChecking) return updChecking;
  updChecking = (async () => {
    const info = await readUpdate();
    // triedAt = último intento (salga bien o mal); checkedAt = última vez que GitHub respondió.
    const wait = info.failed ? 15 * 60e3 : UPDATE_EVERY;
    if (!force && info.triedAt && Date.now() - info.triedAt < wait) return info;
    try {
      const m = await ghJson(`${RAW}Fogueo/manifest.json`);
      const latest = String(m?.version || '');
      if (!/^\d+(\.\d+){0,3}$/.test(latest)) throw new Error('bad version');
      let notes = null, features = info.features || {};
      try {
        const u = await ghJson(`${RAW}updates.json`);
        // Interruptores remotos (p. ej. encender la IA cuando haya saldo) sin publicar versión.
        if (u && typeof u.features === 'object') features = { ai: u.features?.ai === true };
        const r = u?.releases?.[latest];
        const clean = (a) => (Array.isArray(a) ? a.filter((x) => typeof x === 'string').map((x) => x.slice(0, 160)).slice(0, 4) : []);
        if (r) notes = { version: latest, es: clean(r.es), en: clean(r.en) };
      } catch { /* sin novedades: la tarjeta sale igual */ }
      const next = { latest, notes, features, checkedAt: Date.now(), triedAt: Date.now(), failed: false };
      const cur = installedVersion();
      if (cmpVer(latest, cur) > 0 && info.notifiedFor !== latest) {
        next.notifiedFor = latest;
        notify(tr('Blankfire {v} ya está disponible', { v: latest }), tr('Abre Padre o la ventana de Blankfire para actualizar en dos pasos. Tus datos se quedan.'));
      }
      await patchUpdate(next);
      return { ...info, ...next };
    } catch {
      const next = { triedAt: Date.now(), failed: true };   // reintenta en 15 min, sin fingir que se comprobó
      await patchUpdate(next);
      return { ...info, ...next };
    }
  })().finally(() => { updChecking = null; });
  return updChecking;
}
ensureAlarm('blankfire-update', 60);
chrome.alarms.onAlarm.addListener((a) => { if (a.name === 'blankfire-update') { checkUpdate(); proValidate(); } });

chrome.runtime.onInstalled.addListener(async (d) => {
  load().then(updateBadge);
  // Tras actualizar: celebración una vez, y fuera el aviso de la versión que ya tienes.
  if (d?.reason === 'update' && d.previousVersion && cmpVer(installedVersion(), d.previousVersion) > 0) {
    await patchUpdate({ justUpdated: { from: d.previousVersion, to: installedVersion(), at: Date.now(), seen: false }, snooze: null });
  }
  checkUpdate(true);
  try {
    const { blankfireReloadTabs: at } = await chrome.storage.local.get('blankfireReloadTabs');
    if (at) {
      await chrome.storage.local.remove('blankfireReloadTabs');
      if (Date.now() - at < 60000) {
        const tabs = await chrome.tabs.query({ url: 'https://trade.padre.gg/*' });
        tabs.forEach((t) => chrome.tabs.reload(t.id).catch(() => {}));
      }
    }
  } catch { /* sin pestañas que recargar */ }
});
chrome.runtime.onStartup.addListener(() => { updateBadge(); checkUpdate(); });

chrome.commands?.onCommand.addListener(async (command) => {
  if (command !== 'toggle-panel') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) chrome.tabs.sendMessage(tab.id, { type: 'toggle' }).catch(() => {});
});


// =====================================================================
// Bot de práctica: cuatro agentes deciden por separado, el ejecutor obedece límites duros.
// Saldo propio de sesión en SOL ficticios: no toca la cuenta del usuario ni ninguna wallet.
// =====================================================================
const BOT_ALARM = 'blankfire-bot';
const DESKTOP = !!globalThis.BLANKFIRE_DESKTOP;
const fmtDurationTxt = (ms) => (ms >= 60e3 ? `${Math.round(ms / 60e3)} min` : `${Math.round(ms / 1e3)} s`);   // dentro de la app de escritorio: vueltas más rápidas
const botWatchMin = (cfg) => paceTimes(cfg, DESKTOP).watchMin;
let botChain = Promise.resolve();
// Todo lo que cambia el bot pasa por esta cola: un tick y un «Parar» nunca se pisan.
function botRun(fn) {
  const run = botChain.then(async () => {
    const store = (await chrome.storage.local.get(BOT_KEY))[BOT_KEY] || { config: cleanConfig(BOT_DEFAULTS), session: null, past: [] };
    const out = await fn(store);
    await chrome.storage.local.set({ [BOT_KEY]: store });
    return out;
  });
  botChain = run.catch(() => {});
  return run;
}

function botBestPairs(pairs) {
  const best = new Map();
  for (const p of pairs || []) {
    const a = p?.baseToken?.address;
    if (p?.chainId !== 'solana' || !a || !(Number(p.priceUsd) > 0)) continue;
    const cur = best.get(a);
    if (!cur || (Number(p.liquidity?.usd) || 0) > (Number(cur.liquidity?.usd) || 0)) best.set(a, p);
  }
  return [...best.values()];
}

async function botJupRoute(mint, sizeSol, slipPct) {
  try {
    const lamports = Math.round(sizeSol * 1e9);
    const j = await jupJson(`/swap/v1/quote?inputMint=${SOL_MINT}&outputMint=${mint}&amount=${lamports}&slippageBps=${Math.round(slipPct * 100)}&restrictIntermediateTokens=true`);
    const labels = [...new Set((j.routePlan || []).map((r) => r.swapInfo?.label).filter(Boolean))];
    return { route: labels.length ? 'Jupiter · ' + labels.join(' → ') : null, impactPct: Number(j.priceImpactPct) * 100 };
  } catch { return null; }
}

function botOpen(s, pair, quote, router, verdict, agents, sol, settings, now) {
  const key = 'solana:' + pair.baseToken.address;
  const sim = simulateBuy({ solIn: router.sizeSol, quote, solUsd: sol, settings: { ...settings, maxSlippagePct: router.slipPct } });
  if (!sim.ok) {
    pushLog(s, { kind: 'skip', symbol: pair.baseToken.symbol, addr: pair.baseToken.address, score: verdict.score, agents, reason: { t: 'la orden habría fallado por slippage' } }, now);
    return false;
  }
  if (sim.totalDebit > s.balance + 1e-9) return false;
  s.balance -= sim.totalDebit;
  s.positions[key] = {
    key, addr: pair.baseToken.address, symbol: pair.baseToken.symbol, name: pair.baseToken.name, icon: pair.info?.imageUrl || null,
    qty: sim.qty, entryPrice: sim.fillPrice, peak: sim.fillPrice, lastPrice: quote.priceUsd, costSol: sim.totalDebit, valueSol: sim.totalDebit,
    openedAt: now, score: verdict.score, slipPct: router.slipPct, impactPct: sim.impactPct, route: router.route,
    stopPrice: sim.fillPrice * (1 - s.config.stopPct / 100), url: `https://trade.padre.gg/trade/solana/${pair.baseToken.address}`,
  };
  // Lo que valdría venderla ya: así la posición enseña desde el primer segundo lo que se han llevado las comisiones.
  const back = simulateSell({ qty: sim.qty, quote, solUsd: sol, settings: { ...settings, sellSlippagePct: 99 } });
  if (Number.isFinite(back?.netSol)) { s.positions[key].valueSol = Math.max(0, back.netSol); s.positions[key].rtCostSol = Math.max(0, sim.totalDebit - back.netSol); }
  s.seen[pair.baseToken.address] = now;
  s.stats.buys++;
  pushLog(s, { kind: 'buy', symbol: pair.baseToken.symbol, addr: pair.baseToken.address, score: verdict.score, agents, reason: verdict.reason, sol: sim.totalDebit, price: sim.fillPrice }, now);
  return true;
}

function botClose(s, key, quote, sol, settings, exit, now) {
  const p = s.positions[key];
  if (!p) return;
  let netSol = p.valueSol ?? 0;
  if (quote?.priceUsd > 0 && sol > 0) {
    const sim = simulateSell({ qty: p.qty, quote, solUsd: sol, settings: { ...settings, sellSlippagePct: 99 } });
    if (Number.isFinite(sim.netSol)) netSol = Math.max(0, sim.netSol);
  }
  const ch = quote?.priceUsd > 0 ? (quote.priceUsd / p.entryPrice - 1) * 100 : null;
  s.balance += netSol;
  const pnlSol = netSol - p.costSol, pnlPct = (netSol / p.costSol - 1) * 100;
  s.closed.push({ symbol: p.symbol, addr: p.addr, openedAt: p.openedAt, closedAt: now, costSol: p.costSol, netSol, pnlSol, pnlPct, exit, ch, score: p.score, feesSol: p.rtCostSol ?? null });
  if (s.closed.length > 500) s.closed.splice(0, s.closed.length - 500);
  delete s.positions[key];
  pushLog(s, { kind: 'sell', symbol: p.symbol, addr: p.addr, exit, ch, pnlSol, pnlPct, mins: Math.round((now - p.openedAt) / 60e3) }, now);
}

async function botScan(s, settings, sol, now, store = {}) {
  s.lastScanAt = now;
  const [boosts, profiles] = await Promise.all([
    getJson(`${DS}/token-boosts/latest/v1`).catch(() => []),
    getJson(`${DS}/token-profiles/latest/v1`).catch(() => []),
  ]);
  const list = [...(Array.isArray(boosts) ? boosts : []), ...(Array.isArray(profiles) ? profiles : [])].filter((x) => x?.chainId === 'solana' && x.tokenAddress);
  const boosted = new Set((Array.isArray(boosts) ? boosts : []).map((x) => x.tokenAddress));
  const addrs = [...new Set(list.map((x) => x.tokenAddress))].slice(0, 60);
  if (!addrs.length) { pushLog(s, { kind: 'info', reason: { t: 'DexScreener no ha respondido: vuelve a mirar en {m}', v: { m: fmtDurationTxt(paceTimes(s.config, DESKTOP).scanMs) } } }, now); return; }
  const raw = [];
  for (let i = 0; i < addrs.length; i += 30) raw.push(...(await getJson(`${DS}/tokens/v1/solana/${addrs.slice(i, i + 30).join(',')}`).catch(() => [])));
  const pairs = botBestPairs(raw);
  const meta = metaWords(pairs);
  // Restricciones antes de mirar nada: racha de pérdidas, SOL cayendo, horas malas.
  const solPair = await getJson(`${DS}/tokens/v1/solana/${SOL_MINT}`).then((l) => (Array.isArray(l) ? l : []).filter((p) => /USD/.test(p?.quoteToken?.symbol || '')).sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0]).catch(() => null);
  const solH1 = Number(solPair?.priceChange?.h1);
  const past = store.pastClosed || [];
  const stopNote = guardrails(s, { now, solH1: Number.isFinite(solH1) ? solH1 : null, tzOffsetMin: new Date(now).getTimezoneOffset(), pastClosed: past });
  if (stopNote) {
    if (!s.lastGuard || s.lastGuard.t !== stopNote.t || now - s.lastGuardAt > 30 * 60e3) { pushLog(s, { kind: 'info', reason: stopNote }, now); s.lastGuardAt = now; }
    s.lastGuard = stopNote;
    return;
  }
  s.lastGuard = null;
  const held = Object.fromEntries(Object.values(s.positions).map((p) => [p.addr, true]));
  const tracked = await trackedBuys().catch(() => ({}));
  s.skipSeen ||= {};
  const keep = [];
  for (const pair of pairs) {
    const addr = pair.baseToken.address;
    s.stats.scanned++;
    const why = filterPair(pair, s.config, { now, held, recent: s.seen });
    if (why.length) {
      s.stats.skipped++;
      // Un descarte por moneda cada 30 min: el registro cuenta lo que pasa, no repite lo mismo.
      if (!held[addr] && (!s.skipSeen[addr] || now - s.skipSeen[addr] > 30 * 60e3)) {
        s.skipSeen[addr] = now;
        pushLog(s, { kind: 'skip', stage: 'filter', symbol: pair.baseToken.symbol, addr, reason: why[0], more: why.slice(1, 4) }, now);
      }
      continue;
    }
    const smarts = smartsAgent(pair, { tracked: tracked[addr] }), trends = trendsAgent(pair, { meta, boosted });
    keep.push({ pair, smarts, trends, pre: councilScore({ smarts, trends }) ?? -1 });
  }
  const pruned = Object.entries(s.skipSeen).sort((a, b) => b[1] - a[1]).slice(0, 300);
  s.skipSeen = Object.fromEntries(pruned);
  keep.sort((a, b) => b.pre - a.pre);
  let slots = s.config.maxOpen - Object.keys(s.positions).length;
  // Solo las cuatro mejores pasan al debate (cada una cuesta peticiones del escudo y de RugCheck).
  for (const c of keep.slice(0, 4)) {
    const { pair, smarts, trends } = c, addr = pair.baseToken.address;
    const [shield, rc] = await Promise.all([
      shieldFor({ mint: addr, name: pair.baseToken.name, symbol: pair.baseToken.symbol, createdAt: pair.pairCreatedAt, mcUsd: Number(pair.marketCap ?? pair.fdv) || 0 }).catch(() => null),
      rugcheckFor(addr).catch(() => null),
    ]);
    const safety = safetyAgent(rc, { need: s.config.filters.needSafety });
    const ind = indicatorAgent(shield?.chart?.ind || null);
    const debate = debateAgent(pair, { smarts, trends, shield, safety, ind });
    const quote = withTax(pairToQuote(pair));
    let router = routerAgent({ quote, sizeSol: Math.min(entrySize(s), s.balance), solUsd: sol, settings, cfg: s.config, simulateBuy, simulateSell });
    if (router.ok && slots > 0 && !debate.veto) {
      const jup = await botJupRoute(addr, router.sizeSol, router.slipPct);
      if (jup) router = routerAgent({ quote, sizeSol: router.sizeSol, solUsd: sol, settings, cfg: s.config, simulateBuy, simulateSell, jup });
    }
    const agents = { smarts, trends, debate, router, safety: { score: safety.score, veto: safety.veto, notes: safety.notes }, ind: { score: ind.score, notes: ind.notes } };
    agents.checks = checklist({ pair, safety, ind, router, smarts, trends }, s.config);
    const verdict = decide(agents, s.config);
    if (verdict.action === 'buy' && slots > 0 && s.balance >= 0.01) { if (botOpen(s, pair, quote, router, verdict, agents, sol, settings, now)) slots--; }
    else {
      s.stats.skipped++;
      s.skipSeen[addr] = now;
      pushLog(s, { kind: 'skip', stage: 'council', symbol: pair.baseToken.symbol, addr, score: verdict.score, agents, reason: slots > 0 ? verdict.reason : { t: 'sin hueco: ya tiene {n} abiertas', v: { n: s.config.maxOpen } } }, now);
    }
  }
  if (!keep.length) pushLog(s, { kind: 'info', reason: { t: 'ninguna de las {n} monedas pasó los filtros', v: { n: pairs.length } } }, now);
}

function botRecap(s, now, final = false) {
  const r = makeRecap(s, s.lastRecapAt, now);
  r.final = final;
  s.recaps.push(r);
  if (s.recaps.length > 60) s.recaps.splice(0, s.recaps.length - 60);
  s.lastRecapAt = now;
  pushLog(s, { kind: 'recap', recap: r }, now);
  notify(tr('Bot de práctica · resumen'), tr('{n} operaciones · {pnl} SOL · saldo {b} SOL', { n: r.trades, pnl: fmtSol(r.pnlSol, { sign: true }), b: fmtSol(s.balance) }));
}

async function botTick({ forceScan = false } = {}) {
  return botRun(async (store) => {
    const s = store.session;
    if (!s || !['running', 'paused'].includes(s.status)) { chrome.alarms.clear(BOT_ALARM); return; }
    const st = await load();
    // Comisiones con las que se simula: las de la wallet del bot (por defecto) o las de tu Padre.
    const settings = costSettings(st.settings, s.config);
    const sol = await solUsd().catch(() => null);
    const now = Date.now();
    if (!sol) { pushLog(s, { kind: 'info', reason: { t: 'sin precio de SOL: espera' } }, now); return; }
    // 1) Vigilar las abiertas: stop duro, objetivo, stop que sigue al precio y tiempo máximo.
    const keys = Object.keys(s.positions);
    if (keys.length) {
      const q = await refreshQuotes(keys, { force: true }).catch(() => ({}));
      for (const k of keys) {
        const p = s.positions[k], quote = q[k];
        if (!(quote?.priceUsd > 0) || now - (quote.at || 0) > 60e3) {
          // Sin precio fresco el stop no puede actuar: se avisa una vez (a los 3 min) para que lo mires tú.
          const since = p.priceAt || p.openedAt;
          if (!p.staleWarned && now - since > 3 * 60e3) {
            p.staleWarned = true;
            pushLog(s, { kind: 'info', symbol: p.symbol, addr: p.addr, reason: { t: 'sin precio de {s} desde hace {m} min: el stop no puede actuar. Revísala tú.', v: { s: p.symbol, m: Math.round((now - since) / 60e3) } } }, now);
            notify(tr('Blankfire · sin precio de ${s}', { s: p.symbol }), tr('El stop no puede actuar mientras no haya precio. Revísala en Padre.'));
          }
          continue;
        }
        p.priceAt = now; p.staleWarned = false;
        p.lastPrice = quote.priceUsd;
        p.peak = Math.max(p.peak || p.entryPrice, quote.priceUsd);
        const sim = simulateSell({ qty: p.qty, quote, solUsd: sol, settings: { ...settings, sellSlippagePct: 99 } });
        if (Number.isFinite(sim.netSol)) p.valueSol = Math.max(0, sim.netSol);
        const ex = exitReason(p, quote.priceUsd, s.config, now);
        if (ex) botClose(s, k, quote, sol, settings, ex.id, now);
      }
      if (lossHit(s, sessionEquity(s))) {
        for (const k of Object.keys(s.positions)) botClose(s, k, q[k], sol, settings, 'halt', now);
        s.status = 'halted';
        s.haltReason = { t: 'la sesión perdió más del {p} %: el bot se ha parado solo', v: { p: s.config.maxLossPct } };
        pushLog(s, { kind: 'halt', reason: s.haltReason }, now);
        botRecap(s, now, true);
        copilotProcess(store, now);   // las ventas del freno también llegan al dinero real y al copiloto
        notify(tr('Bot de práctica parado'), tr(s.haltReason.t, s.haltReason.v));
        chrome.alarms.clear(BOT_ALARM);
        return;
      }
    }
    // 2) Resumen cada 12 horas.
    if (now - s.lastRecapAt >= RECAP_MS) botRecap(s, now);
    // 3) Buscar entradas según el ritmo (cada 20 s – 2 min), si queda hueco y saldo. Antes, lo último de las wallets que sigues (si hay clave de Helius).
    const free = s.status === 'running' && Object.keys(s.positions).length < s.config.maxOpen && s.balance >= 0.01;
    if (free && (forceScan || now - s.lastScanAt >= paceTimes(s.config, DESKTOP).scanMs)) {
      if (userKeys.helius) {
        const ws = await walletsStore();
        const stale = ws.list.filter((w) => now - (ws.data[w.address]?.at || 0) > 110e3).sort((a, b) => (ws.data[a.address]?.at || 0) - (ws.data[b.address]?.at || 0)).slice(0, 3);
        for (const w of stale) await walletsRefresh({ address: w.address }).catch(() => {});
      }
      await botScan(s, settings, sol, now, store);
    }
    copilotProcess(store, now);
  });
}

// ---------- Copiloto (fase 5): avisos para operar tú en Padre con dinero real ----------
function copilotProcess(store, now = Date.now()) {
  const s = store.session;
  if (!s) return;
  store.copilot = cleanCopilot(store.copilot || COPILOT_DEFAULTS);
  store.signals ||= [];
  const from = store.copilotSeenAt || s.startedAt;
  const fresh = s.log.filter((l) => l.at > from && (l.kind === 'buy' || l.kind === 'sell'));
  store.copilotSeenAt = Math.max(from, ...s.log.map((l) => l.at));
  if (fresh.length) realMirror(fresh, store);   // modo automático con dinero real (si está encendido)
  realRun(() => realRetry()).catch(() => {});   // ventas reales pendientes (wallet cerrada, red caída…)
  if (!store.copilot.on || !copilotGate(store).ok) return;
  for (const l of fresh) {
    const url = `https://trade.padre.gg/trade/solana/${l.addr}`;
    if (l.kind === 'buy') {
      if (signalsToday(store.signals, now) >= store.copilot.maxPerDay) {
        pushLog(s, { kind: 'info', reason: { t: 'copiloto: límite de {n} avisos de compra por hoy', v: { n: store.copilot.maxPerDay } } }, now);
        continue;
      }
      const pos = s.positions['solana:' + l.addr];
      const sig = {
        id: 'bfcop:' + l.at.toString(36) + l.addr.slice(0, 6), kind: 'buy', at: l.at, addr: l.addr, symbol: l.symbol, url,
        sizeSol: Math.min(store.copilot.maxSol, l.sol || store.copilot.maxSol), slipPct: pos?.slipPct ?? null,
        stopPct: s.config.stopPct, tpPct: s.config.tpPct, expires: l.at + store.copilot.ttlMin * 60e3, score: l.score,
      };
      store.signals.push(sig);
      notifyCopilot(sig.id, tr('Copiloto · compraría ${s}', { s: l.symbol }), tr('{sol} SOL · slippage {sl} · stop −{st} %. Caduca en {m} min. Ábrelo y decide tú en Padre.', { sol: fmtSol(sig.sizeSol), sl: sig.slipPct ? sig.slipPct + ' %' : '—', st: sig.stopPct, m: store.copilot.ttlMin }));
    } else {
      const had = store.signals.some((x) => x.kind === 'buy' && x.addr === l.addr && x.at > now - 24 * 3600e3);
      if (!had) continue;
      const sig = { id: 'bfcop:' + l.at.toString(36) + 's' + l.addr.slice(0, 5), kind: 'sell', at: l.at, addr: l.addr, symbol: l.symbol, url, exit: l.exit, ch: l.ch };
      store.signals.push(sig);
      notifyCopilot(sig.id, tr('Copiloto · vendería ${s}', { s: l.symbol }), tr(EXIT_TEXT[l.exit] || EXIT_TEXT.manual, { v: l.ch != null ? fmtPct(l.ch, 1, { sign: true }) : '—', m: l.mins }) + ' · ' + tr('Si la compraste, véndela tú en Padre.'));
    }
  }
  if (store.signals.length > 200) store.signals.splice(0, store.signals.length - 200);
}
function notifyCopilot(id, title, message) {
  try { chrome.notifications.create(id, { type: 'basic', iconUrl: 'icons/icon128.png', title, message, priority: 2, requireInteraction: true }); } catch (e) { /* sin avisos */ }
}
chrome.notifications?.onClicked?.addListener(async (id) => {
  if (!id.startsWith('bfcop:')) return;
  const store = (await chrome.storage.local.get(BOT_KEY))[BOT_KEY];
  const sig = store?.signals?.find((x) => x.id === id);
  if (sig) chrome.tabs.create({ url: sig.url });
  chrome.notifications.clear(id);
});

Object.assign(handlers, {
  async botState() { return botRun(async (store) => store); },
  async botConfig({ config }) {
    return botRun(async (store) => {
      let next = cleanConfig({ ...store.config, ...(config || {}), filters: { ...store.config?.filters, ...(config?.filters || {}) } });
      // Elegir un ritmo ajusta de golpe todos sus valores (luego se pueden retocar en Ajustes avanzados).
      if (config?.usePace) next = cleanConfig(applyPace(next, config.pace));
      store.config = next;
      // El saldo de la sesión es fijo: los demás límites se aplican al momento, el saldo en la próxima sesión.
      if (store.session && ['running', 'paused'].includes(store.session.status)) {
        store.session.config = { ...next, budgetSol: store.session.config.budgetSol };
        pushLog(store.session, { kind: 'info', reason: { t: 'límites actualizados' } });
        chrome.alarms.create(BOT_ALARM, { periodInMinutes: botWatchMin(store.session.config) });
      }
      return store;
    });
  },
  async botStart({ config } = {}) {
    const store = await botRun(async (store) => {
      if (store.session && ['running', 'paused'].includes(store.session.status)) throw new Error(tr('Ya hay una sesión en marcha.'));
      if (store.session) {
        store.past = [{ id: store.session.id, startedAt: store.session.startedAt, endedAt: store.session.endedAt || Date.now(), budgetSol: store.session.config.budgetSol, balance: store.session.balance, trades: store.session.closed.length, status: store.session.status }, ...(store.past || [])].slice(0, 20);
        // Operaciones de sesiones anteriores (solo lo necesario) para aprender las horas malas.
        store.pastClosed = [...(store.pastClosed || []), ...store.session.closed.map((c) => ({ openedAt: c.openedAt, closedAt: c.closedAt, pnlSol: c.pnlSol }))].slice(-1000);
      }
      store.config = cleanConfig({ ...store.config, ...(config || {}), filters: { ...store.config?.filters, ...(config?.filters || {}) } });
      if (config?.usePace) store.config = cleanConfig(applyPace(store.config, config.pace));
      store.session = freshSession(store.config);
      pushLog(store.session, { kind: 'start', reason: { t: 'sesión iniciada con {b} SOL de práctica', v: { b: fmtSol(store.config.budgetSol) } } });
      return store;
    });
    chrome.alarms.create(BOT_ALARM, { periodInMinutes: botWatchMin(store.session?.config) });
    botTick({ forceScan: true }).catch(() => {});
    return store;
  },
  async botPause() {
    return botRun(async (store) => {
      const s = store.session;
      if (s?.status === 'running') { s.status = 'paused'; pushLog(s, { kind: 'info', reason: { t: 'en pausa: vigila las abiertas, no compra' } }); }
      return store;
    });
  },
  async botResume() {
    const store = await botRun(async (store) => {
      const s = store.session;
      if (s?.status === 'paused') { s.status = 'running'; pushLog(s, { kind: 'info', reason: { t: 'reanudado' } }); }
      return store;
    });
    chrome.alarms.create(BOT_ALARM, { periodInMinutes: botWatchMin(store.session?.config) });
    return store;
  },
  async botStop() {
    const st = await load();
    const sol = await solUsd().catch(() => null);
    return botRun(async (store) => {
      const s = store.session;
      if (!s || !['running', 'paused'].includes(s.status)) return store;
      const keys = Object.keys(s.positions);
      const q = keys.length ? await refreshQuotes(keys, { force: true }).catch(() => ({})) : {};
      const now = Date.now();
      for (const k of keys) botClose(s, k, q[k], sol, costSettings(st.settings, s.config), 'manual', now);
      copilotProcess(store, now);
      s.status = 'stopped'; s.endedAt = now;
      pushLog(s, { kind: 'stop', reason: { t: 'sesión terminada' } }, now);
      botRecap(s, now, true);
      chrome.alarms.clear(BOT_ALARM);
      return store;
    });
  },
  async botSell({ key }) {
    const st = await load();
    const sol = await solUsd().catch(() => null);
    const q = await refreshQuotes([String(key)], { force: true }).catch(() => ({}));
    return botRun(async (store) => {
      const s = store.session;
      if (s?.positions?.[key]) { botClose(s, key, q[key], sol, costSettings(st.settings, s.config), 'manual', Date.now()); copilotProcess(store); }
      return store;
    });
  },
  async botScanNow() { await botTick({ forceScan: true }); return botRun(async (store) => store); },
  async botCopilot({ copilot }) {
    return botRun(async (store) => {
      const next = cleanCopilot({ ...(store.copilot || COPILOT_DEFAULTS), ...(copilot || {}) });
      if (next.on && !copilotGate(store).ok) throw new Error(tr('El copiloto se desbloquea con {n} operaciones simuladas y resultado positivo.', { n: 20 }));
      store.copilot = next;
      if (store.session) store.copilotSeenAt = Math.max(store.copilotSeenAt || 0, ...store.session.log.map((l) => l.at));   // no avisar de lo ya pasado
      return store;
    });
  },
});

// Una vuelta a la vez: si la red va lenta, la siguiente alarma se salta en vez de hacer cola
// (en la app de escritorio el ritmo Rápido vigila cada 5 s y una búsqueda puede tardar más).
let botTicking = false;
if (globalThis.BLANKFIRE_TEST) globalThis.__bfTick = botTick;   // solo para las pruebas de resistencia (tests/t50)
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name !== BOT_ALARM || botTicking) return;
  botTicking = true;
  botTick().catch(() => {}).finally(() => { botTicking = false; });
});
// Si el navegador se reinició con una sesión en marcha, la alarma sigue; si se perdió, se recrea.
chrome.storage.local.get(BOT_KEY).then((g) => { if (['running', 'paused'].includes(g[BOT_KEY]?.session?.status)) ensureAlarm(BOT_ALARM, botWatchMin(g[BOT_KEY].session.config)); }).catch(() => {});


// =====================================================================
// Radar (fase 4): temas de moda, ballenas en directo y wallets que sigues.
// =====================================================================
const RADAR_KEY = 'blankfireRadar';
const WALLETS_KEY = 'blankfireWallets';
const HELIUS = 'https://mainnet.helius-rpc.com';
let themesCache = null;

async function latestPairs() {
  const [boosts, top, profiles] = await Promise.all([
    getJson(`${DS}/token-boosts/latest/v1`).catch(() => []),
    getJson(`${DS}/token-boosts/top/v1`).catch(() => []),
    getJson(`${DS}/token-profiles/latest/v1`).catch(() => []),
  ]);
  const all = [boosts, top, profiles].flatMap((x) => (Array.isArray(x) ? x : []));
  const addrs = [...new Set(all.filter((x) => x?.chainId === 'solana' && x.tokenAddress).map((x) => x.tokenAddress))].slice(0, 90);
  const raw = [];
  for (let i = 0; i < addrs.length; i += 30) raw.push(...(await getJson(`${DS}/tokens/v1/solana/${addrs.slice(i, i + 30).join(',')}`).catch(() => [])));
  return { pairs: botBestPairs(raw), boosted: new Set((Array.isArray(boosts) ? boosts : []).map((x) => x.tokenAddress)) };
}

async function radarThemes({ force } = {}) {
  if (!force && themesCache && Date.now() - themesCache.at < 60e3) return themesCache;
  const now = Date.now();
  const { pairs } = await latestPairs();
  const store = (await chrome.storage.local.get(RADAR_KEY))[RADAR_KEY] || { snaps: [] };
  // Comparar con la foto de hace ~1 h (o la más antigua que haya).
  const target = now - 3600e3;
  const prev = store.snaps.filter((x) => x.at <= now - 20 * 60e3).sort((a, b) => Math.abs(a.at - target) - Math.abs(b.at - target))[0];
  const list = themes(pairs, prev?.map || {});
  if (!store.snaps.length || now - store.snaps.at(-1).at >= 10 * 60e3) {
    store.snaps.push({ at: now, map: snapshotOf(themes(pairs, {}, { min: 2, max: 60 })) });
    store.snaps = store.snaps.filter((x) => now - x.at <= 24 * 3600e3);
    await chrome.storage.local.set({ [RADAR_KEY]: store });
  }
  themesCache = { at: now, themes: list, coins: pairs.length, prevAt: prev?.at || null };
  return themesCache;
}

async function walletsStore() {
  return (await chrome.storage.local.get(WALLETS_KEY))[WALLETS_KEY] || { list: [], data: {} };
}
const trackedMap = (ws) => Object.fromEntries(ws.list.map((w) => [w.address, w.name || w.address.slice(0, 4) + '…' + w.address.slice(-4)]));

async function whaleData({ mint } = {}) {
  const m = String(mint || '').trim();
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(m)) throw new Error(tr('Esa dirección no parece de Solana.'));
  if (proSelling()) throw new Error(tr('Las ballenas en directo solo están en la beta gratis.'));
  const pools = await gtJson(`/networks/solana/tokens/${m}/pools?page=1`);
  const top = pools?.data?.[0]?.attributes;
  if (!top?.address) throw new Error(tr('No encuentro operaciones de esa moneda.'));
  const j = await gtJson(`/networks/solana/pools/${top.address}/trades`);
  const ws = await walletsStore();
  const tape = whaleTape(j?.data || [], { liqUsd: Number(top.reserve_in_usd) || 0, tracked: trackedMap(ws) });
  return { ...tape, symbol: String(top.name || '').split(' / ')[0], mint: m, liqUsd: Number(top.reserve_in_usd) || 0, at: Date.now() };
}

async function heliusSwaps(address) {
  const key = userKeys.helius;
  if (!key) throw new Error(tr('Falta tu clave de Helius.'));
  const okPerm = await chrome.permissions.contains({ origins: [`${HELIUS}/*`] }).catch(() => false);
  if (!okPerm) throw new Error(tr('Falta darle permiso a Blankfire para usar Helius (botón «Conectar Helius»).'));
  const r = await fetch(`${HELIUS}/v0/addresses/${address}/transactions?api-key=${encodeURIComponent(key)}&limit=100`);
  if (r.status === 401 || r.status === 403) throw new Error(tr('Helius no acepta la clave: revisa que esté bien copiada.'));
  if (r.status === 429) throw new Error(tr('Helius dice que vas muy rápido: espera un minuto.'));
  if (!r.ok) throw new Error(tr('Helius no responde ({s}).', { s: r.status }));
  return r.json();
}

async function walletsRefresh({ address } = {}) {
  const ws = await walletsStore();
  const list = address ? ws.list.filter((w) => w.address === address) : ws.list;
  for (const w of list) {
    try {
      const txs = await heliusSwaps(w.address);
      ws.data[w.address] = { at: Date.now(), txs: (Array.isArray(txs) ? txs : []).map((t) => ({ signature: t.signature, timestamp: t.timestamp, transactionError: t.transactionError || null, accountData: (t.accountData || []).filter((a) => a.account === w.address), tokenTransfers: (t.tokenTransfers || []).filter((x) => x.fromUserAccount === w.address || x.toUserAccount === w.address).map((x) => ({ mint: x.mint, tokenAmount: x.tokenAmount, fromUserAccount: x.fromUserAccount, toUserAccount: x.toUserAccount })) })), error: null };
    } catch (e) {
      ws.data[w.address] = { ...(ws.data[w.address] || {}), at: Date.now(), error: e.message };
    }
  }
  await chrome.storage.local.set({ [WALLETS_KEY]: ws });
  return { ...ws, solUsd: await solUsd().catch(() => null), helius: !!userKeys.helius };
}

// Para el bot: monedas que alguna wallet que sigues ha comprado en los últimos 30 min.
async function trackedBuys() {
  const ws = await walletsStore();
  return recentBuys(ws.list.map((w) => ({ address: w.address, name: w.name, trades: parseSwaps(ws.data[w.address]?.txs || [], w.address) })));
}

Object.assign(handlers, {
  async radarThemes({ force } = {}) { return radarThemes({ force }); },
  async whaleTape({ mint }) { return whaleData({ mint }); },
  async walletsState() { const ws = await walletsStore(); return { ...ws, solUsd: await solUsd().catch(() => null), helius: !!userKeys.helius, heliusPerm: await chrome.permissions.contains({ origins: [`${HELIUS}/*`] }).catch(() => false) }; },
  async walletAdd({ address, name }) {
    const a = String(address || '').trim();
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a)) throw new Error(tr('Esa dirección no parece de Solana.'));
    const ws = await walletsStore();
    if (ws.list.some((w) => w.address === a)) throw new Error(tr('Ya sigues esa wallet.'));
    if (ws.list.length >= 25) throw new Error(tr('Como mucho 25 wallets.'));
    ws.list.push({ address: a, name: String(name || '').trim().slice(0, 24), addedAt: Date.now() });
    await chrome.storage.local.set({ [WALLETS_KEY]: ws });
    return handlers.walletsState();
  },
  async walletRemove({ address }) {
    const ws = await walletsStore();
    ws.list = ws.list.filter((w) => w.address !== address);
    delete ws.data[address];
    await chrome.storage.local.set({ [WALLETS_KEY]: ws });
    return handlers.walletsState();
  },
  async walletsRefresh({ address } = {}) { return walletsRefresh({ address }); },
});


// =====================================================================
// Dinero real (fase 5): wallet propia del bot, cifrada, que opera por Jupiter con límites duros.
// La clave privada se guarda cifrada (lib/vault.js). Descifrada vive solo en chrome.storage.session:
// en memoria, nunca en disco, fuera del alcance de los scripts de páginas web, y se borra al cerrar el navegador.
// =====================================================================
const REAL_KEY = 'blankfireReal';
const REAL_SESSION = 'blankfireRealKey';
const LAMPORTS = 1e9;
// Pensado para empezar con poco (20 € ≈ 0,13 SOL): entradas de 0,025 SOL, freno diario de 0,03 SOL.
const REAL_DEFAULTS = { mode: 'off', maxSol: 0.025, maxPerDay: 20, maxDailyLossSol: 0.03, maxOpen: 2, buySlipBps: 1500, sellSlipBps: 3000, maxImpactPct: 5, maxPrioLamports: 300000 };
chrome.storage.session?.setAccessLevel?.({ accessLevel: 'TRUSTED_CONTEXTS' }).catch?.(() => {});
let realChain = Promise.resolve();
const realRun = (fn) => { const r = realChain.then(fn); realChain = r.catch(() => {}); return r; };

function cleanReal(c = {}) {
  const n = (v, d, a, b) => { const x = Number(v); return Number.isFinite(x) ? Math.min(b, Math.max(a, x)) : d; };
  const d = REAL_DEFAULTS;
  return {
    mode: c.mode === 'auto' ? 'auto' : 'off',
    maxSol: n(c.maxSol, d.maxSol, 0.01, 2), maxPerDay: Math.round(n(c.maxPerDay, d.maxPerDay, 1, 100)),
    maxDailyLossSol: n(c.maxDailyLossSol, d.maxDailyLossSol, 0.01, 10), maxOpen: Math.round(n(c.maxOpen, d.maxOpen, 1, 5)),
    buySlipBps: Math.round(n(c.buySlipBps, d.buySlipBps, 50, 3000)), sellSlipBps: Math.round(n(c.sellSlipBps, d.sellSlipBps, 100, 5000)),
    maxImpactPct: n(c.maxImpactPct, d.maxImpactPct, 0.5, 15), maxPrioLamports: Math.round(n(c.maxPrioLamports, d.maxPrioLamports, 0, 5e6)),
  };
}
async function realLoad() {
  const r = (await chrome.storage.local.get(REAL_KEY))[REAL_KEY] || {};
  return { vault: null, address: null, withdrawTo: null, createdAt: null, positions: {}, log: [], day: null, ...r, config: cleanReal(r.config) };
}
async function realSave(r) { await chrome.storage.local.set({ [REAL_KEY]: r }); }
function realLog(r, entry) { r.log.push({ at: Date.now(), ...entry }); if (r.log.length > 300) r.log.splice(0, r.log.length - 300); }
async function realKeypair() {
  const g = await chrome.storage.session.get(REAL_SESSION).catch(() => ({}));
  if (!g?.[REAL_SESSION]) return null;
  try { return keypairFromSecret(b64decode(g[REAL_SESSION])); } catch { return null; }
}

// ---------- RPC (Helius, con tu clave) ----------
async function rpc(method, params) {
  if (!userKeys.helius) throw new Error(tr('Para operar con dinero real hace falta tu clave de Helius (Radar → Wallets que sigues).'));
  if (!(await chrome.permissions.contains({ origins: [`${HELIUS}/*`] }).catch(() => false))) throw new Error(tr('Falta darle permiso a Blankfire para usar Helius (botón «Conectar Helius»).'));
  const r = await fetch(`${HELIUS}/?api-key=${encodeURIComponent(userKeys.helius)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(tr('La red de Solana no responde ({s}).', { s: r.status }));
  const j = await r.json();
  if (j.error) throw new Error(j.error.message || 'RPC');
  return j.result;
}
// Respuestas raras de la red se tratan como error, nunca como «cero»: un cero falso haría
// olvidar una posición o borrar una wallet con saldo.
async function lamportsOf(addr) {
  const v = (await rpc('getBalance', [addr, { commitment: 'confirmed' }]))?.value;
  if (!Number.isFinite(v)) throw new Error(tr('La red de Solana devolvió un saldo inválido.'));
  return v;
}
async function tokenRaw(owner, mint) {
  const res = await rpc('getTokenAccountsByOwner', [owner, { mint }, { encoding: 'jsonParsed', commitment: 'confirmed' }]);
  if (!Array.isArray(res?.value)) throw new Error(tr('La red de Solana devolvió una respuesta inválida.'));
  let raw = 0n, decimals = 0;
  for (const a of res?.value || []) { const t = a.account?.data?.parsed?.info?.tokenAmount; if (t) { raw += BigInt(t.amount); decimals = t.decimals; } }
  return { raw, decimals };
}
async function closeEmpty(kp, mint) {
  const res = await rpc('getTokenAccountsByOwner', [kp.address, { mint }, { encoding: 'jsonParsed', commitment: 'confirmed' }]);
  let recovered = 0;
  for (const a of res?.value || []) {
    const info = a.account?.data?.parsed?.info;
    if (!a.pubkey || !TOKEN_PROGRAMS.includes(a.account?.owner) || info?.tokenAmount?.amount !== '0') continue;
    const { blockhash } = (await rpc('getLatestBlockhash', [{ commitment: 'finalized' }])).value;
    const { tx } = signTransaction(closeAccountTx({ owner: kp.address, account: a.pubkey, program: a.account.owner, blockhash }), kp);
    await sendAndConfirm(tx);
    recovered += Number(a.account?.lamports) || 2039280;
  }
  return recovered;
}
async function sendAndConfirm(txBytes) {
  const sig = await rpc('sendTransaction', [b64encode(txBytes), { encoding: 'base64', skipPreflight: false, maxRetries: 3, preflightCommitment: 'confirmed' }]);
  for (let i = 0; i < 30; i++) {
    await new Promise((res) => setTimeout(res, 1500));
    const st = (await rpc('getSignatureStatuses', [[sig]]))?.value?.[0];
    if (st?.err) throw Object.assign(new Error(tr('La red rechazó la operación.')), { sig });
    if (st && (st.confirmationStatus === 'confirmed' || st.confirmationStatus === 'finalized')) return sig;
  }
  throw Object.assign(new Error(tr('Sin confirmar en 45 s: revisa la wallet en Solscan.')), { sig });
}
async function jupPost(path, body) {
  const key = (userKeys.jupiter || '').trim();
  const headers = { 'content-type': 'application/json', accept: 'application/json' };
  if (key) headers['x-api-key'] = key;
  const res = await fetch((key ? JUP_KEYED : JUP) + path, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(tr('Jupiter respondió {s}', { s: res.status }));
  return res.json();
}
async function swap(kp, { inputMint, outputMint, amount, slippageBps, maxImpactPct, maxPrioLamports, priorityLevel = 'high' }) {
  const q = await jupJson(`/swap/v1/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=${slippageBps}&restrictIntermediateTokens=true`);
  if (!q?.outAmount) throw new Error(tr('Jupiter no encuentra ruta.'));
  const impact = Number(q.priceImpactPct) * 100;
  if (Number.isFinite(impact) && impact > maxImpactPct) throw new Error(tr('Impacto {v} % (máximo {m} %): no opero.', { v: impact.toFixed(1), m: maxImpactPct }));
  const sw = await jupPost('/swap/v1/swap', {
    quoteResponse: q, userPublicKey: kp.address, wrapAndUnwrapSol: true, dynamicComputeUnitLimit: true,
    prioritizationFeeLamports: { priorityLevelWithMaxLamports: { maxLamports: maxPrioLamports, priorityLevel } },
  });
  if (!sw?.swapTransaction) throw new Error(tr('Jupiter no devolvió la operación.'));
  const { tx } = signTransaction(b64decode(sw.swapTransaction), kp);
  // Antes de enviar, se ensaya en la red: si fallaría, no se paga comisión; y si la operación
  // sacara de la wallet más SOL del que toca (Jupiter devolviendo algo raro), no se envía.
  const before = await lamportsOf(kp.address);
  const sim = (await rpc('simulateTransaction', [b64encode(tx), { encoding: 'base64', sigVerify: false, replaceRecentBlockhash: false, commitment: 'confirmed', accounts: { encoding: 'base64', addresses: [kp.address] } }]))?.value;
  if (!sim) throw new Error(tr('No he podido ensayar la operación: no la envío.'));
  if (sim.err) throw new Error(tr('El ensayo de la operación falla ({e}): no la envío.', { e: typeof sim.err === 'string' ? sim.err : JSON.stringify(sim.err).slice(0, 80) }));
  const post = Number(sim.accounts?.[0]?.lamports);
  const maxOut = (inputMint === SOL_MINT ? Number(amount) : 0) + maxPrioLamports + 0.01 * LAMPORTS;
  if (!Number.isFinite(post) || before - post > maxOut) throw new Error(tr('La operación sacaría más SOL de lo previsto: no la envío.'));
  const sig = await sendAndConfirm(tx);
  return { sig, quote: q };
}

// ---------- Comprobaciones antes de cada compra ----------
function sameDay(a, b) { const x = new Date(a), y = new Date(b); return x.toDateString() === y.toDateString(); }
// Límites antes de cada compra. Primero se pregunta a la red (sin tocar nada guardado) y después
// se decide y se apunta de golpe, sin esperas en medio: nada puede colarse entre leer y guardar.
async function realGuards(kp, lamportsIn) {
  const store = (await chrome.storage.local.get(BOT_KEY))[BOT_KEY] || {};
  if (!copilotGate(store).ok) return tr('el modo real sigue bloqueado: faltan operaciones simuladas en positivo');
  const bal = await lamportsOf(kp.address);
  const now = Date.now();
  let halted = false;
  const why = await realPatch((r) => {
    if (r.config.mode !== 'auto' || r.movedAt) return tr('modo real apagado');
    const openCost = Object.values(r.positions).reduce((a, p) => a + (p.lamportsIn || 0), 0);
    if (!r.day || !sameDay(r.day.date, now)) r.day = { date: now, start: bal + openCost, buys: 0 };
    const loss = (r.day.start - (bal + openCost)) / LAMPORTS;
    if (loss >= r.config.maxDailyLossSol) {
      r.config.mode = 'off'; halted = true;
      realLog(r, { kind: 'halt', t: 'pérdida del día {v} SOL (máximo {m}): modo real apagado', v: { v: loss.toFixed(3), m: r.config.maxDailyLossSol } });
      return tr('freno diario');
    }
    if (r.day.buys >= r.config.maxPerDay) return tr('límite de {n} compras por hoy', { n: r.config.maxPerDay });
    if (Object.keys(r.positions).length >= r.config.maxOpen) return tr('ya tiene {n} abiertas con dinero real', { n: r.config.maxOpen });
    if (bal < lamportsIn + 0.012 * LAMPORTS) return tr('saldo insuficiente en la wallet del bot');
    return null;
  });
  if (halted) notify(tr('Blankfire · dinero real apagado'), tr('Has llegado a la pérdida máxima del día. Vuelve a encenderlo mañana si quieres.'));
  return why;
}

// Escrituras atómicas: se relee lo guardado justo antes de cambiarlo y van en fila, una detrás de otra.
// Así nada que tarde (una compra esperando a la red) puede pisar un «pánico» o un cambio de límites.
let patchChain = Promise.resolve();
function realPatch(fn) {
  const job = patchChain.then(async () => {
    const r = await realLoad();
    const out = fn(r);   // siempre síncrono: nada de esperas entre leer y guardar
    await realSave(r);
    return out;
  });
  patchChain = job.catch(() => {});
  return job;
}

// Tokens en la wallet del bot que Blankfire no tiene apuntados (una compra que se confirmó tarde, por ejemplo).
async function realReconcile(kp) {
  const found = new Map();
  for (const programId of TOKEN_PROGRAMS) {
    const res = await rpc('getTokenAccountsByOwner', [kp.address, { programId }, { encoding: 'jsonParsed', commitment: 'confirmed' }]).catch(() => null);
    for (const a of res?.value || []) {
      const info = a.account?.data?.parsed?.info;
      if (info?.mint && info.tokenAmount?.amount && info.tokenAmount.amount !== '0') found.set(info.mint, info.tokenAmount.amount);
    }
  }
  const bot = (await chrome.storage.local.get(BOT_KEY))[BOT_KEY];
  const simOpen = new Set(Object.values(bot?.session?.positions || {}).map((p) => p.addr));
  return realPatch((r) => {
    let added = 0;
    r.ignored ||= {};
    for (const [mint] of found) {
      if (r.ignored[mint]) continue;   // basura o regalos sin ruta de venta: ya se intentó
      if (r.positions[mint]) { delete r.positions[mint].pending; continue; }
      // Si el bot simulado ya no la tiene, se vende en cuanto se pueda.
      r.positions[mint] = { addr: mint, symbol: mint.slice(0, 4) + '…', lamportsIn: 0, at: Date.now(), orphan: true, sellPending: simOpen.has(mint) ? null : { reason: 'orphan', nextAt: 0, tries: 0 } };
      realLog(r, { kind: 'info', symbol: mint.slice(0, 4) + '…', t: 'tokens sin apuntar en la wallet del bot: los vigilo' });
      added++;
    }
    // Compras enviadas sin confirmar que al final no entraron: fuera.
    for (const p of Object.values(r.positions)) if (p.pending && !found.has(p.addr) && Date.now() - p.at > 120e3) { delete r.positions[p.addr]; realLog(r, { kind: 'info', symbol: p.symbol, t: 'la compra sin confirmar no llegó a entrar' }); }
    return added;
  });
}

async function realBuy({ addr, symbol, sol }) {
  const r0 = await realLoad();
  if (r0.config.mode !== 'auto' || !r0.vault || r0.positions[addr]) return;
  const kp = await realKeypair();
  if (!kp) { await realPatch((r) => realLog(r, { kind: 'skip', symbol, t: 'wallet bloqueada: no compro' })); return; }
  const lamportsIn = Math.floor(Math.min(r0.config.maxSol, sol || r0.config.maxSol) * LAMPORTS);
  let why = null;
  try {
    // Los guardas trabajan sobre lo guardado ahora mismo y guardan el «día» al momento.
    why = await realGuards(kp, lamportsIn);
  } catch (e) { why = e.message; }
  if (why) { await realPatch((r) => realLog(r, { kind: 'skip', symbol, t: 'no compro: {w}', v: { w: why } })); return; }
  // Última comprobación justo antes de enviar: si has pulsado pánico o apagado, no se compra.
  const fresh = await realLoad();
  if (fresh.config.mode !== 'auto' || fresh.positions[addr]) return;
  try {
    // Comprar no corre prisa (si no entra, no se pierde nada): priority fee baja. Vender sí: alta.
    const { sig, quote } = await swap(kp, { inputMint: SOL_MINT, outputMint: addr, amount: lamportsIn, slippageBps: fresh.config.buySlipBps, maxImpactPct: fresh.config.maxImpactPct, maxPrioLamports: Math.min(fresh.config.maxPrioLamports, 100000), priorityLevel: 'medium' });
    const late = await realPatch((r) => {
      if (r.day) r.day.buys++;
      r.positions[addr] = { addr, symbol, lamportsIn, sig, at: Date.now(), outQuoted: quote.outAmount };
      realLog(r, { kind: 'buy', symbol, addr, sol: lamportsIn / LAMPORTS, sig });
      // Si mientras se confirmaba pulsaste pánico o apagaste, se vende en cuanto se pueda.
      if (r.config.mode !== 'auto') { r.positions[addr].sellPending = { reason: 'manual', nextAt: 0, tries: 0 }; return true; }
      return false;
    });
    if (late) { retryAt = 0; realRun(() => realRetry()).catch(() => {}); }
    notify(tr('Blankfire · compra real ${s}', { s: symbol }), tr('{v} SOL. El bot la vigila con tu stop.', { v: fmtSol(lamportsIn / LAMPORTS) }));
  } catch (e) {
    await realPatch((r) => {
      realLog(r, { kind: 'error', symbol, t: 'compra fallida: {e}', v: { e: e.message }, sig: e.sig || null });
      // Enviada pero sin confirmar: puede entrar más tarde. Se apunta como pendiente y se vigila igual.
      if (e.sig) { if (r.day) r.day.buys++; r.positions[addr] = { addr, symbol, lamportsIn, sig: e.sig, at: Date.now(), pending: true }; }
    });
  }
}

async function realSell({ addr, symbol, reason }) {
  const r0 = await realLoad();
  const pos = r0.positions[addr];
  if (!pos) return;
  const kp = await realKeypair();
  if (!kp) {
    await realPatch((r) => {
      if (!r.positions[addr]) return;
      r.positions[addr].sellPending = { reason, nextAt: 0, tries: r.positions[addr].sellPending?.tries || 0 };
      realLog(r, { kind: 'error', symbol, t: 'wallet bloqueada: no puedo vender. Desbloquéala o véndela en Phantom.' });
    });
    notify(tr('Blankfire · no puedo vender ${s}', { s: symbol }), tr('La wallet del bot está bloqueada. Desbloquéala en la ventana del Bot.'));
    return;
  }
  // Un stop tiene que salir: hasta 3 intentos seguidos subiendo el slippage; si no, se reintenta cada minuto.
  for (let i = 0; i < 3; i++) {
    try {
      const { raw } = await tokenRaw(kp.address, addr);
      if (raw === 0n) {
        if (pos.pending && Date.now() - pos.at < 120e3) return;   // la compra aún puede estar entrando
        await realPatch((r) => { delete r.positions[addr]; realLog(r, { kind: 'info', symbol, t: 'ya no quedan tokens: posición cerrada' }); });
        return;
      }
      const before = await lamportsOf(kp.address);
      const cur = await realLoad();
      const { sig } = await swap(kp, { inputMint: addr, outputMint: SOL_MINT, amount: raw.toString(), slippageBps: Math.min(5000, Math.round(cur.config.sellSlipBps * (1 + i * 0.5))), maxImpactPct: 99, maxPrioLamports: cur.config.maxPrioLamports * (i + 1), priorityLevel: i ? 'veryHigh' : 'high' });
      const after = await lamportsOf(kp.address);
      const pnl = pos.lamportsIn ? (after - before - pos.lamportsIn) / LAMPORTS : null;
      await realPatch((r) => { delete r.positions[addr]; realLog(r, { kind: 'sell', symbol, addr, reason, sol: (after - before) / LAMPORTS, pnl, sig }); });
      // Cada moneda deja una cuenta de token con ~0,002 SOL de renta: se cierra para recuperarla.
      const back = await closeEmpty(kp, addr).catch(() => 0);
      if (back > 0) await realPatch((r) => realLog(r, { kind: 'info', symbol, t: 'recuperada la renta de la cuenta: {v} SOL', v: { v: (back / LAMPORTS).toFixed(4) } }));
      notify(tr('Blankfire · venta real ${s}', { s: symbol }), pnl == null ? tr('Vendida.') : tr('Resultado {v} SOL ({r}).', { v: fmtSol(pnl, { sign: true }), r: tr(reason || '') }));
      return;
    } catch (e) {
      await realPatch((r) => realLog(r, { kind: 'error', symbol, t: 'venta fallida (intento {n}): {e}', v: { n: i + 1, e: e.message }, sig: e.sig || null }));
    }
  }
  const tries = await realPatch((r) => {
    if (!r.positions[addr]) return 0;
    const t = (r.positions[addr].sellPending?.tries || 0) + 1;
    // Tokens que no compró el bot (regalos, spam) y que no se pueden vender: se dejan de vigilar.
    if (r.positions[addr].orphan && !r.positions[addr].lamportsIn && t >= 5) {
      r.ignored ||= {}; r.ignored[addr] = true; delete r.positions[addr];
      realLog(r, { kind: 'info', symbol, t: 'no hay forma de vender esos tokens: los dejo de vigilar' });
      return -1;
    }
    r.positions[addr].sellPending = { reason, nextAt: Date.now() + 60e3, tries: t };
    return t;
  });
  if (tries > 0 && (tries === 1 || tries % 10 === 0)) notify(tr('Blankfire · no he podido vender ${s}', { s: symbol }), tr('Lo sigo intentando cada minuto. Si corre prisa, véndela tú en Phantom.'));
}

// Ventas que quedaron pendientes (wallet cerrada, red caída, sin ruta): se reintentan solas.
let retryAt = 0, reconcileAt = 0;
async function realRetry() {
  const now = Date.now();
  if (now - retryAt < 20e3) return;
  retryAt = now;
  const r = await realLoad();
  if (!r.vault) return;
  const kp = await realKeypair();
  if (!kp) return;
  // Repaso de la wallet del bot (cada minuto, y siempre al abrirla): ningún token se queda olvidado.
  if (now - reconcileAt > 60e3) { reconcileAt = now; await realReconcile(kp).catch(() => {}); }
  const cur = await realLoad();
  for (const p of Object.values(cur.positions)) if (p.sellPending && p.sellPending.nextAt <= now) await realSell({ addr: p.addr, symbol: p.symbol, reason: p.sellPending.reason });
}

// Copia las decisiones del bot simulado: compra cuando él compra y vende cuando él vende.
function realMirror(fresh) {
  for (const l of fresh) {
    if (l.kind === 'buy') realRun(() => realBuy({ addr: l.addr, symbol: l.symbol, sol: l.sol })).catch(() => {});
    if (l.kind === 'sell') realRun(() => realSell({ addr: l.addr, symbol: l.symbol, reason: l.exit })).catch(() => {});
  }
}

Object.assign(handlers, {
  async realState() {
    const r = await realLoad();
    const kp = await realKeypair();
    let balance = null, balErr = null;
    if (r.address && userKeys.helius) { try { balance = (await lamportsOf(r.address)) / LAMPORTS; } catch (e) { balErr = e.message; } }
    const store = (await chrome.storage.local.get(BOT_KEY))[BOT_KEY] || {};
    return { desktop: !!globalThis.BLANKFIRE_DESKTOP, movedAt: r.movedAt || null, has: !!r.vault, address: r.address, withdrawTo: r.withdrawTo, unlocked: !!kp, config: r.config, positions: r.positions, log: r.log.slice(-60), day: r.day, balance, balErr, helius: !!userKeys.helius, gate: copilotGate(store) };
  },
  // Llevar la wallet del bot a la app de escritorio (o traerla de vuelta). La clave viaja cifrada
  // con tu contraseña; aquí se apaga el modo real para que nunca operen los dos a la vez.
  async realMoveOut({ password }) {
    const r = await realLoad();
    if (!r.vault) throw new Error(tr('Aún no hay wallet del bot.'));
    await openVault(r.vault, password).catch(() => { throw new Error(tr('Contraseña incorrecta.')); });
    if (Object.keys(r.positions).length) throw new Error(tr('Tiene posiciones abiertas: véndelas antes de moverla.'));
    const bundle = { kind: 'blankfire-bot-wallet', v: 1, address: r.address, withdrawTo: r.withdrawTo, createdAt: r.createdAt, vault: r.vault, config: { ...r.config, mode: 'off' }, at: Date.now() };
    await realPatch((x) => { x.config.mode = 'off'; x.movedAt = Date.now(); realLog(x, { kind: 'info', t: 'wallet llevada a la app de escritorio: aquí queda apagada' }); });
    await chrome.storage.session.remove(REAL_SESSION);
    return { bundle };
  },
  async realMoveIn({ bundle, password }) {
    const r = await realLoad();
    if (r.vault && !r.movedAt) throw new Error(tr('Aquí ya hay una wallet del bot.'));
    const b = typeof bundle === 'string' ? JSON.parse(bundle) : bundle;
    if (b?.kind !== 'blankfire-bot-wallet' || !b.vault || !isAddress(b.address) || !isAddress(b.withdrawTo)) throw new Error(tr('Ese archivo no es una wallet del bot de Blankfire.'));
    const secret = await openVault(b.vault, password).catch(() => { throw new Error(tr('Contraseña incorrecta.')); });
    if (keypairFromSecret(secret).address !== b.address) throw new Error(tr('El archivo está dañado: la clave no corresponde a la dirección.'));
    if (r.vault && r.address !== b.address) throw new Error(tr('Aquí ya hay otra wallet del bot distinta.'));
    await realPatch((x) => {
      Object.assign(x, { vault: b.vault, address: b.address, withdrawTo: b.withdrawTo, createdAt: b.createdAt || Date.now(), movedAt: null });
      x.config = cleanReal({ ...x.config, ...(b.config || {}), mode: 'off' });
      realLog(x, { kind: 'info', t: 'wallet del bot recibida: revisa los límites y enciéndela cuando quieras' });
    });
    await chrome.storage.session.set({ [REAL_SESSION]: b64encode(secret) });
    return handlers.realState();
  },
  async realReclaim() {
    await realPatch((x) => { x.movedAt = null; realLog(x, { kind: 'info', t: 'wallet usada de nuevo aquí: apaga el modo real en la app de escritorio' }); });
    return handlers.realState();
  },
  async realCreate({ password, withdrawTo }) {
    const r = await realLoad();
    if (r.vault) throw new Error(tr('Ya hay una wallet del bot. Retira el saldo y bórrala antes de crear otra.'));
    const bad = passwordProblem(password);
    if (bad) throw new Error(tr(bad));
    if (!isAddress(withdrawTo)) throw new Error(tr('La dirección para retirar no parece de Solana.'));
    const kp = newKeypair();
    r.vault = await seal(kp.secret, password);
    r.address = kp.address; r.withdrawTo = String(withdrawTo).trim(); r.createdAt = Date.now();
    realLog(r, { kind: 'info', t: 'wallet del bot creada' });
    await realSave(r);
    await chrome.storage.session.set({ [REAL_SESSION]: b64encode(kp.secret) });
    // Copia de seguridad: se enseña una vez, solo en la ventana del bot.
    return { address: kp.address, backup: b58encode(kp.secret) };
  },
  async realUnlock({ password }) {
    const r = await realLoad();
    if (!r.vault) throw new Error(tr('Aún no hay wallet del bot.'));
    const secret = await openVault(r.vault, password).catch(() => { throw new Error(tr('Contraseña incorrecta.')); });
    const kp = keypairFromSecret(secret);
    if (kp.address !== r.address) throw new Error(tr('La clave no coincide con la wallet guardada.'));
    await chrome.storage.session.set({ [REAL_SESSION]: b64encode(secret) });
    retryAt = 0; reconcileAt = 0;
    realRun(() => realRetry()).catch(() => {});   // al abrir, se venden las que quedaron pendientes
    return handlers.realState();
  },
  async realLock() { await chrome.storage.session.remove(REAL_SESSION); return handlers.realState(); },
  async realConfig({ config }) {
    const r = await realLoad();
    const next = cleanReal({ ...r.config, ...(config || {}) });
    // Apagar nunca espera: se guarda al momento.
    if (next.mode === 'off' && r.config.mode === 'auto') { await realPatch((x) => { x.config = { ...cleanReal({ ...x.config, ...(config || {}) }), mode: 'off' }; realLog(x, { kind: 'info', t: 'modo real apagado' }); }); return handlers.realState(); }
    if (next.mode === 'auto') {
      if (r.movedAt) throw new Error(tr('Esta wallet opera ahora desde la app de escritorio. Para usarla aquí, pulsa «Usarla aquí otra vez».'));
      const store = (await chrome.storage.local.get(BOT_KEY))[BOT_KEY] || {};
      if (!copilotGate(store).ok) throw new Error(tr('El modo real se desbloquea con {n} operaciones simuladas y resultado positivo.', { n: 20 }));
      if (!r.vault) throw new Error(tr('Primero crea la wallet del bot.'));
      if (!userKeys.helius) throw new Error(tr('Para operar con dinero real hace falta tu clave de Helius (Radar → Wallets que sigues).'));
    }
    await realPatch((x) => {
      const n = cleanReal({ ...x.config, ...(config || {}) });
      if (n.mode !== x.config.mode) realLog(x, { kind: 'info', t: n.mode === 'auto' ? 'modo real encendido' : 'modo real apagado' });
      x.config = n;
    });
    return handlers.realState();
  },
  // Botón de pánico: apaga el modo real y vende todo lo abierto.
  async realPanic() {
    // Apagar va primero y sin esperar a nada: cualquier compra en marcha lo verá antes de enviar.
    const list = await realPatch((r) => {
      r.config.mode = 'off';
      realLog(r, { kind: 'halt', t: 'pánico: modo real apagado, vendiendo todo' });
      for (const p of Object.values(r.positions)) p.sellPending = { reason: 'manual', nextAt: 0, tries: p.sellPending?.tries || 0 };
      return Object.values(r.positions);
    });
    for (const p of list) realRun(() => realSell({ addr: p.addr, symbol: p.symbol, reason: 'manual' })).catch(() => {});
    return handlers.realState();
  },
  async realSellOne({ addr }) {
    const r = await realLoad();
    const p = r.positions[addr];
    if (!p) return handlers.realState();
    await realRun(() => realSell({ addr, symbol: p.symbol, reason: 'manual' }));
    return handlers.realState();
  },
  // Retirar: solo a la dirección fijada al crear la wallet (tu Phantom).
  async realWithdraw({ sol, all, password }) {
    const r = await realLoad();
    if (!r.vault) throw new Error(tr('Aún no hay wallet del bot.'));
    const secret = await openVault(r.vault, password).catch(() => { throw new Error(tr('Contraseña incorrecta.')); });
    const kp = keypairFromSecret(secret);
    const bal = await lamportsOf(kp.address);
    const fee = 5000;
    // Con posiciones abiertas se deja una reserva para poder venderlas (comisiones y renta).
    const open = Object.keys(r.positions).length;
    const reserve = open ? 0.015 * LAMPORTS : 0;
    if (all && open) throw new Error(tr('Tiene posiciones abiertas: véndelas antes de retirarlo todo (o retira una cantidad).'));
    const lamports = all ? bal - fee : Math.floor(Number(sol) * LAMPORTS);
    if (!(lamports > 0) || lamports + fee + reserve > bal) throw new Error(open ? tr('Con posiciones abiertas hay que dejar 0,015 SOL para poder venderlas.') : tr('No hay saldo suficiente para retirar eso.'));
    const { blockhash } = (await rpc('getLatestBlockhash', [{ commitment: 'finalized' }])).value;
    const { tx } = signTransaction(transferTx({ from: kp.address, to: r.withdrawTo, lamports, blockhash }), kp);
    const sig = await sendAndConfirm(tx);
    // Lo retirado no es pérdida: se descuenta del punto de partida del día.
    await realPatch((x) => { if (x.day) x.day.start -= lamports; realLog(x, { kind: 'withdraw', sol: lamports / LAMPORTS, sig, t: 'retirado a tu wallet' }); });
    return handlers.realState();
  },
  // Exportar la clave (para importarla en Phantom si hiciera falta): pide la contraseña.
  async realExport({ password }) {
    const r = await realLoad();
    if (!r.vault) throw new Error(tr('Aún no hay wallet del bot.'));
    const secret = await openVault(r.vault, password).catch(() => { throw new Error(tr('Contraseña incorrecta.')); });
    return { backup: b58encode(secret) };
  },
  // Borrar la wallet del bot: solo si está vacía (o casi) y sin posiciones.
  async realDelete({ password }) {
    const r = await realLoad();
    if (!r.vault) return handlers.realState();
    await openVault(r.vault, password).catch(() => { throw new Error(tr('Contraseña incorrecta.')); });
    if (Object.keys(r.positions).length) throw new Error(tr('Tiene posiciones abiertas: véndelas antes.'));
    // Si no se puede comprobar el saldo, NO se borra: podría tener SOL dentro y se perderían.
    const bal = await lamportsOf(r.address).catch(() => { throw new Error(tr('No he podido comprobar el saldo (¿sin conexión?). No borro nada.')); });
    if (bal > 0.001 * LAMPORTS) throw new Error(tr('Aún tiene {v} SOL: retíralos antes de borrarla.', { v: fmtSol(bal / LAMPORTS) }));
    // Tampoco con tokens dentro (aunque Blankfire no los tenga apuntados).
    for (const programId of TOKEN_PROGRAMS) {
      const res = await rpc('getTokenAccountsByOwner', [r.address, { programId }, { encoding: 'jsonParsed' }]).catch(() => { throw new Error(tr('No he podido comprobar los tokens (¿sin conexión?). No borro nada.')); });
      if ((res?.value || []).some((a) => a.account?.data?.parsed?.info?.tokenAmount?.amount !== '0')) throw new Error(tr('Aún tiene tokens dentro: véndelos o pásalos a Phantom antes.'));
    }
    await chrome.storage.local.remove(REAL_KEY);
    await chrome.storage.session.remove(REAL_SESSION);
    return handlers.realState();
  },
});
