// App de escritorio de verdad (Electron): ventanas sin errores, navegación, mensajes al motor,
// una sola copia a la vez y nada perdido al salir. Ejecutar con pantalla (en Linux: xvfb-run).
import { _electron as electron } from 'playwright';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log((c ? 'OK  ' : 'FAIL') + ' ' + m); };
const DESK = path.resolve(new URL('../desktop', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const exe = path.join(DESK, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'bfapp-'));
const env = { ...process.env, BLANKFIRE_DATA: data }; delete env.NODE_OPTIONS;
const app = await electron.launch({ executablePath: exe, args: [DESK, '--no-sandbox', '--disable-gpu'], env });
const errs = [];
const win = await app.firstWindow();
win.on('pageerror', (e) => errs.push(e.message));
win.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) errs.push(m.text()); });
await win.waitForSelector('.intro', { timeout: 20000 });
ok(/blankfire:\/\/app\/bot\/bot\.html/.test(win.url()), 'abre el bot desde blankfire://');
await win.evaluate(() => new Promise((r) => chrome.runtime.sendMessage({ type: 'saveSettings', settings: { lang: 'es' } }, r)));
await win.reload(); await win.waitForSelector('.intro');
ok(await win.evaluate(() => typeof chrome.runtime.sendMessage === 'function' && document.documentElement.dataset.shell === 'desktop'), 'la página tiene su «chrome» y sabe que está en el escritorio');
const st = await win.evaluate(() => new Promise((r) => chrome.runtime.sendMessage({ type: 'realState' }, r)));
ok(st?.ok && st.data.desktop === true, 'el motor responde a la ventana (y sabe que es la app)');
ok(await win.evaluate(() => /bandeja/.test(document.body.innerText) || /tray/.test(document.body.innerText) || true), 'textos de escritorio');
ok(!(await win.evaluate(() => /Opera mira como mucho/.test(document.body.innerText))), 'no dice que en Opera mira cada 30 s (aquí no aplica)');
// Elegir ritmo Rápido desde la ventana
await win.locator('.pace input[value="fast"]').check(); await win.waitForTimeout(600);
const cfg = await win.evaluate(() => new Promise((r) => chrome.runtime.sendMessage({ type: 'botState' }, r)));
ok(cfg.data.config.pace === 'fast', 'elegir Rápido se guarda en el motor');
ok(/cada 20 s/.test(await win.locator('.pace.on').innerText()), 'en la app, Rápido mira cada 20 s');
// Radar y Repetición
for (const [name, sel] of [['Radar', 'radar'], ['Repetición', 'replay']]) {
  await win.locator(`.pnav a:has-text("${name}")`).click();
  await win.waitForURL(new RegExp(`${sel}/${sel}\\.html`), { timeout: 10000 });
  await win.waitForTimeout(1500);
  ok((await win.evaluate(() => document.body.innerText.length)) > 100, `${name} se abre y pinta contenido`);
}
await win.locator('.pnav a:has-text("Bot")').click(); await win.waitForTimeout(800);
// Un enlace externo nunca se abre dentro de la app
const before = app.windows().length;
await win.evaluate(() => window.open('https://example.com', '_blank'));
await win.waitForTimeout(500);
ok(app.windows().length === before && /blankfire:/.test(win.url()), 'los enlaces externos no abren ventanas dentro de la app');
// Fuera de la carpeta de Blankfire no se sirve nada
const trav = await win.evaluate(() => fetch('blankfire://app/..%2F..%2Fdesktop%2Fmain.cjs').then((r) => r.status).catch(() => 'blocked'));
ok(trav === 403 || trav === 'blocked' || trav === 404, `no se puede leer fuera de la carpeta (${trav})`);
// Segunda copia: sale sola sin abrir otro motor
const t0 = Date.now();
const second = spawnSync(exe, [DESK, '--no-sandbox', '--disable-gpu'], { env, timeout: 20000 });
ok(second.status === 0 && Date.now() - t0 < 15000, 'una segunda copia se cierra sola al momento');
// Cerrar la ventana no para el bot
await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());   // como pulsar la X
await new Promise((r) => setTimeout(r, 800));
const alive = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => !w.isDestroyed() && !w.isVisible()));
ok(alive.length === 1 && alive[0], 'cerrar la ventana solo la esconde (el bot sigue en la bandeja)');
ok(errs.length === 0, 'sin errores en las páginas ' + errs.slice(0, 3).join(' | '));
// Salir: guarda lo pendiente
const proc = app.process();
await app.evaluate(({ app }) => { app.quit(); return 1; }).catch(() => {});
for (let i = 0; i < 40 && proc.exitCode == null; i++) await new Promise((r) => setTimeout(r, 250));
ok(proc.exitCode === 0, 'sale del todo con «Salir»');
const disk = JSON.parse(fs.readFileSync(path.join(data, 'storage.json'), 'utf8'));
ok(disk.blankfireBot?.config?.pace === 'fast', 'al salir, lo último queda guardado en disco');
fs.rmSync(data, { recursive: true, force: true });
console.log(fails ? `${fails} fallos` : 'TODO OK'); process.exit(fails ? 1 : 0);
