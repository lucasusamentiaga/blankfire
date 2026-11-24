// Blankfire — Escudo anti-rug (lógica pura, sin red ni DOM).
// Tres señales que Padre no da hechas: copias de monedas anteriores, gráficos típicos de rug y una
// nota de 0 a 100 que resume todo el chequeo. Los umbrales son orientativos: sirven para entrenar el ojo.

const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '');

// ---------- Copias ----------
// self: { address, name, symbol, createdAt (ms), mcUsd }
// pairs: pares de DexScreener (search). Devuelve las otras monedas con el mismo nombre o ticker en Solana.
export function analyzeCopies(self, pairs, now = Date.now()) {
  const sName = norm(self?.name), sSym = norm(self?.symbol);
  if (!sSym && !sName) return null;
  const byToken = new Map();
  for (const p of pairs || []) {
    if (p?.chainId !== 'solana') continue;
    const t = p.baseToken || {};
    if (!t.address || t.address === self.address) continue;
    const exactName = sName && norm(t.name) === sName;
    const sameSym = sSym && norm(t.symbol) === sSym;
    if (!exactName && !sameSym) continue;
    const prev = byToken.get(t.address);
    const fdv = Number(p.fdv || p.marketCap) || 0;
    const created = Number(p.pairCreatedAt) || null;
    if (!prev) byToken.set(t.address, { address: t.address, name: t.name, symbol: t.symbol, exactName, sameSym, fdv, createdAt: created });
    else { prev.fdv = Math.max(prev.fdv, fdv); if (created && (!prev.createdAt || created < prev.createdAt)) prev.createdAt = created; }
  }
  const list = [...byToken.values()];
  const selfAt = Number(self?.createdAt) || now;
  const mc = Number(self?.mcUsd) || 0;
  // Solo cuentan como «la original» las que existían antes que esta.
  const older = list.filter((c) => c.createdAt && c.createdAt < selfAt - 60_000);
  const twins = older.filter((c) => c.exactName && c.sameSym);
  const famous = older.filter((c) => (c.exactName || c.sameSym) && c.fdv >= Math.max(250_000, mc * 5));
  const today = list.filter((c) => c.createdAt && now - c.createdAt < 86_400_000 && (c.exactName || c.sameSym));
  const leader = !older.some((c) => c.fdv > mc);
  let level = 'ok', kind = 'unique';
  if (famous.length) { level = 'bad'; kind = 'famous'; }
  else if (today.length >= 3 && !leader) { level = 'warn'; kind = 'swarm'; }
  else if (twins.length && !leader) { level = 'warn'; kind = 'twin'; }
  else if (older.length || today.length) { level = 'ok'; kind = leader ? 'leader' : 'named'; }
  const top = [...famous, ...twins, ...older].sort((a, b) => b.fdv - a.fdv)[0] || null;
  return { level, kind, total: list.length, older: older.length, today: today.length, twins: twins.length, top };
}

// ---------- Gráfico ----------
// candles: [[t, open, high, low, close, volume], …] (GeckoTerminal), en cualquier orden.
export function analyzeChart(candles) {
  const c = (candles || []).filter((x) => Array.isArray(x) && x.length >= 5 && x.slice(1, 5).every((v) => Number(v) > 0))
    .map((x) => ({ t: Number(x[0]), o: +x[1], h: +x[2], l: +x[3], c: +x[4], v: Number(x[5]) || 0 }))
    .sort((a, b) => a.t - b.t);
  if (c.length < 6) return null;
  const signals = [];
  const peakI = c.reduce((m, x, i) => (x.h > c[m].h ? i : m), 0);
  const peak = c[peakI].h, last = c[c.length - 1].c;
  const fromPeak = (last / peak - 1) * 100;
  // 1) Ya se desplomó desde el máximo.
  if (fromPeak <= -70) signals.push({ id: 'dumped', level: 'bad', pct: fromPeak });
  else if (fromPeak <= -50) signals.push({ id: 'dumped', level: 'warn', pct: fromPeak });
  // 2) Una vela de un minuto que se come más del 50 % (liquidez retirada o venta enorme de golpe).
  let worst = null;
  for (const x of c) { const d = (x.c / x.o - 1) * 100; if (d <= -50 && (!worst || d < worst.pct)) worst = { pct: d, t: x.t }; }
  if (worst) signals.push({ id: 'rugCandle', level: 'bad', pct: worst.pct, t: worst.t });
  // 3) Pump & dump: ×4 en 5 velas o menos y luego pierde más del 60 % en otras 5.
  for (let i = 0; i < c.length; i++) {
    const lo = Math.min(...c.slice(Math.max(0, i - 5), i + 1).map((x) => x.l));
    if (c[i].h / lo < 4) continue;
    const after = c.slice(i + 1, i + 6);
    if (after.length && Math.min(...after.map((x) => x.l)) / c[i].h <= 0.4) { signals.push({ id: 'pumpDump', level: 'bad', mult: c[i].h / lo }); break; }
  }
  // 4) Volumen de bots: 10+ velas seguidas con casi el mismo volumen (coef. de variación < 8 %).
  const vols = c.slice(-20).map((x) => x.v).filter((v) => v > 0);
  if (vols.length >= 10) {
    const m = vols.reduce((a, b) => a + b, 0) / vols.length;
    const sd = Math.sqrt(vols.reduce((a, b) => a + (b - m) ** 2, 0) / vols.length);
    if (m > 0 && sd / m < 0.08) signals.push({ id: 'botVolume', level: 'warn' });
  }
  const level = signals.some((s) => s.level === 'bad') ? 'bad' : signals.length ? 'warn' : 'ok';
  return { level, signals, fromPeak, candles: c.length };
}

// ---------- Nota 0-100 ----------
// checks: los de screenToken (con level ok/warn/bad/na). Los críticos restan más.
const CRITICAL = new Set(['auth', 'copies', 'chart']);
export function shieldScore(checks) {
  let score = 100, known = 0;
  for (const ch of checks || []) {
    if (ch.level === 'na') continue;
    known++;
    if (ch.level === 'warn') score -= CRITICAL.has(ch.id) ? 14 : 9;
    else if (ch.level === 'bad') score -= CRITICAL.has(ch.id) ? 38 : 24;
  }
  if (known < 3) return null;
  return Math.max(0, Math.min(100, Math.round(score)));
}
export const scoreBand = (s) => (s == null ? 'na' : s >= 75 ? 'ok' : s >= 50 ? 'warn' : 'bad');

// Datos de la cabecera de pestañas de Padre: «Dev Tokens (8970)», «Holders (3772)».
export function parseCount(s) {
  const m = /\(?\s*([\d.,]+)\s*([KkMm]?)\s*\)?/.exec(String(s || ''));
  if (!m) return null;
  const n = parseFloat(m[1].replace(/,/g, ''));
  return Number.isFinite(n) ? Math.round(n * (/k/i.test(m[2]) ? 1e3 : /m/i.test(m[2]) ? 1e6 : 1)) : null;
}
