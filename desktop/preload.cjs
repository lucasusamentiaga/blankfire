// Puente entre las ventanas de Blankfire y el motor. Solo expone lo que usan las páginas de la extensión.
const { contextBridge, ipcRenderer } = require('electron');
const changeFns = [];
ipcRenderer.on('storage-changed', (_e, { changes, area }) => {
  if (area !== 'local') return;   // lo de la sesión (clave de la wallet) no se reenvía a las ventanas
  for (const fn of changeFns) { try { fn(changes, area); } catch (e) { console.error(e); } }
});
const runtime = {
  id: 'blankfire-desktop',
  lastError: undefined,
  sendMessage: (msg, cb) => {
    const p = ipcRenderer.invoke('bf:msg', msg);
    if (typeof cb === 'function') { p.then((r) => cb(r), (e) => cb({ ok: false, error: String(e?.message || e) })); return undefined; }
    return p;
  },
  getURL: (p = '') => 'blankfire://app/' + String(p).replace(/^\//, ''),
};
// «window.chrome» ya existe en Chromium: se expone como bfChrome y un script propio lo coloca en su sitio.
contextBridge.exposeInMainWorld('bfChrome', {
  runtime,
  storage: {
    local: { get: (keys, cb) => { const p = ipcRenderer.invoke('bf:storage', 'get', 'local', keys); if (cb) p.then(cb); return p; } },
    onChanged: { addListener: (fn) => changeFns.push(fn) },
  },
  permissions: { request: async () => true, contains: async () => true },
});
contextBridge.exposeInMainWorld('blankfireDesktop', { version: process.versions.electron ? 'desktop' : '' });
window.addEventListener('DOMContentLoaded', () => { document.documentElement.dataset.shell = 'desktop'; });
