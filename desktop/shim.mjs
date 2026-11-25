// Blankfire de escritorio · imitación de las APIs de extensión (chrome.*) que usa el motor.
// El motor (Fogueo/background.js) corre tal cual en Node: aquí le damos almacenamiento en disco,
// alarmas, avisos y mensajería. Nada de esto sale del PC.
import fs from 'node:fs';
import path from 'node:path';

export function makeChrome({ dataDir, baseUrl, manifest, notify, broadcast, onReload }) {
  const file = path.join(dataDir, 'storage.json');
  let data = {};
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { data = {}; }
  // Guardado atómico: se escribe a un archivo temporal y se renombra, así un apagón no deja el JSON a medias.
  let writing = Promise.resolve(), dirty = false;
  const flush = () => {
    dirty = true;
    writing = writing.then(async () => {
      if (!dirty) return;
      dirty = false;
      const tmp = file + '.tmp';
      await fs.promises.writeFile(tmp, JSON.stringify(data));
      await fs.promises.rename(tmp, file);
    }).catch((e) => console.error('[storage]', e));
    return writing;
  };
  const changeListeners = [];
  const emit = (changes, area) => {
    for (const fn of changeListeners) { try { fn(changes, area); } catch (e) { console.error(e); } }
    broadcast?.('storage-changed', { changes, area });
  };
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const pick = (store, keys) => {
    if (keys == null) return clone(store);
    if (typeof keys === 'string') keys = [keys];
    if (Array.isArray(keys)) return Object.fromEntries(keys.filter((k) => k in store).map((k) => [k, clone(store[k])]));
    return Object.fromEntries(Object.entries(keys).map(([k, d]) => [k, k in store ? clone(store[k]) : d]));
  };
  const area = (store, name, persist) => ({
    async get(keys, cb) { const r = pick(store, keys); cb?.(r); return r; },
    async set(obj, cb) {
      const changes = {};
      for (const [k, v] of Object.entries(obj || {})) { changes[k] = { oldValue: store[k], newValue: clone(v) }; store[k] = clone(v); }
      if (persist) await flush();
      emit(changes, name); cb?.(); 
    },
    async remove(keys, cb) {
      const changes = {};
      for (const k of [].concat(keys)) if (k in store) { changes[k] = { oldValue: store[k] }; delete store[k]; }
      if (persist) await flush();
      emit(changes, name); cb?.();
    },
    async clear() { const ks = Object.keys(store); return this.remove(ks); },
    setAccessLevel: async () => {},
  });
  const session = {};
  const listeners = { message: [], alarm: [], installed: [], startup: [], notifClick: [] };
  const alarms = new Map();
  const event = (list) => ({ addListener: (fn) => list.push(fn), removeListener: (fn) => { const i = list.indexOf(fn); if (i >= 0) list.splice(i, 1); }, hasListener: (fn) => list.includes(fn) });
  const fire = (a) => { for (const fn of listeners.alarm) { try { fn({ name: a.name, periodInMinutes: a.periodInMinutes, scheduledTime: Date.now() }); } catch (e) { console.error(e); } } };

  const chrome = {
    storage: { local: area(data, 'local', true), session: area(session, 'session', false), onChanged: event(changeListeners) },
    runtime: {
      id: 'blankfire-desktop',
      lastError: undefined,
      getURL: (p = '') => baseUrl + String(p).replace(/^\//, ''),
      getManifest: () => manifest,
      reload: () => onReload?.(),
      onMessage: event(listeners.message),
      onInstalled: event(listeners.installed),
      onStartup: event(listeners.startup),
      // El motor se manda mensajes a sí mismo en algún caso: se atienden igual que los de las ventanas.
      sendMessage: (msg, cb) => dispatch(msg, { id: 'blankfire-desktop', url: baseUrl + '_engine' }).then((r) => { cb?.(r); return r; }),
    },
    alarms: {
      create(name, info = {}) {
        if (typeof name === 'object') { info = name; name = ''; }
        clearInterval(alarms.get(name)?.timer); clearTimeout(alarms.get(name)?.first);
        const period = Math.max(0.05, Number(info.periodInMinutes) || 0);
        const a = { name, periodInMinutes: period || undefined };
        const delay = (Number(info.delayInMinutes) || period || 0) * 60e3;
        a.first = setTimeout(() => { fire(a); if (period) a.timer = setInterval(() => fire(a), period * 60e3); }, delay);
        alarms.set(name, a);
      },
      get(name, cb) { const a = alarms.get(name); const r = a ? { name, periodInMinutes: a.periodInMinutes } : undefined; cb?.(r); return Promise.resolve(r); },
      async clear(name, cb) { const a = alarms.get(name); if (a) { clearTimeout(a.first); clearInterval(a.timer); alarms.delete(name); } cb?.(!!a); return !!a; },
      onAlarm: event(listeners.alarm),
    },
    notifications: {
      create(id, opts, cb) { if (typeof id === 'object') { opts = id; id = 'n' + Date.now(); } notify?.(id, opts, () => listeners.notifClick.forEach((fn) => fn(id))); cb?.(id); return Promise.resolve(id); },
      clear: async () => true,
      onClicked: event(listeners.notifClick),
    },
    // En el escritorio no hay permisos que pedir: las conexiones las decide el propio programa.
    permissions: { contains: async () => true, request: async () => true },
    tabs: { query: async () => [], sendMessage: async () => undefined, create: async () => ({}), update: async () => ({}), reload: async () => {} },
    windows: { update: async () => ({}) },
    action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {}, setBadgeTextColor: async () => {} },
  };

  function dispatch(msg, sender) {
    return new Promise((resolve) => {
      let done = false;
      const reply = (r) => { if (!done) { done = true; resolve(r); } };
      let async = false;
      for (const fn of listeners.message) {
        try { const r = fn(msg, sender, reply); if (r === true) async = true; } catch (e) { reply({ ok: false, error: e.message }); }
      }
      if (!async) setTimeout(() => reply(undefined), 0);
    });
  }
  return { chrome, dispatch, flush: () => writing, startup: () => { listeners.startup.forEach((fn) => fn()); } };
}
