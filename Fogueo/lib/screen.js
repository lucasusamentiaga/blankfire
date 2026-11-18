// Blankfire — chequeo de seguridad de una memecoin (lógica pura + lectura del DOM de Padre).
// Criterios: top 10, dev, snipers, insiders, bundles, liquidez y autoridades del token.
// Los umbrales son orientativos: sirven para practicar a filtrar, no garantizan nada.
import { tr, getLang } from './i18n.js';

// ---------- Umbrales ----------
// Cada criterio: hasta `ok` → bien; hasta `warn` → ojo; por encima → peligro.
// Rigor: 'strict' aprieta un 25 % y 'loose' afloja un 25 %.
const BASE = {
  top10: { ok: 30, warn: 45 },
  dev: { ok: 5, warn: 15 },
  snipers: { ok: 5, warn: 15 },
  insiders: { ok: 10, warn: 20 },
};
// El bundle se tolera más cuanto más pequeño es el token: a 5-10K de MC un 20-30 % es normal,
// pero si la moneda crece y el bundle sigue ahí, cada vez es más peligroso.
export function bundleLimits(mcUsd) {
  if (!(mcUsd > 0) || mcUsd < 15000) return { ok: 30, warn: 40 };
  if (mcUsd < 60000) return { ok: 10, warn: 20 };
  return { ok: 5, warn: 12 };
}
// Liquidez frente al market cap, solo para tokens con pool propio (en la curva de pump.fun
// la «liquidez» la pone la propia curva y siempre se puede vender contra ella).
export const LIQ = { okRatio: 10, warnRatio: 4, minUsd: 3000 };

const FACTOR = { strict: 0.75, normal: 1, loose: 1.25 };
const scale = (lim, rigor) => {
  const f = FACTOR[rigor] || 1;
  return { ok: Math.round(lim.ok * f * 10) / 10, warn: Math.round(lim.warn * f * 10) / 10 };
};
const grade = (v, lim) => (v <= lim.ok ? 'ok' : v <= lim.warn ? 'warn' : 'bad');
const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

// ---------- Lectura de textos de Padre ----------
// «66%» → 66 · «> 27.0%» → 27 · «-» → null · «0.3%» → 0.3
export function parsePct(s) {
  const m = String(s ?? '').replace(',', '.').match(/(\d+(?:\.\d+)?)\s*%/);
  return m ? Number(m[1]) : null;
}
// «23•9%» → { n: 23, pct: 9 }
export function parseSnipers(s) {
  const m = String(s ?? '').replace(/\s/g, '').replace(',', '.').match(/^(\d+)[•·.](\d+(?:\.\d+)?)%$/);
  return m ? { n: Number(m[1]), pct: Number(m[2]) } : null;
}
// Pastilla del dev en Trenches: «21%3mo», «0%2h», «DS1mo» (dev sold: ya vendió todo).
const AGE = '\\d+(?:s|m|h|d|w|mo|y)';
const DEV_RE = new RegExp(`^(DS|\\d+(?:\\.\\d+)?%)\\s*(${AGE})?$`, 'i');
export function parseDev(s) {
  const t = String(s ?? '').replace(/\s+/g, '').replace(',', '.');
  const m = t.match(DEV_RE);
  if (!m || (!m[2] && !/^DS$/i.test(m[1]))) return null;
  return /^DS$/i.test(m[1]) ? { pct: 0, sold: true } : { pct: Number(m[1].replace('%', '')), sold: false };
}
// «$73.0K» → 73000
export function parseUsd(s) {
  const m = String(s ?? '').replace(/[,\s]/g, '').match(/\$?(\d+(?:\.\d+)?)([KMB])?/i);
  if (!m) return null;
  return Number(m[1]) * ({ K: 1e3, M: 1e6, B: 1e9 }[(m[2] || '').toUpperCase()] || 1);
}

// Fila «Audit» de una tarjeta de Trenches (Pulse). Padre etiqueta tres pastillas con aria-label;
// el dev y los bundles van sin etiqueta: el dev lleva la edad de su wallet y el bundle es solo un %.
// La pastilla de la comisión (tax) no tiene la clase «_outer_» de las demás y la saltamos.
export function readAuditRow(row) {
  const f = {};
  if (!row) return f;
  const kids = [...row.children];
  const isPill = (el) => /(^|\s)_outer_/.test(String(el.className || '')) && !/tax/i.test(el.outerHTML.slice(0, 400));
  for (const el of kids) {
    const label = el.getAttribute('aria-label') || '';
    const text = (el.textContent || '').trim();
    if (/^top 10/i.test(label)) f.top10 = parsePct(text);
    else if (/sniper/i.test(label)) { const s = parseSnipers(text); if (s) { f.snipersN = s.n; f.snipers = s.pct; } }
    else if (/insider/i.test(label)) f.insiders = parsePct(text);
    else if (/dev/i.test(label)) { const d = parseDev(text) || { pct: parsePct(text), sold: false }; f.dev = d.pct; f.devSold = d.sold; }
    else if (/bundl/i.test(label)) f.bundles = parsePct(text);
    else if (!label && /tax/i.test(el.outerHTML.slice(0, 600)) && /^\d+(?:\.\d+)?%$/.test(text)) f.taxPct = parsePct(text);
    else if (!label && isPill(el)) {
      const d = parseDev(text);
      if (d && f.dev == null) { f.dev = d.pct; f.devSold = d.sold; }
      else if (/^\d+(?:\.\d+)?%$/.test(text) && f.bundles == null) f.bundles = parsePct(text);
    }
  }
  return f;
}

// Bloque «Token Data & Security» de la página de un token: cada valor va justo encima de su etiqueta.
const DATA_LABELS = [
  [/^top 10/i, 'top10'], [/^dev hold/i, 'dev'], [/^bundl/i, 'bundles'], [/^snipers?/i, 'snipers'],
  [/^insiders?/i, 'insiders'], [/^mint auth/i, 'mintAuth'], [/^freeze auth/i, 'freezeAuth'],
];
export function readTokenData(doc) {
  const f = {};
  if (!doc?.querySelectorAll) return f;
  const leaves = [...doc.querySelectorAll('body *')].filter((n) => n.childElementCount === 0 && n.textContent && n.textContent.length < 24);
  for (const n of leaves) {
    const t = n.textContent.trim();
    const hit = DATA_LABELS.find(([re]) => re.test(t));
    if (!hit || f[hit[1]] !== undefined) continue;
    const box = n.parentElement;
    if (!box) continue;
    const lines = (box.innerText || box.textContent || '').split('\n').map((x) => x.trim()).filter((x) => x && x !== t);
    if (lines.length !== 1) continue;
    const v = lines[0];
    if (hit[1] === 'mintAuth' || hit[1] === 'freezeAuth') { if (/^(yes|no)$/i.test(v)) f[hit[1]] = /^yes$/i.test(v); }
    else if (hit[1] === 'snipers') { const s = parseSnipers(v); f.snipers = s ? s.pct : parsePct(v); if (s) f.snipersN = s.n; }
    else f[hit[1]] = v === '-' ? null : parsePct(v);
  }
  // Comisión real del token («Buy Tax» de Padre: curva, pool, conversión del par…).
  const tax = doc.querySelector?.('[aria-label="Buy Tax"]');
  if (tax) { const v = parsePct(tax.textContent); if (v != null) f.taxPct = v; }
  // Liquidez y MC de la cabecera de Padre («Liquidity / $73.0K»).
  for (const n of leaves) {
    const t = n.textContent.trim();
    if (t !== 'Liquidity' && t !== 'Market cap') continue;
    const lines = (n.parentElement?.parentElement?.innerText || '').split('\n').map((x) => x.trim());
    const v = parseUsd(lines[lines.indexOf(t) + 1]);
    if (v != null) f[t === 'Liquidity' ? 'liqUsd' : 'mcUsd'] = v;
  }
  return f;
}

// Mezcla datos de varias fuentes: los primeros mandan si tienen valor.
export function mergeFacts(...list) {
  const out = {};
  for (const f of list) for (const [k, v] of Object.entries(f || {})) if (out[k] == null && v != null) out[k] = v;
  return out;
}

// ---------- Puntuación ----------
// facts: { top10, dev, devSold, snipers, snipersN, insiders, bundles, liqUsd, mcUsd, curve, mintAuth, freezeAuth }
export function screenToken(facts = {}, { rigor = 'normal' } = {}) {
  const f = facts || {};
  const checks = [];
  const add = (id, value, level, extra = {}) => checks.push({ id, value, level, ...extra });
  const pctCheck = (id) => {
    const v = num(f[id]);
    if (v == null) return add(id, null, 'na');
    const lim = scale(BASE[id], rigor);
    add(id, v, grade(v, lim), { lim });
  };
  pctCheck('top10');
  {
    const v = num(f.dev);
    if (v == null) add('dev', null, 'na');
    else { const lim = scale(BASE.dev, rigor); add('dev', v, grade(v, lim), { lim, sold: !!f.devSold }); }
  }
  {
    const v = num(f.snipers);
    if (v == null) add('snipers', null, 'na');
    else { const lim = scale(BASE.snipers, rigor); add('snipers', v, grade(v, lim), { lim, n: num(f.snipersN) }); }
  }
  pctCheck('insiders');
  {
    const v = num(f.bundles);
    const lim = scale(bundleLimits(num(f.mcUsd)), rigor);
    if (v == null) add('bundles', null, 'na', { lim });
    else add('bundles', v, grade(v, lim), { lim });
  }
  {
    const liq = num(f.liqUsd), mc = num(f.mcUsd);
    if (f.curve) add('liq', liq, 'ok', { curve: true });
    else if (liq == null || !(mc > 0)) add('liq', liq, 'na');
    else {
      const ratio = (liq / mc) * 100;
      const fct = FACTOR[rigor] || 1;
      const okR = LIQ.okRatio / fct, warnR = LIQ.warnRatio / fct;
      const level = liq < LIQ.minUsd || ratio < warnR ? 'bad' : ratio < okR ? 'warn' : 'ok';
      add('liq', liq, level, { ratio, mc, okR, warnR });
    }
  }
  if (f.mintAuth != null || f.freezeAuth != null) {
    const bad = f.mintAuth === true || f.freezeAuth === true;
    add('auth', null, bad ? 'bad' : 'ok', { mint: f.mintAuth ?? null, freeze: f.freezeAuth ?? null });
  }
  const count = (l) => checks.filter((c) => c.level === l).length;
  const ok = count('ok'), warn = count('warn'), bad = count('bad');
  const known = ok + warn + bad;
  // Top 10 al 0 % no existe en una moneda real: Padre aún no tiene los datos (tokens de segundos).
  const early = num(f.top10) === 0;
  const verdict = bad > 0 ? 'avoid' : known < 3 || early ? 'unknown' : warn >= 2 ? 'care' : 'good';
  return { checks, ok, warn, bad, known, verdict };
}

// Resumen corto de lo peligroso, para el aviso de la revisión: «dev 25 %, bundle 34 %».
export function screenRisks(res) {
  return (res?.checks || []).filter((c) => c.level === 'bad').map((c) => checkShort(c)).filter(Boolean);
}

// ---------- Textos ----------
const p = (v) => { const t = `${Math.round(v * 10) / 10} %`; return getLang() === 'en' ? t.replace(' %', '%') : t.replace('.', ','); };
const money = (v) => (v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `$${(v / 1e3).toFixed(v >= 1e5 ? 0 : 1)}K` : `$${Math.round(v)}`);

export const VERDICT = {
  good: { label: 'Pinta bien', short: 'Bien' },
  care: { label: 'Con cuidado', short: 'Ojo' },
  avoid: { label: 'Evitar', short: 'Evitar' },
  unknown: { label: 'Faltan datos', short: '¿?' },
};

export function checkName(id) {
  return tr({ top10: 'Top 10 holders', dev: 'Dev', snipers: 'Snipers dentro', insiders: 'Insiders', bundles: 'Bundles', liq: 'Liquidez', auth: 'Autoridades' }[id] || id);
}

export function checkShort(c) {
  if (c.value == null && c.id !== 'auth' && !c.curve) return '';
  switch (c.id) {
    case 'top10': return tr('top 10 {v}', { v: p(c.value) });
    case 'dev': return c.sold ? tr('dev vendió') : tr('dev {v}', { v: p(c.value) });
    case 'snipers': return tr('snipers {v}', { v: p(c.value) });
    case 'insiders': return tr('insiders {v}', { v: p(c.value) });
    case 'bundles': if (c.generic) return tr('Varias wallets que compraron juntas en la misma transacción al lanzarse, casi siempre del mismo dueño. A 5-15K de market cap un 20-30 % es normal; si la moneda sube y el bundle no se limpia (no vende), cada vez es más peligroso, porque puede venderlo todo de golpe.');
      return tr('bundle {v}', { v: p(c.value) });
    case 'liq': return c.curve ? tr('en curva') : tr('liquidez {v} del MC', { v: p(c.ratio) });
    case 'auth': return c.mint ? tr('puede crear más tokens') : c.freeze ? tr('puede congelar wallets') : tr('autoridades revocadas');
    default: return '';
  }
}

export function checkValue(c) {
  if (c.id === 'auth') return c.mint || c.freeze ? tr('Activas') : tr('Revocadas');
  if (c.id === 'liq') return c.curve ? tr('Curva') : c.value == null ? '—' : money(c.value);
  if (c.value == null) return '—';
  if (c.id === 'dev' && c.sold) return tr('Vendió');
  if (c.id === 'snipers' && c.n != null) return `${c.n} · ${p(c.value)}`;
  return p(c.value);
}

// Explicación de cada criterio con el umbral que se ha usado.
export function checkWhy(c) {
  const L = c.lim || {};
  switch (c.id) {
    case 'top10': return tr('Lo que tienen las 10 wallets más grandes. Por encima del {warn} pueden hundir el precio vendiendo a la vez; lo sano es menos del {ok}.', { ok: p(L.ok ?? 30), warn: p(L.warn ?? 45) });
    case 'dev': return c.sold ? tr('El creador ya vendió todo: no puede tirar el precio con su saco, aunque tampoco apuesta por su moneda.') : tr('Lo que conserva el creador. Con más del {warn} puede vender encima de ti cuando quiera; lo ideal es menos del {ok}.', { ok: p(L.ok ?? 5), warn: p(L.warn ?? 15) });
    case 'snipers': return tr('Bots que compraron en el primer bloque y siguen dentro. Si aún tienen más del {warn}, venderán en cuanto suba. 0 % = ya vendieron.', { warn: p(L.warn ?? 15) });
    case 'insiders': return tr('Wallets ligadas al creador o que compraron con información. Por encima del {warn} es mala señal; lo sano es menos del {ok}.', { ok: p(L.ok ?? 10), warn: p(L.warn ?? 20) });
    case 'bundles': return tr('Varias wallets que compraron juntas en la misma transacción, casi siempre del mismo dueño. Con este market cap, más del {warn} es peligroso: si no se limpia mientras sube, puede venderlo todo de golpe.', { warn: p(L.warn ?? 30) });
    case 'liq': return c.curve
      ? tr('Aún está en la curva de pump.fun: el precio lo marca la curva y siempre se puede vender contra ella.')
      : tr('El dinero real del pool para comprarte lo que vendes. Lo sano es al menos un {ok} del market cap; con menos del {warn}, o menos de $3K, vender mueve mucho el precio o es imposible.', { ok: p(c.okR ?? 10), warn: p(c.warnR ?? 4) });
    case 'auth': return tr('Si el creador conserva la autoridad de «mint» puede fabricar tokens nuevos, y con la de «freeze» puede congelar tu wallet para que no vendas.');
    default: return '';
  }
}

// Umbrales efectivos con un rigor dado (para la tabla de Ajustes).
export function screenLimits(rigor = 'normal') {
  const f = FACTOR[rigor] || 1;
  return {
    top10: scale(BASE.top10, rigor), dev: scale(BASE.dev, rigor), snipers: scale(BASE.snipers, rigor), insiders: scale(BASE.insiders, rigor),
    bundlesSmall: scale(bundleLimits(5000), rigor), bundlesMid: scale(bundleLimits(30000), rigor), bundlesBig: scale(bundleLimits(100000), rigor),
    liq: { ok: Math.round((LIQ.okRatio / f) * 10) / 10, warn: Math.round((LIQ.warnRatio / f) * 10) / 10 },
  };
}
export { p as fmtScreenPct };

// Preset de ejecución activo en Padre (barra de compra: «P1 0.001 0.01 20% On»)
// y su versión completa con compra y venta (fila oculta «P1 Buy 0.001 0.01 20% On Sell 0.001 0.01 40% On»).
export function readPadrePreset(doc) {
  if (!doc?.querySelectorAll) return null;
  const leaves = (el) => [...el.querySelectorAll('*')].filter((n) => n.childElementCount === 0).map((n) => n.textContent.trim()).filter(Boolean);
  const num = (t) => (/^\d+(?:\.\d+)?$/.test(t) ? Number(t) : null);
  const parseRun = (arr) => {
    const [prio, tip, slip, mev] = arr;
    const o = { prio: num(prio), tip: num(tip), slip: parsePct(slip), mev: /^on$/i.test(mev || '') ? true : /^off$/i.test(mev || '') ? false : null };
    return o.prio != null && o.tip != null && o.slip != null ? o : null;
  };
  const tags = [...doc.querySelectorAll('body *')].filter((n) => n.childElementCount === 0 && /^P[1-3]$/.test(n.textContent.trim()));
  let active = null;
  for (const t of tags) {
    const r = t.getBoundingClientRect?.();
    if (!r || !r.width) continue;
    let box = t.parentElement;
    for (let i = 0; i < 3 && box; i++, box = box.parentElement) {
      const l = leaves(box);
      if (l[0] === t.textContent.trim() && l.length >= 5 && l.length <= 7) { const run = parseRun(l.slice(1, 5)); if (run) { active = { id: l[0], buy: run }; break; } }
    }
    if (active) break;
  }
  if (!active) return null;
  // Venta del mismo preset (fila de ajustes, aunque esté oculta).
  for (const t of tags) {
    if (t.textContent.trim() !== active.id) continue;
    let box = t.parentElement;
    for (let i = 0; i < 3 && box; i++, box = box.parentElement) {
      const l = leaves(box);
      const si = l.indexOf('Sell');
      if (l[0] === active.id && l.includes('Buy') && si > 0) { const run = parseRun(l.slice(si + 1, si + 5)); if (run) active.sell = run; break; }
    }
    if (active.sell) break;
  }
  return active;
}
