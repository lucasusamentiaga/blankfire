// Blankfire — deja los ajustes de Padre en los valores recomendados con un clic.
// Abre el modal de ajustes de Padre y lo recorre como lo haría una persona: presets de ejecución
// (P1 nuevos pares, P2 graduados, P3 salidas urgentes) y la información que el chequeo necesita en Trenches.
// Antes de tocar nada guarda una copia para poder deshacerlo.
import { tr } from '../lib/i18n.js';
import { PRESETS } from '../lib/core.js';

const BACKUP_KEY = 'blankfirePadreBackup';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 5000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() > end) return null;
    await sleep(100);
  }
}

// ---------- Lo que se aplica ----------
function sides(P) {
  return { buy: { prio: P.priorityFee, tip: P.tipSol, slip: P.maxSlippagePct }, sell: { prio: P.priorityFee, tip: P.tipSol, slip: P.sellSlippagePct } };
}
// Prioridad y tip en SOL, slippage en %. MEV «Secure» en todos: evita sándwiches y una orden fallida no cuesta.
export const PADRE_PLAN = {
  // P1 y P2 salen de los ajustes recomendados de la práctica (así nunca se desincronizan); P3 es para salir ya.
  presets: [
    { id: 'normal', n: 1, name: 'P1 · Nuevos pares (curva)', stage: 'new', ...sides(PRESETS.new) },
    { id: 'fast', n: 2, name: 'P2 · Graduados (pool)', stage: 'graduated', ...sides(PRESETS.graduated) },
    { id: 'ultra', n: 3, name: 'P3 · Salida urgente / carrera', buy: { prio: 0.003, tip: 0.005, slip: 35 }, sell: { prio: 0.003, tip: 0.005, slip: 50 } },
  ],
  mev: true,
  // Interruptores, agrupados por dónde viven en el modal de Padre (sección › pestaña › subpestaña).
  // Cada uno: [ancla data-settings-anchor, texto para el usuario, encendido]. Solo cosas que dan seguridad o
  // información para decidir; nada de colores ni gustos personales.
  groups: [
    { path: ['Orders', 'General'], why: 'Seguridad al operar', toggles: [
      ['orders-general-button-cooldown', 'Pausa tras comprar/vender (evita doble clic)'],
      ['orders-general-dev-sold-sound', 'Sonido cuando el dev vende'],
      ['orders-general-hide-high-tax-warning', 'Aviso de tax alto'],
      ['orders-general-hide-low-liquidity-warning', 'Aviso de poca liquidez'],
      ['orders-general-hide-jupiter-route-warning', 'Aviso de ruta rara del agregador'],
    ] },
    { path: ['Instant Trade', 'General'], why: 'Seguridad al operar', toggles: [
      ['instant-trade-general-button-cooldown', 'Pausa tras comprar/vender en compra instantánea'],
      ['instant-trade-general-position-row', 'Ver tu posición en compra instantánea'],
    ] },
    { path: ['Trenches', 'General'], why: 'Trenches más fácil de leer', toggles: [
      ['trenches-general-pause-on-hover', 'La lista se para al pasar el ratón (sin clics equivocados)'],
      ['trenches-general-x-card-xReuse', 'Aviso de cuenta de X reutilizada'],
    ] },
    { path: ['Trenches', 'Token', 'Layout'], why: 'Detectar copias', toggles: [
      ['trenches-token-avatar-reused-warning', 'Aviso de imagen reutilizada'],
      ['trenches-token-socials-reuse-warning', 'Aviso de redes reutilizadas'],
    ] },
    { path: ['Trenches', 'Token', 'Elements'], why: 'Lo que usa el chequeo de monedas', toggles: [
      ['trenches-token-audit-top-10-holders', 'Top 10 holders en Trenches'],
      ['trenches-token-audit-dev-holding', 'Dev holding en Trenches'],
      ['trenches-token-audit-dev-funded', 'De dónde sacó el dev su SOL'],
      ['trenches-token-audit-snipers-count', 'Nº de snipers en Trenches'],
      ['trenches-token-audit-snipers-holding', '% de snipers en Trenches'],
      ['trenches-token-audit-insiders-holding', 'Insiders en Trenches'],
      ['trenches-token-audit-bundles', 'Bundles en Trenches'],
      ['trenches-token-audit-tax', 'Comisión (tax) en Trenches'],
      ['trenches-token-audit-hover-bubble-map', 'Bubble map al pasar el ratón'],
      ['trenches-token-metrics-market-cap', 'Market cap en Trenches'],
      ['trenches-token-metrics-volume', 'Volumen en Trenches'],
      ['trenches-token-metrics-net-buy', 'Compra neta (entra o sale dinero)'],
      ['trenches-token-vitals-total-holders', 'Holders en Trenches'],
      ['trenches-token-vitals-dev-created', 'Monedas que ha creado el dev'],
      ['trenches-token-vitals-fresh-wallet-buys', 'Compras de wallets recién creadas (multicuentas)'],
    ] },
    { path: ['Market', 'Holders'], why: 'Detectar multicuentas', toggles: [
      ['market-holders-column-fundedBy', 'Quién financió a cada holder'],
    ] },
    { path: ['Market', 'Top traders'], why: 'Detectar multicuentas', toggles: [
      ['market-top-traders-column-fundedBy', 'Quién financió a cada top trader'],
    ] },
    { path: ['Market', 'Position'], why: 'PnL honesto', toggles: [
      ['market-position-remaining-basis', 'Lo que te queda, descontando el impacto al vender'],
    ] },
  ],
};

export const planToggles = (plan) => (plan.groups || []).flatMap((g) => g.toggles.map(([a, label, on = true]) => ({ a, label, on, path: g.path, why: g.why })));

// ---------- Acceso al modal de Padre ----------
const visible = (el) => { const r = el?.getBoundingClientRect?.(); return !!r && r.width > 0 && r.height > 0; };
function modalRoot() {
  const search = [...document.querySelectorAll('input')].find((i) => i.placeholder === 'Search settings' && visible(i));
  if (!search) return null;
  let el = search;
  for (let i = 0; i < 10 && el.parentElement; i++) {
    el = el.parentElement;
    if (el.getBoundingClientRect().width > 450 && /Trading/.test(el.innerText || '')) return el;
  }
  return null;
}
async function openSettings() {
  if (modalRoot()) return modalRoot();
  const btn = [...document.querySelectorAll('button[aria-label="Settings"]')].find(visible);
  if (!btn) throw new Error(tr('No encuentro el botón de ajustes de Padre. Abre Padre en una ventana ancha y vuelve a probar.'));
  btn.click();
  const root = await waitFor(modalRoot, 6000);
  if (!root) throw new Error(tr('El modal de ajustes de Padre no se ha abierto.'));
  return root;
}
const byText = (root, sel, text) => [...root.querySelectorAll(sel)].filter((b) => (b.innerText || b.textContent || '').trim() === text && visible(b));
// Barra lateral: el botón con ese texto más a la izquierda. Pestañas: el que no está en la barra lateral.
async function goSection(name) {
  const root = modalRoot();
  const btns = byText(root, 'button', name).sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
  if (!btns[0]) throw new Error(tr('No encuentro la sección «{s}» en los ajustes de Padre.', { s: name }));
  btns[0].click();
  await sleep(500);
}
async function goTab(name) {
  const root = modalRoot();
  const byId = [...root.querySelectorAll('[id^="settings-tab-"]')].find((t) => (t.innerText || '').trim() === name && visible(t));
  if (byId) { byId.click(); await sleep(450); return; }
  const sideRight = Math.max(...byText(root, 'button', 'Orders').map((b) => b.getBoundingClientRect().right), 0);
  const btn = byText(root, 'button', name).find((b) => b.getBoundingClientRect().left > sideRight - 2);
  if (!btn) throw new Error(tr('No encuentro la pestaña «{s}» en los ajustes de Padre.', { s: name }));
  btn.click();
  await sleep(450);
}
// Subpestañas de Trenches › Token (Layout, Styling, Elements…): tienen id propio.
async function goCategory(name) {
  const id = `trenches-token-category-${name.toLowerCase()}`;
  const btn = document.getElementById(id);
  if (!btn || !visible(btn)) throw new Error(tr('No encuentro la pestaña «{s}» en los ajustes de Padre.', { s: name }));
  btn.click();
  await sleep(450);
}
async function goPath([section, tab, cat]) {
  await goSection(section);
  if (tab) await goTab(tab);
  if (cat) await goCategory(cat);
}
async function pickPreset(n) {
  const root = modalRoot();
  const r = [...root.querySelectorAll('[role="radio"]')].find((x) => (x.innerText || '').trim() === `Preset ${n}`);
  if (!r) throw new Error(tr('No encuentro el preset {n} de Padre.', { n }));
  if (r.getAttribute('aria-checked') !== 'true') r.click();
  await waitFor(() => r.getAttribute('aria-checked') === 'true', 2000);
  await sleep(300);
}
async function pickSide(side) {
  const root = modalRoot();
  const label = side === 'buy' ? 'Buy settings' : 'Sell settings';
  const leaf = [...root.querySelectorAll('*')].find((n) => n.childElementCount === 0 && n.textContent.trim() === label && visible(n));
  if (!leaf) throw new Error(tr('No encuentro «{s}» en Padre.', { s: label }));
  (leaf.closest('[role="radio"], [role="tab"], label') || leaf).click();
  await sleep(300);
}
function inputFor(label) {
  const root = modalRoot();
  const leaf = [...root.querySelectorAll('*')].find((n) => n.childElementCount === 0 && n.textContent.trim() === label && visible(n));
  let b = leaf;
  for (let i = 0; i < 4 && b; i++) { b = b.parentElement; const inp = b?.querySelector('input'); if (inp) return inp; }
  return null;
}
function setInput(inp, v) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  inp.focus();
  setter.call(inp, String(v));
  inp.dispatchEvent(new Event('input', { bubbles: true }));
  inp.dispatchEvent(new Event('change', { bubbles: true }));
  inp.blur();
}
// Interruptor «Off / Secure»: está en Secure si su opción «Secure» no es la «Unselected».
function mevSwitch() {
  return [...modalRoot().querySelectorAll('[role="switch"]')].find((b) => /Off\s*Secure/.test((b.innerText || '').replace(/\n/g, ' ')));
}
function mevIsSecure() {
  const opt = [...(mevSwitch()?.children || [])].find((c) => /Secure/.test(c.innerText || ''));
  return opt ? !/unselected/i.test(String(opt.className)) : null;
}
async function setMev(secure) {
  const before = mevIsSecure();
  if (before === null || before === secure) return before;
  const opt = [...mevSwitch().children].find((c) => (secure ? /Secure/ : /Off/).test(c.innerText || ''));
  (opt || mevSwitch()).click();
  await waitFor(() => mevIsSecure() === secure, 1500);
  return before;
}
function toggleState(anchor) {
  const el = modalRoot()?.querySelector(`[data-settings-anchor="${anchor}"]`);
  if (!el) return { el: null, on: null };
  const own = el.getAttribute('aria-pressed') ?? el.getAttribute('aria-checked');
  const sw = own == null ? el.querySelector('[role="switch"], [aria-pressed], [aria-checked]') : null;
  const st = own ?? sw?.getAttribute('aria-pressed') ?? sw?.getAttribute('aria-checked') ?? el.getAttribute('data-visible');
  return { el: sw || el, on: st === 'true' };
}
async function closeSettings() {
  const root = modalRoot();
  if (!root) return;
  const x = [...root.querySelectorAll('button')].find((b) => /close/i.test(b.getAttribute('aria-label') || '')) || null;
  if (x) x.click();
  else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await waitFor(() => !modalRoot(), 2000);
}

// ---------- Leer y escribir ----------
async function readPreset(p) {
  const out = {};
  await pickPreset(p.n);
  for (const side of ['buy', 'sell']) {
    await pickSide(side);
    out[side] = { prio: inputFor('Prio')?.value ?? null, tip: inputFor('Tip')?.value ?? null, slip: inputFor('Slippage')?.value ?? null, mev: mevIsSecure() };
  }
  return out;
}

// plan: { presets: [{n, buy:{prio,tip,slip,mev?}, sell:{…}}], mev, groups: [{ path, toggles: [[anchor, label, on?]] }] }
// onStep(texto) informa del progreso. Devuelve { changes: [...], backup }.
export async function applyPadrePlan(plan, { onStep = () => {}, backup = true } = {}) {
  const changes = [];
  const prev = { presets: [], groups: [] };
  await openSettings();
  try {
    // 1) Presets de ejecución
    onStep(tr('Presets de compra y venta…'));
    await goSection('Orders');
    await goTab('Presets');
    for (const p of plan.presets) {
      const old = await readPreset(p);
      prev.presets.push({ n: p.n, id: p.id, buy: old.buy, sell: old.sell });
      for (const side of ['buy', 'sell']) {
        await pickPreset(p.n);
        await pickSide(side);
        const want = p[side];
        for (const [label, key] of [['Prio', 'prio'], ['Tip', 'tip'], ['Slippage', 'slip']]) {
          if (want[key] == null) continue;
          const inp = inputFor(label);
          if (!inp) throw new Error(tr('No encuentro la casilla «{s}» del preset {n}.', { s: label, n: p.n }));
          if (Number(inp.value) !== Number(want[key])) {
            setInput(inp, want[key]);
            await sleep(650);   // Padre guarda cada casilla con un pequeño retraso
            changes.push({ what: `P${p.n} ${side === 'buy' ? tr('compra') : tr('venta')} · ${label}`, from: old[side][key], to: String(want[key]) });
          }
        }
        const mevWant = want.mev ?? plan.mev;
        if (mevWant != null) {
          const was = await setMev(mevWant);
          if (was !== null && was !== mevWant) changes.push({ what: `P${p.n} ${side === 'buy' ? tr('compra') : tr('venta')} · MEV`, from: was ? 'Secure' : 'Off', to: mevWant ? 'Secure' : 'Off' });
        }
      }
    }
    // 2) Interruptores, sección por sección. Si Padre quita una opción, se salta sin romper nada.
    for (const g of plan.groups || []) {
      onStep(tr('Ajustes de {s}…', { s: g.path.join(' › ') }));
      try { await goPath(g.path); } catch { continue; }   // esa sección ya no existe en esta versión de Padre
      for (const [anchor, label, wantOn = true] of g.toggles) {
        const { el, on } = toggleState(anchor);
        if (!el) continue;
        prev.groups ||= [];
        let pg = prev.groups.find((x) => x.path.join('/') === g.path.join('/'));
        if (!pg) { pg = { path: g.path, why: g.why, toggles: [] }; prev.groups.push(pg); }
        pg.toggles.push([anchor, label, on]);
        if (on !== wantOn) {
          el.click();
          await waitFor(() => toggleState(anchor).on === wantOn, 1500);
          changes.push({ what: tr(label), from: on ? tr('Sí') : tr('No'), to: wantOn ? tr('Sí') : tr('No') });
        }
      }
    }
    // 3) Comprobación: Padre guarda cada casilla con un pequeño retraso y a veces pierde alguna si se
    //    escriben muy seguidas. Releemos todo y reescribimos lo que no se haya quedado (hasta 3 vueltas).
    onStep(tr('Comprobando…'));
    await goSection('Orders');
    await goTab('Presets');
    for (let round = 0; round < 3; round++) {
      const bad = [];
      for (const p of plan.presets) {
        const now = await readPreset(p);
        for (const side of ['buy', 'sell']) {
          for (const [label, key] of [['Prio', 'prio'], ['Tip', 'tip'], ['Slippage', 'slip']]) {
            if (p[side][key] != null && Number(now[side][key]) !== Number(p[side][key])) bad.push({ p, side, label, key });
          }
        }
      }
      if (!bad.length) break;
      if (round === 2) {
        const b = bad[0];
        throw new Error(tr('Padre no guardó el {k} del preset {n}. Revísalo a mano en Ajustes → Orders → Presets.', { k: b.label, n: b.p.n }));
      }
      for (const b of bad) {
        await pickPreset(b.p.n);
        await pickSide(b.side);
        const inp = inputFor(b.label);
        if (inp) { setInput(inp, b.p[b.side][b.key]); await sleep(900 + round * 600); }
      }
      // Cambiar de preset y volver obliga a Padre a guardar lo pendiente.
      await pickPreset(plan.presets[0].n === 1 ? 2 : 1);
      await sleep(400);
    }
    await pickPreset(1);
    await pickSide('buy');
  } finally {
    await closeSettings();
  }
  if (backup && changes.length) {
    try { await chrome.storage.local.set({ [BACKUP_KEY]: { at: Date.now(), plan: prev } }); } catch { /* sin copia */ }
  }
  return { changes, backup: prev };
}

export async function getPadreBackup() {
  try { return (await chrome.storage.local.get(BACKUP_KEY))[BACKUP_KEY] || null; } catch { return null; }
}

// Deshacer: vuelve a escribir los valores que había antes de optimizar.
export async function restorePadreBackup({ onStep } = {}) {
  const b = await getPadreBackup();
  if (!b?.plan) throw new Error(tr('No hay ninguna copia de tus ajustes anteriores de Padre.'));
  const num = (v) => (v == null || v === '' ? null : Number(v));
  const plan = {
    presets: b.plan.presets.map((p) => ({ n: p.n, id: p.id, buy: { prio: num(p.buy.prio), tip: num(p.buy.tip), slip: num(p.buy.slip), mev: p.buy.mev ?? undefined }, sell: { prio: num(p.sell.prio), tip: num(p.sell.tip), slip: num(p.sell.slip), mev: p.sell.mev ?? undefined } })),
    mev: null,
    // Copias de versiones anteriores (lista plana de Trenches) siguen sirviendo para deshacer.
    groups: b.plan.groups ? b.plan.groups.map((g) => ({ path: g.path, toggles: g.toggles.filter((t) => t[2] != null) }))
      : [{ path: ['Trenches', 'Token', 'Elements'], toggles: (b.plan.toggles || []).filter((t) => t[2] != null && t[0].startsWith('trenches-')) },
         { path: ['Instant Trade', 'General'], toggles: (b.plan.toggles || []).filter((t) => t[2] != null && t[0].startsWith('instant-trade-')) }],
  };
  const res = await applyPadrePlan(plan, { onStep, backup: false });
  try { await chrome.storage.local.remove(BACKUP_KEY); } catch { /* ya está */ }
  return res;
}
