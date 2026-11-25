// Dinero real de punta a punta (con Helius y Jupiter simulados): crear wallet cifrada, copia de seguridad,
// modo automático que copia al bot, firmas válidas, venta por stop, pánico, cerrar/abrir y retirada solo a tu Phantom.
import { chromium } from 'playwright';
import fs from 'fs';
import { execSync } from 'child_process';
import { b58decode, b58encode, b64decode, b64encode, verifySigned, newKeypair } from '../Fogueo/lib/solana.js';
const TDIR = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log((c ? 'OK  ' : 'FAIL') + ' ' + m); };
// Copia de la extensión con el permiso de Helius ya concedido (en la real se concede con el clic de «Conectar Helius»).
const EXT = TDIR + 'ext45-' + Date.now();
execSync(`cp -r "${new URL('../Fogueo', import.meta.url).pathname}" "${EXT}"`);
const man = JSON.parse(fs.readFileSync(EXT + '/manifest.json', 'utf8'));
man.host_permissions.push('https://mainnet.helius-rpc.com/*');
fs.writeFileSync(EXT + '/manifest.json', JSON.stringify(man, null, 2));
const SOL = 'So11111111111111111111111111111111111111112';
const NOW = Date.now();
const FROG = 'FRoGQ' + 'x'.repeat(35) + 'pump';
const PHANTOM = newKeypair().address;
let px = 0.0005;
const pair = () => ({ chainId: 'solana', dexId: 'pumpswap', pairAddress: 'P' + FROG, pairCreatedAt: NOW - 3 * 3600e3, baseToken: { address: FROG, name: 'Moon Frog', symbol: 'FROG' }, quoteToken: { symbol: 'SOL' },
  priceUsd: String(px), liquidity: { usd: 80000 }, marketCap: 500000, fdv: 500000, volume: { m5: 30000, h1: 200000 }, txns: { m5: { buys: 80, sells: 30 }, h1: { buys: 400, sells: 150 } },
  priceChange: { m5: 4, h1: 40 }, info: { websites: [{ url: 'https://x' }], socials: [{ type: 'twitter', url: 'https://x' }] } });
const ctx = await chromium.launchPersistentContext(TDIR + 'p45-' + Date.now(), { headless: true, channel: 'chromium', viewport: { width: 1440, height: 1000 }, args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`] });
await ctx.route('https://api.dexscreener.com/**', (r) => {
  const u = r.request().url();
  if (u.includes('/token-boosts/')) return r.fulfill({ json: [{ chainId: 'solana', tokenAddress: FROG }] });
  if (u.includes('/token-profiles/')) return r.fulfill({ json: [] });
  if (u.includes(SOL)) return r.fulfill({ json: [{ chainId: 'solana', baseToken: { address: SOL }, quoteToken: { symbol: 'USDC' }, priceUsd: '180', liquidity: { usd: 9e6 } }] });
  if (u.includes('/search')) return r.fulfill({ json: { pairs: [] } });
  return r.fulfill({ json: u.includes(FROG) ? [pair()] : [] });
});
await ctx.route('https://api.geckoterminal.com/**', (r) => r.fulfill({ status: 404, body: '' }));
// Jupiter: cotización y operación construida para la wallet que pida
const swaps = [];
await ctx.route('https://lite-api.jup.ag/**', async (r) => {
  const u = r.request().url();
  if (u.includes('/swap/v1/quote')) return r.fulfill({ json: { inAmount: '1', outAmount: '1000000000', priceImpactPct: '0.004', routePlan: [{ swapInfo: { label: 'Pump.fun Amm' } }] } });
  if (u.includes('/swap/v1/swap')) {
    const body = JSON.parse(r.request().postData());
    swaps.push(body);
    const payer = b58decode(body.userPublicKey);
    const msg = new Uint8Array([0x80, 1, 0, 1, 2, ...payer, ...new Uint8Array(32).fill(7), ...new Uint8Array(32).fill(9), 0, 0]);
    const tx = new Uint8Array(1 + 64 + msg.length); tx[0] = 1; tx.set(msg, 65);
    return r.fulfill({ json: { swapTransaction: b64encode(tx) } });
  }
  return r.fulfill({ json: {} });
});
// Helius RPC: saldo, tokens, envío (verificando la firma) y confirmación
let lamports = 0.5e9, tokenRaw = 0n, accOpen = false; const sent = []; let walletPk = null;
const TOKACC = newKeypair().address;
await ctx.route('https://mainnet.helius-rpc.com/**', async (r) => {
  const { method, params } = JSON.parse(r.request().postData());
  const res = (result) => r.fulfill({ json: { jsonrpc: '2.0', id: 1, result } });
  if (method === 'getBalance') return res({ value: lamports });
  if (method === 'getTokenAccountsByOwner') return res({ value: [{ pubkey: TOKACC, account: { owner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', lamports: 2039280, data: { parsed: { info: { tokenAmount: { amount: tokenRaw.toString(), decimals: 6 } } } } } }].filter(() => tokenRaw > 0n || accOpen) });
  if (method === 'simulateTransaction') return res({ value: { err: null, accounts: [{ lamports: (typeof drain !== 'undefined' && drain) ? lamports - 0.4e9 : lamports - 5000 }] } });
  if (method === 'getLatestBlockhash') return res({ value: { blockhash: b58encode(new Uint8Array(32).fill(3)), lastValidBlockHeight: 1 } });
  if (method === 'sendTransaction') {
    const tx = b64decode(params[0]);
    const valid = walletPk && verifySigned(tx, walletPk);
    const msg = tx.subarray(65);
    const legacy = (msg[0] & 0x80) === 0;
    const prog = legacy ? b58encode(msg.subarray(68, 100)) : null;
    const close = legacy && prog.startsWith('Tokenkeg');
    sent.push({ valid, legacy, close, to: legacy ? b58encode(msg.subarray(36, 68)) : null });
    if (!legacy && swaps.length % 2 === 1) { lamports -= 0.05e9; tokenRaw = 1000000000n; accOpen = true; }
    else if (!legacy) { lamports += 0.046e9; tokenRaw = 0n; }
    else if (close) { lamports += 2039280; accOpen = false; }
    else lamports = 0;
    return res(b58encode(tx.subarray(1, 65)));
  }
  if (method === 'getSignatureStatuses') return res({ value: [{ confirmationStatus: 'confirmed', err: null }] });
  return res(null);
});
let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent('serviceworker');
const id = sw.url().split('/')[2];
const errs = [];
const bot = await ctx.newPage(); bot.on('pageerror', (e) => errs.push(e.message));
await bot.goto(`chrome-extension://${id}/bot/bot.html`); await bot.waitForTimeout(400);
const send = (m) => bot.evaluate((m) => new Promise((r) => chrome.runtime.sendMessage(m, r)), m);
await send({ type: 'saveSettings', settings: { lang: 'es' } });
ok((await send({ type: 'saveKeys', helius: '12345678-abcd-4ef0-9876-0123456789ab' })).ok, 'clave de Helius guardada');
await bot.evaluate(() => chrome.storage.local.set({ blankfireBot: { session: null, past: [{ id: 'old', startedAt: Date.now() - 864e5, endedAt: Date.now() - 8e7, budgetSol: 10, balance: 11.2, trades: 22, status: 'stopped' }] } }));
await bot.reload(); await bot.waitForTimeout(900);
ok(/Sin wallet/.test(await bot.locator('.realb').innerText()) && await bot.locator('form[data-form="realCreate"]').count() === 1, 'con la simulación en positivo, ofrece crear la wallet del bot');
// Contraseña floja → no
await bot.fill('form[data-form="realCreate"] [name="pw"]', 'corta'); await bot.fill('form[data-form="realCreate"] [name="pw2"]', 'corta');
await bot.fill('form[data-form="realCreate"] [name="to"]', PHANTOM); await bot.check('form[data-form="realCreate"] [name="risk"]');
await bot.click('form[data-form="realCreate"] button[type="submit"]'); await bot.waitForTimeout(500);
ok(/Mínimo 10/.test(await bot.locator('#toast').innerText()), 'rechaza una contraseña floja');
const PW = 'fogueo-2026!';
await bot.fill('form[data-form="realCreate"] [name="pw"]', PW); await bot.fill('form[data-form="realCreate"] [name="pw2"]', PW);
await bot.click('form[data-form="realCreate"] button[type="submit"]');
const t0 = Date.now(); await bot.waitForSelector('.backup', { timeout: 40000 }).catch(() => {}); console.log('  (crear la wallet tardó ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s; toast: ' + (await bot.locator('#toast').innerText().catch(() => '')) + ')');
const secret = (await bot.locator('.secret').innerText()).trim();
ok(secret.length >= 80 && /Solo la verás esta vez/.test(await bot.locator('.backup').innerText()), 'enseña la copia de seguridad una sola vez');
await bot.screenshot({ path: TDIR + 't45-backup-es.png', fullPage: true });
await bot.click('[data-act="backupDone"]'); await bot.waitForTimeout(200);
ok(await bot.locator('.backup').count() === 1, 'no deja seguir sin marcar «La he guardado»');
await bot.check('[data-ref="savedOk"]'); await bot.click('[data-act="backupDone"]'); await bot.waitForTimeout(700);
const all = await bot.evaluate(() => chrome.storage.local.get(null).then((g) => JSON.stringify(g)));
ok(!all.includes(secret) && /PBKDF2-SHA256/.test(all), 'en el almacenamiento solo está cifrada: la clave en claro no aparece por ningún sitio');
const st0 = (await send({ type: 'realState' })).data;
walletPk = b58decode(st0.address);
ok(st0.unlocked && st0.withdrawTo === PHANTOM && Math.abs(st0.balance - 0.5) < 1e-9, 'wallet abierta, retirada fijada a tu Phantom, saldo 0,5 SOL');
// Modo automático

await bot.locator('[data-act="realMode"]').check(); await bot.waitForTimeout(500);
ok((await send({ type: 'realState' })).data.config.mode === 'auto', 'modo automático con dinero real encendido');
await bot.screenshot({ path: TDIR + 't45-real-on-es.png', fullPage: true });
// El bot simulado compra → la wallet real compra (0,05 SOL)
await bot.click('form[data-form="start"] button');
await bot.waitForFunction(() => document.querySelectorAll('.log .ev').length >= 2, null, { timeout: 25000 }).catch(() => {});
let rs;
for (let i = 0; i < 40; i++) { rs = (await send({ type: 'realState' })).data; if (rs.positions[FROG]) break; await bot.waitForTimeout(500); }
ok(swaps.length === 1 && swaps[0].userPublicKey === st0.address && swaps[0].wrapAndUnwrapSol === true, 'pide a Jupiter la operación para la wallet del bot');
ok(sent.length === 1 && sent[0].valid && !sent[0].legacy, 'la compra se envía firmada correctamente por la wallet del bot');
ok(rs.positions[FROG]?.lamportsIn === 0.05e9 && rs.log.some((l) => l.kind === 'buy' && l.symbol === 'FROG'), 'posición real abierta: 0,05 SOL en FROG (el máximo por compra)');
// Stop: el precio cae y el bot simulado vende → la real vende
px *= 0.9;
await send({ type: 'botScanNow' });
for (let i = 0; i < 40; i++) { rs = (await send({ type: 'realState' })).data; if (rs.log.some((l) => l.kind === 'sell')) break; await bot.waitForTimeout(500); }
ok(sent.filter((x) => !x.legacy).length === 2 && sent[1].valid && !rs.positions[FROG], 'stop: vende con dinero real, firmado');
const sellLog = rs.log.find((l) => l.kind === 'sell');
ok(sellLog && Math.abs(sellLog.pnl + 0.004) < 1e-9 && sellLog.reason === 'stop', 'apunta el resultado real (−0,004 SOL) y el motivo (stop)');
for (let i = 0; i < 30; i++) { rs = (await send({ type: 'realState' })).data; if (sent.some((x) => x.close) && rs.log.some((l) => /renta/.test(l.t || ''))) break; await bot.waitForTimeout(500); }
rs = (await send({ type: 'realState' })).data;
ok(sent.some((x) => x.close && x.valid && x.to === TOKACC) && rs.log.some((l) => /renta/.test(l.t || '')), 'después de vender cierra la cuenta vacía y recupera ~0,002 SOL de renta');
// Cerrar y abrir
await send({ type: 'realLock' });
rs = (await send({ type: 'realState' })).data;
ok(!rs.unlocked, 'cerrar la wallet borra la clave de la memoria');
ok(!(await send({ type: 'realUnlock', password: 'otra-clave-1' })).ok, 'abrir con otra contraseña, no');
ok((await send({ type: 'realUnlock', password: PW })).data.unlocked, 'con la buena, sí');
// Límites acotados
const cfg = (await send({ type: 'realConfig', config: { maxSol: 50, maxPerDay: 0 } })).data.config;
ok(cfg.maxSol === 2 && cfg.maxPerDay === 1, 'límites acotados (máximo 2 SOL por compra)');
// Pánico
await bot.reload(); await bot.waitForTimeout(900);
await bot.click('[data-act="realPanic"]'); await bot.click('[data-act="realPanic"]'); await bot.waitForTimeout(800);
ok((await send({ type: 'realState' })).data.config.mode === 'off', 'pánico (dos clics): modo real apagado');
// Retirada: siempre a tu Phantom
ok(!(await send({ type: 'realWithdraw', all: true, password: 'mala-clave-9' })).ok, 'retirar con otra contraseña, no');
const wd = await send({ type: 'realWithdraw', all: true, password: PW });
ok(wd.ok && sent.at(-1).legacy && !sent.at(-1).close && sent.at(-1).valid && sent.at(-1).to === PHANTOM, 'retirada firmada y enviada a tu Phantom');
// Copia de seguridad con contraseña y borrado (vacía)
const ex = await send({ type: 'realExport', password: PW });
ok(ex.ok && ex.data.backup === secret, 'la copia de seguridad se puede volver a ver con la contraseña');
ok((await send({ type: 'realDelete', password: PW })).ok && !(await send({ type: 'realState' })).data.has, 'una wallet vacía se puede borrar');
ok(errs.length === 0, 'sin errores de JavaScript ' + errs.join(' | '));
await ctx.close();
fs.rmSync(EXT, { recursive: true, force: true });
console.log(fails ? `${fails} fallos` : 'TODO OK'); process.exit(fails ? 1 : 0);
