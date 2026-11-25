// Blankfire — Radar (lógica pura): temas de moda, ballenas en directo y patrones de wallets.
import { words } from './bot.js';

const SOL_MINT = 'So11111111111111111111111111111111111111112';
const num = (x) => (Number.isFinite(Number(x)) ? Number(x) : 0);

// ---------- Temas de moda ----------
// pairs: mejores pares de DexScreener de las monedas que están saliendo. prev: foto anterior { word: n }.
export function themes(pairs, prev = {}, { min = 3, max = 12 } = {}) {
  const by = new Map();
  for (const p of pairs || []) {
    const ws = new Set([...words(p?.baseToken?.name), ...words(p?.baseToken?.symbol)]);
    for (const w of ws) {
      if (!by.has(w)) by.set(w, []);
      by.get(w).push(p);
    }
  }
  const out = [];
  for (const [w, list] of by) {
    if (list.length < min) continue;
    const h1 = list.map((p) => num(p.priceChange?.h1));
    const vol = list.reduce((a, p) => a + num(p.volume?.h1), 0);
    const best = list.slice().sort((a, b) => num(b.marketCap ?? b.fdv) - num(a.marketCap ?? a.fdv))[0];
    out.push({
      word: w, n: list.length, prevN: prev[w] ?? null, delta: prev[w] != null ? list.length - prev[w] : null,
      avgH1: h1.reduce((a, b) => a + b, 0) / h1.length, up: h1.filter((x) => x > 0).length, volH1: vol,
      leader: best && { symbol: best.baseToken.symbol, address: best.baseToken.address, mc: num(best.marketCap ?? best.fdv), h1: num(best.priceChange?.h1) },
      coins: list.slice().sort((a, b) => num(b.volume?.h1) - num(a.volume?.h1)).slice(0, 6).map((p) => ({ symbol: p.baseToken.symbol, address: p.baseToken.address, mc: num(p.marketCap ?? p.fdv), h1: num(p.priceChange?.h1) })),
    });
  }
  // Primero lo que más crece desde la foto anterior; después por número de monedas y volumen.
  out.sort((a, b) => (b.delta ?? 0) - (a.delta ?? 0) || b.n - a.n || b.volH1 - a.volH1);
  // Si dos palabras son el mismo grupo de monedas («pepe» y «frog» siempre juntas), queda una.
  const kept = [];
  for (const t of out) {
    const set = new Set(t.coins.map((c) => c.address));
    if (kept.some((k) => k.coins.filter((c) => set.has(c.address)).length >= Math.min(set.size, k.coins.length) * 0.8)) continue;
    kept.push(t);
    if (kept.length >= max) break;
  }
  return kept;
}
export const snapshotOf = (list) => Object.fromEntries(list.map((t) => [t.word, t.n]));

// ---------- Ballenas en directo (operaciones de GeckoTerminal de un pool) ----------
// trades: data[] de /pools/{pool}/trades. Grande = ≥ minUsd o ≥ 1 % de la liquidez.
export function whaleTape(trades, { minUsd = 500, liqUsd = 0, tracked = {}, now = Date.now() } = {}) {
  const rows = (trades || []).map((t) => {
    const a = t.attributes || t;
    return { at: Date.parse(a.block_timestamp), side: a.kind === 'sell' ? 'sell' : 'buy', usd: num(a.volume_in_usd), wallet: a.tx_from_address || '', tx: a.tx_hash || '', price: num(a.kind === 'sell' ? a.price_from_in_usd : a.price_to_in_usd) };
  }).filter((r) => r.at > 0 && r.usd > 0).sort((a, b) => b.at - a.at);
  const bigCut = Math.max(minUsd, liqUsd * 0.01);
  const count = new Map();
  rows.forEach((r) => count.set(r.wallet, (count.get(r.wallet) || 0) + 1));
  const big = rows.filter((r) => r.usd >= bigCut || tracked[r.wallet]).map((r) => ({ ...r, repeat: count.get(r.wallet) || 1, tracked: tracked[r.wallet] || null }));
  const flow = (mins) => {
    const w = rows.filter((r) => now - r.at <= mins * 60e3);
    const b = w.filter((r) => r.side === 'buy').reduce((a, r) => a + r.usd, 0), s = w.filter((r) => r.side === 'sell').reduce((a, r) => a + r.usd, 0);
    const bb = w.filter((r) => r.usd >= bigCut && r.side === 'buy').reduce((a, r) => a + r.usd, 0), bs = w.filter((r) => r.usd >= bigCut && r.side === 'sell').reduce((a, r) => a + r.usd, 0);
    return { buys: b, sells: s, net: b - s, bigNet: bb - bs, n: w.length };
  };
  // Wallets que reparten la compra en muchas órdenes (o que entran y salen sin parar).
  const busy = [...count.entries()].filter(([, n]) => n >= 5).map(([wallet, n]) => {
    const own = rows.filter((r) => r.wallet === wallet);
    const net = own.reduce((a, r) => a + (r.side === 'buy' ? r.usd : -r.usd), 0);
    return { wallet, n, net };
  }).sort((a, b) => b.n - a.n).slice(0, 5);
  return { big: big.slice(0, 60), cut: bigCut, f5: flow(5), f15: flow(15), f60: flow(60), busy, total: rows.length, oldest: rows.at(-1)?.at || null };
}

// ---------- Wallets que sigues (historial de Helius) ----------
// Convierte las transacciones mejoradas de Helius en compras/ventas de esa wallet.
export function parseSwaps(txs, wallet) {
  const out = [];
  for (const tx of txs || []) {
    if (!tx || tx.transactionError) continue;
    const acc = (tx.accountData || []).find((a) => a.account === wallet);
    let sol = acc ? num(acc.nativeBalanceChange) / 1e9 : 0;
    const tok = new Map();
    for (const t of tx.tokenTransfers || []) {
      const amt = num(t.tokenAmount);
      const delta = (t.toUserAccount === wallet ? amt : 0) - (t.fromUserAccount === wallet ? amt : 0);
      if (!delta) continue;
      if (t.mint === SOL_MINT) sol += delta;   // SOL envuelto cuenta como SOL
      else tok.set(t.mint, (tok.get(t.mint) || 0) + delta);
    }
    for (const [mint, d] of tok) {
      if (d > 0 && sol < 0) out.push({ at: tx.timestamp * 1000, side: 'buy', mint, qty: d, sol: -sol, sig: tx.signature });
      else if (d < 0 && sol > 0) out.push({ at: tx.timestamp * 1000, side: 'sell', mint, qty: -d, sol, sig: tx.signature });
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

// Agrupa por moneda: lo invertido, lo recuperado, cuándo entró y salió. Una moneda es «cerrada» si vendió ≥ 90 %.
export function walletRounds(trades, { solUsd = 0, supply = 1e9 } = {}) {
  const by = new Map();
  for (const t of trades) {
    const r = by.get(t.mint) || { mint: t.mint, in: 0, out: 0, bought: 0, sold: 0, first: t.at, last: t.at, buys: 0, sells: 0 };
    if (t.side === 'buy') { r.in += t.sol; r.bought += t.qty; r.buys++; } else { r.out += t.sol; r.sold += t.qty; r.sells++; }
    r.last = t.at;
    by.set(t.mint, r);
  }
  return [...by.values()].map((r) => {
    const closed = r.bought > 0 && r.sold >= r.bought * 0.9;
    // Market cap al entrar: para monedas de pump.fun (1.000 millones de unidades) sale de precio × cantidad.
    const entryPx = r.bought > 0 ? r.in / r.bought : 0;
    return { ...r, closed, pnl: r.out - r.in, pnlPct: r.in > 0 ? (r.out / r.in - 1) * 100 : null, hold: r.last - r.first, entryMcUsd: solUsd > 0 && entryPx > 0 ? entryPx * supply * solUsd : null };
  }).sort((a, b) => b.last - a.last);
}

const median = (xs) => { const a = xs.filter(Number.isFinite).sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : null; };
// Patrón de una wallet: dónde entra, cuánto aguanta, cuánto acierta y cuánto arriesga.
export function walletProfile(rounds) {
  const closed = rounds.filter((r) => r.closed && r.in > 0);
  const wins = closed.filter((r) => r.pnl > 0);
  const p = {
    tokens: rounds.length, closed: closed.length, wins: wins.length,
    winRate: closed.length ? (wins.length / closed.length) * 100 : null,
    net: closed.reduce((a, r) => a + r.pnl, 0),
    medIn: median(rounds.map((r) => r.in)), medHold: median(closed.map((r) => r.hold)),
    medEntryMc: median(rounds.map((r) => r.entryMcUsd)),
    avgWinPct: wins.length ? wins.reduce((a, r) => a + r.pnlPct, 0) / wins.length : null,
    avgLossPct: closed.length - wins.length ? closed.filter((r) => r.pnl <= 0).reduce((a, r) => a + r.pnlPct, 0) / (closed.length - wins.length) : null,
    open: rounds.filter((r) => !r.closed && r.bought > 0).length,
  };
  p.notes = [];
  if (p.closed >= 5) {
    if (p.medEntryMc) p.notes.push({ t: 'Suele entrar con market cap de unos {mc}.', v: { mc: `$:${Math.round(p.medEntryMc)}` } });
    if (p.medHold != null) p.notes.push({ t: 'Aguanta unos {d} de media.', v: { d: `D:${p.medHold}` } });
    if (p.avgWinPct != null && p.avgLossPct != null) p.notes.push({ t: 'Cuando gana, gana un {w}; cuando pierde, pierde un {l}.', v: { w: `%+:${Math.round(p.avgWinPct)}`, l: `%+:${Math.round(p.avgLossPct)}` } });
    if (p.winRate != null && p.winRate < 40 && p.net > 0) p.notes.push({ t: 'Acierta poco pero sus ganadoras pagan las perdedoras: corta rápido y deja correr.' });
    if (p.winRate != null && p.winRate >= 60 && p.avgWinPct != null && p.avgWinPct < 40) p.notes.push({ t: 'Acierta mucho con ganancias pequeñas: entra y sale rápido.' });
  }
  return p;
}

// Compras recientes de las wallets que sigues: { mint: [{ wallet, name, at, sol }] }, para el bot y el panel.
export function recentBuys(walletData, { since = Date.now() - 30 * 60e3 } = {}) {
  const out = {};
  for (const w of walletData || []) for (const t of w.trades || []) {
    if (t.side !== 'buy' || t.at < since) continue;
    (out[t.mint] ||= []).push({ wallet: w.address, name: w.name || null, at: t.at, sol: t.sol });
  }
  return out;
}
