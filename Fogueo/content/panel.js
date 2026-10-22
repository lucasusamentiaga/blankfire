// Blankfire — panel flotante dentro de trade.padre.gg.
import {
  DEFAULT_SETTINGS, REVIEW_TAGS, PRESETS, simulateBuy, simulateSell, positionPnl, realizedSince, startOfDay,
  fmtPrice, fmtCompact, fmtSol, fmtPct, fmtNum, fmtUsd, tone, rangeModel, hueFor,
} from '../lib/core.js';
import { tr, setLang, getLang } from '../lib/i18n.js';
import { Tour } from './tour.js';

const ICON = {
  mark: '<svg viewBox="0 0 100 100" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="M57 5C61 25 79 38 79 62A29 29 0 0 1 21 62C21 47 28 38 36 31C37 39 41 43 45 45C43 31 49 17 57 5ZM50 48.5A13.5 13.5 0 0 1 50 75.5A13.5 13.5 0 0 1 50 48.5Z"/></svg>',
  chevron: '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  back: '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M10 3.5L5.5 8l4.5 4.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  next: '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M6 3.5l4.5 4.5L6 12.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  check: '<svg viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M2.5 6.2l2.3 2.3 4.7-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  pen: '<svg viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M7.6 2.2l2.2 2.2M2 10l.6-2.6 5.7-5.7 2 2-5.7 5.7L2 10z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>',
  target: '<svg viewBox="0 0 22 22" fill="none" aria-hidden="true"><circle cx="11" cy="11" r="8" stroke="currentColor" stroke-width="1.6"/><path d="M11 1.5v4M11 16.5v4M1.5 11h4M16.5 11h4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  alert: '<svg viewBox="0 0 22 22" fill="none" aria-hidden="true"><path d="M11 3l9 16H2L11 3z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M11 9v4.5M11 16.2v.1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  ok: '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="6.5" stroke="currentColor" stroke-width="1.5"/><path d="M5.2 8.2l1.9 1.9 3.8-4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  err: '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="6.5" stroke="currentColor" stroke-width="1.5"/><path d="M8 4.8v3.8M8 11v.1" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
  x: '<svg viewBox="0 0 12 12" fill="none" aria-hidden="true" width="10" height="10"><path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  help: '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="6.3" stroke="currentColor" stroke-width="1.3"/><path d="M6.3 6.3a1.8 1.8 0 113 1.3c-.6.4-1.3.8-1.3 1.6v.2M8 11.4v.1" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
  keys: '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="1.5" y="4" width="13" height="8.5" rx="1.6" stroke="currentColor" stroke-width="1.3"/><path d="M4 6.6h.1M6.5 6.6h.1M9 6.6h.1M11.6 6.6h.1M5 9.6h6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
  stack: '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 2l6 3-6 3-6-3 6-3z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M2 8l6 3 6-3M2 11l6 3 6-3" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>',
  clock: '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.4"/><path d="M8 4.8V8l2.2 1.4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
};

const SOL_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const EVM_RE = /^0x[a-fA-F0-9]{40}$/;
const TICK_MS = 2500;
const BUY_KEYS = ['1', '2', '3', '4'];
const SELL_KEYS = { q: 25, w: 50, e: 75, r: 100 };

// ---------- utilidades ----------

const send = (msg) => new Promise((resolve) => {
  try {
    chrome.runtime.sendMessage(msg, (res) => {
      if (chrome.runtime.lastError) resolve({ ok: false, error: tr('La extensión se ha actualizado. Recarga la página.') });
      else resolve(res || { ok: false, error: tr('Sin respuesta') });
    });
  } catch (e) {
    resolve({ ok: false, error: tr('La extensión se ha actualizado. Recarga la página.') });
  }
});

function detectAddress(href) {
  let url;
  try { url = new URL(href); } catch { return null; }
  const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  for (let i = parts.length - 1; i >= 0; i--) {
    if (SOL_RE.test(parts[i]) || EVM_RE.test(parts[i])) return parts[i];
  }
  for (const v of url.searchParams.values()) {
    if (SOL_RE.test(v) || EVM_RE.test(v)) return v;
  }
  return null;
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const parseNum = (v) => { const n = Number(String(v).replace(/\s/g, '').replace(',', '.')); return isFinite(n) ? n : NaN; };
// "30k", "1,2M", "$45.000" → número
function parseMc(v) {
  const t = String(v || '').trim().toLowerCase().replace(/[$\s]/g, '');
  const m = t.match(/^([\d.,]+)([kmb])?$/);
  if (!m) return NaN;
  let n = m[1];
  if (m[2]) n = n.replace(',', '.');
  else n = n.replace(/\./g, '').replace(',', '.');
  const x = Number(n) * ({ k: 1e3, m: 1e6, b: 1e9 }[m[2]] || 1);
  return isFinite(x) ? x : NaN;
}

async function loadFonts() {
  const faces = [
    ['Fogueo Barlow', 'barlow-latin-400-normal', 400],
    ['Fogueo Barlow', 'barlow-latin-500-normal', 500],
    ['Fogueo Barlow', 'barlow-latin-600-normal', 600],
    ['Fogueo Barlow SC', 'barlow-semi-condensed-latin-500-normal', 500],
    ['Fogueo Barlow SC', 'barlow-semi-condensed-latin-600-normal', 600],
    ['Fogueo Barlow SC', 'barlow-semi-condensed-latin-700-normal', 700],
    ['Fogueo Code Next', 'codenext-800', 800],
  ];
  // Cargamos los bytes nosotros: así la CSP de Padre no bloquea las fuentes.
  await Promise.all(faces.map(async ([family, file, weight]) => {
    try {
      const buf = await fetch(chrome.runtime.getURL(`fonts/${file}.woff2`)).then((r) => r.arrayBuffer());
      const face = new FontFace(family, buf, { weight: String(weight), style: 'normal' });
      await face.load();
      document.fonts.add(face);
    } catch (e) { /* caemos a system-ui */ }
  }));
}

// ---------- panel ----------

export async function mount() {
  if (document.getElementById('fogueo-root')) return;
  const host = document.createElement('div');
  host.id = 'fogueo-root';
  host.hidden = true;
  const root = host.attachShadow({ mode: 'open' });
  const [tokens, css] = await Promise.all([
    fetch(chrome.runtime.getURL('content/tokens.css')).then((r) => r.text()),
    fetch(chrome.runtime.getURL('content/panel.css')).then((r) => r.text()),
  ]);
  const style = document.createElement('style');
  style.textContent = tokens + '\n' + css;
  root.appendChild(style);
  loadFonts();

  const app = new Panel(root, host);
  document.documentElement.appendChild(host);
  await app.init();
}

class Panel {
  constructor(root, host) {
    this.root = root;
    this.host = host;
    this.st = null;
    this.quote = null;
    this.solUsd = null;
    this.address = undefined; // undefined = aún sin mirar la URL (distinto de null = "no hay token")
    this.key = null;
    this.side = 'buy';
    this.orderType = 'market'; // market | limit
    this.view = 'trade';       // trade | positions | keys
    this.status = 'idle';      // idle | none | loading | ready | missing | offline
    this.busy = false;
    this.lastPrice = null;
    this.toastTimer = null;
    this.sellPct = 100;
    this.editing = null;
    this.hover = false;
    this.review = null;        // ronda recién cerrada pendiente de revisar
    this.reviewDraft = { tags: [], followedPlan: null };
    this.allQuotes = {};
    this.tour = null;
  }

  get settings() { return { ...DEFAULT_SETTINGS, ...(this.st?.settings || {}) }; }
  get position() { return this.key ? this.st?.account.positions[this.key] : null; }
  get orders() { return this.st?.account.orders || []; }

  async init() {
    const res = await send({ type: 'state' });
    if (res.ok) this.st = res.data;
    setLang(this.settings.lang);
    // Primera vez: fijamos el idioma detectado para que panel, ventana y avisos coincidan.
    if (this.st && !this.st.settings?.lang) {
      this.st.settings = { ...this.st.settings, lang: getLang() };
      send({ type: 'saveSettings', settings: { lang: getLang() } });
    }
    this.build();
    this.applyPanelPrefs();
    this.host.hidden = !!this.st?.ui?.panel?.hidden;

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes.fogueo) return;
      if (this.tour) { this.tour.realSt = changes.fogueo.newValue; return; }
      const prevHidden = !!this.st?.ui?.panel?.hidden;
      const prevLang = this.settings.lang;
      this.st = changes.fogueo.newValue;
      if (this.settings.lang !== prevLang) { setLang(this.settings.lang); this.rebuild(); return; }
      const hidden = !!this.st?.ui?.panel?.hidden;
      if (hidden !== prevHidden) this.host.hidden = hidden;
      this.renderAll();
    });

    chrome.runtime.onMessage.addListener((msg) => {
      if (msg?.type === 'toggle' && !this.tour) this.toggleHidden();
      if (msg?.type === 'startTour') this.startTour();
      if (msg?.type === 'triggered') {
        const r = msg.round;
        const label = tr({ tp: 'Take profit ejecutado', sl: 'Stop loss ejecutado', trail: 'Trailing stop ejecutado' }[msg.reason] || 'Posición cerrada');
        this.toast(r && r.pnlSol >= 0 ? 'ok' : 'info', tr('{label} en ${sym}: {pnl} SOL ({pct}).', { label, sym: r?.symbol, pnl: fmtSol(r?.pnlSol, { sign: true }), pct: fmtPct(r?.pnlPct, 1, { sign: true }) }));
        if (r) this.openReview(r);
      }
      if (msg?.type === 'orderFilled') this.toast('ok', tr('Orden límite ejecutada en ${sym}: compraste {sol} SOL.', { sym: msg.order?.symbol, sol: fmtSol(msg.order?.solIn) }));
      if (msg?.type === 'orderFailed') this.toast('err', tr('Orden límite cancelada: {e}', { e: msg.error }));
    });

    // Padre es una SPA: vigilamos la URL.
    let lastHref = '';
    const watchUrl = () => {
      if (location.href !== lastHref) { lastHref = location.href; this.onUrl(location.href); }
    };
    watchUrl();
    setInterval(watchUrl, 500);
    window.addEventListener('popstate', watchUrl);

    setInterval(() => this.tick(), TICK_MS);
    setInterval(() => this.renderFresh(), 1000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.tick(true); });
    window.addEventListener('resize', () => this.clampPosition());

    // Atajos de teclado: solo con el ratón encima del panel, para no pisar los de Padre.
    this.host.addEventListener('pointerenter', () => { this.hover = true; this.el.classList.add('kbd'); });
    this.host.addEventListener('pointerleave', () => { this.hover = false; this.el.classList.remove('kbd'); });
    window.addEventListener('keydown', (e) => this.onKey(e), true);
  }

  // ---------- estructura ----------

  build() {
    const wrap = document.createElement('div');
    wrap.className = 'fx';
    wrap.setAttribute('role', 'region');
    wrap.setAttribute('aria-label', 'Blankfire, paper trading');
    wrap.innerHTML = `
      <div class="head" data-drag>
        <span class="mark">${ICON.mark}</span>
        <span class="brand">Blankfire</span>
        <span class="live" title="${tr('Estás operando con SOL ficticio')}"><i></i>${tr('práctica')}</span>
        <span class="head-chip num" data-ref="headChip"></span>
        <div class="head-bal">
          <b class="num" data-ref="bal">—</b>
          <small>${tr('SOL ficticio')}</small>
        </div>
        <button class="icon-btn collapse" data-act="collapse" aria-label="${tr('Minimizar panel')}" aria-expanded="true">${ICON.chevron}</button>
      </div>
      <div class="body"><div class="body-inner">
        <div data-ref="onboard"></div>
        <div data-ref="viewTrade">
          <div data-ref="tokenArea"></div>
          <div data-ref="recoArea"></div>
          <div data-ref="posArea"></div>
          <div data-ref="ordersArea"></div>
          <div data-ref="reviewArea"></div>
          <div data-ref="tradeArea">
            <div class="seg" role="tablist" data-side="buy">
              <span class="seg-thumb"></span>
              <button role="tab" aria-selected="true" data-act="side" data-side="buy">${tr('Comprar')}<kbd class="hk">B</kbd></button>
              <button role="tab" aria-selected="false" data-act="side" data-side="sell">${tr('Vender')}<kbd class="hk">${tr('V')}</kbd></button>
            </div>
            <div class="form" data-ref="buyForm">
              <div class="otype" role="group" aria-label="${tr('Tipo de orden')}">
                <button data-act="otype" data-o="market" aria-pressed="true">${tr('Ahora')}</button>
                <button data-act="otype" data-o="limit" aria-pressed="false">${ICON.clock}${tr('Si baja a…')}</button>
                <span class="daily" data-ref="daily"></span>
              </div>
              <label class="limit" data-ref="limitRow" hidden>
                <span class="limit-l">${tr('Comprar cuando el MC baje a')}</span>
                <span class="limit-in"><span class="cur">$</span><input data-ref="limitMc" inputmode="decimal" autocomplete="off" placeholder="30K" aria-label="${tr('Market cap objetivo')}"></span>
                <span class="limit-hint" data-ref="limitHint"></span>
              </label>
              <div class="amount">
                <input data-ref="amount" inputmode="decimal" autocomplete="off" placeholder="${fmtNum(0, 1, 1)}" aria-label="${tr('Cantidad a usar')}">
                <button class="unit" data-act="unit" data-ref="unit" title="${tr('Cambiar entre SOL y % de tu saldo')}">SOL</button>
              </div>
              <div class="chips" data-ref="quickBuys"></div>
              <div class="opts">
                <div class="opt sl" data-ref="optSl">
                  <label><span class="box">${ICON.check}</span><input type="checkbox" data-ref="useSl" hidden>Stop</label>
                  <span class="sgn">−</span><input data-ref="slPct" inputmode="decimal" aria-label="${tr('Stop loss en porcentaje')}"><span class="pct">%</span>
                </div>
                <div class="opt tp" data-ref="optTp">
                  <label><span class="box">${ICON.check}</span><input type="checkbox" data-ref="useTp" hidden>Take</label>
                  <span class="sgn">+</span><input data-ref="tpPct" inputmode="decimal" aria-label="${tr('Take profit en porcentaje')}"><span class="pct">%</span>
                </div>
              </div>
              <button class="trail" data-act="trail" data-ref="trailBtn" role="switch" aria-checked="false">
                <span class="sw"></span><span>${tr('<b>Stop dinámico</b> · sigue al máximo y protege lo ganado')}</span>
              </button>
              <button class="note-toggle" data-act="note" data-for="buyNote">${ICON.pen}<span>${tr('Apuntar por qué entro')}</span></button>
              <textarea class="note" data-ref="buyNote" hidden placeholder="${tr('Ej.: rompe resistencia en 40K de MC con volumen, dev no ha vendido…')}"></textarea>
              <div class="quote" data-ref="buyQuote" aria-live="polite"></div>
              <button class="go buy" data-act="buy"><span class="label" data-ref="buyLabel">${tr('Comprar')}</span><span class="spin"><i></i></span></button>
            </div>
            <div class="form" data-ref="sellForm" hidden>
              <div class="chips" data-ref="sellChips">
                ${Object.entries(SELL_KEYS).map(([k, p]) => `<button class="chip num" data-act="sellpct" data-pct="${p}" data-k="${k.toUpperCase()}" aria-pressed="false">${p}%</button>`).join('')}
              </div>
              <button class="initials" data-act="initials" data-ref="initialsBtn"><span data-ref="initialsLabel">${tr('Recuperar lo invertido')}</span><kbd class="hk">I</kbd></button>
              <button class="note-toggle" data-act="note" data-for="sellNote">${ICON.pen}<span>${tr('Apuntar por qué salgo')}</span></button>
              <textarea class="note" data-ref="sellNote" hidden placeholder="${tr('Ej.: perdió el soporte, recojo beneficios antes del dump…')}"></textarea>
              <div class="quote" data-ref="sellQuote" aria-live="polite"></div>
              <button class="go sell" data-act="sell"><span class="label" data-ref="sellLabel">${tr('Vender')}</span><span class="spin"><i></i></span></button>
            </div>
          </div>
        </div>
        <div data-ref="viewList" hidden></div>
        <div data-ref="viewKeys" hidden></div>
        <div class="toast" data-ref="toast" role="status"></div>
        <div class="foot">
          <span class="fresh" data-ref="fresh" title="${tr('Antigüedad del último precio')}"><i></i><span data-ref="freshText">DexScreener</span></span>
          <span class="foot-actions">
            <button class="foot-btn lang" data-act="lang" aria-label="${tr('Cambiar idioma a inglés')}" title="${tr('Cambiar idioma a inglés')}">${getLang() === 'en' ? 'ES' : 'EN'}</button>
            <button class="foot-btn" data-act="tour" aria-label="${tr('Recorrido guiado')}" title="${tr('Recorrido guiado por todas las funciones')}">${ICON.help}</button>
            <button class="foot-btn" data-act="view" data-v="keys" aria-label="${tr('Atajos de teclado')}" title="${tr('Atajos de teclado')}">${ICON.keys}</button>
            <button class="foot-btn wide" data-act="view" data-v="positions" data-ref="posBtn">${ICON.stack}<span data-ref="posBtnLabel">${tr('Posiciones')}</span></button>
          </span>
        </div>
      </div></div>`;
    this.root.appendChild(wrap);
    this.el = wrap;
    this.refs = {};
    wrap.querySelectorAll('[data-ref]').forEach((n) => { this.refs[n.dataset.ref] = n; });

    wrap.addEventListener('click', (e) => {
      // Durante el recorrido solo vale lo que pide el paso «Pruébalo» (nunca comprar ni vender de verdad).
      if (this.tour) {
        const b = e.target.closest('[data-act]');
        if (!b || !this.tour.allows(b.dataset.act, b)) { e.preventDefault(); return; }
        if (!this.tour.intercept(b.dataset.act)) this.onClick(e);
        this.tour?.notify(b.dataset.act);
        return;
      }
      this.onClick(e);
    });
    const r = this.refs;
    r.amount.addEventListener('input', () => { this.renderQuotes(); this.syncQuickPressed(); this.renderReco(); });
    r.amount.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.buy(); });
    r.limitMc.addEventListener('input', () => this.renderQuotes());
    r.limitMc.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.buy(); });
    const optSync = () => { this.syncOpts(true); this.renderQuotes(); this.renderReco(); };
    r.useTp.addEventListener('change', optSync);
    r.useSl.addEventListener('change', optSync);
    r.tpPct.addEventListener('input', () => { r.useTp.checked = true; this.syncOpts(); });
    r.slPct.addEventListener('input', () => { r.useSl.checked = true; this.syncOpts(); });
    r.tpPct.addEventListener('change', optSync);
    r.slPct.addEventListener('change', optSync);
    // Las teclas que escribes en el panel no deben llegar a los atajos de Padre.
    ['keydown', 'keyup', 'keypress'].forEach((t) => wrap.addEventListener(t, (e) => {
      if (e.target.matches?.('input, textarea')) e.stopPropagation();
    }));
    this.setupDrag();
    // Si el panel crece (posición abierta, aviso…), que nunca se salga de la pantalla.
    new ResizeObserver(() => this.clampPosition()).observe(wrap);

    const s = this.settings;
    r.useTp.checked = !!s.useTp;
    r.useSl.checked = !!s.useSl;
    r.tpPct.value = fmtNum(s.defaultTpPct, 0);
    r.slPct.value = fmtNum(s.defaultSlPct, 0);
    this.renderAll();
  }

  // Reconstruye el panel (p. ej. al cambiar de idioma) conservando lo que estabas escribiendo.
  rebuild() {
    const r = this.refs;
    const keep = r ? { amount: r.amount.value, limitMc: r.limitMc.value, buyNote: r.buyNote.value, sellNote: r.sellNote.value,
      useTp: r.useTp.checked, useSl: r.useSl.checked, tpPct: r.tpPct.value, slPct: r.slPct.value } : null;
    this.el?.remove();
    this.lastPrice = null;
    this.build();
    if (keep) {
      const n = this.refs;
      n.amount.value = keep.amount; n.limitMc.value = keep.limitMc; n.buyNote.value = keep.buyNote; n.sellNote.value = keep.sellNote;
      n.useTp.checked = keep.useTp; n.useSl.checked = keep.useSl; n.tpPct.value = keep.tpPct; n.slPct.value = keep.slPct;
    }
    this.applyPanelPrefs();
    this.renderAll();
  }

  switchLang() {
    const lang = getLang() === 'en' ? 'es' : 'en';
    setLang(lang);
    this.st.settings = { ...this.st.settings, lang };
    send({ type: 'saveSettings', settings: { lang } });
    this.rebuild();
  }

  applyPanelPrefs() {
    const p = this.st?.ui?.panel || {};
    this.el.classList.toggle('is-collapsed', !!p.collapsed);
    this.el.querySelector('[data-act="collapse"]').setAttribute('aria-expanded', String(!p.collapsed));
    this.moveTo(p.x ?? 20, p.y ?? 72);
  }

  moveTo(x, y) {
    const rect = this.el.getBoundingClientRect();
    const w = rect.width || 330;
    const h = rect.height || 60;
    const nx = Math.min(Math.max(8, x), window.innerWidth - w - 8);
    const ny = Math.min(Math.max(8, y), Math.max(8, window.innerHeight - h - 8));
    this.pos = { x: nx, y: ny };
    this.host.style.transform = `translate(${nx}px, ${ny}px)`;
  }

  clampPosition() { if (this.pos) this.moveTo(this.pos.x, this.pos.y); }

  setupDrag() {
    const head = this.el.querySelector('[data-drag]');
    let start = null;
    head.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('button')) return;
      start = { x: e.clientX, y: e.clientY, ox: this.pos?.x || 0, oy: this.pos?.y || 0, moved: false };
      head.setPointerCapture(e.pointerId);
    });
    head.addEventListener('pointermove', (e) => {
      if (!start) return;
      const dx = e.clientX - start.x, dy = e.clientY - start.y;
      if (!start.moved && Math.hypot(dx, dy) < 3) return;
      start.moved = true;
      this.el.classList.add('is-dragging');
      this.moveTo(start.ox + dx, start.oy + dy);
    });
    const end = () => {
      if (!start) return;
      const moved = start.moved;
      start = null;
      this.el.classList.remove('is-dragging');
      if (moved) send({ type: 'savePanel', panel: { x: this.pos.x, y: this.pos.y } });
    };
    head.addEventListener('pointerup', end);
    head.addEventListener('pointercancel', end);
    head.addEventListener('dblclick', (e) => { if (!e.target.closest('button')) this.toggleCollapse(); });
  }

  toggleCollapse() {
    const collapsed = !this.el.classList.contains('is-collapsed');
    this.el.classList.toggle('is-collapsed', collapsed);
    const b = this.el.querySelector('[data-act="collapse"]');
    b.setAttribute('aria-expanded', String(!collapsed));
    b.setAttribute('aria-label', collapsed ? tr('Abrir panel') : tr('Minimizar panel'));
    send({ type: 'savePanel', panel: { collapsed } });
    setTimeout(() => this.clampPosition(), 260);
  }

  toggleHidden() {
    const hidden = !this.host.hidden;
    this.host.hidden = hidden;
    send({ type: 'savePanel', panel: { hidden } });
  }

  setView(v) {
    this.view = this.view === v ? 'trade' : v;
    this.renderView();
    if (this.view === 'positions') this.refreshAllQuotes();
  }

  // ---------- teclado ----------

  onKey(e) {
    if (this.tour) {
      if (this.tour.onKey(e)) { e.preventDefault(); e.stopPropagation(); }
      return;
    }
    if (!this.hover || this.host.hidden || this.el.classList.contains('is-collapsed')) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.composedPath?.()[0];
    if (t?.matches?.('input, textarea, select, [contenteditable=""], [contenteditable="true"]')) return;
    // Si estás escribiendo en un campo de Padre (aunque el ratón esté sobre el panel), no tocamos nada.
    const ae = document.activeElement;
    if (ae && ae !== this.host && (ae.matches?.('input, textarea, select') || ae.isContentEditable)) return;
    const k = e.key.toLowerCase();
    let handled = true;
    if (k === 'escape' && this.view !== 'trade') { this.view = 'trade'; this.renderView(); }
    else if (k === '?' || k === 'k') this.setView('keys');
    else if (k === 'p') this.setView('positions');
    else if (this.view !== 'trade' || this.status !== 'ready') handled = false;
    else if (k === 'b') this.switchSide('buy');
    else if (k === 'v' || k === 's') this.switchSide('sell');
    else if (BUY_KEYS.includes(k) && this.side === 'buy') {
      const chip = this.refs.quickBuys.querySelectorAll('.chip')[Number(k) - 1];
      if (chip) { chip.click(); this.flash(chip); this.buy(); }
    } else if (SELL_KEYS[k] && this.position) {
      this.switchSide('sell');
      this.sellPct = SELL_KEYS[k];
      this.renderTrade(); this.renderQuotes();
      this.flash(this.refs.sellChips.querySelector(`[data-pct="${this.sellPct}"]`));
      this.sell();
    } else if (k === 'i' && this.position) { this.switchSide('sell'); this.flash(this.refs.initialsBtn); this.sellInitials(); }
    else handled = false;
    if (handled) { e.preventDefault(); e.stopPropagation(); }
  }

  flash(el) {
    if (!el) return;
    el.classList.remove('pressed'); void el.offsetWidth; el.classList.add('pressed');
    setTimeout(() => el.classList.remove('pressed'), 260);
  }

  switchSide(side) {
    if (side === 'sell' && !this.position) return;
    this.side = side;
    this.renderTrade(); this.renderQuotes();
  }

  // ---------- datos ----------

  async onUrl(href) {
    const addr = detectAddress(href);
    if (addr === this.address && this.status !== 'offline' && this.status !== 'missing') return;
    this.address = addr;
    this.quote = null;
    this.key = null;
    this.lastPrice = null;
    this.orderType = 'market';
    if (this.view === 'positions' && addr) this.view = 'trade';
    if (!addr) { this.status = 'none'; this.renderAll(); this.refreshAllQuotes(); return; }
    this.status = 'loading';
    this.renderAll();
    await this.resolve();
  }

  async resolve() {
    const addr = this.address;
    const res = await send({ type: 'resolve', address: addr });
    if (addr !== this.address) return;
    if (!res.ok) { this.status = 'offline'; this.renderAll(); return; }
    if (!res.data.quote) { this.status = 'missing'; this.renderAll(); return; }
    this.quote = res.data.quote;
    this.solUsd = res.data.solUsd;
    this.key = `${this.quote.chain}:${this.quote.address}`;
    this.status = 'ready';
    this.renderAll();
    // Ajustes recomendados automáticos al abrir un token nuevo.
    const preset = PRESETS[this.quote.stage];
    if (preset && this.settings.autoPreset && this.autoAppliedKey !== this.key && !this.tour) {
      this.autoAppliedKey = this.key;
      if (!this.presetMatches(preset)) this.applyPreset(preset, true);
    }
  }

  async refreshAllQuotes() {
    const keys = Object.keys(this.st?.account.positions || {});
    if (!keys.length) { this.renderList(); return; }
    const res = await send({ type: 'quotes', keys });
    if (res.ok) { this.allQuotes = res.data.quotes || {}; if (res.data.solUsd) this.solUsd = res.data.solUsd; }
    this.renderList();
    if (this.status === 'none') this.renderToken();
  }

  async tick(force) {
    if (this.tour || document.hidden || this.host.hidden) return;
    if (this.view === 'positions' || this.status === 'none') this.refreshAllQuotes();
    if (this.status === 'missing' || this.status === 'offline') {
      if (this.address) return this.resolve();
      return;
    }
    if (!this.key) return;
    const key = this.key;
    const res = await send({ type: 'tick', key, force, address: this.address });
    if (!res.ok || key !== this.key || !res.data.quote) return;
    this.quote = res.data.quote;
    if (res.data.solUsd) this.solUsd = res.data.solUsd;
    this.renderToken(true);
    this.renderPosition();
    this.renderOrders();
    this.renderQuotes();
    this.renderHead();
    this.renderFresh();
  }

  // ---------- render ----------

  renderAll() {
    if (!this.el) return;
    this.renderHead();
    this.renderOnboard();
    this.renderToken();
    this.renderReco();
    this.renderPosition();
    this.renderOrders();
    this.renderReview();
    this.renderTrade();
    this.renderQuotes();
    this.renderView();
    this.renderFresh();
  }

  renderView() {
    const r = this.refs;
    r.viewTrade.hidden = this.view !== 'trade';
    r.viewList.hidden = this.view !== 'positions';
    r.viewKeys.hidden = this.view !== 'keys';
    const n = Object.keys(this.st?.account.positions || {}).length;
    const o = this.orders.length;
    r.posBtnLabel.innerHTML = `${tr('Posiciones')}${n + o ? ` <b class="count">${n + o}</b>` : ''}`;
    r.posBtn.setAttribute('aria-pressed', String(this.view === 'positions'));
    this.el.querySelector('[data-v="keys"]').setAttribute('aria-pressed', String(this.view === 'keys'));
    if (this.view === 'positions') this.renderList();
    if (this.view === 'keys') this.renderKeys();
  }

  renderOnboard() {
    const box = this.refs.onboard;
    if (this.st?.ui?.onboarded) { box.innerHTML = ''; return; }
    if (box.firstChild) return;
    box.innerHTML = `
      <div class="onboard">
        <div class="ob-head">
          <span class="ob-mark">${ICON.mark}</span>
          <div><strong>${tr('Practica sin pólvora')}</strong><span>${tr('Precios reales de Padre, SOL de mentira.')}</span></div>
        </div>
        <ol class="ob-steps">
          <li><i aria-hidden="true">1</i><p>${tr('<b>Abre un token</b> en Padre: el panel lo detecta solo.')}</p></li>
          <li><i aria-hidden="true">2</i><p>${tr('<b>Compra con SOL ficticio</b> y fija Stop y Take antes de entrar.')}</p></li>
          <li><i aria-hidden="true">3</i><p>${tr('<b>Al cerrar, revisa el trade</b>: ¿seguiste tu plan? Así aprendes de verdad.')}</p></li>
        </ol>
        <div class="ob-a">
          <button class="btn-brand" data-act="tour">${tr('Ver el recorrido guiado')}</button>
          <button class="link-btn" data-act="onboarded">${tr('Ya lo conozco')}</button>
        </div>
        <div class="onboard-tip">
          <span>${tr('Con el ratón encima del panel')}</span>
          <span class="ob-keys"><span><kbd>1</kbd>–<kbd>4</kbd> ${tr('compran')}</span><span><kbd>Q</kbd><kbd>W</kbd><kbd>E</kbd><kbd>R</kbd> ${tr('venden')}</span></span>
        </div>
      </div>`;
  }

  renderHead() {
    const r = this.refs;
    r.bal.textContent = fmtSol(this.st?.account.balance, { digits: 3 });
    const pos = this.position;
    const pnl = pos && this.quote ? positionPnl(pos, this.quote, this.solUsd) : null;
    if (pnl) {
      r.headChip.className = `head-chip num on ${tone(pnl.pnlPct)}`;
      r.headChip.textContent = fmtPct(pnl.pnlPct, 1, { sign: true });
    } else {
      r.headChip.className = 'head-chip num';
    }
  }

  renderToken() {
    const area = this.refs.tokenArea;
    const q = this.quote;
    if (this.status === 'none' || this.status === 'idle') {
      const n = Object.keys(this.st?.account.positions || {}).length;
      // Con la bienvenida a la vista sobra repetir «abre un token»: ya es su paso 1.
      const onboarding = !this.st?.ui?.onboarded && !this.tour;
      area.innerHTML = `${onboarding ? '' : `<div class="empty">${ICON.target}<p><strong>${tr('Abre un token en Padre')}</strong>${tr('Cuando estés en la página de una memecoin, aquí podrás comprarla y venderla con SOL ficticio.')}</p></div>`}
        ${n ? `<div class="sub-h">${tr('Tus posiciones abiertas')}</div>${this.listHtml()}` : ''}`;
      return;
    }
    if (this.status === 'loading') {
      area.innerHTML = `<div class="token" aria-busy="true"><div class="avatar"></div><span class="skel" style="width:70px"></span><span class="skel" style="width:84px;justify-self:end"></span><span class="skel" style="width:120px"></span><span class="skel" style="width:60px;justify-self:end"></span></div><div class="facts"><span class="skel" style="width:180px"></span></div>`;
      return;
    }
    if (this.status === 'missing') {
      area.innerHTML = `<div class="empty">${ICON.alert}<p><strong>${tr('Aún sin precio para este token')}</strong>${tr('Ni DexScreener ni Jupiter lo tienen todavía (pasa con tokens de hace segundos). Lo vuelvo a intentar solo.')}</p></div>`;
      return;
    }
    if (this.status === 'offline') {
      area.innerHTML = `<div class="empty">${ICON.alert}<p><strong>${tr('Sin conexión con las fuentes de precio')}</strong>${tr('No puedo leer el precio ahora mismo. Reintentando…')}</p></div>`;
      return;
    }
    if (!q) return;
    if (!area.querySelector('.token[data-key]') || area.querySelector('.token').dataset.key !== this.key) {
      const initial = esc((q.symbol || '?').slice(0, 1).toUpperCase());
      area.innerHTML = `
        <div class="token" data-key="${esc(this.key)}">
          <div class="avatar" style="--h:${hueFor(q.symbol)}">${q.icon ? `<img alt="" src="${esc(q.icon)}" referrerpolicy="no-referrer">` : initial}</div>
          <div class="sym">$${esc(q.symbol)}</div>
          <div class="price num" data-ref="price"></div>
          <div class="tname">${esc(q.name)}</div>
          <div class="changes num" data-ref="changes"></div>
        </div>
        <div class="facts">
          <span>MC<b class="num" data-ref="mc"></b></span>
          <span>${tr('Liq.')}<b class="num" data-ref="liq"></b></span>
          <span>SOL<b class="num" data-ref="solp"></b></span>
        </div>`;
      const img = area.querySelector('.avatar img');
      if (img) img.addEventListener('error', () => { img.parentElement.textContent = initial; }, { once: true });
      this.lastPrice = null;
    }
    const $ = (s) => area.querySelector(`[data-ref="${s}"]`);
    const price = $('price');
    if (this.lastPrice != null && q.priceUsd !== this.lastPrice) {
      const cls = q.priceUsd > this.lastPrice ? 'tick-up' : 'tick-down';
      price.classList.remove('tick-up', 'tick-down');
      void price.offsetWidth;
      price.classList.add(cls);
      clearTimeout(this.flashT);
      this.flashT = setTimeout(() => price.classList.remove(cls), 450);
    }
    this.lastPrice = q.priceUsd;
    price.textContent = fmtPrice(q.priceUsd);
    const ch = (label, v) => `<span><em>${label}</em><span class="${tone(v)}">${fmtPct(v, 1, { sign: true })}</span></span>`;
    $('changes').innerHTML = ch('5m', q.change?.m5) + ch('1h', q.change?.h1);
    $('mc').textContent = fmtCompact(q.marketCapUsd, '$');
    $('liq').textContent = q.liquidityUsd ? fmtCompact(q.liquidityUsd, '$') : tr('curva');
    $('liq').title = q.liquidityUsd ? '' : tr('Token en bonding curve: liquidez estimada a partir del market cap');
    $('solp').textContent = this.solUsd ? '$' + fmtNum(this.solUsd, 2) : '—';
  }

  // ---------- ajustes recomendados ----------

  presetSol(P) {
    const bal = this.st?.account.balance ?? 0;
    return Math.max(0.01, Math.round((bal * P.sizePct) / 100 * 100) / 100);
  }

  presetMatches(P) {
    const s = this.settings, r = this.refs;
    const amountOk = s.sizeMode === 'pct'
      ? parseNum(r.amount.value) === P.sizePct
      : Math.abs(parseNum(r.amount.value) - this.presetSol(P)) < 0.0051;
    return amountOk && s.maxSlippagePct === P.maxSlippagePct && s.priorityFee === P.priorityFee
      && r.useSl.checked && parseNum(r.slPct.value) === P.slPct && !!s.useTrail === P.trailing
      && r.useTp.checked && parseNum(r.tpPct.value) === P.tpPct;
  }

  applyPreset(P, auto) {
    const r = this.refs;
    const settings = {
      maxSlippagePct: P.maxSlippagePct, priorityFee: P.priorityFee,
      useSl: true, defaultSlPct: P.slPct, useTrail: P.trailing, useTp: true, defaultTpPct: P.tpPct,
    };
    this.st.settings = { ...this.st.settings, ...settings };
    send({ type: 'saveSettings', settings });
    r.useSl.checked = true; r.slPct.value = fmtNum(P.slPct, 0);
    r.useTp.checked = true; r.tpPct.value = fmtNum(P.tpPct, 0);
    r.amount.value = this.settings.sizeMode === 'pct' ? fmtNum(P.sizePct, 1) : fmtNum(this.presetSol(P), 2);
    if (this.side !== 'buy') this.side = 'buy';
    this.renderTrade(); this.renderQuotes(); this.renderReco();
    this.toast(auto ? 'info' : 'ok', tr(auto ? 'Aplicados automáticamente los ajustes para {name}: {size} % del saldo, Stop −{sl} %{trail}, Take +{tp} %, slippage {slip} % y prioridad {prio} SOL.' : 'Aplicados los ajustes para {name}: {size} % del saldo, Stop −{sl} %{trail}, Take +{tp} %, slippage {slip} % y prioridad {prio} SOL.', { name: tr(P.name).toLowerCase(), size: fmtNum(P.sizePct, 0), sl: P.slPct, trail: P.trailing ? tr(' dinámico') : '', tp: P.tpPct, slip: P.maxSlippagePct, prio: fmtSol(P.priorityFee) }));
  }

  ago(ts) {
    if (!ts) return '';
    const m = Math.max(0, Math.round((Date.now() - ts) / 60000));
    if (m < 1) return tr('hace segundos');
    if (m < 60) return tr('hace {n} min', { n: m });
    const h = Math.round(m / 60);
    if (h < 48) return tr('hace {n} h', { n: h });
    return tr('hace {n} d', { n: Math.round(h / 24) });
  }

  renderReco() {
    const area = this.refs.recoArea;
    const P = this.status === 'ready' ? PRESETS[this.quote?.stage] : null;
    if (!P) { area.innerHTML = ''; return; }
    const open = !!this.st?.ui?.recoOpen;
    const applied = this.presetMatches(P);
    const when = P.id === 'graduated'
      ? (this.quote.graduatedAt ? tr('graduado {ago}', { ago: this.ago(Date.parse(this.quote.graduatedAt)) }) : tr(P.where))
      : (this.quote.pairCreatedAt ? tr('creado {ago}', { ago: this.ago(this.quote.pairCreatedAt) }) : tr(P.where));
    const sol = this.presetSol(P);
    const row = (label, value, why) => `<div class="reco-row"><dt>${label}<b class="num">${value}</b></dt><dd>${why}</dd></div>`;
    area.innerHTML = `
      <div class="reco is-${P.id} ${open ? 'open' : ''}">
        <button class="reco-head" data-act="recoToggle" aria-expanded="${open}" aria-controls="fx-reco-body">
          <span class="stage"><i></i>${tr(P.name)}</span>
          <span class="reco-when">${esc(when)}</span>
          <span class="reco-more">${open ? tr('Ocultar') : tr('Por qué')}${ICON.chevron}</span>
        </button>
        <div class="reco-line">
          <span>${tr('Recomendado: <b class="num">{size} %</b> saldo · Stop <b class="num">−{sl} %</b>{trail} · Take <b class="num">+{tp} %</b> · Slip. <b class="num">{slip} %</b>', { size: fmtNum(P.sizePct, 0), sl: P.slPct, trail: P.trailing ? tr(' din.') : '', tp: P.tpPct, slip: P.maxSlippagePct })}</span>
          <button class="reco-apply ${applied ? 'done' : ''}" data-act="recoApply" ${applied ? 'aria-disabled="true"' : ''}>${applied ? `${ICON.check}${tr('Aplicados')}` : tr('Aplicar')}</button>
        </div>
        <div class="reco-body" id="fx-reco-body" ${open ? '' : 'hidden'}>
          <p class="reco-intro">${tr(P.intro)}</p>
          <dl class="reco-list">
            ${row(tr('Tamaño'), `${fmtNum(P.sizePct, 0)} % · ${fmtSol(sol, { digits: 2 })} SOL`, tr(P.why.size))}
            ${row('Stop', `−${P.slPct} %${P.trailing ? tr(' dinámico') : ''}`, tr(P.why.stop))}
            ${row('Take', `+${P.tpPct} %`, tr(P.why.take))}
            ${row(tr('Slippage máx.'), `${P.maxSlippagePct} %`, tr(P.why.slippage))}
            ${row(tr('Prioridad'), `${fmtSol(P.priorityFee)} SOL`, tr(P.why.priority))}
          </dl>
          <p class="reco-tip">${tr(P.tip)}</p>
          <div class="reco-foot">
            <button class="trail auto" data-act="recoAuto" role="switch" aria-checked="${!!this.settings.autoPreset}"><span class="sw"></span><span>${tr('<b>Aplicar siempre</b> al abrir cada token')}</span></button>
          </div>
          <p class="reco-note">${tr('Son puntos de partida para practicar, no reglas fijas: ajústalos a tu estilo y mira en Estadísticas cuáles te funcionan.')}</p>
        </div>
      </div>`;
  }

  fmtPnl(sol, opts = {}) {
    if (this.settings.pnlUnit === 'usd' && this.solUsd) return fmtUsd(sol * this.solUsd, opts);
    return `${fmtSol(sol, opts)} SOL`;
  }

  renderPosition() {
    const area = this.refs.posArea;
    const pos = this.position;
    if (!pos || this.status !== 'ready') { area.innerHTML = ''; this.editing = null; return; }
    const pnl = positionPnl(pos, this.quote, this.solUsd);
    const t = tone(pnl?.pnlSol);
    const nowMc = this.quote?.marketCapUsd;
    const entryMc = pos.avgEntryUsd && this.quote?.priceUsd
      ? (this.quote.marketCapUsd * pos.avgEntryUsd) / this.quote.priceUsd : pos.entryMcUsd;
    if (!area.querySelector('.pos') || area.querySelector('.pos').dataset.id !== pos.id) {
      area.innerHTML = `
        <div class="pos" data-id="${esc(pos.id)}">
          <span class="pos-label">${tr('Tu posición')}</span>
          <span class="pos-value num" data-ref="pval" style="text-align:right"></span>
          <button class="pos-pnl num" data-ref="ppnl" data-act="unitPnl" title="${tr('Cambiar entre SOL y dólares')}"></button>
          <div class="range" data-ref="prange" hidden>
            <div class="range-track"><i class="range-fill" data-ref="pfill"></i><i class="range-zero" data-ref="pzero"></i><i class="range-peak" data-ref="ppeak" hidden></i><span class="range-dot-wrap" data-ref="pdot"><i class="range-dot"></i></span></div>
            <div class="range-labels"><span class="down" data-ref="plo"></span><span class="up" data-ref="phi"></span></div>
          </div>
          <div class="pos-meta" data-ref="pmeta"></div>
          <div class="targets" data-ref="ptargets"></div>
        </div>`;
    }
    const $ = (s) => area.querySelector(`[data-ref="${s}"]`);
    $('pval').innerHTML = this.settings.pnlUnit === 'usd' && this.solUsd ? fmtUsd(pnl?.value * this.solUsd) : `${fmtSol(pnl?.value)} SOL`;
    $('ppnl').className = `pos-pnl num ${t}`;
    $('ppnl').innerHTML = `${this.fmtPnl(pnl?.pnlSol, { sign: true })}<small>${fmtPct(pnl?.pnlPct, 1, { sign: true })}</small>`;
    $('pmeta').innerHTML = `
      <span>${tr('Entrada')} <b class="num">${fmtCompact(entryMc, '$')}</b> → <b class="num">${fmtCompact(nowMc, '$')}</b></span>
      <span>${tr('Invertido')} <b class="num">${fmtSol(pos.costSol)}</b></span>
      <span><b class="num">${fmtCompact(pos.qty)}</b> tokens</span>`;
    this.renderRange(pnl, pos);
    if (!this.editing) this.renderTargets();
  }

  renderRange(pnl, pos) {
    const $ = (s) => this.refs.posArea.querySelector(`[data-ref="${s}"]`);
    const box = $('prange');
    if (!box) return;
    // Con stop dinámico, el stop efectivo va por debajo del máximo alcanzado.
    const trailing = !!(pos.sl?.trailing && (pos.peakPct ?? 0) > 0);
    const stopLevel = pos.sl ? (trailing ? pos.peakPct - pos.sl.pct : -pos.sl.pct) : null;
    const m = rangeModel(pnl?.pnlPct, pos, stopLevel);
    box.hidden = !m;
    if (!m) return;
    const a = Math.min(m.x0, m.x) * 100, b = Math.max(m.x0, m.x) * 100;
    const fill = $('pfill');
    fill.className = `range-fill ${m.x >= m.x0 ? 'up' : 'down'}`;
    fill.style.clipPath = `inset(0 ${(100 - b).toFixed(2)}% 0 ${a.toFixed(2)}%)`;
    $('pzero').style.transform = `translateX(${(m.x0 * 100).toFixed(2)}%)`;
    const dot = $('pdot');
    dot.style.transform = `translateX(${(m.x * 100).toFixed(2)}%)`;
    dot.className = `range-dot-wrap ${tone(pnl.pnlPct)} ${m.near >= 0.8 ? 'near' : ''}`;
    $('plo').textContent = pos.sl
      ? (trailing ? `${tr('Stop dinámico')} ${fmtPct(stopLevel, 0, { sign: true })}` : `Stop ${fmtPct(-pos.sl.pct, 0)}${pos.sl.trailing ? tr(' · dinámico') : ''}`)
      : '';
    $('phi').textContent = m.hasTp ? `Take ${fmtPct(m.R, 0, { sign: true })}` : '';
    const peak = $('ppeak');
    if (trailing && pos.peakPct > 0) {
      const px = Math.min(1, Math.max(0, (pos.peakPct - m.L) / (m.R - m.L)));
      peak.hidden = false;
      peak.style.transform = `translateX(${(px * 100).toFixed(2)}%)`;
      peak.title = tr('Máximo alcanzado: {p}', { p: fmtPct(pos.peakPct, 1, { sign: true }) });
    } else peak.hidden = true;
    box.setAttribute('aria-label', tr('Recorrido: {p}', { p: fmtPct(pnl.pnlPct, 1, { sign: true }) }));
  }

  renderTargets() {
    const box = this.refs.posArea.querySelector('[data-ref="ptargets"]');
    const pos = this.position;
    if (!box || !pos) return;
    const one = (kind) => {
      const on = !!pos[kind];
      const label = kind === 'tp' ? 'Take profit' : 'Stop loss';
      const short = kind === 'tp' ? 'Take' : (pos.sl?.trailing ? tr('Stop din.') : 'Stop');
      const val = on ? `${kind === 'tp' ? '+' : '−'}${fmtNum(pos[kind].pct, 0)}%` : tr('Añadir');
      return `<button class="target ${kind} ${on ? 'on' : ''}" data-act="editTarget" data-kind="${kind}" aria-label="${label}: ${on ? val : tr('sin fijar')}"><span>${short}</span><b>${val}</b></button>`;
    };
    box.innerHTML = one('sl') + one('tp');
  }

  startEditTarget(kind) {
    const box = this.refs.posArea.querySelector('[data-ref="ptargets"]');
    const pos = this.position;
    if (!box || !pos) return;
    this.editing = kind;
    const btn = box.querySelector(`.target.${kind}`);
    const cur = pos[kind]?.pct ?? (kind === 'tp' ? this.settings.defaultTpPct : this.settings.defaultSlPct);
    const edit = document.createElement('label');
    edit.className = 'target-edit';
    edit.innerHTML = `<span>${kind === 'tp' ? 'Take +' : 'Stop −'}</span><input inputmode="decimal" value="${fmtNum(cur, 0)}" aria-label="${tr('Porcentaje')}"><span>%</span>`;
    btn.replaceWith(edit);
    const input = edit.querySelector('input');
    input.focus(); input.select();
    const commit = async (save) => {
      if (this.editing !== kind) return;
      this.editing = null;
      if (save) {
        const v = parseNum(input.value);
        const payload = { type: 'setTargets', key: this.key };
        payload[kind === 'tp' ? 'tpPct' : 'slPct'] = isFinite(v) && v > 0 ? v : 0;
        const res = await send(payload);
        if (!res.ok) this.toast('err', res.error);
      }
      this.renderTargets();
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') commit(true);
      if (e.key === 'Escape') commit(false);
    });
    input.addEventListener('blur', () => commit(true));
  }

  renderOrders() {
    const area = this.refs.ordersArea;
    const mine = this.status === 'ready' ? this.orders.filter((o) => o.key === this.key) : [];
    if (!mine.length) { area.innerHTML = ''; return; }
    const mc = this.quote?.marketCapUsd;
    area.innerHTML = `<div class="orders">${mine.map((o) => {
      const dist = mc ? (o.mc / mc - 1) * 100 : null;
      return `<div class="order">${ICON.clock}<span>${tr('Comprar <b class="num">{sol} SOL</b> si MC ≤ <b class="num">{mc}</b>', { sol: fmtSol(o.solIn), mc: fmtCompact(o.mc, '$') })}${dist != null ? ` <em class="num">(${fmtPct(dist, 0, { sign: true })})</em>` : ''}</span><button data-act="cancelOrder" data-id="${esc(o.id)}">${tr('Cancelar')}</button></div>`;
    }).join('')}</div>`;
  }

  // Revisión rápida al cerrar una posición.
  openReview(round) {
    this.review = round;
    this.reviewDraft = { tags: [], followedPlan: null };
    this.renderReview();
  }

  renderReview() {
    const area = this.refs.reviewArea;
    const r = this.review;
    if (!r) { area.innerHTML = ''; return; }
    const d = this.reviewDraft;
    const t = tone(r.pnlSol);
    area.innerHTML = `
      <div class="review" role="group" aria-label="${tr('Revisión del trade')}">
        <div class="review-h"><span>${tr('Trade cerrado')} · <b>$${esc(r.symbol)}</b></span><b class="num ${t}">${fmtSol(r.pnlSol, { sign: true })} SOL · ${fmtPct(r.pnlPct, 1, { sign: true })}</b></div>
        <div class="review-q">${tr('¿Seguiste tu plan?')}
          <span class="yn">
            <button data-act="plan" data-v="yes" aria-pressed="${d.followedPlan === true}">${tr('Sí')}</button>
            <button data-act="plan" data-v="no" aria-pressed="${d.followedPlan === false}">${tr('No')}</button>
          </span>
        </div>
        <div class="tags">${REVIEW_TAGS.map((tg) => `<button class="tag-chip" data-act="tag" data-id="${tg.id}" aria-pressed="${d.tags.includes(tg.id)}">${tr(tg.label)}</button>`).join('')}</div>
        <div class="review-a"><button class="link-btn" data-act="reviewSkip">${tr('Ahora no')}</button><button class="btn-brand" data-act="reviewSave">${tr('Guardar revisión')}</button></div>
      </div>`;
  }

  async saveReview() {
    const r = this.review;
    if (!r) return;
    const res = await send({ type: 'review', id: r.id, tags: this.reviewDraft.tags, followedPlan: this.reviewDraft.followedPlan });
    this.review = null;
    this.renderReview();
    if (res.ok) this.toast('ok', tr('Revisión guardada. La verás en Estadísticas: plan vs. sin plan.'));
    else this.toast('err', res.error);
  }

  renderTrade() {
    const r = this.refs;
    const ready = this.status === 'ready';
    r.tradeArea.hidden = !ready;
    if (!ready) return;
    const s = this.settings;
    const hasPos = !!this.position;
    if (!hasPos && this.side === 'sell') this.side = 'buy';
    const seg = this.el.querySelector('.seg');
    seg.dataset.side = this.side;
    seg.querySelectorAll('button').forEach((b) => {
      b.setAttribute('aria-selected', String(b.dataset.side === this.side));
      if (b.dataset.side === 'sell') {
        b.disabled = !hasPos;
        b.title = hasPos ? '' : tr('Compra primero para poder vender');
      }
    });
    r.buyForm.hidden = this.side !== 'buy';
    r.sellForm.hidden = this.side !== 'sell';

    // Tipo de orden
    r.buyForm.querySelectorAll('[data-act="otype"]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.o === this.orderType)));
    r.limitRow.hidden = this.orderType !== 'limit';

    // Unidad SOL / %
    const pct = s.sizeMode === 'pct';
    r.unit.textContent = pct ? tr('% saldo') : 'SOL';
    r.amount.setAttribute('aria-label', pct ? tr('Porcentaje de tu saldo a usar') : tr('Cantidad de SOL a usar'));
    const quick = pct ? s.quickPcts : s.quickBuys;
    const sig = (pct ? 'p' : 's') + quick.join('|');
    if (r.quickBuys.dataset.sig !== sig) {
      r.quickBuys.dataset.sig = sig;
      r.quickBuys.innerHTML = quick.map((v, i) => `<button class="chip num" data-act="quick" data-v="${v}" data-k="${i + 1}" aria-pressed="false">${fmtNum(v, 3)}${pct ? '%' : ''}</button>`).join('');
    }
    r.trailBtn.hidden = !r.useSl.checked;
    r.trailBtn.setAttribute('aria-checked', String(!!s.useTrail));
    this.syncQuickPressed();
    this.syncOpts();
    r.sellChips.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', String(Number(c.dataset.pct) === this.sellPct)));
  }

  syncQuickPressed() {
    const v = parseNum(this.refs.amount.value);
    this.refs.quickBuys.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', String(Number(c.dataset.v) === v)));
  }

  syncOpts(persist) {
    const r = this.refs;
    r.optTp.classList.toggle('on', r.useTp.checked);
    r.optSl.classList.toggle('on', r.useSl.checked);
    r.trailBtn.hidden = !r.useSl.checked;
    if (persist) {
      const tp = parseNum(r.tpPct.value), sl = parseNum(r.slPct.value);
      const settings = { useTp: r.useTp.checked, useSl: r.useSl.checked };
      if (tp > 0) settings.defaultTpPct = tp;
      if (sl > 0) settings.defaultSlPct = sl;
      send({ type: 'saveSettings', settings });
    }
  }

  solFromInput() {
    const v = parseNum(this.refs.amount.value);
    if (!(v > 0)) return NaN;
    if (this.settings.sizeMode === 'pct') return (this.st?.account.balance ?? 0) * Math.min(v, 100) / 100;
    return v;
  }

  dailyState() {
    const limit = Number(this.settings.dailyLossLimit) || 0;
    if (!limit || !this.st) return null;
    const today = realizedSince(this.st.account, startOfDay());
    return { limit, today, locked: today <= -limit };
  }

  initialsPlan() {
    const pos = this.position;
    if (!pos || !this.quote || !this.solUsd) return null;
    const s = this.settings;
    const all = simulateSell({ qty: pos.qty, quote: this.quote, solUsd: this.solUsd, settings: s });
    if (!(all.netSol > pos.costSol)) return { ok: false };
    let lo = 0, hi = pos.qty;
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      if (simulateSell({ qty: mid, quote: this.quote, solUsd: this.solUsd, settings: s }).netSol >= pos.costSol) hi = mid; else lo = mid;
    }
    return { ok: true, pct: (hi / pos.qty) * 100 };
  }

  renderQuotes() {
    const r = this.refs;
    if (this.status !== 'ready' || !this.quote) return;
    const s = this.settings;
    const bal = this.st?.account.balance ?? 0;
    const sym = esc(this.quote.symbol);
    const isLimit = this.orderType === 'limit';

    // Límite diario
    const daily = this.dailyState();
    r.daily.innerHTML = daily
      ? `<span class="${daily.locked ? 'bad' : daily.today < 0 ? 'warn' : ''}" title="${tr('Pérdida realizada hoy frente a tu límite diario')}">${tr('Hoy')} ${fmtSol(daily.today, { sign: true })} / −${fmtSol(daily.limit)}</span>`
      : '';

    // Orden límite
    let limitMc = NaN;
    if (isLimit) {
      limitMc = parseMc(r.limitMc.value);
      const mc = this.quote.marketCapUsd;
      r.limitHint.innerHTML = limitMc > 0 && mc
        ? (limitMc >= mc ? `<span class="bad">${tr('Ya está por debajo ({mc}): usa «Ahora»', { mc: fmtCompact(mc, '$') })}</span>` : tr('Ahora {mc} · tiene que caer un <b>{pct}</b>', { mc: fmtCompact(mc, '$'), pct: fmtPct((1 - limitMc / mc) * 100, 0) }))
        : tr('Ahora {mc}. Escribe p. ej. {ex}', { mc: fmtCompact(mc, '$'), ex: fmtCompact(mc * 0.7, '') });
    }

    // Comprar
    const solIn = this.solFromInput();
    const btn = r.buyForm.querySelector('.go');
    if (solIn > 0) {
      const sim = simulateBuy({ solIn, quote: this.quote, solUsd: this.solUsd, settings: s });
      const costs = (sim.fee || 0) + (sim.priorityFee || 0);
      const parts = [];
      if (s.sizeMode === 'pct') parts.push(`<span>= <b>${fmtSol(solIn)}</b> SOL</span>`);
      if (!isLimit && sim.qty) parts.push(`<span>${tr('Recibes ≈ <b>{qty}</b> {sym}', { qty: fmtCompact(sim.qty), sym })}</span>`);
      if (!isLimit && isFinite(sim.slipPct)) parts.push(`<span class="${sim.slipPct > s.maxSlippagePct ? 'bad' : sim.slipPct > 5 ? 'warn' : ''}">Slippage <b>${fmtPct(sim.slipPct, sim.slipPct < 1 ? 2 : 1)}</b></span>`);
      parts.push(`<span>${tr('Costes')} <b>${fmtSol(costs)}</b></span>`);
      if (sim.totalDebit > bal) parts.push(`<span class="bad">${tr('Saldo insuficiente')}</span>`);
      r.buyQuote.innerHTML = parts.join('');
      r.buyLabel.innerHTML = isLimit
        ? `${tr('Colocar orden')} · ${fmtNum(solIn, 4)} SOL <span class="tag">${tr('práctica')}</span>`
        : `${tr('Comprar')} ${fmtNum(solIn, 4)} SOL <span class="tag">${tr('práctica')}</span>`;
    } else {
      r.buyQuote.innerHTML = `<span>${tr('Disponible <b>{bal}</b> SOL · comisión {fee} + {prio} de prioridad', { bal: fmtSol(bal), fee: fmtPct(s.feePct, 2), prio: fmtSol(s.priorityFee) })}</span>`;
      r.buyLabel.innerHTML = `${isLimit ? tr('Colocar orden') : tr('Comprar')} <span class="tag">${tr('práctica')}</span>`;
    }
    if (daily?.locked) {
      r.buyQuote.innerHTML = `<span class="bad">${tr('Has llegado a tu límite de pérdida diaria. Se desbloquea mañana: aprovecha para revisar tus trades.')}</span>`;
    }
    const stale = !this.tour && this.quote.at && Date.now() - this.quote.at > 15000;
    if (stale) {
      r.buyQuote.innerHTML = `<span class="bad">${tr('Precio congelado: no se puede operar hasta que vuelva a actualizarse.')}</span>`;
    }
    const cantAfford = solIn > 0 && solIn + s.priorityFee > bal + 1e-12;
    const badLimit = isLimit && !(limitMc > 0 && limitMc < (this.quote.marketCapUsd || Infinity));
    btn.disabled = !(solIn > 0) || cantAfford || this.busy || !!daily?.locked || (badLimit) || (stale && !isLimit);
    btn.classList.toggle('limit', isLimit);

    // Vender
    const pos = this.position;
    if (pos) {
      const qty = this.sellPct >= 100 ? pos.qty : pos.qty * (this.sellPct / 100);
      const sim = simulateSell({ qty, quote: this.quote, solUsd: this.solUsd, settings: s });
      const basis = pos.costSol * (qty / pos.qty);
      const pnl = sim.netSol - basis;
      r.sellQuote.innerHTML = [
        `<span>${tr('Recibes ≈ <b>{sol}</b> SOL', { sol: fmtSol(sim.netSol) })}</span>`,
        `<span>${tr('Resultado')} <b class="${tone(pnl)}">${fmtSol(pnl, { sign: true })}</b></span>`,
        `<span class="${sim.slipPct > s.maxSlippagePct ? 'bad' : sim.slipPct > 5 ? 'warn' : ''}">Slippage <b>${fmtPct(sim.slipPct, sim.slipPct < 1 ? 2 : 1)}</b></span>`,
      ].join('');
      r.sellLabel.innerHTML = `${tr('Vender')} ${this.sellPct === 100 ? tr('todo') : this.sellPct + '%'} <span class="tag">${tr('práctica')}</span>`;
      r.sellForm.querySelector('.go').disabled = this.busy || stale;
      if (stale) r.sellQuote.innerHTML = `<span class="bad">${tr('Precio congelado: espera a que se actualice para vender.')}</span>`;
      const plan = this.initialsPlan();
      r.initialsBtn.disabled = !plan?.ok || this.busy || stale;
      r.initialsLabel.innerHTML = plan?.ok
        ? tr('Recuperar lo invertido · vende <b class="num">{pct}</b>', { pct: fmtPct(plan.pct, 0) })
        : tr('Recuperar lo invertido · aún no da');
      r.initialsBtn.title = plan?.ok ? tr('Vende justo lo necesario para recuperar lo que has metido; el resto sigue corriendo gratis') : tr('Ahora mismo vender todo no cubre lo invertido');
    }
  }

  // ---------- lista de posiciones ----------

  listHtml() {
    const positions = Object.entries(this.st?.account.positions || {}).sort((a, b) => b[1].openedAt - a[1].openedAt);
    const orders = this.orders;
    if (!positions.length && !orders.length) {
      return `<div class="empty small">${ICON.stack}<p><strong>${tr('Sin posiciones abiertas')}</strong>${tr('Lo que compres aparecerá aquí, con su resultado en vivo.')}</p></div>`;
    }
    const rows = positions.map(([k, p]) => {
      const q = k === this.key ? this.quote : this.allQuotes[k];
      const pnl = positionPnl(p, q, this.solUsd);
      const t = tone(pnl?.pnlSol);
      const m = rangeModel(pnl?.pnlPct, p);
      const initial = esc((p.symbol || '?').slice(0, 1).toUpperCase());
      const bar = m ? `<span class="mini-range"><i class="${m.x >= m.x0 ? 'up' : 'down'}" style="clip-path:inset(0 ${(100 - Math.max(m.x0, m.x) * 100).toFixed(1)}% 0 ${(Math.min(m.x0, m.x) * 100).toFixed(1)}%)"></i><b style="left:${(m.x0 * 100).toFixed(1)}%"></b></span>` : '';
      return `<button class="prow ${k === this.key ? 'here' : ''}" data-act="goto" data-key="${esc(k)}" data-url="${esc(p.url || '')}">
        <span class="avatar sm" style="--h:${hueFor(p.symbol)}">${p.icon ? `<img alt="" src="${esc(p.icon)}" referrerpolicy="no-referrer">` : initial}</span>
        <span class="prow-main"><b>$${esc(p.symbol)}</b><small class="num">${fmtSol(p.costSol)} → ${pnl ? fmtSol(pnl.value) : '…'} SOL</small></span>
        <span class="prow-end num ${t}">${pnl ? fmtPct(pnl.pnlPct, 1, { sign: true }) : '—'}<small>${pnl ? fmtSol(pnl.pnlSol, { sign: true }) : ''}</small></span>
        ${bar}
      </button>`;
    }).join('');
    const ord = orders.map((o) => `<div class="order">${ICON.clock}<span><b>$${esc(o.symbol)}</b> · ${tr('comprar <b class="num">{sol}</b> si MC ≤ <b class="num">{mc}</b>', { sol: fmtSol(o.solIn), mc: fmtCompact(o.mc, '$') })}</span><button data-act="cancelOrder" data-id="${esc(o.id)}">${tr('Cancelar')}</button></div>`).join('');
    return `<div class="plist">${rows}</div>${ord ? `<div class="sub-h">${tr('Órdenes límite')}</div><div class="orders">${ord}</div>` : ''}`;
  }

  renderList() {
    if (this.view !== 'positions') return;
    const box = this.refs.viewList;
    const back = this.status === 'ready' ? `<button class="back" data-act="view" data-v="positions">${ICON.back}${tr('Volver a')} $${esc(this.quote?.symbol)}</button>` : '';
    box.innerHTML = `<div class="list-wrap">${back}<div class="sub-h">${tr('Posiciones abiertas')}</div>${this.listHtml()}</div>`;
  }

  renderKeys() {
    const row = (k, d) => `<div><span>${k}</span><em>${d}</em></div>`;
    this.refs.viewKeys.innerHTML = `
      <div class="list-wrap">
        <button class="back" data-act="view" data-v="keys">${ICON.back}${tr('Volver')}</button>
        <div class="sub-h">${tr('Atajos (con el ratón encima del panel)')}</div>
        <div class="keys">
          ${row('<kbd>1</kbd><kbd>2</kbd><kbd>3</kbd><kbd>4</kbd>', tr('Comprar con la cantidad rápida'))}
          ${row('<kbd>Q</kbd><kbd>W</kbd><kbd>E</kbd><kbd>R</kbd>', tr('Vender 25 / 50 / 75 / 100 %'))}
          ${row('<kbd>I</kbd>', tr('Recuperar lo invertido'))}
          ${row(`<kbd>B</kbd> <kbd>${tr('V')}</kbd>`, tr('Pestaña Comprar / Vender'))}
          ${row('<kbd>P</kbd>', tr('Ver tus posiciones'))}
          ${row('<kbd>Esc</kbd>', tr('Volver'))}
          ${row('<kbd>Alt</kbd><kbd>Shift</kbd><kbd>F</kbd>', tr('Mostrar u ocultar el panel'))}
        </div>
        <p class="keys-note">${tr('Los atajos solo funcionan con el puntero sobre el panel, así no interfieren con los de Padre.')}</p>
      </div>`;
  }

  renderFresh() {
    const r = this.refs;
    if (!r?.fresh) return;
    const at = this.tour ? Date.now() : this.quote?.at;
    if (this.status !== 'ready' || !at) { r.fresh.className = 'fresh'; r.freshText.textContent = 'DexScreener'; return; }
    const age = Math.max(0, Math.round((Date.now() - at) / 1000));
    r.fresh.className = `fresh ${age <= 8 ? 'is-live' : 'is-stale'}`;
    const isStale = age > 15;
    if (isStale !== this.wasStale) { this.wasStale = isStale; this.renderQuotes(); }
    const src = this.quote?.source === 'jupiter' ? 'Jupiter' : 'DexScreener';
    // En vivo basta con la fuente (el punto verde ya dice «en vivo»); si se retrasa, decimos cuánto.
    r.freshText.textContent = age <= 8 ? src : tr('Hace {n} s', { n: age });
    r.fresh.setAttribute('aria-label', age <= 8 ? tr('En vivo · {src}', { src }) : tr('Hace {n} s · {src}', { n: age, src }));
    r.fresh.title = tr('Fuente del precio: {src}', { src });
  }

  // ---------- acciones ----------

  onClick(e) {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    const r = this.refs;
    if (act === 'tour') { this.startTour(); return; }
    if (act === 'lang') { this.switchLang(); return; }
    if (act === 'collapse') this.toggleCollapse();
    else if (act === 'side') { if (!b.disabled) this.switchSide(b.dataset.side); }
    else if (act === 'otype') { this.orderType = b.dataset.o; this.renderTrade(); this.renderQuotes(); if (this.orderType === 'limit') r.limitMc.focus(); }
    else if (act === 'unit') {
      const sizeMode = this.settings.sizeMode === 'pct' ? 'sol' : 'pct';
      r.amount.value = '';
      this.st.settings = { ...this.st.settings, sizeMode };
      send({ type: 'saveSettings', settings: { sizeMode } });
      this.renderTrade(); this.renderQuotes();
    }
    else if (act === 'quick') { r.amount.value = fmtNum(Number(b.dataset.v), 4); this.syncQuickPressed(); this.renderQuotes(); this.renderReco(); }
    else if (act === 'sellpct') { this.sellPct = Number(b.dataset.pct); this.renderTrade(); this.renderQuotes(); }
    else if (act === 'trail') {
      const useTrail = !this.settings.useTrail;
      this.st.settings = { ...this.st.settings, useTrail };
      if (!this.tour) send({ type: 'saveSettings', settings: { useTrail } });
      this.renderTrade();
    }
    else if (act === 'note') {
      const ta = r[b.dataset.for];
      ta.hidden = !ta.hidden;
      if (!ta.hidden) ta.focus();
    }
    else if (act === 'recoToggle') {
      const recoOpen = !this.st?.ui?.recoOpen;
      this.st.ui = { ...(this.st.ui || {}), recoOpen };
      send({ type: 'saveUi', ui: { recoOpen } });
      this.renderReco();
    }
    else if (act === 'recoApply') { const P = PRESETS[this.quote?.stage]; if (P && !this.presetMatches(P)) this.applyPreset(P, false); }
    else if (act === 'recoAuto') {
      const autoPreset = !this.settings.autoPreset;
      this.st.settings = { ...this.st.settings, autoPreset };
      send({ type: 'saveSettings', settings: { autoPreset } });
      this.renderReco();
      if (autoPreset) this.toast('info', tr('A partir de ahora, al abrir un token se aplicarán sus ajustes recomendados (nuevo par o graduado).'));
    }
    else if (act === 'buy') this.buy();
    else if (act === 'sell') this.sell();
    else if (act === 'initials') this.sellInitials();
    else if (act === 'editTarget') this.startEditTarget(b.dataset.kind);
    else if (act === 'closeToast') this.hideToast();
    else if (act === 'unitPnl') {
      const pnlUnit = this.settings.pnlUnit === 'usd' ? 'sol' : 'usd';
      this.st.settings = { ...this.st.settings, pnlUnit };
      if (!this.tour) send({ type: 'saveSettings', settings: { pnlUnit } });
      this.renderPosition();
    }
    else if (act === 'view') this.setView(b.dataset.v);
    else if (act === 'goto') {
      if (b.dataset.key === this.key) { this.view = 'trade'; this.renderView(); }
      else if (b.dataset.url) location.href = b.dataset.url;
    }
    else if (act === 'cancelOrder') send({ type: 'cancelOrder', id: b.dataset.id }).then(() => this.toast('info', tr('Orden límite cancelada.')));
    else if (act === 'onboarded') send({ type: 'saveUi', ui: { onboarded: true } });
    else if (act === 'plan') { this.reviewDraft.followedPlan = b.dataset.v === 'yes'; this.renderReview(); }
    else if (act === 'tag') {
      const id = b.dataset.id; const tags = this.reviewDraft.tags;
      this.reviewDraft.tags = tags.includes(id) ? tags.filter((t) => t !== id) : [...tags, id];
      this.renderReview();
    }
    else if (act === 'reviewSave') this.saveReview();
    else if (act === 'reviewSkip') { this.review = null; this.renderReview(); }
  }

  startTour() {
    if (this.tour || !this.st) return;
    this.hideToast();
    new Tour(this).start();
  }

  saveUiAfterTour(finished, resume = null) {
    if (this.st) this.st.ui = { ...(this.st.ui || {}), tourResume: resume };
    send({ type: 'saveUi', ui: { onboarded: true, toured: !!finished || !!this.st?.ui?.toured, tourResume: resume } });
    if (finished) this.toast('ok', tr('Recorrido terminado. Puedes repetirlo cuando quieras con el botón ? de abajo.'));
  }

  setBusy(on, which) {
    this.busy = on;
    const btn = this.refs[which === 'buy' ? 'buyForm' : 'sellForm'].querySelector('.go');
    btn.classList.toggle('busy', on);
    btn.disabled = on;
    btn.setAttribute('aria-busy', String(on));
    if (!on) this.renderQuotes();
  }

  async buy() {
    if (this.busy || this.status !== 'ready') return;
    const r = this.refs;
    const solIn = this.solFromInput();
    if (!(solIn > 0)) { r.amount.focus(); return; }
    const tp = r.useTp.checked ? parseNum(r.tpPct.value) : 0;
    const sl = r.useSl.checked ? parseNum(r.slPct.value) : 0;
    const base = { key: this.key, solIn: Math.round(solIn * 1e6) / 1e6, tpPct: tp > 0 ? tp : 0, slPct: sl > 0 ? Math.min(sl, 99) : 0, trailing: !!(sl > 0 && this.settings.useTrail), note: r.buyNote.value.trim(), url: location.href };

    if (this.orderType === 'limit') {
      const mc = parseMc(r.limitMc.value);
      if (!(mc > 0)) { r.limitMc.focus(); return; }
      this.setBusy(true, 'buy');
      const res = await send({ type: 'placeOrder', ...base, mc });
      this.setBusy(false, 'buy');
      if (!res.ok) return this.toast('err', res.error);
      r.limitMc.value = ''; r.buyNote.value = ''; r.buyNote.hidden = true;
      this.orderType = 'market';
      this.renderTrade();
      return this.toast('ok', tr('Orden colocada: comprar {sol} SOL si el MC baja a {mc}. Funciona aunque cierres Padre (mientras el navegador esté abierto).', { sol: fmtSol(base.solIn), mc: fmtCompact(mc, '$') }));
    }

    this.setBusy(true, 'buy');
    const res = await send({ type: 'buy', ...base });
    this.setBusy(false, 'buy');
    if (!res.ok) return this.toast('err', res.error);
    const d = res.data;
    if (!d.ok) return this.toast('err', `${d.error} ${tr('Se cobran {fee} SOL de prioridad, como en real.', { fee: fmtSol(d.chargedFee) })}`);
    r.buyNote.value = ''; r.buyNote.hidden = true;
    this.toast('ok', tr('Compraste {qty} ${sym} a {mc} de MC por {sol} SOL.', { qty: fmtCompact(d.fill.qty), sym: this.quote.symbol, mc: fmtCompact(d.fill.mc, '$'), sol: fmtSol(d.fill.sol) }));
    this.renderQuotes();
  }

  afterSell(d) {
    this.refs.sellNote.value = ''; this.refs.sellNote.hidden = true;
    if (d.round) {
      this.side = 'buy';
      const rr = d.round;
      this.toast(rr.pnlSol >= 0 ? 'ok' : 'info', tr('Posición cerrada: {pnl} SOL ({pct}).', { pnl: fmtSol(rr.pnlSol, { sign: true }), pct: fmtPct(rr.pnlPct, 1, { sign: true }) }));
      this.openReview(rr);
    } else {
      const vars = { qty: fmtCompact(d.fill.qty), sym: this.quote.symbol, sol: fmtSol(d.fill.sol), pnl: fmtSol(d.fill.pnlSol, { sign: true }) };
      this.toast('ok', d.fill.reason === 'initials'
        ? tr('Inversión recuperada: vendiste {qty} ${sym} por {sol} SOL ({pnl}). El resto sigue corriendo gratis.', vars)
        : tr('Vendiste {qty} ${sym} por {sol} SOL ({pnl}).', vars));
    }
    this.renderAll();
  }

  async sell() {
    if (this.busy || this.status !== 'ready' || !this.position) return;
    this.setBusy(true, 'sell');
    const res = await send({ type: 'sell', key: this.key, pct: this.sellPct, note: this.refs.sellNote.value.trim() });
    this.setBusy(false, 'sell');
    if (!res.ok) return this.toast('err', res.error);
    const d = res.data;
    if (!d.ok) return this.toast('err', `${d.error} ${tr('Se cobran {fee} SOL de prioridad, como en real.', { fee: fmtSol(d.chargedFee) })}`);
    this.afterSell(d);
  }

  async sellInitials() {
    if (this.busy || this.status !== 'ready' || !this.position) return;
    this.setBusy(true, 'sell');
    const res = await send({ type: 'sellInitials', key: this.key, note: this.refs.sellNote.value.trim() });
    this.setBusy(false, 'sell');
    if (!res.ok) return this.toast('err', res.error);
    const d = res.data;
    if (!d.ok) return this.toast('err', `${d.error} ${tr('Se cobran {fee} SOL de prioridad, como en real.', { fee: fmtSol(d.chargedFee) })}`);
    this.afterSell(d);
  }

  toast(kind, text) {
    const t = this.refs.toast;
    t.className = `toast show ${kind}`;
    t.innerHTML = `${kind === 'ok' ? ICON.ok : kind === 'info' ? ICON.mark : ICON.err}<p>${esc(text)}</p><button class="x" data-act="closeToast" aria-label="${tr('Cerrar aviso')}">${ICON.x}</button>`;
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.hideToast(), kind === 'err' ? 9000 : 6000);
  }

  hideToast() { this.refs.toast.className = 'toast'; }
}
