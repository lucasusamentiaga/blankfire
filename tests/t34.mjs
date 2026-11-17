// Chequeo de monedas · funciones puras: lectura de textos de Padre, umbrales, veredicto y textos.
import { parsePct, parseSnipers, parseDev, parseUsd, screenToken, screenRisks, bundleLimits, mergeFacts, screenLimits, checkValue, checkWhy } from '../Fogueo/lib/screen.js';
import { setLang } from '../Fogueo/lib/i18n.js';
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log((c ? 'OK  ' : 'FAIL') + ' ' + m); };
setLang('es');
ok(parsePct('66%') === 66 && parsePct('> 27.0%') === 27 && parsePct('-') === null && parsePct('0,3 %') === 0.3, 'parsePct lee «66%», «> 27.0%», «-» y comas');
ok(JSON.stringify(parseSnipers('23•9%')) === '{"n":23,"pct":9}' && JSON.stringify(parseSnipers('1 • 50%')) === '{"n":1,"pct":50}' && parseSnipers('9%') === null, 'parseSnipers lee «23•9%»');
ok(parseDev('21%3mo').pct === 21 && parseDev('DS1mo').sold && parseDev('DS 7m').sold && parseDev('0%2h').pct === 0 && parseDev('34%') === null && parseDev('1.25%') === null, 'parseDev distingue la pastilla del dev (con edad) del bundle y la comisión');
ok(parseUsd('$73.0K') === 73000 && parseUsd('$1.2M') === 1.2e6 && parseUsd('$94') === 94, 'parseUsd lee $K/$M');
// Las cinco imágenes de referencia
const r1 = screenToken({ top10: 66, mcUsd: 27000 });
ok(r1.checks.find((c) => c.id === 'top10').level === 'bad' && r1.verdict === 'avoid', 'top 10 al 66 % → peligro / evitar');
ok(screenToken({ top10: 20, dev: 29, mcUsd: 25000 }).checks.find((c) => c.id === 'dev').level === 'bad', 'dev con 29 % → peligro');
ok(screenToken({ top10: 13, snipers: 9, snipersN: 23 }).checks.find((c) => c.id === 'snipers').level === 'warn', 'snipers 23 con el 9 % → ojo');
ok(screenToken({ top10: 13, snipers: 0, snipersN: 23 }).checks.find((c) => c.id === 'snipers').level === 'ok', 'snipers al 0 % (ya vendieron) → bien');
const b = (v, mc) => screenToken({ top10: 10, bundles: v, mcUsd: mc }).checks.find((c) => c.id === 'bundles').level;
ok(b(25, 8000) === 'ok' && b(34, 20000) === 'bad' && b(35, 8000) === 'warn' && b(8, 100000) === 'warn' && b(15, 100000) === 'bad', 'bundle: 25 % normal a 8K, 34 % peligroso a 20K, se aprieta al crecer');
ok(bundleLimits(5000).warn === 40 && bundleLimits(30000).warn === 20 && bundleLimits(1e6).warn === 12, 'límites del bundle por market cap');
const liq = screenToken({ top10: 10, mcUsd: 64000, liqUsd: 94 }).checks.find((c) => c.id === 'liq');
ok(liq.level === 'bad' && liq.ratio < 1, 'liquidez de 94 $ con 64K de MC → peligro');
ok(screenToken({ top10: 10, mcUsd: 100000, liqUsd: 20000 }).checks.find((c) => c.id === 'liq').level === 'ok', 'liquidez del 20 % → bien');
ok(screenToken({ top10: 10, mcUsd: 100000, liqUsd: 6000 }).checks.find((c) => c.id === 'liq').level === 'warn', 'liquidez del 6 % → ojo');
ok(screenToken({ top10: 10, curve: true, mcUsd: 9000 }).checks.find((c) => c.id === 'liq').level === 'ok', 'en la curva de pump.fun la liquidez no penaliza');
ok(screenToken({ top10: 10, dev: 1, mintAuth: true }).verdict === 'avoid', 'autoridad de mint activa → evitar');
// Veredictos
ok(screenToken({ top10: 18, dev: 2, snipers: 1, insiders: 4, bundles: 5, mcUsd: 50000 }).verdict === 'good', 'todo sano → pinta bien');
ok(screenToken({ top10: 35, dev: 8, snipers: 1, insiders: 4 }).verdict === 'care', 'dos señales flojas → con cuidado');
ok(screenToken({ top10: 35, dev: 2, snipers: 1, insiders: 4 }).verdict === 'good', 'una sola floja → sigue pintando bien');
ok(screenToken({ top10: 20 }).verdict === 'unknown' && screenToken({}).verdict === 'unknown', 'pocos datos → faltan datos');
ok(screenToken({ top10: 0, dev: 0, snipers: 0, insiders: 0 }).verdict === 'unknown', 'top 10 al 0 % (token de segundos) → faltan datos, no «bien»');
// Rigor
const lv = (rigor) => screenToken({ top10: 27, dev: 1, snipers: 1, insiders: 1 }, { rigor }).checks[0].level;
ok(lv('strict') === 'warn' && lv('normal') === 'ok', 'el rigor prudente aprieta los umbrales');
ok(screenToken({ top10: 50, dev: 1, snipers: 1, insiders: 1 }, { rigor: 'loose' }).checks[0].level === 'warn', 'el rigor arriesgado los afloja');
ok(screenLimits('normal').top10.ok === 30 && screenLimits('strict').dev.warn === 11.3, 'tabla de umbrales efectivos');
// Mezcla y textos
ok(JSON.stringify(mergeFacts({ a: null, b: 1 }, { a: 2, b: 3 }, { c: 4 })) === '{"b":1,"a":2,"c":4}', 'mergeFacts: manda el primero con valor');
const bad = screenToken({ top10: 66, dev: 21, snipers: 9, snipersN: 23, insiders: 23, bundles: 34, mcUsd: 27000 });
ok(screenRisks(bad).join(', ') === 'top 10 66 %, dev 21 %, insiders 23 %, bundle 34 %', 'resumen de riesgos: ' + screenRisks(bad).join(', '));
ok(checkValue(bad.checks.find((c) => c.id === 'snipers')) === '23 · 9 %', 'valor de snipers «23 · 9 %»');
ok(bad.checks.every((c) => checkWhy(c).length > 30 && !/\{|undefined|NaN/.test(checkWhy(c))), 'cada criterio tiene su explicación completa');
setLang('en');
ok(screenRisks(bad)[0] === 'top 10 66%' && /holds/.test(checkWhy(bad.checks[1])), 'textos en inglés');
console.log(fails ? `${fails} FALLOS` : 'TODO OK');
process.exit(fails ? 1 : 0);
