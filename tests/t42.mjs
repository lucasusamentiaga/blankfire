// Fases 4 y 5 (lógica): temas de moda, ballenas, wallets que sigues, el bot con wallets y el copiloto.
import { themes, snapshotOf, whaleTape, parseSwaps, walletRounds, walletProfile, recentBuys } from '../Fogueo/lib/radar.js';
import { smartsAgent, copilotGate, cleanCopilot, signalsToday } from '../Fogueo/lib/bot.js';
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log((c ? 'OK  ' : 'FAIL') + ' ' + m); };
const NOW = Date.UTC(2026, 10, 25, 12, 0);
const P = (addr, name, sym, o = {}) => ({ chainId: 'solana', baseToken: { address: addr, name, symbol: sym }, marketCap: o.mc ?? 50000, priceChange: { h1: o.h1 ?? 10 }, volume: { h1: o.v ?? 10000 } });
const pairs = [
  P('A', 'Grok Cat', 'GCAT', { mc: 900000, h1: 80 }), P('B', 'Cat of Grok', 'GROKC'), P('C', 'Baby Grok', 'BGROK', { h1: -20 }), P('D', 'Grok Dog', 'GDOG'),
  P('E', 'Moon Frog', 'FROG'), P('F', 'Frog King', 'KFROG'), P('G', 'Frog Wif Hat', 'FWH'),
  P('H', 'Solo Thing', 'SOLO'),
];
const th = themes(pairs, { grok: 1 });
ok(th[0].word === 'grok' && th[0].n === 4 && th[0].delta === 3, 'tema que más crece primero: «grok» (4 monedas, +3 desde la foto anterior)');
ok(th.some((t) => t.word === 'frog' && t.delta === null), '«frog» aparece como nuevo');
ok(!th.some((t) => t.word === 'solo'), 'una palabra suelta no es tema');
ok(th[0].leader.symbol === 'GCAT' && th[0].leader.mc === 900000, 'dice cuál es la más grande del tema');
ok(!th.some((t) => t.word === 'cat'), 'si «cat» es casi el mismo grupo que «grok», no lo repite') ;
ok(snapshotOf(th).grok === 4, 'guarda la foto para comparar dentro de una hora');

// Ballenas
const tr = (min, side, usd, w) => ({ attributes: { block_timestamp: new Date(NOW - min * 60e3).toISOString(), kind: side, volume_in_usd: String(usd), tx_from_address: w, price_to_in_usd: '0.001', price_from_in_usd: '0.001' } });
const trades = [tr(1, 'buy', 3000, 'W1'), tr(2, 'buy', 80, 'W2'), tr(3, 'sell', 1200, 'W3'), tr(4, 'buy', 60, 'W9'), tr(20, 'buy', 2500, 'W1'), tr(30, 'sell', 40, 'W4'),
  ...Array.from({ length: 6 }, (_, i) => tr(5 + i, 'buy', 50, 'BOT'))];
const tape = whaleTape(trades, { minUsd: 500, liqUsd: 40000, tracked: { W9: 'Ansem' }, now: NOW });
ok(tape.big.length === 4 && tape.big[0].wallet === 'W1' && tape.big[0].repeat === 2, 'grandes (≥ $500) más la wallet que sigues, de la más nueva a la más vieja');
ok(tape.big.find((x) => x.wallet === 'W9')?.tracked === 'Ansem', 'marca la wallet que sigues aunque compre poco');
ok(Math.round(tape.f5.net) === 3000 + 80 - 1200 + 60 + 50 && tape.f5.bigNet === 3000 - 1200, 'flujo neto de 5 min (todo y solo ballenas)');
ok(tape.busy[0].wallet === 'BOT' && tape.busy[0].n === 6, 'detecta la wallet que repite muchas órdenes');
ok(whaleTape(trades, { minUsd: 500, liqUsd: 400000 }).cut === 4000, 'en monedas grandes, «grande» es el 1 % de la liquidez');

// Wallets (Helius)
const W = 'WaLLeT';
const tx = (min, sol, mint, qty, err) => ({ signature: 's' + min, timestamp: Math.floor((NOW - min * 60e3) / 1000), transactionError: err || null,
  accountData: [{ account: W, nativeBalanceChange: Math.round(sol * 1e9) }], tokenTransfers: [{ mint, tokenAmount: Math.abs(qty), fromUserAccount: qty < 0 ? W : 'pool', toUserAccount: qty > 0 ? W : 'pool' }] });
const txs = [
  tx(300, -1, 'M1', 1e6), tx(280, 2.5, 'M1', -1e6),         // gana 1,5
  tx(250, -0.5, 'M2', 2e6), tx(240, 0.2, 'M2', -2e6),       // pierde 0,3
  tx(200, -0.5, 'M3', 1e6), tx(190, 1.5, 'M3', -1e6),       // gana 1
  tx(150, -1, 'M4', 1e6), tx(140, 0.5, 'M4', -1e6),         // pierde 0,5
  tx(100, -0.2, 'M5', 1e5), tx(95, 0.6, 'M5', -1e5),        // gana 0,4
  tx(10, -0.4, 'M6', 1e6),                                  // abierta
  tx(5, -9, 'M7', 1e6, 'failed'),                           // fallida: no cuenta
];
const sw = parseSwaps(txs, W);
ok(sw.length === 11 && sw[0].side === 'buy' && sw[1].side === 'sell' && Math.abs(sw[1].sol - 2.5) < 1e-9, 'lee compras y ventas de la wallet (y salta las fallidas)');
const wsol = parseSwaps([{ signature: 'x', timestamp: NOW / 1000, accountData: [{ account: W, nativeBalanceChange: -2039280 }], tokenTransfers: [
  { mint: 'So11111111111111111111111111111111111111112', tokenAmount: 0.7, fromUserAccount: W, toUserAccount: 'pool' }, { mint: 'M9', tokenAmount: 5e5, fromUserAccount: 'pool', toUserAccount: W }] }], W);
ok(wsol.length === 1 && wsol[0].side === 'buy' && wsol[0].sol > 0.7, 'el SOL envuelto (WSOL) cuenta como SOL');
const rounds = walletRounds(sw, { solUsd: 200 });
ok(rounds.length === 6 && rounds.filter((r) => r.closed).length === 5 && rounds[0].mint === 'M6' && !rounds[0].closed, 'agrupa por moneda: 5 cerradas y 1 abierta');
ok(Math.abs(rounds.find((r) => r.mint === 'M1').entryMcUsd - 200000) < 1, 'market cap al entrar (pump.fun, 1.000 millones): 1 SOL por 1M → $200K');
const prof = walletProfile(rounds);
ok(prof.closed === 5 && prof.wins === 3 && prof.winRate === 60 && Math.abs(prof.net - 2.1) < 1e-9, 'patrón: 5 cerradas, 60 % de acierto, +2,1 SOL');
ok(prof.notes.length >= 3 && prof.notes.some((n) => /Aguanta/.test(n.t)) && prof.notes.some((n) => /Suele entrar/.test(n.t)), 'saca frases de su patrón (dónde entra, cuánto aguanta, cuánto gana y pierde)');
const rb = recentBuys([{ address: W, name: 'Ansem', trades: sw }], { since: NOW - 30 * 60e3 });
ok(rb.M6?.[0]?.name === 'Ansem' && !rb.M1, 'compras de los últimos 30 min de las wallets que sigues');

// El bot sabe cuándo compra una wallet que sigues
const pair = { txns: { m5: { buys: 50, sells: 50 }, h1: { buys: 300, sells: 300 } }, volume: { m5: 5000, h1: 60000 } };
const base = smartsAgent(pair, { now: NOW }), withW = smartsAgent(pair, { tracked: rb.M6, now: NOW });
ok(withW.score - base.score >= 0.39 && /que sigues/.test(withW.notes[0].t) && withW.notes[0].v.n === 'Ansem' && withW.notes[0].v.m === 10, 'dinero inteligente: «Ansem, que sigues, compró hace 10 min» sube la nota');
ok(smartsAgent({}, { tracked: rb.M6, now: NOW }).score === 0.4, 'aunque no haya datos de operaciones, la compra de una wallet que sigues cuenta');

// Copiloto
const g0 = copilotGate({ session: { closed: Array.from({ length: 12 }, () => ({ pnlSol: 0.01 })) }, past: [] });
ok(!g0.ok && g0.trades === 12 && g0.need === 8, 'copiloto bloqueado con 12 operaciones (faltan 8)');
const g1 = copilotGate({ session: { closed: Array.from({ length: 12 }, () => ({ pnlSol: 0.01 })) }, past: [{ trades: 10, budgetSol: 10, balance: 9.5 }] });
ok(!g1.ok && g1.trades === 22 && g1.net < 0, 'con 22 operaciones pero en pérdidas, sigue bloqueado');
const g2 = copilotGate({ session: { closed: Array.from({ length: 12 }, () => ({ pnlSol: 0.1 })) }, past: [{ trades: 10, budgetSol: 10, balance: 10.2 }] });
ok(g2.ok && Math.abs(g2.net - 1.4) < 1e-9, 'con 22 operaciones y +1,4 SOL se desbloquea');
const c = cleanCopilot({ on: true, maxSol: 99, maxPerDay: 0, ttlMin: 'x' });
ok(c.on && c.maxSol === 5 && c.maxPerDay === 1 && c.ttlMin === 3, 'límites del copiloto acotados (máx. 5 SOL por aviso)');
const day = new Date(NOW); day.setHours(0, 0, 0, 0);
ok(signalsToday([{ kind: 'buy', at: NOW }, { kind: 'buy', at: day.getTime() - 1 }, { kind: 'sell', at: NOW }], NOW) === 1, 'cuenta solo los avisos de compra de hoy');
console.log(fails ? `${fails} fallos` : 'TODO OK'); process.exit(fails ? 1 : 0);
