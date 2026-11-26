// Blankfire de escritorio · proceso principal.
// Arranca el mismo motor que la extensión (Fogueo/background.js) sin navegador, enseña sus ventanas
// (Bot, Radar, Repetición) y se queda en la bandeja del sistema vigilando aunque cierres la ventana.
const { app, BrowserWindow, Tray, Menu, Notification, ipcMain, protocol, net, shell, nativeTheme, nativeImage, dialog } = require('electron');
const { execFile } = require('node:child_process');
const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..', 'Fogueo');
const SCHEME = 'blankfire';
const BASE = `${SCHEME}://app/`;
const PAGES = { bot: 'bot/bot.html', radar: 'radar/radar.html', replay: 'replay/replay.html' };

// Una sola copia: si ya está abierta, la segunda solo enseña la ventana de la primera.
// Sale al momento (app.exit), antes de arrancar un segundo motor que podría operar en paralelo.
const FIRST = app.requestSingleInstanceLock();
if (!FIRST) app.exit(0);

// Para pruebas automáticas: carpeta de datos aparte y captura de la ventana (no afecta al uso normal).
if (process.env.BLANKFIRE_DATA) app.setPath('userData', process.env.BLANKFIRE_DATA);
protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);
nativeTheme.themeSource = 'dark';

let win = null, tray = null, engine = null, quitting = false;
const icon = (s = 128) => nativeImage.createFromPath(path.join(ROOT, 'icons', `icon${s}.png`));
// Icono de la bandeja nítido también en pantallas con escalado (16 px y su versión al doble).
function trayIcon() {
  const img = nativeImage.createFromPath(path.join(ROOT, 'icons', 'icon16.png'));
  img.addRepresentation({ scaleFactor: 2, buffer: fs.readFileSync(path.join(ROOT, 'icons', 'icon32.png')) });
  return img;
}
const AUMID = 'gg.blankfire.desktop';
const APP_ARGS = [path.resolve(__dirname)];
app.setAppUserModelId(AUMID);
// Windows solo enseña los avisos de una app si su acceso directo del menú Inicio lleva su identificador:
// se crea (o se arregla) al arrancar, y el del escritorio también.
function ensureShortcuts() {
  if (process.platform !== 'win32' || process.env.BLANKFIRE_DATA) return;
  const link = { target: process.execPath, args: `"${APP_ARGS[0]}"`, cwd: APP_ARGS[0], icon: path.join(__dirname, 'blankfire.ico'), iconIndex: 0, appUserModelId: AUMID, description: 'Blankfire: bot de práctica y dinero real' };
  if (!fs.existsSync(link.icon)) { link.icon = process.execPath; }
  for (const dir of [path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs'), app.getPath('desktop')]) {
    try { const f = path.join(dir, 'Blankfire.lnk'); shell.writeShortcutLink(f, fs.existsSync(f) ? 'replace' : 'create', link); } catch (e) { console.error('[acceso directo]', e.message); }
  }
}

function broadcast(channel, payload) {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(channel, payload);
}

function notify(id, opts, onClick) {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title: opts.title || 'Blankfire', body: opts.message || '', icon: icon(128), silent: false });
  n.on('click', () => { show(); onClick?.(); });
  n.show();
}

async function startEngine() {
  const dataDir = app.getPath('userData');
  fs.mkdirSync(dataDir, { recursive: true });
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  const { makeChrome } = await import(pathToFileURL(path.join(__dirname, 'shim.mjs')).href);
  engine = makeChrome({ dataDir, baseUrl: BASE, manifest: { ...manifest, desktop: true }, notify, broadcast, onReload: () => { app.relaunch(); app.exit(0); } });
  globalThis.chrome = engine.chrome;
  // Node de Electron no trae «navigator»: el motor lo usa para el idioma y el nombre del equipo.
  if (!globalThis.navigator) globalThis.navigator = { userAgent: 'Blankfire Desktop', language: app.getLocale() };
  globalThis.BLANKFIRE_DESKTOP = true;
  await import(pathToFileURL(path.join(ROOT, 'background.js')).href);
  engine.startup();
}

function createWindow(page = 'bot') {
  if (win && !win.isDestroyed()) { win.loadURL(BASE + PAGES[page]); show(); return; }
  win = new BrowserWindow({
    width: 1440, height: 940, minWidth: 980, minHeight: 640,
    backgroundColor: '#1a1714', show: false, icon: icon(128), title: 'Blankfire',
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false },
  });
  win.removeMenu();
  win.once('ready-to-show', () => win.show());
  if (process.env.BLANKFIRE_SHOT) {
    win.webContents.on('console-message', (_e, level, message, line, src) => console.log('[page]', level, message, src, line));
    win.webContents.once('did-finish-load', () => setTimeout(async () => {
      if (process.env.BLANKFIRE_EVAL) await win.webContents.executeJavaScript(process.env.BLANKFIRE_EVAL).catch((e) => console.error('[eval]', e));
      await new Promise((r) => setTimeout(r, 1200));
      const img = await win.webContents.capturePage();
      fs.writeFileSync(process.env.BLANKFIRE_SHOT, img.toPNG());
      console.log('[shot]', await win.webContents.executeJavaScript('document.title + " | " + document.body.innerText.slice(0, 300).replace(/\\s+/g, " ")'));
      quitting = true; app.exit(0);
    }, 2500));
  }
  win.loadURL(BASE + PAGES[page]);
  // Los enlaces externos (Padre, Solscan, RugCheck…) se abren en tu navegador, nunca dentro de la app.
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(BASE)) { e.preventDefault(); if (/^https:\/\//.test(url)) shell.openExternal(url); } });
  // Cerrar la ventana no para el bot: se queda en la bandeja.
  win.on('close', (e) => {
    if (quitting) return;
    e.preventDefault(); win.hide();
    if (!app.__toldTray) { app.__toldTray = true; notify('tray', { title: 'Blankfire sigue vigilando', message: 'El bot sigue en marcha en la bandeja (junto al reloj). Para salir del todo: clic derecho en el icono → Salir.' }); }
  });
}
function show() { if (!win || win.isDestroyed()) return createWindow(); if (win.isMinimized()) win.restore(); win.show(); win.focus(); }

// ---------- Actualizaciones ----------
// La app vive en tu copia del repositorio: actualizar es bajarse lo nuevo de GitHub (git pull) y reiniciar.
// Eso actualiza a la vez los archivos de la extensión (en Opera solo hay que pulsar «recargar»).
const REPO = path.resolve(__dirname, '..');
let updates = { n: 0, at: 0, busy: false, told: 0 };
const git = (args, opts = {}) => new Promise((res) => execFile('git', ['-C', REPO, ...args], { windowsHide: true, timeout: 60000, ...opts }, (err, out, errOut) => res({ ok: !err, out: String(out || '').trim(), err: String(errOut || err?.message || '').trim() })));
const fileHash = (f) => { try { return crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex'); } catch { return ''; } };
async function checkUpdates({ quiet = true } = {}) {
  if (process.env.BLANKFIRE_DATA) return;
  const f = await git(['fetch', '-q', 'origin']);
  if (!f.ok) { if (!quiet) notify('upd', { title: 'Blankfire', message: 'No he podido mirar si hay actualizaciones (¿sin conexión?).' }); return; }
  const c = await git(['rev-list', '--count', 'HEAD..@{u}']);
  updates.n = c.ok ? Number(c.out) || 0 : 0; updates.at = Date.now();
  if (updates.n > 0 && updates.told !== updates.n) { updates.told = updates.n; notify('upd', { title: 'Blankfire · hay una actualización', message: 'Clic derecho en el icono de la bandeja → Actualizar.' }); }
  else if (!quiet && !updates.n) notify('upd', { title: 'Blankfire', message: 'Ya tienes la última versión.' });
  refreshTray();
}
async function applyUpdate() {
  if (updates.busy) return;
  const st = await botCall('botState').catch(() => null);
  const open = Object.keys(st?.data?.session?.positions || {}).length;
  if (open) {
    const { response } = await dialog.showMessageBox({ type: 'question', buttons: ['Actualizar igualmente', 'Ahora no'], defaultId: 1, cancelId: 1, title: 'Blankfire', message: `Hay ${open} posición(es) abiertas.`, detail: 'Al actualizar, el bot deja de vigilar unos 10 segundos mientras se reinicia.' });
    if (response !== 0) return;
  }
  updates.busy = true; refreshTray();
  const before = fileHash(path.join(__dirname, 'package.json'));
  const p = await git(['pull', '--ff-only', '-q']);
  if (!p.ok) { updates.busy = false; refreshTray(); dialog.showErrorBox('Blankfire', `No he podido actualizar:\n${p.err.slice(0, 400)}\n\nSi has tocado archivos a mano, pídele a Claude que lo arregle.`); return; }
  // Si cambió lo que necesita la app (Electron), se instala antes de reiniciar.
  if (fileHash(path.join(__dirname, 'package.json')) !== before) {
    await new Promise((res) => execFile(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install', '--no-audit', '--no-fund'], { cwd: __dirname, windowsHide: true, shell: process.platform === 'win32', timeout: 600000 }, () => res()));
  }
  notify('upd', { title: 'Blankfire actualizado', message: 'Se reinicia ahora. En Opera, recarga la extensión en opera://extensions.' });
  try { await engine?.flush(); } catch { /* */ }
  app.relaunch(); app.exit(0);
}

async function botCall(type) { return engine?.dispatch({ type }, { id: 'blankfire-desktop', url: BASE + 'tray' }); }

async function refreshTray() {
  if (!tray) return;
  const st = await botCall('botState').catch(() => null);
  const s = st?.data?.session;
  const live = s && ['running', 'paused'].includes(s.status);
  const label = !s ? 'Sin sesión' : s.status === 'running' ? 'En marcha' : s.status === 'paused' ? 'En pausa' : 'Parado';
  tray.setToolTip(`Blankfire · Bot: ${label}`);
  const login = app.getLoginItemSettings({ path: process.execPath, args: [...APP_ARGS, '--hidden'] }).openAtLogin;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: `Bot: ${label}`, enabled: false },
    { type: 'separator' },
    { label: 'Abrir el bot', click: () => createWindow('bot') },
    { label: 'Abrir el radar', click: () => createWindow('radar') },
    { label: 'Abrir la repetición', click: () => createWindow('replay') },
    { type: 'separator' },
    ...(live ? [s.status === 'running' ? { label: 'Pausar el bot', click: () => botCall('botPause').then(refreshTray) } : { label: 'Reanudar el bot', click: () => botCall('botResume').then(refreshTray) }] : []),
    updates.n ? { label: updates.busy ? 'Actualizando…' : `Actualizar (${updates.n} cambio${updates.n === 1 ? '' : 's'})`, enabled: !updates.busy, click: () => applyUpdate() } : { label: 'Buscar actualizaciones', click: () => checkUpdates({ quiet: false }) },
    { label: 'Arrancar con Windows', type: 'checkbox', checked: login, click: (i) => { app.setLoginItemSettings({ openAtLogin: i.checked, path: process.execPath, args: [...APP_ARGS, '--hidden'] }); refreshTray(); } },
    { type: 'separator' },
    { label: 'Salir (el bot deja de vigilar)', click: () => { quitting = true; app.quit(); } },
  ]));
}

app.on('second-instance', () => show());
app.on('window-all-closed', (e) => e?.preventDefault?.());
// Antes de salir se termina de guardar lo pendiente (si no, se podría perder lo último del registro).
let flushed = false;
app.on('before-quit', (e) => {
  quitting = true;
  if (flushed || !engine) return;
  e.preventDefault();
  Promise.race([engine.flush(), new Promise((r) => setTimeout(r, 4000))]).catch(() => {}).finally(() => { flushed = true; app.quit(); });
});

app.whenReady().then(async () => {
  if (!FIRST) return;
  ensureShortcuts();
  const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data: blob:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'";
  protocol.handle(SCHEME, async (req) => {
    const u = new URL(req.url);
    const rel = decodeURIComponent(u.pathname).replace(/^\/+/, '');
    // Puente: coloca el «chrome» de Blankfire antes de que arranque cualquier script de la página.
    if (rel === '_desktop/bridge.js') return new Response("Object.defineProperty(window, 'chrome', { value: window.bfChrome, configurable: true, writable: false });", { headers: { 'content-type': 'text/javascript' } });
    const file = path.resolve(ROOT, rel);
    // Solo se sirven archivos de la carpeta de Blankfire.
    if (!file.startsWith(ROOT + path.sep)) return new Response('no', { status: 403 });
    if (file.endsWith('.html')) {
      const html = (await fs.promises.readFile(file, 'utf8')).replace(/<head>/i, '<head>\n  <script src="/_desktop/bridge.js"></script>');
      return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': CSP } });
    }
    const res = await net.fetch(pathToFileURL(file).href);
    return new Response(res.body, { status: res.status, headers: { 'content-type': res.headers.get('content-type') || 'application/octet-stream', 'content-security-policy': CSP } });
  });
  ipcMain.handle('bf:msg', (e, msg) => engine.dispatch(msg, { id: 'blankfire-desktop', url: e.senderFrame?.url || '' }));
  ipcMain.handle('bf:storage', (e, op, area, arg) => {
    if (!['local', 'session'].includes(area) || area === 'session') return null;   // la sesión (clave abierta) nunca sale del motor
    if (op === 'get') return engine.chrome.storage.local.get(arg);
    return null;   // las ventanas no escriben directamente: todo pasa por el motor
  });
  await startEngine();
  tray = new Tray(trayIcon());
  tray.on('click', () => show());
  refreshTray();
  setInterval(refreshTray, 30e3);
  if (!process.argv.includes('--hidden')) createWindow('bot');
  setTimeout(() => checkUpdates(), 30e3);
  setInterval(() => checkUpdates(), 6 * 3600e3);
});
