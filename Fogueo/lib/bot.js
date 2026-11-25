// Blankfire — Bot de práctica (lógica pura, sin red ni DOM).
// Cuatro agentes opinan por separado sobre cada moneda candidata y un ejecutor decide con límites duros.
// Todo en SOL ficticios con un saldo propio de sesión: nunca toca la cuenta del usuario ni una wallet real.
//
// Las notas de cada agente se guardan como { t: texto en español, v: variables } y se traducen al pintarlas,
// así el registro cambia de idioma con el resto de la extensión.

export const BOT_KEY = 'blankfireBot';
export const STOP_MIN = 6, STOP_MAX = 8;
export const RECAP_MS = 12 * 3600e3;
export const LOG_MAX = 400;

export const BOT_DEFAULTS = {
  budgetSol: 10,         // saldo fijo de la sesión (no se puede rellenar a mitad)
  sizePct: 10,           // cada entrada usa este % del saldo de la sesión
  maxOpen: 3,            // posiciones abiertas a la vez
  stopPct: 7,            // stop duro, siempre entre 6 % y 8 %
  tpPct: 40,             // recoge todo al +40 %
  trailArmPct: 15,       // a partir de +15 % activa el stop que sigue al precio…
  trailPct: 10,          // …que vende si cae un 10 % desde el máximo
  maxHoldMin: 45,        // si en 45 min no ha hecho nada (< +5 %), fuera
  maxLossPct: 25,        // si la sesión pierde un 25 %, el bot se para solo
  cooldownMin: 60,       // no repite la misma moneda en 1 h
  minScore: 0.3,         // nota mínima del consejo (de −1 a +1) para entrar
  maxImpactPct: 3,       // la ruta reduce el tamaño hasta mover el precio ≤ 3 %
  maxCostPct: 8,         // entrar y salir al momento no puede costar más de un 8 % (comisiones + impacto)
  // Restricciones: momentos en los que el bot no compra aunque vea algo bueno.
  maxLossStreak: 3,      // tras 3 pérdidas seguidas descansa…
  streakPauseMin: 30,    // …30 min (0 = sin descanso)
  solDropPct: 3,         // si SOL cae un 3 % en una hora, no compra (0 = no mirar)
  avoidBadHours: true,   // no compra en las horas en que el propio bot pierde de forma clara
  filters: {
    minLiqUsd: 15000,
    minMcUsd: 25000,
    maxMcUsd: 5000000,
    minAgeMin: 15,
    maxAgeH: 72,
    minVolH1Usd: 5000,
    maxH1Pct: 300,       // ya subió más de ×4 en la última hora: llegas tarde
    needSocials: true,
    needSafety: true,    // sin informe de seguridad (RugCheck) no compra
    minTxnsH1: 40,       // operaciones mínimas en la última hora
  },
};

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const num = (x) => (Number.isFinite(Number(x)) ? Number(x) : null);
const note = (t, v) => (v ? { t, v } : { t });
// Los números de las notas se guardan marcados y la ventana los formatea en el idioma de cada momento:
// «%+:12.5» → «+12,5 %» / «+12.5%», «%:12.5» sin signo, «$:15000» → «$15K», «S:1.25» → «1,25» SOL.
const pctTxt = (x, d = 0, signed = true) => `${signed ? '%+' : '%'}:${Math.round(x * 10 ** d) / 10 ** d}`;
const usdTxt = (x) => `$:${Math.round(x)}`;
const pctAbs = (x, d = 0) => pctTxt(x, d, false);

// Configuración saneada: lo que venga de la ventana nunca rompe los límites duros.
export function cleanConfig(c = {}) {
  const d = BOT_DEFAULTS, f = { ...d.filters, ...(c.filters || {}) };
  const n = (v, def, a, b) => { const x = Number(v); return Number.isFinite(x) ? clamp(x, a, b) : def; };
  return {
    budgetSol: n(c.budgetSol, d.budgetSol, 0.1, 1000),
    sizePct: n(c.sizePct, d.sizePct, 2, 25),
    maxOpen: Math.round(n(c.maxOpen, d.maxOpen, 1, 6)),
    stopPct: n(c.stopPct, d.stopPct, STOP_MIN, STOP_MAX),
    tpPct: n(c.tpPct, d.tpPct, 10, 300),
    trailArmPct: n(c.trailArmPct, d.trailArmPct, 5, 100),
    trailPct: n(c.trailPct, d.trailPct, 4, 30),
    maxHoldMin: Math.round(n(c.maxHoldMin, d.maxHoldMin, 5, 480)),
    maxLossPct: n(c.maxLossPct, d.maxLossPct, 5, 60),
    cooldownMin: Math.round(n(c.cooldownMin, d.cooldownMin, 5, 1440)),
    minScore: n(c.minScore, d.minScore, 0, 0.9),
    maxImpactPct: n(c.maxImpactPct, d.maxImpactPct, 0.5, 10),
    maxCostPct: n(c.maxCostPct, d.maxCostPct, 2, 15),
    maxLossStreak: Math.round(n(c.maxLossStreak, d.maxLossStreak, 0, 10)),
    streakPauseMin: Math.round(n(c.streakPauseMin, d.streakPauseMin, 0, 240)),
    solDropPct: n(c.solDropPct, d.solDropPct, 0, 20),
    avoidBadHours: c.avoidBadHours !== false,
    filters: {
      minLiqUsd: n(f.minLiqUsd, d.filters.minLiqUsd, 0, 1e8),
      minMcUsd: n(f.minMcUsd, d.filters.minMcUsd, 0, 1e10),
      maxMcUsd: n(f.maxMcUsd, d.filters.maxMcUsd, 1e4, 1e11),
      minAgeMin: n(f.minAgeMin, d.filters.minAgeMin, 0, 1440),
      maxAgeH: n(f.maxAgeH, d.filters.maxAgeH, 1, 24 * 365),
      minVolH1Usd: n(f.minVolH1Usd, d.filters.minVolH1Usd, 0, 1e9),
      maxH1Pct: n(f.maxH1Pct, d.filters.maxH1Pct, 20, 10000),
      needSocials: f.needSocials !== false,
      needSafety: f.needSafety !== false,
      minTxnsH1: Math.round(n(f.minTxnsH1, d.filters.minTxnsH1, 0, 100000)),
    },
  };
}

export function freshSession(config, now = Date.now()) {
  const cfg = cleanConfig(config);
  return {
    id: 's' + now.toString(36), startedAt: now, status: 'running', haltReason: null,
    config: cfg, balance: cfg.budgetSol, positions: {}, closed: [], log: [], recaps: [],
    lastScanAt: 0, lastRecapAt: now, seen: {}, stats: { scanned: 0, skipped: 0, buys: 0 },
  };
}

// ---------- Filtros: descartes rápidos antes de gastar peticiones en los agentes ----------
export function filterPair(pair, cfg, { now = Date.now(), held = {}, recent = {} } = {}) {
  const f = cfg.filters, why = [];
  const addr = pair?.baseToken?.address;
  if (pair?.chainId !== 'solana' || !addr) return [note('no es de Solana')];
  if (held[addr]) return [note('ya la tiene abierta')];
  if (recent[addr] && now - recent[addr] < cfg.cooldownMin * 60e3) return [note('la tocó hace poco (espera {m} min)', { m: cfg.cooldownMin })];
  const liq = num(pair.liquidity?.usd) || 0, mc = num(pair.marketCap ?? pair.fdv) || 0;
  const ageMin = pair.pairCreatedAt ? (now - pair.pairCreatedAt) / 60e3 : null;
  const volH1 = num(pair.volume?.h1) || 0, h1 = num(pair.priceChange?.h1);
  if (liq < f.minLiqUsd) why.push(note('liquidez {v} (mínimo {m})', { v: usdTxt(liq), m: usdTxt(f.minLiqUsd) }));
  if (mc < f.minMcUsd) why.push(note('market cap {v} (mínimo {m})', { v: usdTxt(mc), m: usdTxt(f.minMcUsd) }));
  if (mc > f.maxMcUsd) why.push(note('market cap {v} (máximo {m})', { v: usdTxt(mc), m: usdTxt(f.maxMcUsd) }));
  if (ageMin != null && ageMin < f.minAgeMin) why.push(note('tiene {m} min: demasiado nueva', { m: Math.max(0, Math.round(ageMin)) }));
  if (ageMin != null && ageMin > f.maxAgeH * 60) why.push(note('tiene más de {h} h', { h: f.maxAgeH }));
  if (volH1 < f.minVolH1Usd) why.push(note('volumen de la última hora {v}', { v: usdTxt(volH1) }));
  const tx1 = (+pair.txns?.h1?.buys || 0) + (+pair.txns?.h1?.sells || 0);
  if (pair.txns?.h1 && tx1 < f.minTxnsH1) why.push(note('solo {n} operaciones en una hora (mínimo {m})', { n: tx1, m: f.minTxnsH1 }));
  if (!(num(pair.priceUsd) > 0)) why.push(note('sin precio'));
  if (h1 != null && h1 > f.maxH1Pct) why.push(note('ya subió {v} en una hora: llega tarde', { v: pctTxt(h1) }));
  const info = pair.info || {};
  if (f.needSocials && !(info.socials?.length || info.websites?.length)) why.push(note('sin web ni redes'));
  return why;
}

// ---------- Agente 1 · Dinero inteligente ----------
// Mientras no sigamos wallets concretas (fase 4), lee el flujo de órdenes: quién compra, cuánto y con qué prisa.
export function smartsAgent(pair, { tracked = null, now = Date.now() } = {}) {
  const t5 = pair?.txns?.m5, t1 = pair?.txns?.h1;
  // Wallets que sigues (Radar): si alguna ha comprado hace poco, es la señal más fuerte que hay.
  const follow = tracked?.length ? note('{n}, que sigues, compró hace {m} min', { n: tracked[0].name || tracked[0].wallet.slice(0, 4) + '…', m: Math.max(0, Math.round((now - Math.max(...tracked.map((x) => x.at))) / 60e3)) }) : null;
  if (!t5 || !t1) return { id: 'smarts', score: follow ? 0.4 : null, notes: follow ? [follow] : [note('sin datos de operaciones')] };
  const b5 = +t5.buys || 0, s5 = +t5.sells || 0, b1 = +t1.buys || 0, s1 = +t1.sells || 0;
  const v5 = num(pair.volume?.m5) || 0, v1 = num(pair.volume?.h1) || 0;
  if (b1 + s1 < 20) return { id: 'smarts', score: follow ? 0.1 : -0.3, notes: [...(follow ? [follow] : []), note('solo {n} operaciones en una hora: nadie mira', { n: b1 + s1 })] };
  const r5 = b5 + s5 ? b5 / (b5 + s5) : 0.5, r1 = b1 / (b1 + s1);
  const avg = v1 / (b1 + s1), accel = v1 > 0 ? (v5 * 12) / v1 : 0;
  let score = 0; const notes = [];
  if (r5 >= 0.6) { score += 0.4; notes.push(note('{p} de las órdenes de 5 min son compras', { p: pctAbs(r5 * 100) })); }
  else if (r5 <= 0.42) { score -= 0.4; notes.push(note('dominan las ventas ({p} compras)', { p: pctAbs(r5 * 100) })); }
  if (avg >= 300 && r1 >= 0.55) { score += 0.3; notes.push(note('compras grandes: {v} de media', { v: usdTxt(avg) })); }
  else if (avg < 40) { score -= 0.2; notes.push(note('órdenes diminutas ({v} de media): huele a bots', { v: usdTxt(avg) })); }
  if (accel >= 1.5 && r5 > 0.5) { score += 0.3; notes.push(note('el volumen acelera (×{x} sobre la media de la hora)', { x: accel.toFixed(1) })); }
  else if (accel < 0.5) { score -= 0.3; notes.push(note('el volumen se apaga')); }
  if (follow) { score += 0.4; notes.unshift(follow); }
  if (!notes.length) notes.push(note('flujo neutro'));
  return { id: 'smarts', score: clamp(score, -1, 1), notes, data: { r5, r1, avg, accel } };
}

// ---------- Agente 2 · Tendencias ----------
const STOP_WORDS = new Set(['the', 'of', 'and', 'coin', 'token', 'sol', 'on', 'a', 'el', 'la', 'de', 'inu', 'ai']);
export const words = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w.length >= 3 && !STOP_WORDS.has(w));
// Temas que se repiten entre las monedas que están saliendo ahora (el «meta»).
export function metaWords(pairs) {
  const count = new Map();
  for (const p of pairs || []) for (const w of new Set([...words(p?.baseToken?.name), ...words(p?.baseToken?.symbol)])) count.set(w, (count.get(w) || 0) + 1);
  return count;
}
export function trendsAgent(pair, ctx = {}) {
  const addr = pair?.baseToken?.address;
  let score = 0; const notes = [];
  const h1 = num(pair?.priceChange?.h1), m5 = num(pair?.priceChange?.m5);
  if (h1 != null) {
    if (h1 >= 10 && h1 <= 150) { score += 0.3; notes.push(note('sube {v} en la última hora', { v: pctTxt(h1) })); }
    else if (h1 > 150) { score -= 0.2; notes.push(note('ya ha corrido mucho ({v} en 1 h)', { v: pctTxt(h1) })); }
    else if (h1 <= -30) { score -= 0.4; notes.push(note('cae {v} en la última hora', { v: pctTxt(h1) })); }
  }
  if (m5 != null && m5 <= -15) { score -= 0.3; notes.push(note('se desploma ahora mismo ({v} en 5 min)', { v: pctTxt(m5) })); }
  const meta = ctx.meta;
  if (meta) {
    const hot = [...new Set(words(pair?.baseToken?.name).concat(words(pair?.baseToken?.symbol)))].map((w) => [w, (meta.get(w) || 0) - 1]).filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1])[0];
    if (hot) { score += 0.3; notes.push(note('tema de moda: «{w}» ({n} monedas más)', { w: hot[0], n: hot[1] })); }
  }
  if (ctx.boosted?.has(addr)) { score += 0.1; notes.push(note('alguien paga por promocionarla en DexScreener')); }
  if (!notes.length) notes.push(note('sin tendencia clara'));
  return { id: 'trends', score: clamp(score, -1, 1), notes };
}

// ---------- Agente 3 · Debate (toro contra oso, con derecho a veto) ----------
export function debateAgent(pair, { smarts, trends, shield, safety, ind } = {}) {
  const bull = [], bear = []; let veto = null;
  // Lo que dicen Seguridad e Indicadores también entra en la discusión (y su veto manda).
  for (const a of [safety, ind]) { if (!a) continue; bull.push(...(a.bullW || [])); bear.push(...(a.bearW || [])); veto = veto || a.veto || null; }
  const liq = num(pair?.liquidity?.usd) || 0, mc = num(pair?.marketCap ?? pair?.fdv) || 0;
  const ratio = mc ? liq / mc : 0;
  if (ratio >= 0.12) bull.push([0.2, note('liquidez sana para su tamaño ({p} del market cap)', { p: pctAbs(ratio * 100) })]);
  else if (ratio < 0.05) bear.push([0.35, note('poca liquidez para su tamaño ({p} del market cap)', { p: pctAbs(ratio * 100, 1) })]);
  if (smarts?.score > 0.3) bull.push([0.3, note('el dinero entra con fuerza')]);
  if (smarts?.score < -0.2) bear.push([0.3, note('el dinero sale')]);
  if (trends?.score > 0.3) bull.push([0.25, note('va con la tendencia')]);
  if (trends?.score < -0.2) bear.push([0.25, note('va contra la tendencia')]);
  const info = pair?.info || {};
  if ((info.socials?.length || 0) + (info.websites?.length || 0) >= 2) bull.push([0.1, note('tiene web y redes')]);
  const ch = shield?.chart, cp = shield?.copies;
  if (ch?.level === 'bad') veto = note('el gráfico tiene dibujo de rug');
  else if (ch?.level === 'warn') bear.push([0.3, note('el gráfico enseña señales raras')]);
  if (cp?.level === 'bad') veto = veto || note('copia de una moneda famosa anterior');
  else if (cp?.level === 'warn') bear.push([0.25, note('hay copias con el mismo nombre')]);
  else if (cp?.kind === 'leader') bull.push([0.15, note('es la que va ganando entre las de su nombre')]);
  if (ratio > 0 && ratio < 0.02) veto = veto || note('liquidez ridícula: no podrías salir');
  const sum = (a) => a.reduce((s, [w]) => s + w, 0);
  const score = clamp(sum(bull) - sum(bear), -1, 1);
  return { id: 'debate', score: veto ? -1 : score, veto, bull: bull.map(([, n]) => n), bear: bear.map(([, n]) => n), notes: veto ? [veto] : [] };
}

// ---------- Agente 5 · Seguridad (informe de RugCheck) ----------
// rep: respuesta de /v1/tokens/{mint}/report/summary → { risks:[{name,value,level}], score_normalised, lpLockedPct }.
// Lo que puede vaciarte la cartera de golpe veta; lo demás pesa en contra.
const RISK_RULES = [
  [/mint authority/i, 'veto', 'pueden fabricar más tokens (autoridad de emisión activa)'],
  [/freeze authority/i, 'veto', 'pueden congelar tus tokens (autoridad de congelar activa)'],
  [/permanent delegate/i, 'veto', 'alguien puede mover tus tokens (delegado permanente)'],
  [/transfer fee|transfer tax/i, 'veto', 'cobra un impuesto oculto en cada transferencia'],
  [/rugged|history of rugged/i, 'veto', 'el creador ya ha hecho rug con otras monedas'],
  [/low liquidity/i, 'danger', 'liquidez muy baja según RugCheck'],
  [/single holder/i, 'holder', 'una sola wallet tiene {v} del suministro'],
  [/top 10|holder concentration|high ownership/i, 'bear', 'pocas wallets tienen casi todo el suministro'],
  [/lp unlocked|lp providers/i, 'bear', 'la liquidez no está bloqueada: la pueden retirar'],
  [/insider|bundle|sniper/i, 'bear', 'compras de gente de dentro al lanzar'],
  [/copycat/i, 'bear', 'RugCheck la marca como copia'],
  [/mutable metadata/i, 'soft', 'el creador puede cambiar nombre e imagen'],
];
export function safetyAgent(rep, { need = true } = {}) {
  const bullW = [], bearW = [], checks = []; let veto = null;
  if (!rep || !Array.isArray(rep.risks)) {
    const n = note('sin informe de seguridad (RugCheck no responde)');
    checks.push({ ok: null, n });
    if (need) veto = note('sin informe de seguridad: no compro a ciegas');
    return { id: 'safety', score: need ? -1 : null, veto, bullW, bearW, checks, notes: [veto || n] };
  }
  const seen = new Set();
  for (const r of rep.risks) {
    const rule = RISK_RULES.find(([re]) => re.test(r?.name || ''));
    const level = String(r?.level || '').toLowerCase();
    if (!rule) {
      const n = note('RugCheck avisa: «{r}»', { r: String(r?.name || '?').slice(0, 60) });
      if (level === 'danger') bearW.push([0.3, n]); else if (level === 'warn') bearW.push([0.1, n]);
      checks.push({ ok: false, n }); continue;
    }
    const [, kind, t] = rule;
    if (seen.has(t)) continue; seen.add(t);
    const pct = parseFloat(String(r.value || '').replace(',', '.'));
    const n = note(t, Number.isFinite(pct) ? { v: pctAbs(pct, 0) } : undefined);
    checks.push({ ok: false, n });
    if (kind === 'veto') veto = veto || n;
    else if (kind === 'danger') { if (level === 'danger') veto = veto || n; else bearW.push([0.3, n]); }
    else if (kind === 'holder') { if (pct >= 25 || level === 'danger') veto = veto || n; else bearW.push([0.25, n]); }
    else if (kind === 'bear') bearW.push([level === 'danger' ? 0.35 : 0.2, n]);
    else bearW.push([0.05, n]);
  }
  const sc = num(rep.score_normalised);
  if (sc != null) {
    if (sc >= 70) veto = veto || note('RugCheck la puntúa {s}/100 de riesgo', { s: Math.round(sc) });
    else if (sc >= 40) bearW.push([0.25, note('RugCheck la puntúa {s}/100 de riesgo', { s: Math.round(sc) })]);
  }
  const lp = num(rep.lpLockedPct);
  if (lp != null) {
    if (lp >= 90) { bullW.push([0.1, note('liquidez bloqueada o quemada ({p})', { p: pctAbs(lp) })]); checks.push({ ok: true, n: note('liquidez bloqueada o quemada ({p})', { p: pctAbs(lp) }) }); }
    else if (lp < 50 && !seen.has('la liquidez no está bloqueada: la pueden retirar')) { const n = note('solo {p} de la liquidez está bloqueada', { p: pctAbs(lp) }); bearW.push([0.3, n]); checks.push({ ok: false, n }); }
  }
  if (!rep.risks.some((r) => /mint authority/i.test(r?.name || ''))) checks.unshift({ ok: true, n: note('nadie puede fabricar más tokens') });
  if (!rep.risks.some((r) => /freeze authority/i.test(r?.name || ''))) checks.unshift({ ok: true, n: note('nadie puede congelar tus tokens') });
  if (!rep.risks.length) bullW.push([0.2, note('RugCheck no ve ningún riesgo')]);
  const score = veto ? -1 : clamp(bullW.reduce((a, [w]) => a + w, 0) - bearW.reduce((a, [w]) => a + w, 0), -1, 1);
  // Lo que se ve en su recuadro: los datos, no la discusión (esa está en el Debate).
  const facts = [];
  if (sc != null) facts.push(note('riesgo según RugCheck: {s}/100', { s: Math.round(sc) }));
  facts.push(note(rep.risks.length ? (rep.risks.length === 1 ? '1 aviso' : '{n} avisos') : 'sin avisos', { n: rep.risks.length }));
  if (lp != null) facts.push(note('liquidez bloqueada: {p}', { p: pctAbs(lp) }));
  return { id: 'safety', score, veto, bullW, bearW, checks, notes: facts };
}

// ---------- Agente 6 · Indicadores del gráfico (velas de 1 min) ----------
// ohlcv: filas [ts, open, high, low, close, volume] en cualquier orden.
export function rsi(closes, n = 14) {
  if (closes.length <= n) return null;
  let g = 0, l = 0;
  for (let i = 1; i <= n; i++) { const d = closes[i] - closes[i - 1]; if (d > 0) g += d; else l -= d; }
  g /= n; l /= n;
  for (let i = n + 1; i < closes.length; i++) { const d = closes[i] - closes[i - 1]; g = (g * (n - 1) + Math.max(0, d)) / n; l = (l * (n - 1) + Math.max(0, -d)) / n; }
  if (l === 0) return g === 0 ? 50 : 100;
  return 100 - 100 / (1 + g / l);
}
export function ema(xs, n) { if (!xs.length) return null; const k = 2 / (n + 1); let e = xs[0]; for (let i = 1; i < xs.length; i++) e = xs[i] * k + e * (1 - k); return e; }
export function indicators(ohlcv) {
  const rows = (ohlcv || []).filter((r) => Array.isArray(r) && r.length >= 6 && [1, 2, 3, 4, 5].every((i) => Number.isFinite(Number(r[i])))).map((r) => r.map(Number)).sort((a, b) => a[0] - b[0]);
  if (rows.length < 25) return null;
  const closes = rows.map((r) => r[4]), vols = rows.map((r) => r[5]);
  const last = closes.at(-1), high = Math.max(...rows.map((r) => r[2]));
  const recent = vols.slice(-5).reduce((a, b) => a + b, 0) / 5;
  const prior = vols.slice(-35, -5).slice().sort((a, b) => a - b);
  const med = prior.length ? prior[Math.floor(prior.length / 2)] : 0;
  const green = rows.slice(-5).filter((r) => r[4] >= r[1]).length;
  return { n: rows.length, rsi: rsi(closes), ema9: ema(closes.slice(-40), 9), ema21: ema(closes.slice(-60), 21), last, fromHigh: high > 0 ? (last / high - 1) * 100 : 0, volSpike: med > 0 ? recent / med : recent > 0 ? 3 : 0, green };
}
export function indicatorAgent(ind) {
  const bullW = [], bearW = [], checks = []; let veto = null;
  if (!ind) return { id: 'ind', score: null, veto, bullW, bearW, checks: [{ ok: null, n: note('sin velas suficientes para calcular indicadores') }], notes: [note('sin velas suficientes para calcular indicadores')] };
  const r = ind.rsi;
  if (r != null) {
    const n = note('RSI {v}', { v: Math.round(r) });
    if (r >= 85) { bearW.push([0.35, note('RSI {v}: sobrecomprada, suele corregir', { v: Math.round(r) })]); checks.push({ ok: false, n }); }
    else if (r >= 75) { bearW.push([0.15, note('RSI {v}: caliente', { v: Math.round(r) })]); checks.push({ ok: false, n }); }
    else if (r <= 25) { bearW.push([0.25, note('RSI {v}: cae sin freno (no cojas el cuchillo)', { v: Math.round(r) })]); checks.push({ ok: false, n }); }
    else if (r >= 50) { bullW.push([0.1, note('RSI {v}: fuerza sin pasarse', { v: Math.round(r) })]); checks.push({ ok: true, n }); }
    else checks.push({ ok: null, n });
  }
  if (ind.ema9 != null && ind.ema21 != null) {
    if (ind.ema9 > ind.ema21 && ind.last >= ind.ema21) { const n = note('media rápida sobre la lenta: tendencia de subida'); bullW.push([0.15, n]); checks.push({ ok: true, n }); }
    else if (ind.ema9 < ind.ema21 && ind.last < ind.ema21) { const n = note('media rápida bajo la lenta: tendencia de bajada'); bearW.push([0.2, n]); checks.push({ ok: false, n }); }
  }
  if (ind.volSpike >= 3 && ind.green >= 3) { const n = note('volumen ×{x} sobre lo normal con velas verdes', { x: ind.volSpike.toFixed(1) }); bullW.push([0.2, n]); checks.push({ ok: true, n }); }
  else if (ind.volSpike >= 3 && ind.green <= 1) { const n = note('volumen ×{x} con velas rojas: están vendiendo', { x: ind.volSpike.toFixed(1) }); bearW.push([0.3, n]); checks.push({ ok: false, n }); }
  else if (ind.volSpike < 0.4) { const n = note('el volumen se ha secado'); bearW.push([0.15, n]); checks.push({ ok: false, n }); }
  if (ind.fromHigh <= -50) { const n = note('está un {p} por debajo de su máximo reciente', { p: pctAbs(-ind.fromHigh) }); bearW.push([0.3, n]); checks.push({ ok: false, n }); }
  else if (ind.fromHigh >= -8 && (r == null || r < 85)) { const n = note('cerca de su máximo reciente'); bullW.push([0.05, n]); checks.push({ ok: true, n }); }
  const score = clamp(bullW.reduce((a, [w]) => a + w, 0) - bearW.reduce((a, [w]) => a + w, 0), -1, 1);
  const facts = [];
  if (r != null) facts.push(note('RSI (14): {v}', { v: Math.round(r) }));
  if (ind.ema9 != null && ind.ema21 != null) facts.push(note(ind.ema9 >= ind.ema21 ? 'medias 9/21: subiendo' : 'medias 9/21: bajando'));
  facts.push(note('volumen reciente: ×{x} lo normal', { x: ind.volSpike.toFixed(1) }));
  facts.push(note('distancia al máximo: {p}', { p: pctTxt(ind.fromHigh, Math.abs(ind.fromHigh) < 10 ? 1 : 0) }));
  return { id: 'ind', score, veto, bullW, bearW, checks, notes: facts };
}

// ---------- Restricciones: cuándo no se compra aunque haya algo bueno ----------
// Horas en las que el propio bot pierde de forma clara (al menos 4 operaciones, saldo negativo y < 35 % de aciertos).
export function badHours(closed, tzOffsetMin = 0) {
  const by = new Map();
  for (const c of closed || []) {
    if (!Number.isFinite(c?.closedAt) || !Number.isFinite(c?.pnlSol)) continue;
    const h = new Date((c.openedAt || c.closedAt) - tzOffsetMin * 60e3).getUTCHours();
    const b = by.get(h) || { n: 0, w: 0, pnl: 0 }; b.n++; if (c.pnlSol > 0) b.w++; b.pnl += c.pnlSol; by.set(h, b);
  }
  return [...by].filter(([, b]) => b.n >= 4 && b.pnl < 0 && b.w / b.n < 0.35).map(([h]) => h).sort((a, b) => a - b);
}
export function guardrails(session, { now = Date.now(), solH1 = null, tzOffsetMin = 0, pastClosed = [] } = {}) {
  const c = session.config;
  if (c.maxLossStreak > 0 && c.streakPauseMin > 0) {
    let streak = 0, lastAt = 0;
    for (let i = session.closed.length - 1; i >= 0 && session.closed[i].pnlSol < 0; i--) { streak++; lastAt = Math.max(lastAt, session.closed[i].closedAt); }
    if (streak >= c.maxLossStreak && now - lastAt < c.streakPauseMin * 60e3) return note('{n} pérdidas seguidas: descansa {m} min antes de volver a comprar', { n: streak, m: Math.ceil((c.streakPauseMin * 60e3 - (now - lastAt)) / 60e3) });
  }
  if (c.solDropPct > 0 && Number.isFinite(solH1) && solH1 <= -c.solDropPct) return note('SOL cae {v} en una hora: con el mercado en contra no compra', { v: pctTxt(solH1, 1) });
  if (c.avoidBadHours) {
    const hours = badHours([...pastClosed, ...session.closed], tzOffsetMin);
    const h = new Date(now - tzOffsetMin * 60e3).getUTCHours();
    if (hours.includes(h)) return note('a esta hora ({h}:00) el bot pierde de forma clara: no compra', { h });
  }
  return null;
}

// Repaso final antes de comprar: todo lo que se ha mirado, en una lista de sí / no.
export function checklist({ pair, safety, ind, router, smarts, trends }, cfg) {
  const out = [];
  const liq = num(pair?.liquidity?.usd) || 0, mc = num(pair?.marketCap ?? pair?.fdv) || 0;
  out.push({ ok: true, n: note('pasa los filtros (liquidez {l}, market cap {m})', { l: usdTxt(liq), m: usdTxt(mc) }) });
  for (const c of safety?.checks || []) out.push(c);
  for (const c of ind?.checks || []) out.push(c);
  if (smarts?.score != null) out.push({ ok: smarts.score > 0 ? true : smarts.score < 0 ? false : null, n: note('flujo de órdenes') });
  if (trends?.score != null) out.push({ ok: trends.score > 0 ? true : trends.score < 0 ? false : null, n: note('tendencia') });
  if (router) out.push({ ok: !!router.ok, n: router.ok && router.costPct != null ? note('ida y vuelta {v} (máximo {m})', { v: pctAbs(router.costPct, 1), m: pctAbs(cfg.maxCostPct) }) : router.notes?.[0] || note('ruta') });
  return out;
}

// ---------- Agente 4 · Ruta y slippage ----------
// simulateBuy viene de core.js (mismo modelo de impacto que el panel). jup: cotización de Jupiter si la hay.
export function routerAgent({ quote, sizeSol, solUsd, settings, cfg, simulateBuy, simulateSell, jup }) {
  let size = sizeSol, sim = null;
  for (let i = 0; i < 8; i++) {
    sim = simulateBuy({ solIn: size, quote, solUsd, settings: { ...settings, maxSlippagePct: 99 } });
    if (!sim || !(sim.qty > 0)) break;
    if (sim.impactPct <= cfg.maxImpactPct || size <= 0.02) break;
    size = Math.max(0.02, size * 0.7);
  }
  if (!sim || !(sim.qty > 0)) return { id: 'router', ok: false, score: null, notes: [note('sin precio para calcular la ruta')] };
  if (sim.impactPct > cfg.maxImpactPct) return { id: 'router', ok: false, score: -1, notes: [note('ni con la entrada mínima baja de {v} de impacto', { v: pctAbs(sim.impactPct, 1) })] };
  // Ida y vuelta al mismo precio: lo que se pierde solo por comisiones, coste por transacción e impacto.
  let costPct = null;
  if (simulateSell) {
    const back = simulateSell({ qty: sim.qty, quote, solUsd, settings: { ...settings, sellSlippagePct: 99 } });
    if (Number.isFinite(back?.netSol) && sim.totalDebit > 0) costPct = (1 - back.netSol / sim.totalDebit) * 100;
  }
  if (costPct != null && costPct > cfg.maxCostPct) {
    return { id: 'router', ok: false, score: -1, costPct, notes: [note('entrar y salir costaría un {v} solo en comisiones: con este tamaño no compensa', { v: pctAbs(costPct, 1) })] };
  }
  const vol = Math.abs(num(quote?.change?.m5) || 0);
  const slip = clamp(Math.ceil(sim.slipPct * 1.5 + vol / 2 + 3), 5, 25);
  const route = jup?.route || (quote?.stage === 'new' ? 'curva de lanzamiento' : quote?.dex || 'pool');
  const notes = [note('entrada de {s} SOL, impacto {i}', { s: `S:${Math.round(size * 1e4) / 1e4}`, i: pctAbs(sim.impactPct, 2) }), note('slippage máximo {v} · ruta: {r}', { v: pctAbs(slip), r: route })];
  if (costPct != null) notes.push(note('ida y vuelta: {v} en comisiones e impacto', { v: pctAbs(costPct, 1) }));
  if (size < sizeSol * 0.99) notes.unshift(note('reduce la entrada para no mover el precio'));
  if (jup?.impactPct != null && Math.abs(jup.impactPct - sim.impactPct) > 2) notes.push(note('Jupiter calcula {v} de impacto', { v: pctAbs(jup.impactPct, 1) }));
  return { id: 'router', ok: true, score: 0, sizeSol: size, slipPct: slip, impactPct: sim.impactPct, costPct, route, notes };
}

// ---------- Ejecutor: junta los votos y decide ----------
export const WEIGHTS = { smarts: 0.35, trends: 0.25, debate: 0.4 };
export function councilScore({ smarts, trends, debate }) {
  let s = 0, w = 0;
  for (const [k, a] of Object.entries({ smarts, trends, debate })) if (a && a.score != null) { s += a.score * WEIGHTS[k]; w += WEIGHTS[k]; }
  return w ? s / w : null;
}
export function decide({ smarts, trends, debate, router }, cfg) {
  const score = councilScore({ smarts, trends, debate });
  if (debate?.veto) return { action: 'skip', score: -1, reason: debate.veto };
  if (score == null) return { action: 'skip', score, reason: note('los agentes no tienen datos suficientes') };
  if (score < cfg.minScore) return { action: 'skip', score, reason: note('nota del consejo {s} (mínimo {m})', { s: score.toFixed(2), m: cfg.minScore.toFixed(2) }) };
  if (!router?.ok) return { action: 'skip', score, reason: router?.notes?.[0] || note('sin ruta') };
  return { action: 'buy', score, reason: note('nota del consejo {s}', { s: score.toFixed(2) }) };
}

// Tamaño de la siguiente entrada: % del saldo de la sesión, nunca más de lo que queda.
export function entrySize(session) {
  const eq = session.config.budgetSol;
  return Math.min(session.balance, Math.max(0.02, (eq * session.config.sizePct) / 100));
}

// ---------- Gestión de cada posición abierta ----------
// pos: { entryPrice, peak, openedAt }. Devuelve el motivo de salida o null.
export function exitReason(pos, price, cfg, now = Date.now()) {
  if (!(price > 0) || !(pos?.entryPrice > 0)) return null;
  const ch = (price / pos.entryPrice - 1) * 100;
  const peak = Math.max(pos.peak || pos.entryPrice, price);
  const fromPeak = (price / peak - 1) * 100;
  const peakCh = (peak / pos.entryPrice - 1) * 100;
  if (ch <= -cfg.stopPct + 1e-9) return { id: 'stop', ch };
  if (ch >= cfg.tpPct - 1e-9) return { id: 'tp', ch };
  if (peakCh >= cfg.trailArmPct && fromPeak <= -cfg.trailPct) return { id: 'trail', ch };
  if (now - pos.openedAt > cfg.maxHoldMin * 60e3 && ch < 5) return { id: 'time', ch };
  return null;
}
export const EXIT_TEXT = {
  stop: 'stop duro ({v})', tp: 'objetivo cumplido ({v})', trail: 'el precio se dio la vuelta desde el máximo ({v})',
  time: 'no se movió en {m} min ({v})', halt: 'sesión parada ({v})', manual: 'cerrada a mano ({v})',
};

// Valor de la sesión: saldo libre + lo que darían las abiertas si se vendieran ahora (valueSol[k], en SOL).
export function sessionEquity(session, valueSol = {}) {
  let v = session.balance;
  for (const [k, p] of Object.entries(session.positions)) v += Number.isFinite(valueSol[k]) ? valueSol[k] : (p.valueSol ?? p.costSol);
  return v;
}

// Pérdida máxima de la sesión: si se pasa, el bot se para (y no vuelve a arrancar solo).
export function lossHit(session, equity) {
  return (equity / session.config.budgetSol - 1) * 100 <= -session.config.maxLossPct;
}

// ---------- Registro ----------
export function pushLog(session, entry, now = Date.now()) {
  session.log.push({ at: now, ...entry });
  if (session.log.length > LOG_MAX) session.log.splice(0, session.log.length - LOG_MAX);
}

// ---------- Resumen de 12 horas ----------
export function makeRecap(session, from, to) {
  const closed = session.closed.filter((c) => c.closedAt >= from && c.closedAt < to);
  const pnl = closed.reduce((s, c) => s + c.pnlSol, 0);
  const wins = closed.filter((c) => c.pnlSol > 0).length;
  const reasons = new Map();
  session.log.filter((l) => l.at >= from && l.at < to && l.kind === 'skip' && l.reason).forEach((l) => {
    const r = reasons.get(l.reason.t) || { t: l.reason.t, v: l.reason.v, n: 0 };
    r.n++; reasons.set(l.reason.t, r);
  });
  const topSkips = [...reasons.values()].sort((a, b) => b.n - a.n).slice(0, 3);
  const exits = {};
  closed.forEach((c) => { exits[c.exit] = (exits[c.exit] || 0) + 1; });
  const best = closed.slice().sort((a, b) => b.pnlPct - a.pnlPct)[0] || null;
  const worst = closed.slice().sort((a, b) => a.pnlPct - b.pnlPct)[0] || null;
  const scanned = session.log.filter((l) => l.at >= from && l.at < to && (l.kind === 'skip' || l.kind === 'buy')).length;
  return {
    from, to, trades: closed.length, wins, losses: closed.length - wins, pnlSol: pnl,
    winRate: closed.length ? wins / closed.length : null, best: best && { symbol: best.symbol, pnlPct: best.pnlPct },
    worst: worst && { symbol: worst.symbol, pnlPct: worst.pnlPct }, exits, topSkips, scanned,
    balance: session.balance, open: Object.keys(session.positions).length,
  };
}

// ---------- Fase 5 · Copiloto con dinero real ----------
// El bot no firma ni toca ninguna wallet: cuando decide comprar o vender en la simulación, te avisa con
// tamaño, slippage y stop para que lo hagas tú en Padre (con una wallet aparte y poco saldo).
// Se desbloquea solo cuando la simulación ha demostrado algo: suficientes operaciones y resultado positivo tras comisiones.
export const COPILOT_UNLOCK = { trades: 20, netSol: 0 };
export const COPILOT_DEFAULTS = { on: false, maxSol: 0.1, maxPerDay: 5, ttlMin: 3 };

export function cleanCopilot(c = {}) {
  const n = (v, d, a, b) => { const x = Number(v); return Number.isFinite(x) ? Math.min(b, Math.max(a, x)) : d; };
  return {
    on: c.on === true,
    maxSol: n(c.maxSol, COPILOT_DEFAULTS.maxSol, 0.01, 5),
    maxPerDay: Math.round(n(c.maxPerDay, COPILOT_DEFAULTS.maxPerDay, 1, 30)),
    ttlMin: Math.round(n(c.ttlMin, COPILOT_DEFAULTS.ttlMin, 1, 15)),
  };
}

// Todas las operaciones simuladas cerradas (sesión actual y anteriores guardadas).
export function copilotGate(store) {
  const s = store?.session;
  let trades = (store?.past || []).reduce((a, p) => a + (p.trades || 0), 0);
  let net = (store?.past || []).reduce((a, p) => a + ((p.balance ?? p.budgetSol) - p.budgetSol), 0);
  if (s) {
    trades += s.closed.length;
    net += s.closed.reduce((a, c) => a + c.pnlSol, 0);
  }
  const ok = trades >= COPILOT_UNLOCK.trades && net > COPILOT_UNLOCK.netSol;
  return { ok, trades, net, need: Math.max(0, COPILOT_UNLOCK.trades - trades) };
}

// Señales enviadas hoy (para el límite diario).
export function signalsToday(signals, now = Date.now()) {
  const d = new Date(now); d.setHours(0, 0, 0, 0);
  return (signals || []).filter((x) => x.kind === 'buy' && x.at >= d.getTime()).length;
}
