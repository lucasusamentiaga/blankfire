// Blankfire — aviso de nueva versión publicada en GitHub (panel y ventana comparten la tarjeta).
import { tr, getLang } from './i18n.js';

export const UPD_KEY = 'blankfireUpdate';
export const REPO = 'https://github.com/lucasusamentiaga/blankfire';
export const RAW = 'https://raw.githubusercontent.com/lucasusamentiaga/blankfire/main/';
export const ZIP = `${REPO}/archive/refs/heads/main.zip`;
const SNOOZE_MS = 24 * 3600e3;

// 1.10.0 > 1.9.2 (no vale comparar como texto).
export function cmpVer(a, b) {
  const pa = String(a || '0').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b || '0').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

export function installedVersion() {
  try { return chrome.runtime.getManifest().version; } catch { return '0'; }
}

// Qué toca enseñar: 'available' (hay versión nueva), 'done' (recién actualizado) o null.
export function updateView(info, { respectSnooze = true } = {}) {
  if (!info || typeof info !== 'object') return null;
  const cur = installedVersion();
  if (info.justUpdated?.to === cur && !info.justUpdated.seen) return 'done';
  if (info.latest && cmpVer(info.latest, cur) > 0) {
    if (respectSnooze && info.snooze?.version === info.latest && Date.now() < info.snooze.until) return null;
    return 'available';
  }
  return null;
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MARK = '<svg viewBox="0 0 100 100" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="M57 5C61 25 79 38 79 62A29 29 0 0 1 21 62C21 47 28 38 36 31C37 39 41 43 45 45C43 31 49 17 57 5ZM50 48.5A13.5 13.5 0 0 1 50 75.5A13.5 13.5 0 0 1 50 48.5Z"/></svg>';
const CHECK = '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3.5 8.4l2.9 2.9 6.1-6.6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const X = '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';

function notesFor(info, version) {
  const r = info.notes && (info.notes.version === version) ? info.notes : null;
  const list = r ? (getLang() === 'en' ? r.en : r.es) || r.es || [] : [];
  return list.slice(0, 4);
}

// Tarjeta. data-upd="reload" | "later" | "seen" | "check" son las acciones (las engancha quien la pinta).
export function updateCard(info, view, { compact = false } = {}) {
  const cur = installedVersion();
  if (view === 'done') {
    const notes = notesFor(info, cur);
    return `<div class="upd done${compact ? ' compact' : ''}" role="status">
      <div class="upd-h">
        <span class="upd-mark">${MARK}</span>
        <div class="upd-t"><strong>${tr('Blankfire actualizado')}</strong><span class="upd-v"><span class="upd-old num">${esc(info.justUpdated.from)}</span><span class="upd-arr" aria-hidden="true">→</span><span class="upd-new num">${esc(cur)}</span></span></div>
        <button class="upd-x" data-upd="seen" aria-label="${tr('Cerrar aviso')}">${X}</button>
      </div>
      ${notes.length ? `<ul class="upd-notes">${notes.map((n, i) => `<li style="--i:${i}">${CHECK}<span>${esc(n)}</span></li>`).join('')}</ul>` : `<p class="upd-p">${tr('Tus datos, posiciones y ajustes siguen intactos.')}</p>`}
      <div class="upd-a"><button class="upd-btn" data-upd="seen">${tr('¡A practicar!')}</button></div>
    </div>`;
  }
  const notes = notesFor(info, info.latest);
  return `<div class="upd${compact ? ' compact' : ''}" role="region" aria-label="${tr('Nueva versión disponible')}">
    <div class="upd-h">
      <span class="upd-mark">${MARK}<i class="upd-dot" aria-hidden="true"></i></span>
      <div class="upd-t"><strong>${tr('Nueva versión disponible')}</strong><span class="upd-v"><span class="upd-old num">${esc(cur)}</span><span class="upd-arr" aria-hidden="true">→</span><span class="upd-new num">${esc(info.latest)}</span></span></div>
      <button class="upd-x" data-upd="later" aria-label="${tr('Recordármelo mañana')}" title="${tr('Recordármelo mañana')}">${X}</button>
    </div>
    ${notes.length ? `<ul class="upd-notes">${notes.map((n, i) => `<li style="--i:${i}">${CHECK}<span>${esc(n)}</span></li>`).join('')}</ul>` : ''}
    <ol class="upd-steps">
      <li><i>1</i><span>${tr('Descarga la versión nueva: doble clic en <b>actualizar.bat</b>, en la carpeta de Blankfire. ¿Sin Git? <a href="{zip}" target="_blank" rel="noopener">Baja el ZIP</a> y reemplaza la carpeta <b>Fogueo</b>.', { zip: ZIP })}</span></li>
      <li><i>2</i><span>${tr('Pulsa <b>Recargar Blankfire</b>. Tus datos se quedan.')}</span></li>
    </ol>
    <div class="upd-a">
      <button class="upd-btn" data-upd="reload">${tr('Recargar Blankfire')}</button>
      <a class="upd-link" href="${REPO}/commits/main" target="_blank" rel="noopener">${tr('Novedades')}</a>
      <button class="upd-link" data-upd="later">${tr('Más tarde')}</button>
    </div>
  </div>`;
}

export async function readUpdate() {
  try { return (await chrome.storage.local.get(UPD_KEY))[UPD_KEY] || {}; } catch { return {}; }
}

export async function patchUpdate(patch) {
  const cur = await readUpdate();
  await chrome.storage.local.set({ [UPD_KEY]: { ...cur, ...patch } });
}

// Acciones comunes de la tarjeta.
export async function onUpdateAction(act, info) {
  if (act === 'later') return patchUpdate({ snooze: { version: info.latest, until: Date.now() + SNOOZE_MS } });
  if (act === 'seen') return patchUpdate({ justUpdated: { ...(info.justUpdated || {}), seen: true } });
  if (act === 'reload') return chrome.runtime.sendMessage({ type: 'reloadExt' }).catch(() => {});
  return null;
}
