// Resistencia del bot: miles de vueltas con precios al azar (subidas, rugs, huecos sin precio, RugCheck caído)
// en los tres ritmos. Comprueba que las cuentas cuadran siempre y que nada revienta.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log((c ? 'OK  ' : 'FAIL') + ' ' + m); };
const ROOT = new URL('../Fogueo/', import.meta.url);
// Reloj y azar controlados: misma semilla, mismo resultado.
let seed = 42; const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
let clock = Date.UTC(2026, 10, 20, 9, 0); const realNow = Date.now;
Date.now = () => clock;
const SOL = 'So11111111111111111111111111111111111111112';
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const mint = (i) => { let s = ''; for (let k = 0; k < 40; k++) s += B58[(i * 7 + k * 13) % 58]; return s + 'pump'; };
const newCoins = () => Array.from({ length: 14 }, (_, i) => ({ addr: mint(i + 1), sym: 'C' + i, px: 0.0001 * (1 + rnd() * 9), liq: 30000 + rnd() * 150000, born: clock - (1 + rnd() * 40) * 3600e3, h1: 0, risk: rnd() < 0.25 }));
let coins = newCoins();
let rcDown = false, dsDown = false;
function step() {
  for (const c of coins) {
    const r = rnd();
    let m = (rnd() - 0.48) * 0.04;                 // ruido con leve deriva
    if (r < 0.004) m = -0.85;                       // rug
    else if (r < 0.012) m = 0.25 + rnd() * 0.4;     // pump
    c.px = Math.max(1e-9, c.px * (1 + m));
    c.h1 = Math.max(-95, Math.min(900, c.h1 * 0.97 + m * 100));
    if (m === -0.85) c.liq *= 0.1;
  }
}
const pairOf = (c) => ({ chainId: 'solana', dexId: 'pumpswap', pairAddress: 'P' + c.addr.slice(1), pairCreatedAt: c.born, baseToken: { address: c.addr, name: 'Coin ' + c.sym, symbol: c.sym }, quoteToken: { symbol: 'SOL' },
  priceUsd: String(c.px), liquidity: { usd: c.liq }, marketCap: c.px * 1e9, fdv: c.px * 1e9, volume: { m5: 5000 + rnd() * 30000, h1: 20000 + rnd() * 200000 },
  txns: { m5: { buys: 20 + Math.floor(rnd() * 80), sells: 10 + Math.floor(rnd() * 60) }, h1: { buys: 200 + Math.floor(rnd() * 400), sells: 100 + Math.floor(rnd() * 300) } },
  priceChange: { m5: (rnd() - 0.4) * 10, h1: c.h1 }, info: { websites: [{ url: 'https://x' }], socials: [{ type: 'twitter', url: 'https://x' }] } });
const json = (j, status = 200) => new Response(JSON.stringify(j), { status, headers: { 'content-type': 'application/json' } });
globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.includes('dexscreener')) {
    if (dsDown) throw new Error('red caída');
    if (u.includes('/token-boosts/')) return json(coins.slice(0, 10).map((c) => ({ chainId: 'solana', tokenAddress: c.addr })));
    if (u.includes('/token-profiles/')) return json(coins.slice(6).map((c) => ({ chainId: 'solana', tokenAddress: c.addr })));
    if (u.includes(SOL)) return json([{ chainId: 'solana', baseToken: { address: SOL }, quoteToken: { symbol: 'USDC' }, priceUsd: '180', liquidity: { usd: 9e6 }, priceChange: { h1: (rnd() - 0.5) * 3 } }]);
    if (u.includes('/search')) return json({ pairs: [] });
    const list = coins.filter((c) => u.includes(c.addr)).map(pairOf);
    return json(list);
  }
  if (u.includes('rugcheck')) {
    if (rcDown) return json({}, 503);
    const c = coins.find((x) => u.includes(x.addr));
    return json({ risks: c?.risk ? [{ name: 'Freeze Authority still enabled', level: 'danger', value: '' }] : [], score_normalised: c?.risk ? 80 : 5, lpLockedPct: 100 });
  }
  if (u.includes('geckoterminal')) {
    if (u.includes('/pools?')) { const c = coins.find((x) => u.includes(x.addr)); return json({ data: c ? [{ attributes: { address: 'P' + c.addr.slice(1) } }] : [] }); }
    if (u.includes('/ohlcv/')) { const c = coins.find((x) => u.includes(x.addr.slice(1))); const base = c ? c.px : 1; const rows = Array.from({ length: 60 }, (_, i) => { const p = base * (1 + (rnd() - 0.5) * 0.1); return [Math.floor(clock / 1000) - (60 - i) * 60, p, p * 1.02, p * 0.98, p * (1 + (rnd() - 0.5) * 0.02), 100 + rnd() * 900]; }); return json({ data: { attributes: { ohlcv_list: rows.reverse() } } }); }
    return json({}, 404);
  }
  if (u.includes('jup.ag')) return json({ inAmount: '1', outAmount: '1000000', priceImpactPct: '0.004', routePlan: [{ swapInfo: { label: 'Pump.fun Amm' } }] });
  return json({}, 404);
};
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bfsoak-'));
const { makeChrome } = await import(pathToFileURL(path.resolve('../desktop/shim.mjs')).href);
const manifest = JSON.parse(fs.readFileSync(new URL('manifest.json', ROOT), 'utf8'));
const eng = makeChrome({ dataDir: dir, baseUrl: 'blankfire://app/', manifest, notify: () => {}, broadcast: () => {} });
globalThis.chrome = eng.chrome; globalThis.BLANKFIRE_DESKTOP = true; globalThis.BLANKFIRE_TEST = true;
await import(new URL('background.js', ROOT).href);
const page = (msg) => eng.dispatch(msg, { id: 'blankfire-desktop', url: 'blankfire://app/bot/bot.html' });
await page({ type: 'saveSettings', settings: { lang: 'es' } });
const state = async () => (await page({ type: 'botState' })).data;

function check(s, label) {
  const open = Object.values(s.positions);
  const opened = open.reduce((a, p) => a + p.costSol, 0);
  const realized = s.closed.reduce((a, c) => a + c.pnlSol, 0);
  const expect = s.config.budgetSol - opened + realized;
  const errs = [];
  if (!(s.balance >= -1e-9)) errs.push('saldo negativo ' + s.balance);
  if (Math.abs(s.balance - expect) > 1e-6) errs.push(`saldo ${s.balance} ≠ ${expect}`);
  if (open.length > s.config.maxOpen) errs.push('más abiertas que el máximo');
  if (s.log.length > 400) errs.push('registro sin límite');
  if (s.closed.some((c) => !Number.isFinite(c.pnlSol) || !Number.isFinite(c.netSol))) errs.push('resultado no numérico');
  if (open.some((p) => !(p.costSol > 0) || !(p.qty > 0) || !(p.entryPrice > 0))) errs.push('posición rota');
  if (new Set(open.map((p) => p.addr)).size !== open.length) errs.push('misma moneda abierta dos veces');
  return errs;
}

for (const pace of ['calm', 'balanced', 'fast']) {
  await page({ type: 'botStop' });
  coins = newCoins();   // cada ritmo con un mercado nuevo
  const st = await page({ type: 'botStart', config: { budgetSol: 1, pace, usePace: true } });
  if (!st.ok) { ok(false, `${pace}: arranca (${st.error})`); continue; }
  const watch = { calm: 30, balanced: 15, fast: 5 }[pace] * 1000;
  const N = pace === 'fast' ? 2400 : 1200;
  let problems = [], thrown = 0, maxJson = 0;
  for (let i = 0; i < N; i++) {
    clock += watch; step();
    dsDown = i % 300 > 290;          // a ratos sin DexScreener
    rcDown = i % 500 > 470;          // a ratos sin RugCheck
    try { await globalThis.__bfTick(); } catch (e) { thrown++; if (thrown < 3) console.log('  error:', e.message); }
    if (i % 50 === 0) {
      const s = (await state()).session;
      const e = check(s, pace);
      if (e.length) problems.push(`vuelta ${i}: ${e.join('; ')}`);
      if (s.status === 'halted') break;
    }
  }
  await eng.flush();
  maxJson = fs.statSync(path.join(dir, 'storage.json')).size;
  const s = (await state()).session;
  const e = check(s, pace); if (e.length) problems.push('final: ' + e.join('; '));
  const exits = s.closed.reduce((a, c) => ((a[c.exit] = (a[c.exit] || 0) + 1), a), {});
  const fees = s.closed.reduce((a, c) => a + (c.feesSol || 0), 0);
  const vetoRisk = s.log.filter((l) => l.kind === 'skip' && l.agents?.safety?.veto).length;
  const why = {}; for (const l of s.log) { const k = l.kind + ':' + (l.reason?.t || l.stage || '').slice(0, 50); why[k] = (why[k] || 0) + 1; }
  if (process.env.BF_DEBUG) console.log(JSON.stringify(Object.entries(why).sort((a, b) => b[1] - a[1]).slice(0, 12)));
  console.log(`  ${pace}: ${s.closed.length} cerradas · salidas ${JSON.stringify(exits)} · saldo ${s.balance.toFixed(4)} · comisiones ${fees.toFixed(4)} · vetos de seguridad ${vetoRisk} · estado ${s.status} · ${Math.round(maxJson / 1024)} KB`);
  ok(thrown === 0, `${pace}: ninguna vuelta revienta en ${N} vueltas`);
  ok(s.log.filter((l) => l.kind === 'info').length < 60, `${pace}: los avisos repetidos no llenan el registro`);
  ok(problems.length === 0, `${pace}: las cuentas cuadran siempre ${problems.slice(0, 2).join(' | ')}`);
  ok(s.closed.length > 0, `${pace}: llega a operar`);
  ok(!s.closed.some((c) => coins.find((x) => x.addr === c.addr)?.risk), `${pace}: nunca compra una moneda con autoridad de congelar`);
  ok(maxJson < 3e6, `${pace}: lo guardado no crece sin límite (${Math.round(maxJson / 1024)} KB)`);
  const stops = s.closed.filter((c) => c.exit === 'stop');
  ok(stops.every((c) => c.ch <= -s.config.stopPct + 1e-9 || c.ch < 0), `${pace}: los stops salen en pérdida, nunca en ganancia`);
}
Date.now = realNow;
fs.rmSync(dir, { recursive: true, force: true });
console.log(fails ? `${fails} fallos` : 'TODO OK');
process.exit(fails ? 1 : 0);
