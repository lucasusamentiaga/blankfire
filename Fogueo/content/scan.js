// Blankfire — lee las métricas de seguridad que Padre ya muestra (Trenches y página del token),
// las recuerda por moneda y marca cada tarjeta de Trenches con el resultado del chequeo.
import { readAuditRow, screenToken, screenRisks, checkShort, VERDICT, parseUsd } from '../lib/screen.js';
import { tr } from '../lib/i18n.js';

const SOL_RE = /([1-9A-HJ-NP-Za-km-z]{32,44})/;
const STORE = 'blankfireScreen';
const MAX = 300;
const cache = new Map();          // mint → { ...facts, at }
let dirty = false;
let opts = { badges: true, rigor: 'normal' };
const sigs = new WeakMap();       // fila → firma de lo último pintado
const taxQueue = new Map();       // key → % de comisión del token según Padre, pendiente de enviar
const taxSent = new Map();

export function cachedFacts(mint) { return mint ? cache.get(mint) || null : null; }
export function setScanOptions(o) {
  const changed = o.badges !== opts.badges || o.rigor !== opts.rigor;
  opts = { ...opts, ...o };
  if (changed) { document.querySelectorAll('[data-fx-chk]').forEach((n) => n.remove()); scan(); }
}

// Sube desde la fila «Audit» hasta la tarjeta entera (el contenedor más alto con una sola fila).
function cardOf(row) {
  let card = row;
  for (let i = 0; i < 14 && card.parentElement; i++) {
    if (card.parentElement.querySelectorAll('[aria-label="Audit"]').length > 1) break;
    card = card.parentElement;
  }
  return card;
}
function mintOf(card) {
  for (const a of card.querySelectorAll('a[href]')) {
    const h = a.getAttribute('href') || '';
    if (!/pump\.fun\/coin\/|\/trade\/solana\/|[?&]q=|solscan|birdeye|dexscreener/i.test(h)) continue;
    const m = h.match(SOL_RE);
    if (m) return m[1];
  }
  return null;
}
function mcOf(card) {
  const lines = (card.innerText || '').split('\n').map((x) => x.trim());
  const i = lines.indexOf('MC');
  return i >= 0 ? parseUsd(lines[i + 1]) : null;
}

function badge(res) {
  const host = document.createElement('span');
  host.setAttribute('data-fx-chk', '');
  host.style.cssText = 'display:inline-flex;flex:none;align-self:center;margin-right:6px;';
  const root = host.attachShadow({ mode: 'open' });
  const tone = { good: '#5ddf8c', care: '#f2c14e', avoid: '#f47b6b', unknown: '#9a9ba0' }[res.verdict];
  const label = tr(VERDICT[res.verdict].short);
  root.innerHTML = `<style>
    :host{all:initial}
    b{display:inline-flex;align-items:center;gap:5px;height:22px;padding:0 8px 0 7px;border-radius:999px;
      font:600 11px/1 system-ui,sans-serif;letter-spacing:.01em;color:${tone};background:color-mix(in oklab, ${tone} 14%, transparent);
      box-shadow:inset 0 0 0 1px color-mix(in oklab, ${tone} 38%, transparent);white-space:nowrap;cursor:help}
    i{width:6px;height:6px;border-radius:50%;background:${tone}}
  </style><b part="chip"><i></i>${label}</b>`;
  const bad = screenRisks(res);
  const warn = res.checks.filter((c) => c.level === 'warn').map(checkShort).filter(Boolean);
  host.title = `Blankfire · ${tr(VERDICT[res.verdict].label)}`
    + (bad.length ? `\n${tr('Peligro')}: ${bad.join(', ')}` : '')
    + (warn.length ? `\n${tr('Ojo')}: ${warn.join(', ')}` : '')
    + (res.verdict === 'good' ? `\n${tr('Top 10, dev, snipers, insiders y bundles en niveles sanos')}` : '');
  // Que el clic no abra la tarjeta de Padre.
  host.addEventListener('click', (e) => { e.stopPropagation(); e.preventDefault(); }, true);
  return host;
}

function scan() {
  if (document.hidden) return;
  const rows = document.querySelectorAll('[aria-label="Audit"]');
  for (const row of rows) {
    const card = cardOf(row);
    const mint = mintOf(card);
    const facts = readAuditRow(row);
    if (facts.top10 == null && facts.dev == null && facts.snipers == null) continue;
    const mcUsd = mcOf(card);
    if (mcUsd != null) facts.mcUsd = mcUsd;
    if (mint && facts.taxPct != null) taxQueue.set(`solana:${mint}`, facts.taxPct);
    if (mint) {
      const prev = cache.get(mint);
      const next = { ...facts, at: Date.now() };
      if (!prev || JSON.stringify({ ...prev, at: 0 }) !== JSON.stringify({ ...next, at: 0 })) dirty = true;
      cache.delete(mint); cache.set(mint, next);
    }
    const existing = row.querySelector(':scope > [data-fx-chk]');
    if (!opts.badges) { existing?.remove(); continue; }
    const res = screenToken(facts, { rigor: opts.rigor });
    // Sin datos suficientes (tokens de segundos) no etiquetamos: sería ruido.
    if (res.verdict === 'unknown') { existing?.remove(); sigs.delete(row); continue; }
    const sig = `${res.verdict}|${screenRisks(res).join()}|${res.warn}`;
    if (existing && sigs.get(row) === sig) continue;
    existing?.remove();
    // Al principio de la fila: al final la tapa el botón de compra rápida de Padre en tarjetas estrechas.
    row.prepend(badge(res));
    sigs.set(row, sig);
  }
  while (cache.size > MAX) cache.delete(cache.keys().next().value);
}

function flushTax() {
  const items = [];
  for (const [key, pct] of taxQueue) if (taxSent.get(key) !== pct) { items.push({ key, pct }); taxSent.set(key, pct); }
  taxQueue.clear();
  if (!items.length) return;
  try { chrome.runtime.sendMessage({ type: 'padreTax', items: items.slice(0, 60) })?.catch?.(() => {}); } catch { /* extensión recargada */ }
}

async function persist() {
  flushTax();
  if (!dirty) return;
  dirty = false;
  try { await chrome.storage.local.set({ [STORE]: Object.fromEntries(cache) }); } catch { /* sin espacio o contexto cerrado */ }
}

let started = false;
export async function startScan(o = {}) {
  if (started) return;
  started = true;
  opts = { ...opts, ...o };
  try {
    const saved = (await chrome.storage.local.get(STORE))[STORE] || {};
    for (const [k, v] of Object.entries(saved)) if (!cache.has(k) && Date.now() - (v?.at || 0) < 6 * 3600e3) cache.set(k, v);
  } catch { /* primera vez */ }
  scan();
  setInterval(scan, 1500);
  setInterval(persist, 10000);
}
