// Fase 3 (lógica): «Dónde pierdes» y la repetición (probar entradas con stop y objetivo).
import { diagnose, markReentries } from '../Fogueo/lib/diag.js';
import { testEntry, entryMap, gameResult, indexAt, startIndex } from '../Fogueo/lib/replay.js';
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log((c ? 'OK  ' : 'FAIL') + ' ' + m); };
const T0 = Date.UTC(2026, 10, 20, 10, 0);   // 10:00 UTC
const H = 3600e3;
let id = 0;
const R = (o) => ({ id: 'r' + (++id), key: 'solana:' + (o.tok || 'T' + id), symbol: o.tok || 'T', openedAt: o.at, closedAt: o.at + (o.hold ?? 5 * 60e3), pnlSol: o.pnl, investedSol: 0.5, entryMcUsd: o.mc });
const rounds = [
  // Microcaps (< $20K): 4 operaciones, 1 ganadora, neto muy negativo
  R({ at: T0, mc: 9e3, pnl: -0.2 }), R({ at: T0 + H, mc: 12e3, pnl: -0.25 }), R({ at: T0 + 2 * H, mc: 15e3, pnl: 0.05 }), R({ at: T0 + 3 * H, mc: 8e3, pnl: -0.3 }),
  // $100K–500K: 3 ganadoras
  R({ at: T0 + 4 * H, mc: 200e3, pnl: 0.3 }), R({ at: T0 + 5 * H, mc: 300e3, pnl: 0.2 }), R({ at: T0 + 6 * H, mc: 150e3, pnl: 0.1, hold: 30 * 60e3 }),
  // Re-entradas en FROG tras perder
  R({ at: T0 + 7 * H, tok: 'FROG', mc: 50e3, pnl: -0.1 }), R({ at: T0 + 7 * H + 10 * 60e3, tok: 'FROG', mc: 50e3, pnl: -0.15 }),
  R({ at: T0 + 7 * H + 20 * 60e3, tok: 'FROG', mc: 50e3, pnl: -0.12 }), R({ at: T0 + 7 * H + 30 * 60e3, tok: 'FROG', mc: 50e3, pnl: -0.1 }),
];
const d = diagnose(rounds, { tzOffsetMin: 0 });
ok(d.all.n === 11, 'cuenta todas las operaciones');
const micro = d.byMc.find((b) => b.id === 'micro');
ok(micro.n === 4 && micro.wins === 1 && Math.abs(micro.net + 0.7) < 1e-9 && micro.winRate === 25, 'tramo < $20K: 4 operaciones, 25 % de acierto, −0,7 SOL');
ok(d.findings[0].id === 'mc' && d.findings[0].band === 'micro', 'la primera conclusión señala el tramo de market cap que más resta');
ok(d.findings.some((f) => f.id === 'mcBest' && f.band === 'mid'), 'y también dice dónde mejor te va ($100K–$500K)');
const re = markReentries(rounds);
ok([...re.values()].filter(Boolean).length === 3, 'detecta 3 re-entradas en la misma moneda en menos de 2 h');
ok(d.findings.some((f) => f.id === 'reentryLoss' && f.v.n === 3), 'conclusión: volver a una moneda en la que acabas de perder');
ok(d.byHour.find((h) => h.from === 16).n === 5, 'agrupa por franja horaria (16–20 h: 5 operaciones)');
ok(d.byHold.find((h) => h.id === 'mid').n === 1, 'agrupa por cuánto aguantas');
ok(diagnose(rounds.slice(0, 4)).findings.length === 0, 'con menos de 5 operaciones no saca conclusiones');
ok(markReentries([R({ at: T0, tok: 'X', pnl: 1 }), R({ at: T0 + 3 * H, tok: 'X', pnl: 1 })]).size === 2 && [...markReentries([R({ at: T0, tok: 'X', pnl: 1 }), R({ at: T0 + 3 * H, tok: 'X', pnl: 1 })]).values()].every((v) => !v), 'volver 3 h después no cuenta como re-entrada');

// Repetición
const cs = [];
const t0 = Math.floor(T0 / 1000);
const path = [1, 1, 1, 1.05, 1.1, 1.2, 1.5, 2.1, 2.2, 1.9, 1.2, 0.9, 0.7, 0.72];
path.forEach((p, i) => { const o = i ? path[i - 1] : p; cs.push([t0 + i * 60, o, Math.max(o, p) * 1.01, Math.min(o, p) * 0.99, p, 100]); });
const a = testEntry(cs, 2, { stopPct: 30, tpPct: 100 }, 6);
ok(a.reason === 'tp' && Math.abs(a.pricePct - 100) < 1e-9 && Math.abs(a.netPct - 94) < 1e-9 && a.exitIdx === 7, 'entrar en la vela 2: llega al +100 % en la vela 7 (94 % tras comisiones)');
const b = testEntry(cs, 8, { stopPct: 30, tpPct: 100 }, 6);
ok(b.reason === 'stop' && Math.abs(b.pricePct + 30) < 1e-9 && b.netPct < -35, 'entrar arriba del todo: salta el stop al −30 %');
const c = testEntry(cs, 11, { stopPct: 30, tpPct: 100 }, 6);
ok(c.reason === 'end' && c.exitIdx === cs.length - 1, 'sin tocar stop ni objetivo, sale al final');
// Stop y objetivo en la misma vela: cuenta el stop
const wild = [[0, 1, 1, 1, 1, 0], [60, 1, 2.5, 0.5, 1, 0]];
ok(testEntry(wild, 0, { stopPct: 30, tpPct: 100 }).reason === 'stop', 'si en la misma vela se tocan los dos, cuenta el stop (prudente)');
const m = entryMap(cs, { stopPct: 30, tpPct: 100 }, 6);
ok(m.length === cs.length && m[cs.length - 1] === null && m[2] > 0 && m[8] < 0, 'mapa de entradas: verde abajo, rojo arriba');
ok(Math.abs(gameResult(cs, 3, 7, 5).pricePct - 100) < 1e-9 && gameResult(cs, 7, 3) === null, 'resultado de la partida (y nada si vendes antes de comprar)');
ok(indexAt(cs, (t0 + 125) * 1000) === 2 && indexAt(cs, (t0 - 5) * 1000) === -1, 'encuentra la vela de un instante');
ok(startIndex(cs, { fills: [{ side: 'buy', t: (t0 + 12 * 60) * 1000 }] }, 4) === 8 && startIndex(cs, null) >= 5, 'la partida empieza unas velas antes de tu compra');
console.log(fails ? `${fails} fallos` : 'TODO OK'); process.exit(fails ? 1 : 0);
