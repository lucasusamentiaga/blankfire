// Escudo anti-rug: copias, dibujos de rug en el gráfico, nota 0-100 y lectura de contadores de Padre.
import { analyzeCopies, analyzeChart, shieldScore, scoreBand, parseCount } from '../Fogueo/lib/shield.js';
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log((c ? 'OK  ' : 'FAIL') + ' ' + m); };
const NOW = Date.UTC(2026, 10, 24, 22, 0);
const pair = (address, name, symbol, fdv, minsAgo, chainId = 'solana') => ({ chainId, fdv, pairCreatedAt: NOW - minsAgo * 60_000, baseToken: { address, name, symbol } });
const me = (mc, minsAgo = 10) => ({ address: 'SELF', name: 'SpaceX Squirrel', symbol: 'SQUIRREL', createdAt: NOW - minsAgo * 60_000, mcUsd: mc });

// Caso real SpaceX Squirrel: la copia anterior murió en $1.2K y la nuestra va por $250K → es la líder.
let r = analyzeCopies(me(250_000, 30), [pair('OLD', 'SpaceX Squirrel', 'SQUIRREL', 1_200, 40)], NOW);
ok(r.level === 'ok' && r.kind === 'leader', 'la que más ha subido no se marca como copia (caso SpaceX Squirrel)');
// La gemela anterior lo hizo mejor → copia.
r = analyzeCopies(me(8_000), [pair('OLD', 'SpaceX Squirrel', 'SQUIRREL', 60_000, 90)], NOW);
ok(r.level === 'warn' && r.kind === 'twin' && r.top.address === 'OLD', 'gemela anterior que llegó más alto → «repetida»');
// Una famosa anterior → rojo.
r = analyzeCopies(me(20_000), [pair('FAM', 'spacex squirrel', 'SQRL', 3_000_000, 60 * 24 * 30)], NOW);
ok(r.level === 'bad' && r.kind === 'famous', 'copia de una moneda famosa anterior → «copia» en rojo');
// Enjambre de copias hoy.
r = analyzeCopies(me(5_000), [pair('A', 'x', 'SQUIRREL', 9_000, 30), pair('B', 'y', 'SQUIRREL', 7_000, 50), pair('C', 'z', 'SQUIRREL', 100, 120)], NOW);
ok(r.level === 'warn' && r.kind === 'swarm' && r.today === 3, 'tres o más con el mismo ticker hoy → enjambre');
// Otras cadenas e iguales a sí misma no cuentan; sin parecidas → única.
r = analyzeCopies(me(5_000), [pair('SELF', 'SpaceX Squirrel', 'SQUIRREL', 9e6, 999), pair('ETH', 'SpaceX Squirrel', 'SQUIRREL', 9e6, 999, 'ethereum')], NOW);
ok(r.level === 'ok' && r.kind === 'unique' && r.total === 0, 'ignora la propia moneda y otras cadenas');
// Una creada después (o en el mismo minuto) no es «la original».
r = analyzeCopies(me(5_000, 10), [pair('NEW', 'SpaceX Squirrel', 'SQUIRREL', 9e6, 9.5)], NOW);
ok(r.level === 'ok' && r.older === 0, 'una moneda posterior no cuenta como original');
ok(analyzeCopies({ address: 'x' }, [], NOW) === null, 'sin nombre ni ticker no opina');

// Gráficos (velas de 1 minuto, [t,o,h,l,c,v]).
const mk = (closes, vol = (i) => 100 + (i * 37) % 90) => closes.map((c, i) => { const o = i ? closes[i - 1] : c; return [i * 60, o, Math.max(o, c) * 1.01, Math.min(o, c) * 0.99, c, vol(i)]; });
const healthy = mk([1, 1.1, 1.2, 1.15, 1.3, 1.4, 1.35, 1.5, 1.6, 1.55, 1.7, 1.8]);
let ch = analyzeChart(healthy.slice().reverse());
ok(ch.level === 'ok' && ch.signals.length === 0, 'gráfico sano (aunque llegue de más nuevo a más viejo) → bien');
ch = analyzeChart(mk([1, 1.2, 1.4, 1.5, 1.6, 1.7, 0.6, 0.55, 0.5]));
ok(ch.signals.some((s) => s.id === 'rugCandle') && ch.level === 'bad', 'vela de −50 % en un minuto → rug');
ch = analyzeChart(mk([1, 1.5, 2.5, 3.5, 4.6, 3, 2, 1.4, 1.2, 1.1]));
ok(ch.signals.some((s) => s.id === 'pumpDump'), '×4 y desplome justo después → pump & dump');
ch = analyzeChart(mk([1, 2, 3, 4, 5, 4.5, 4, 3.5, 3, 2.6, 2.4]));
ok(ch.signals.some((s) => s.id === 'dumped' && s.level === 'warn') && ch.fromPeak < -50, 'más de −50 % desde el máximo → ojo');
ch = analyzeChart(mk([1, 1.01, 1.02, 1.03, 1.02, 1.04, 1.05, 1.06, 1.05, 1.07, 1.08, 1.09], () => 500));
ok(ch.signals.some((s) => s.id === 'botVolume'), 'volumen idéntico vela tras vela → bots');
ok(analyzeChart([[1, 1, 1, 1, 1, 1]]) === null && analyzeChart([[0, 0, 0, 0, 0]]) === null, 'pocas velas o datos rotos → sin opinión');

// Nota.
const c = (id, level) => ({ id, level });
ok(shieldScore([c('top10', 'ok'), c('dev', 'ok'), c('auth', 'ok')]) === 100, 'todo bien → 100');
ok(shieldScore([c('top10', 'na'), c('dev', 'ok')]) === null, 'con menos de 3 datos no hay nota');
const s1 = shieldScore([c('top10', 'warn'), c('dev', 'ok'), c('chart', 'warn')]);
ok(s1 === 100 - 9 - 14, 'los críticos restan más (ojo)');
const s2 = shieldScore([c('copies', 'bad'), c('chart', 'bad'), c('auth', 'bad'), c('top10', 'bad')]);
ok(s2 === 0 && scoreBand(s2) === 'bad', 'no baja de 0');
ok(scoreBand(80) === 'ok' && scoreBand(60) === 'warn' && scoreBand(49) === 'bad' && scoreBand(null) === 'na', 'bandas de color de la nota');

// Contadores de Padre.
ok(parseCount('Holders (3772)') === 3772 && parseCount('(3.81K)') === 3810 && parseCount('Dev Tokens (1)') === 1 && parseCount('1,204') === 1204 && parseCount('—') === null, 'lee «(3772)», «3.81K», «1,204»');
console.log(fails ? `${fails} fallos` : 'TODO OK'); process.exit(fails ? 1 : 0);
