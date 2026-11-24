// Blankfire — service worker: única fuente de verdad de la cuenta ficticia,
// precios (DexScreener + Jupiter para tokens recién creados) y vigilancia de Take Profit / Stop Loss.
import {
  DEFAULT_SETTINGS, simulateBuy, simulateSell, positionPnl, uid, fmtSol, fmtPct, fmtCompact,
  realizedSince, startOfDay, REVIEW_TAGS, LAUNCH_DEXES, stopLevelPct, txCost, failCost,
} from './lib/core.js';
import { tr, setLang } from './lib/i18n.js';
import { analyzeCopies, analyzeChart } from './lib/shield.js';
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
let userKeys = { jupiter: '' };
chrome.storage.local.get(KEYS_KEY).then((g) => {
  const k = g[KEYS_KEY] || {};
  userKeys = { jupiter: k.jupiter || '' };
  if ('gemini' in k) chrome.storage.local.set({ [KEYS_KEY]: { jupiter: k.jupiter || '' } });   // ya no se usa: se borra
}).catch(() => {});
chrome.storage.onChanged.addListener((ch, area) => { if (area === 'local' && ch[KEYS_KEY]) userKeys = { jupiter: '', ...(ch[KEYS_KEY].newValue || {}) }; });

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
    const pools = await fetch(`${GT}/networks/solana/tokens/${mint}/pools?page=1`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(7000) }).then((r) => (r.ok ? r.json() : null));
    const pool = pools?.data?.[0]?.attributes?.address;
    if (!pool) return null;
    const o = await fetch(`${GT}/networks/solana/pools/${pool}/ohlcv/minute?aggregate=1&limit=90&currency=usd`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(7000) }).then((r) => (r.ok ? r.json() : null));
    return analyzeChart(o?.data?.attributes?.ohlcv_list || []);
  })();
  const [copies, chart] = await Promise.all([copiesP.catch(() => null), chartP.catch(() => null)]);
  const data = { copies, chart, at: Date.now() };
  shieldCache.set(mint, { at: Date.now(), data });
  if (shieldCache.size > 200) shieldCache.delete(shieldCache.keys().next().value);
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
  async saveKeys({ jupiter }) {
    const cur = { jupiter: '', ...((await chrome.storage.local.get(KEYS_KEY))[KEYS_KEY] || {}) };
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
    return { jupiter: !!cur.jupiter, check, checkedAt: cur.checkedAt || null };
  },
  async keysStatus() {
    const k = (await chrome.storage.local.get(KEYS_KEY))[KEYS_KEY] || {};
    const notice = (await chrome.storage.local.get(NOTICE_KEY))[NOTICE_KEY] || {};
    return { jupiter: !!k.jupiter, checkedAt: k.checkedAt || null, notice, ai: await aiOn() };
  },
  async afterData({ id }) { return afterData(id); },
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
