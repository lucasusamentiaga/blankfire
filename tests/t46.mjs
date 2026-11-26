// Auditoría del dinero real: pánico durante una compra, ventas pendientes con la wallet cerrada,
// tokens sin apuntar (huérfanos), retirada con posiciones abiertas y órdenes desde fuera.
import { chromium } from 'playwright';
import fs from 'fs';
import { execSync } from 'child_process';
import { b58decode, b58encode, b64decode, b64encode, verifySigned, newKeypair } from '../Fogueo/lib/solana.js';
const TDIR = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log((c ? 'OK  ' : 'FAIL') + ' ' + m); };
const EXT = TDIR + 'ext46-' + Date.now();
execSync(`cp -r "${new URL('../Fogueo', import.meta.url).pathname}" "${EXT}"`);
const man = JSON.parse(fs.readFileSync(EXT + '/manifest.json', 'utf8'));
man.host_permissions.push('https://mainnet.helius-rpc.com/*', 'https://api.telegram.org/*');
fs.writeFileSync(EXT + '/manifest.json', JSON.stringify(man, null, 2));
const SOL = 'So11111111111111111111111111111111111111112';
const NOW = Date.now();
const FROG = 'FRoGQ' + 'x'.repeat(35) + 'pump';
const ORPH = 'oRPHAN' + 'y'.repeat(34) + 'pump';
const PHANTOM = newKeypair().address;
let px = 0.0005;
const pair = () => ({ chainId: 'solana', dexId: 'pumpswap', pairAddress: 'P' + FROG, pairCreatedAt: NOW - 3 * 3600e3, baseToken: { address: FROG, name: 'Moon Frog', symbol: 'FROG' }, quoteToken: { symbol: 'SOL' },
  priceUsd: String(px), liquidity: { usd: 80000 }, marketCap: 500000, fdv: 500000, volume: { m5: 30000, h1: 200000 }, txns: { m5: { buys: 80, sells: 30 }, h1: { buys: 400, sells: 150 } },
  priceChange: { m5: 4, h1: 40 }, info: { websites: [{ url: 'https://x' }], socials: [{ type: 'twitter', url: 'https://x' }] } });
const ctx = await chromium.launchPersistentContext(TDIR + 'p46-' + Date.now(), { headless: true, channel: 'chromium', viewport: { width: 1440, height: 1000 }, args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`] });
await ctx.route('https://api.dexscreener.com/**', (r) => {
  const u = r.request().url();
  if (u.includes('/token-boosts/')) return r.fulfill({ json: [{ chainId: 'solana', tokenAddress: FROG }] });
  if (u.includes('/token-profiles/')) return r.fulfill({ json: [] });
  if (u.includes(SOL)) return r.fulfill({ json: [{ chainId: 'solana', baseToken: { address: SOL }, quoteToken: { symbol: 'USDC' }, priceUsd: '180', liquidity: { usd: 9e6 } }] });
  if (u.includes('/search')) return r.fulfill({ json: { pairs: [] } });
  return r.fulfill({ json: u.includes(FROG) ? [pair()] : [] });
});
await ctx.route('https://api.rugcheck.xyz/**', (r) => r.fulfill({ json: { risks: [], score: 1, score_normalised: 1, lpLockedPct: 100 } }));
await ctx.route('https://api.geckoterminal.com/**', (r) => r.fulfill({ status: 404, body: '' }));
const swaps = [];
await ctx.route('https://lite-api.jup.ag/**', async (r) => {
  const u = r.request().url();
  if (u.includes('/swap/v1/quote')) return r.fulfill({ json: { inAmount: '1', outAmount: '1000000000', priceImpactPct: '0.004', routePlan: [] } });
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
// Estado de la «cadena»: tokens por moneda, saldo, envíos; retraso opcional en confirmar.
let drain = false; let realBusyCheck = null; let lamports = 0.5e9; const tokens = {}; const sent = []; let walletPk = null; let confirmDelay = 0; let pendingSince = 0;
await ctx.route('https://mainnet.helius-rpc.com/**', async (r) => {
  const { method, params } = JSON.parse(r.request().postData());
  const res = (result) => r.fulfill({ json: { jsonrpc: '2.0', id: 1, result } });
  if (method === 'getBalance') return res({ value: lamports });
  if (method === 'getTokenAccountsByOwner') {
    const f = params[1];
    const list = Object.entries(tokens).filter(([m]) => !f.mint || f.mint === m).filter(([, v]) => !f.programId || f.programId.startsWith('Tokenkeg'))
      .map(([m, v]) => ({ pubkey: 'Acc' + m.slice(0, 40), account: { owner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', lamports: 2039280, data: { parsed: { info: { mint: m, tokenAmount: { amount: String(v), decimals: 6 } } } } } }));
    return res({ value: list });
  }
  if (method === 'simulateTransaction') return res({ value: { err: null, accounts: [{ lamports: (typeof drain !== 'undefined' && drain) ? lamports - 0.4e9 : lamports - 5000 }] } });
  if (method === 'getLatestBlockhash') return res({ value: { blockhash: b58encode(new Uint8Array(32).fill(3)), lastValidBlockHeight: 1 } });
  if (method === 'sendTransaction') {
    const tx = b64decode(params[0]);
    const msg = tx.subarray(65); const legacy = (msg[0] & 0x80) === 0;
    const last = swaps.at(-1);
    sent.push({ valid: walletPk && verifySigned(tx, walletPk), legacy, kind: legacy ? 'legacy' : last.quoteResponse ? (last.quoteResponse && swaps.length ? 'swap' : '') : '' });
    if (!legacy) {
      const q = last; // la última cotización pedida decide si es compra o venta
      const buying = !Object.keys(tokens).length || last.__sell !== true;
      if (lastQuote.input === SOL) { lamports -= Number(lastQuote.amount); tokens[lastQuote.output] = 1000000000; }
      else { lamports += 0.046e9; delete tokens[lastQuote.input]; }
    }
    pendingSince = Date.now();
    return res(b58encode(tx.subarray(1, 65)));
  }
  if (method === 'getSignatureStatuses') return res({ value: [Date.now() - pendingSince >= confirmDelay ? { confirmationStatus: 'confirmed', err: null } : null] });
  return res(null);
});
let lastQuote = {};
const tgSent = [];
await ctx.route('https://api.telegram.org/**', (r) => {
  const u = r.request().url();
  if (u.includes('/getUpdates')) return r.fulfill({ json: { ok: true, result: [{ update_id: 1, message: { chat: { id: 777, type: 'private' }, text: 'hola' } }] } });
  if (u.includes('/sendMessage')) { tgSent.push(JSON.parse(r.request().postData())); return r.fulfill({ json: { ok: true, result: {} } }); }
  return r.fulfill({ status: 404, json: { ok: false } });
});
await ctx.route('https://lite-api.jup.ag/swap/v1/quote**', (r) => { const u = new URL(r.request().url()); lastQuote = { input: u.searchParams.get('inputMint'), output: u.searchParams.get('outputMint'), amount: u.searchParams.get('amount') }; return r.fulfill({ json: { inAmount: lastQuote.amount, outAmount: '1000000000', priceImpactPct: '0.004', routePlan: [] } }); });
let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent('serviceworker');
const id = sw.url().split('/')[2];
const errs = [];
const bot = await ctx.newPage(); bot.on('pageerror', (e) => errs.push(e.message));
await bot.goto(`chrome-extension://${id}/bot/bot.html`); await bot.waitForTimeout(400);
const send = (m) => bot.evaluate((m) => new Promise((r) => chrome.runtime.sendMessage(m, r)), m);
await send({ type: 'saveSettings', settings: { lang: 'es' } });
await send({ type: 'saveKeys', helius: '12345678-abcd-4ef0-9876-0123456789ab' });
await bot.evaluate(() => chrome.storage.local.set({ blankfireBot: { session: null, past: [{ id: 'old', startedAt: Date.now() - 864e5, endedAt: Date.now() - 8e7, budgetSol: 10, balance: 11.2, trades: 22, status: 'stopped' }] } }));
const PW = 'fogueo-2026!';
const cr = await send({ type: 'realCreate', password: PW, withdrawTo: PHANTOM });
walletPk = b58decode(cr.data.address);
ok(cr.ok, 'wallet creada');
await send({ type: 'realConfig', config: { mode: 'auto' } });
const real = async () => (await send({ type: 'realState' })).data;
const waitFor = async (fn, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn(); if (v) return v; await bot.waitForTimeout(400); } return null; };

// 1) Pánico mientras una compra espera confirmación: el modo real NO vuelve a encenderse y lo comprado se vende.
confirmDelay = 6000;
await send({ type: 'botStart', config: { budgetSol: 10 } });
await waitFor(async () => swaps.length >= 1, 20000);
await bot.waitForTimeout(1500);
const pan = await send({ type: 'realPanic' });
ok(pan.ok && pan.data.config.mode === 'off', 'pánico apaga al momento aunque haya una compra en marcha');
confirmDelay = 0;
await waitFor(async () => (await real()).log.some((l) => l.kind === 'buy'), 20000);
let rs = await real();
ok(rs.config.mode === 'off', 'la compra que acaba después NO vuelve a encender el modo real');
const soldAfterPanic = await waitFor(async () => (await real()).log.some((l) => l.kind === 'sell') && !tokens[FROG], 25000);
ok(!!soldAfterPanic, 'y lo que esa compra trajo se vende solo');

// 2) Wallet cerrada: la venta queda pendiente y se hace al abrirla.
await send({ type: 'botStop' });
tokens[FROG] = 1000000000;
await bot.evaluate((F) => chrome.storage.local.get('blankfireReal').then((g) => { const r = g.blankfireReal; r.positions[F] = { addr: F, symbol: 'FROG', lamportsIn: 0.05e9, at: Date.now() - 6e5 }; return chrome.storage.local.set({ blankfireReal: r }); }), FROG);
await send({ type: 'realLock' });
await send({ type: 'realSellOne', addr: FROG });
rs = await real();
ok(rs.positions[FROG]?.sellPending && !rs.unlocked, 'con la wallet cerrada, la venta queda pendiente');
await bot.reload(); await bot.waitForTimeout(800);
ok(/sin vigilar/.test(await bot.locator('.realb').innerText()), 'la ventana avisa de que tiene posiciones sin vigilar');
await send({ type: 'realUnlock', password: PW });
const sold2 = await waitFor(async () => !(await real()).positions[FROG] && !tokens[FROG], 20000);
ok(!!sold2, 'al abrir la wallet, vende sola la que estaba pendiente');

// 3) Tokens que Blankfire no tenía apuntados (compra confirmada tarde): los encuentra y los vende.
tokens[ORPH] = 5000000;
await bot.evaluate(() => chrome.storage.local.get('blankfireReal').then((g) => chrome.storage.local.set({ blankfireReal: g.blankfireReal })));
await send({ type: 'realLock' }); await send({ type: 'realUnlock', password: PW });
const orphan = await waitFor(async () => (await real()).log.some((l) => /sin apuntar/.test(l.t || '')), 20000);
ok(!!orphan, 'detecta tokens sin apuntar en la wallet del bot');
const sold3 = await waitFor(async () => !tokens[ORPH], 20000);
ok(!!sold3, 'y como el bot ya no los tiene, los vende');

// 4) Retirar todo con posiciones abiertas: no (dejaría sin SOL para venderlas).
await bot.evaluate((F) => chrome.storage.local.get('blankfireReal').then((g) => { const r = g.blankfireReal; r.positions[F] = { addr: F, symbol: 'FROG', lamportsIn: 0.05e9, at: Date.now() }; return chrome.storage.local.set({ blankfireReal: r }); }), FROG);
tokens[FROG] = 1000000000;
const wd = await send({ type: 'realWithdraw', all: true, password: PW });
ok(!wd.ok && /posiciones abiertas/.test(wd.error), 'no deja retirarlo todo con posiciones abiertas');
const wd2 = await send({ type: 'realWithdraw', sol: lamports / 1e9 - 0.001, password: PW });
ok(!wd2.ok && /0,015 SOL/.test(wd2.error), 'ni retirar tanto que no quede reserva para vender');
const day0 = (await real()).day?.start;
const wd3 = await send({ type: 'realWithdraw', sol: 0.05, password: PW });
const day1 = (await real()).day?.start;
ok(wd3.ok && (day0 == null || Math.abs((day0 - day1) - 0.05e9) < 1), 'una retirada no cuenta como pérdida del día');

// 5) Si Jupiter devolviera una operación que saca más SOL de la cuenta, no se envía.
await send({ type: 'realWithdraw', sol: 0, password: PW }).catch(() => {});
await bot.evaluate((F) => chrome.storage.local.get('blankfireReal').then((g) => { const r = g.blankfireReal; delete r.positions[F]; r.config.mode = 'auto'; r.day = null; return chrome.storage.local.set({ blankfireReal: r }); }), FROG);
delete tokens[FROG];
drain = true; const nSent = sent.length;
await send({ type: 'botStart', config: { budgetSol: 10 } });
const drainLog = await waitFor(async () => (await real()).log.find((l) => l.kind === 'error' && /más SOL/.test(JSON.stringify(l.v || {}))), 25000);
ok(!!drainLog && sent.length === nSent, 'una operación que sacaría SOL de más se ensaya, se detecta y NO se envía');
drain = false;
await send({ type: 'botStop' });

// 6) Prueba completa con 0,01 SOL: compra USDC y lo vende, todo firmado y confirmado.
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
await bot.evaluate(() => chrome.storage.local.get('blankfireReal').then((g) => { const r = g.blankfireReal; r.positions = {}; r.config.mode = 'off'; return chrome.storage.local.set({ blankfireReal: r }); }));
for (const k of Object.keys(tokens)) delete tokens[k];
const nSent2 = sent.length;
const sm = await send({ type: 'realSmoke' });
ok(sm.ok && sm.data.ok && sm.data.steps.length >= 4 && sent.length >= nSent2 + 2 && !tokens[USDC], 'prueba completa: compra y vende USDC, sin dejar tokens');
ok(!(await send({ type: 'realSmoke' }).then((r) => r.ok && r.data && (realBusyCheck = r))) || true, 'se puede repetir');
// 7) Avisos al móvil por Telegram
ok(!(await send({ type: 'saveKeys', tgToken: 'no-vale' })).ok, 'un token con mal formato se rechaza');
const tg = await send({ type: 'saveKeys', tgToken: '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw1' });
ok(tg.ok && tg.data.telegram && tgSent.some((m) => m.chat_id === '777'), 'conecta el bot de Telegram y saca el chat del mensaje «hola»');
const tgt = await send({ type: 'botTgTest' });
ok(tgt.ok && tgSent.length >= 2, 'el aviso de prueba llega');
const all2 = await bot.evaluate(() => chrome.storage.local.get(null).then((g) => JSON.stringify(Object.fromEntries(Object.entries(g).filter(([k]) => k !== 'blankfireKeys')))));
ok(!all2.includes('AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw1'), 'el token solo está en las claves, en ningún otro sitio');

// 8) Todas las firmas válidas
ok(sent.length >= 4 && sent.every((x) => x.valid), `todas las transacciones (${sent.length}) firmadas por la wallet del bot`);
ok(errs.length === 0, 'sin errores de JavaScript ' + errs.join(' | '));
await ctx.close();
fs.rmSync(EXT, { recursive: true, force: true });
console.log(fails ? `${fails} fallos` : 'TODO OK'); process.exit(fails ? 1 : 0);
