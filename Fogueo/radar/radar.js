// Blankfire — Radar: temas de moda, ballenas en directo y wallets que sigues.
import { tr, setLang, getLang, locale } from '../lib/i18n.js';
import { fmtSol, fmtPct, fmtCompact, fmtDuration } from '../lib/core.js';
import { parseSwaps, walletRounds, walletProfile } from '../lib/radar.js';
import { pagesNav } from '../lib/pages-nav.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const send = (msg) => new Promise((res) => chrome.runtime.sendMessage(msg, (r) => res(r || { ok: false, error: chrome.runtime.lastError?.message })));
const tone = (n) => (n > 0 ? 'up' : n < 0 ? 'down' : 'flat');
const short = (a) => (a ? `${a.slice(0, 4)}…${a.slice(-4)}` : '');
const HELIUS_ORIGIN = 'https://mainnet.helius-rpc.com/*';

const S = {
  themes: null, themesErr: null, themesBusy: false, openTheme: null,
  mint: '', tape: null, tapeErr: null, tapeBusy: false,
  wallets: null, wBusy: false, openWallet: null,
};

// Números marcados por lib/radar.js («$:12000», «%+:40», «D:ms»).
function fmtVar(v) {
  const m = /^(%\+|%|\$|D):(-?[\d.]+)$/.exec(String(v));
  if (!m) return esc(tr(String(v)));
  const n = Number(m[2]);
  if (m[1] === '$') return esc(fmtCompact(n, '$'));
  if (m[1] === 'D') return esc(fmtDuration(n));
  return esc(fmtPct(n, 0, { sign: m[1] === '%+' }));
}
const say = (n) => (n.v ? tr(n.t, Object.fromEntries(Object.entries(n.v).map(([k, v]) => [k, fmtVar(v)]))) : esc(tr(n.t)));
const ago = (t) => (t ? tr('hace {t}', { t: fmtDuration(Math.max(0, Date.now() - t)) }) : '');
const clock = (t) => new Date(t).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit', second: '2-digit' });

// ---------- Temas de moda ----------
async function loadThemes(force) {
  S.themesBusy = true; render();
  const r = await send({ type: 'radarThemes', force });
  S.themesBusy = false;
  if (r.ok) { S.themes = r.data; S.themesErr = null; } else S.themesErr = r.error;
  render();
}
function themesBlock() {
  const t = S.themes;
  const head = `<header class="sec-h"><h2>${tr('Temas de moda')}</h2>
    <span class="muted sm">${t ? tr('{n} monedas mirando ahora · {a}', { n: t.coins, a: ago(t.at) }) : ''}</span>
    <button class="btn small" data-act="themes" ${S.themesBusy ? 'disabled' : ''}>${tr(S.themesBusy ? 'Mirando…' : 'Actualizar')}</button></header>
    <p class="hint">${tr('Palabras que se repiten en los nombres de las monedas que están saliendo ahora. Cuando un tema crece, salen copias: las primeras suelen ir mejor que las últimas.')}</p>`;
  if (S.themesErr) return `<section class="blk">${head}<p class="empty err">${esc(S.themesErr)}</p></section>`;
  if (!t) return `<section class="blk">${head}<p class="empty">${tr('Cargando…')}</p></section>`;
  if (!t.themes.length) return `<section class="blk">${head}<p class="empty">${tr('Ahora mismo no se repite ningún tema en 3 monedas o más.')}</p></section>`;
  const rows = t.themes.map((x) => {
    const open = S.openTheme === x.word;
    const d = x.delta == null ? `<span class="tag">${tr('nuevo')}</span>` : x.delta > 0 ? `<span class="tag up">+${x.delta}</span>` : x.delta < 0 ? `<span class="tag down">${x.delta}</span>` : `<span class="tag">=</span>`;
    return `<li class="th ${open ? 'on' : ''}">
      <button class="th-row" data-act="theme" data-w="${esc(x.word)}" aria-expanded="${open}">
        <span class="th-w">${esc(x.word)}</span>
        <span class="th-n num">${tr('{n} monedas', { n: x.n })} ${d}</span>
        <span class="th-h num ${tone(x.avgH1)}">${fmtPct(x.avgH1, 0, { sign: true })} <small>${tr('media 1 h')}</small></span>
        <span class="th-l">${x.leader ? `${esc(x.leader.symbol)} <small class="num">${esc(fmtCompact(x.leader.mc, '$'))}</small>` : ''}</span>
      </button>
      ${open ? `<ul class="coins">${x.coins.map((c) => `<li><span class="sym">${esc(c.symbol)}</span><span class="num">${esc(fmtCompact(c.mc, '$'))}</span><span class="num ${tone(c.h1)}">${fmtPct(c.h1, 0, { sign: true })}</span>
        <a class="link" href="https://trade.padre.gg/trade/solana/${esc(c.address)}" target="_blank" rel="noopener">${tr('Padre')}</a>
        <button class="link" data-act="whales" data-mint="${esc(c.address)}">${tr('ballenas')}</button></li>`).join('')}</ul>` : ''}
    </li>`;
  }).join('');
  return `<section class="blk">${head}
    <div class="th-head" aria-hidden="true"><span>${tr('Tema')}</span><span>${tr('Monedas (vs. hace 1 h)')}</span><span>${tr('Cambio en 1 h')}</span><span>${tr('La más grande')}</span></div>
    <ol class="themes">${rows}</ol>
    ${t.prevAt ? '' : `<p class="muted sm">${tr('La comparación con hace 1 h aparece cuando el radar lleva un rato funcionando.')}</p>`}</section>`;
}

// ---------- Ballenas en directo ----------
let tapeTimer = null;
async function loadTape(mint) {
  S.mint = mint; S.tapeBusy = true; render();
  const r = await send({ type: 'whaleTape', mint });
  S.tapeBusy = false;
  if (r.ok) { S.tape = r.data; S.tapeErr = null; } else { S.tape = null; S.tapeErr = r.error; }
  render();
  clearInterval(tapeTimer);
  if (r.ok) tapeTimer = setInterval(async () => { if (document.hidden) return; const x = await send({ type: 'whaleTape', mint: S.mint }); if (x.ok) { S.tape = x.data; render(); } }, 20e3);
}
function flowBar(f, label) {
  const tot = f.buys + f.sells;
  const b = tot ? (f.buys / tot) * 100 : 50;
  return `<div class="flow"><span class="fl-l">${tr(label)}</span>
    <span class="fl-bar" role="img" aria-label="${esc(tr('{b} compras, {s} ventas', { b: fmtCompact(f.buys, '$'), s: fmtCompact(f.sells, '$') }))}"><i class="b" style="width:${b}%"></i><i class="s" style="width:${100 - b}%"></i></span>
    <b class="num ${tone(f.net)}">${f.net >= 0 ? '+' : '−'}${esc(fmtCompact(Math.abs(f.net), '$'))}</b>
    <small class="num ${tone(f.bigNet)}">${tr('ballenas {v}', { v: `${f.bigNet >= 0 ? '+' : '−'}${fmtCompact(Math.abs(f.bigNet), '$')}` })}</small></div>`;
}
function tapeBlock() {
  const t = S.tape;
  const form = `<form class="tape-f" data-form="tape"><label class="fld grow"><span class="fl">${tr('Moneda (dirección)')}</span><span class="fi"><input name="mint" value="${esc(S.mint)}" placeholder="…pump" autocomplete="off" spellcheck="false"></span></label><button class="btn small" type="submit" ${S.tapeBusy ? 'disabled' : ''}>${tr(S.tapeBusy ? 'Cargando…' : 'Ver')}</button></form>`;
  const head = `<header class="sec-h"><h2>${tr('Ballenas en directo')}${t ? ` <span class="sym">· ${esc(t.symbol)}</span>` : ''}</h2>${t ? `<span class="muted sm">${tr('se actualiza solo cada 20 s')}</span>` : ''}</header>`;
  if (!t) return `<section class="blk">${head}${form}${S.tapeErr ? `<p class="empty err">${esc(S.tapeErr)}</p>` : `<p class="hint">${tr('Pega la dirección de una moneda (o pulsa «ballenas» en un tema) para ver las compras y ventas grandes de las últimas horas, quién repite y hacia dónde va el dinero.')}</p>`}</section>`;
  const rows = t.big.slice(0, 40).map((r) => `<li class="wt ${r.side}">
    <span class="t num">${clock(r.at)}</span>
    <span class="kind ${r.side === 'buy' ? 'k-buy' : 'k-sell'}">${tr(r.side === 'buy' ? 'Compra' : 'Venta')}</span>
    <b class="num">${esc(fmtCompact(r.usd, '$'))}</b>
    <span class="wl"><button class="link mono" data-act="copy" data-v="${esc(r.wallet)}" title="${esc(r.wallet)}">${esc(r.tracked || short(r.wallet))}</button>${r.tracked ? `<span class="tag brand">${tr('la sigues')}</span>` : ''}${r.repeat >= 3 ? `<span class="tag">${tr('{n} órdenes', { n: r.repeat })}</span>` : ''}</span>
    ${r.tracked ? '<span></span>' : `<button class="link" data-act="follow" data-v="${esc(r.wallet)}">${tr('Seguir')}</button>`}
  </li>`).join('');
  const busy = t.busy.length ? `<p class="sub-h">${tr('Wallets que más repiten')}</p><ul class="busy">${t.busy.map((b) => `<li><span class="mono">${esc(short(b.wallet))}</span><span class="num">${tr('{n} órdenes', { n: b.n })}</span><b class="num ${tone(b.net)}">${b.net >= 0 ? '+' : '−'}${esc(fmtCompact(Math.abs(b.net), '$'))}</b></li>`).join('')}</ul><p class="muted sm">${tr('Muchas órdenes de la misma wallet: o reparte la compra para no mover el precio, o es un bot que entra y sale.')}</p>` : '';
  return `<section class="blk">${head}${form}
    <div class="flows">${flowBar(t.f5, 'Últimos 5 min')}${flowBar(t.f15, 'Últimos 15 min')}${flowBar(t.f60, 'Última hora')}</div>
    <p class="muted sm">${tr('Grande = desde {c}. Mira las {n} últimas operaciones ({a}).', { c: fmtCompact(t.cut, '$'), n: t.total, a: t.oldest ? tr('desde las {h}', { h: clock(t.oldest).slice(0, 5) }) : '' })}</p>
    ${rows ? `<ol class="tape">${rows}</ol>` : `<p class="empty">${tr('Ninguna operación grande en este rato.')}</p>`}
    ${busy}</section>`;
}

// ---------- Wallets que sigues ----------
async function loadWallets(refresh, address) {
  S.wBusy = true; render();
  const r = await send({ type: refresh ? 'walletsRefresh' : 'walletsState', address });
  S.wBusy = false;
  if (r.ok) S.wallets = r.data; else toast(r.error, true);
  render();
}
function heliusBox(w) {
  if (w.helius && w.heliusPerm) return '';
  return `<form class="helius" data-form="helius">
    <p><b>${tr('Para seguir wallets hace falta una clave gratis de Helius')}</b></p>
    <ol class="steps">
      <li>${tr('Entra en dashboard.helius.dev y crea una cuenta gratis (la creas tú).')}</li>
      <li>${tr('Copia tu «API key» (son letras y números con guiones).')}</li>
      <li>${tr('Pégala aquí y pulsa «Conectar Helius». Opera te pedirá permiso para ese sitio.')}</li>
    </ol>
    <label class="fld"><span class="fl">${tr('Clave de Helius')}</span><span class="fi"><input name="key" type="password" autocomplete="off" spellcheck="false" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"></span><small>${tr('Se guarda solo en este navegador, aparte de tus datos, y solo se usa para leer historiales públicos de wallets.')}</small></label>
    <button class="btn small primary" type="submit">${tr('Conectar Helius')}</button>
  </form>`;
}
function walletCard(x, w) {
  const d = w.data[x.address] || {};
  const trades = parseSwaps(d.txs || [], x.address);
  const rounds = walletRounds(trades, { solUsd: w.solUsd || 0 });
  const p = walletProfile(rounds);
  const open = S.openWallet === x.address;
  const last = trades.slice(-4).reverse();
  return `<li class="wc ${open ? 'on' : ''}">
    <button class="wc-h" data-act="wallet" data-a="${esc(x.address)}" aria-expanded="${open}">
      <span class="wc-n">${esc(x.name || short(x.address))}</span>
      <span class="num ${tone(p.net)}">${p.closed ? `${fmtSol(p.net, { sign: true })} SOL` : '—'}</span>
      <span class="num muted">${p.winRate != null ? tr('{w} acierto', { w: fmtPct(p.winRate, 0) }) : d.at ? tr('sin cerradas') : tr('sin datos')}</span>
    </button>
    ${open ? `<div class="wc-b">
      ${d.error ? `<p class="err">${esc(d.error)}</p>` : ''}
      ${p.notes.length ? `<ul class="pat">${p.notes.map((n) => `<li>${say(n)}</li>`).join('')}</ul>` : `<p class="muted sm">${tr(d.at ? 'Con 5 monedas cerradas te digo su patrón: dónde entra, cuánto aguanta, cuánto gana y pierde.' : 'Pulsa «Actualizar» para leer su historial.')}</p>`}
      ${last.length ? `<p class="sub-h">${tr('Últimos movimientos')}</p><ul class="mv">${last.map((t) => `<li><span class="kind ${t.side === 'buy' ? 'k-buy' : 'k-sell'}">${tr(t.side === 'buy' ? 'Compra' : 'Venta')}</span><span class="num">${fmtSol(t.sol)} SOL</span><span class="mono">${esc(short(t.mint))}</span><span class="muted">${ago(t.at)}</span><a class="link" href="https://trade.padre.gg/trade/solana/${esc(t.mint)}" target="_blank" rel="noopener">${tr('Padre')}</a></li>`).join('')}</ul>` : ''}
      <div class="wc-a"><span class="muted sm">${d.at ? tr('leído {a}', { a: ago(d.at) }) : ''} · ${tr('{n} monedas, {c} cerradas', { n: p.tokens, c: p.closed })}</span>
        <button class="link" data-act="wRefresh" data-a="${esc(x.address)}">${tr('Actualizar')}</button>
        <button class="link danger" data-act="wRemove" data-a="${esc(x.address)}">${tr('Dejar de seguir')}</button></div>
    </div>` : ''}
  </li>`;
}
function walletsBlock() {
  const w = S.wallets;
  if (!w) return `<section class="side-s"><h3>${tr('Wallets que sigues')}</h3><p class="empty sm">${tr('Cargando…')}</p></section>`;
  return `<section class="side-s wallets">
    <header class="sec-h"><h3>${tr('Wallets que sigues')}</h3>${w.list.length && w.helius ? `<button class="btn small" data-act="wRefreshAll" ${S.wBusy ? 'disabled' : ''}>${tr(S.wBusy ? 'Leyendo…' : 'Actualizar todas')}</button>` : ''}</header>
    <p class="hint">${tr('Apunta wallets de traders buenos (del leaderboard de fomo, de Padre o de las ballenas de aquí al lado). Aprendes de sus patrones y el bot las tiene en cuenta: si una compra, el agente de dinero inteligente lo sabe.')}</p>
    ${heliusBox(w)}
    <form class="addw" data-form="addw">
      <label class="fld"><span class="fl">${tr('Dirección de la wallet')}</span><span class="fi"><input name="address" autocomplete="off" spellcheck="false"></span></label>
      <label class="fld"><span class="fl">${tr('Nombre (opcional)')}</span><span class="fi"><input name="name" maxlength="24" autocomplete="off"></span></label>
      <button class="btn small" type="submit">${tr('Seguir')}</button>
    </form>
    ${w.list.length ? `<ul class="wlist">${w.list.map((x) => walletCard(x, w)).join('')}</ul>` : `<p class="empty sm">${tr('Aún no sigues ninguna.')}</p>`}
  </section>`;
}

// ---------- Pintar ----------
function render() {
  const head = `<header class="bar">
    <div class="id">
      <svg class="mark" viewBox="0 0 100 100" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="M57 5C61 25 79 38 79 62A29 29 0 0 1 21 62C21 47 28 38 36 31C37 39 41 43 45 45C43 31 49 17 57 5ZM50 48.5A13.5 13.5 0 0 1 50 75.5A13.5 13.5 0 0 1 50 48.5Z"/></svg>
      <div class="id-t">
        <div class="id-r"><h1>${tr('Radar')}</h1></div>
        <p class="paper">${tr('Qué temas se están moviendo, quién compra fuerte ahora y qué hacen las wallets que sigues.')}</p>
      </div>
    </div>
    <div class="ctl">${pagesNav('radar')}<button class="lang" data-act="lang" aria-label="${getLang() === 'en' ? 'Cambiar a español' : 'Switch to English'}">${getLang() === 'en' ? 'ES' : 'EN'}</button></div>
  </header>`;
  const focus = document.activeElement;
  if (focus?.closest?.('form') && $('#app').contains(focus) && focus.value) return;   // no pisar lo que escribes
  $('#app').innerHTML = `${head}<main class="grid"><div class="main-col">${themesBlock()}${tapeBlock()}</div><aside class="side">${walletsBlock()}</aside></main>`;
  document.title = `Blankfire · ${tr('Radar')}`;
}

function toast(msg, bad) {
  const t = $('#toast');
  t.textContent = msg; t.className = 'toast' + (bad ? ' bad' : ''); t.hidden = false;
  clearTimeout(toast.h); toast.h = setTimeout(() => { t.hidden = true; }, 3600);
}

document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const a = b.dataset.act;
  if (a === 'themes') return loadThemes(true);
  if (a === 'theme') { S.openTheme = S.openTheme === b.dataset.w ? null : b.dataset.w; render(); return; }
  if (a === 'whales') { loadTape(b.dataset.mint); $('.tape-f')?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }); return; }
  if (a === 'copy') { try { await navigator.clipboard.writeText(b.dataset.v); toast(tr('Dirección copiada.')); } catch { toast(b.dataset.v); } return; }
  if (a === 'follow') { const r = await send({ type: 'walletAdd', address: b.dataset.v }); if (r.ok) { S.wallets = r.data; toast(tr('Ahora la sigues.')); render(); } else toast(r.error, true); return; }
  if (a === 'wallet') { S.openWallet = S.openWallet === b.dataset.a ? null : b.dataset.a; render(); return; }
  if (a === 'wRefresh') return loadWallets(true, b.dataset.a);
  if (a === 'wRefreshAll') return loadWallets(true);
  if (a === 'wRemove') { const r = await send({ type: 'walletRemove', address: b.dataset.a }); if (r.ok) { S.wallets = r.data; render(); } return; }
  if (a === 'lang') {
    const next = getLang() === 'en' ? 'es' : 'en';
    setLang(next); document.documentElement.lang = next;
    await send({ type: 'saveSettings', settings: { lang: next } });
    render();
  }
});
document.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target, kind = f.dataset.form;
  if (kind === 'tape') { const m = f.mint.value.trim(); if (m) { f.mint.blur(); loadTape(m); } }
  if (kind === 'addw') {
    const r = await send({ type: 'walletAdd', address: f.address.value, name: f.name.value });
    if (r.ok) { S.wallets = r.data; f.reset(); document.activeElement?.blur(); toast(tr('Ahora la sigues.')); render(); if (r.data.helius) loadWallets(true, r.data.list.at(-1).address); } else toast(r.error, true);
  }
  if (kind === 'helius') {
    const key = f.key.value.trim();
    // El permiso para el sitio de Helius se pide aquí, con tu clic (Opera enseña su propio aviso).
    let granted = false;
    try { granted = await chrome.permissions.request({ origins: [HELIUS_ORIGIN] }); } catch { granted = false; }
    if (!granted) { toast(tr('Sin el permiso de Opera para Helius no puedo leer wallets.'), true); return; }
    const r = await send({ type: 'saveKeys', helius: key });
    if (!r.ok) { toast(r.error, true); return; }
    f.key.value = ''; document.activeElement?.blur();
    toast(tr('Helius conectado.'));
    loadWallets(true);
  }
});

addEventListener('focusout', () => setTimeout(() => { if (!document.activeElement?.closest?.('form')) render(); }, 0));
setInterval(() => { if (!document.hidden) loadThemes(false); }, 120e3);

(async () => {
  const st = await send({ type: 'state' });
  setLang(st.data?.settings?.lang); document.documentElement.lang = getLang();
  render();
  const mint = new URLSearchParams(location.search).get('mint');
  loadWallets(false);
  loadThemes(false);
  if (mint) loadTape(mint);
})();
