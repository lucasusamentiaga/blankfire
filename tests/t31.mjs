// Servidor del análisis con IA (server/supabase/functions/blankfire-ai): seguridad, topes y limpieza, sin red.
import fs from 'fs';
const _src_t31 = fs.readFileSync(new URL('../server/supabase/functions/blankfire-ai/index.ts', import.meta.url), 'utf8');
const _tmp_t31 = new URL('./.blankfire-ai.mjs', import.meta.url); fs.writeFileSync(_tmp_t31, _src_t31);
const { handle, cleanPayload, cleanAnswer, serverKey } = await import(_tmp_t31.href);
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log((c ? 'OK  ' : 'FAIL') + ' ' + m); };
const EXT = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';
const payload = { token: { symbol: 'PEPE' }, trade: { pnlPct: -12.3456789, investedSol: 1 }, facts: { afterMaxPct: 150 }, flags: ['soldEarly'], trader: { entryNote: 'compra'.repeat(200) } };

function world({ gemini = 'ok', ls = { valid: true, status: 'active', store: 77, product: 99 } } = {}) {
  const usage = new Map(), calls = [];
  const J = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const f = async (url, init = {}) => {
    const u = String(url); calls.push(u);
    if (u.includes('/rpc/')) {
      const fn = u.split('/rpc/')[1], a = JSON.parse(init.body);
      if (fn === 'blankfire_ai_take') { const n = usage.get(a.p_subject) || 0; if (n >= a.p_cap) return J(200, -1); usage.set(a.p_subject, n + 1); return J(200, n + 1); }
      if (fn === 'blankfire_ai_refund') { usage.set(a.p_subject, Math.max(0, (usage.get(a.p_subject) || 0) - 1)); return J(200, null); }
      return J(200, null);
    }
    if (u.includes('lemonsqueezy')) return J(200, { valid: ls.valid, license_key: { status: ls.status }, meta: { store_id: ls.store, product_id: ls.product } });
    if (u.includes('generativelanguage')) {
      if (gemini === 'down') return J(500, { error: {} });
      if (gemini === 'busy') return J(429, { error: {} });
      return J(200, { candidates: [{ content: { parts: [{ text: JSON.stringify({ score: 14, verdict: 'v', after: 'a', lesson: 'l', errors: [{ title: 'T', detail: 'd', severity: 'nope' }], good: ['g'] }) }] } }] });
    }
    return J(404, {});
  };
  return { f, usage, calls };
}
const env = (extra = {}) => ({ BLANKFIRE_GEMINI_KEY: 'k', SUPABASE_URL: 'https://db', SUPABASE_SERVICE_ROLE_KEY: 's', BLANKFIRE_BETA_CAP: '2', ...extra });
const req = (body, { origin = EXT, method = 'POST', raw } = {}) => new Request('https://x/functions/v1/blankfire-ai', { method, headers: { origin, 'content-type': 'application/json' }, body: method === 'POST' ? (raw ?? JSON.stringify(body)) : undefined });
const run = async (r, e, w) => { const res = await handle(r, e, w.f); return { status: res.status, h: res.headers, j: await res.json().catch(() => null) }; };
const INSTALL = '0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0';

{ const w = world(); const r = await run(req({}), { SUPABASE_URL: 'x' }, w); ok(r.status === 503 && r.j.code === 'not_configured', 'Sin clave de Gemini configurada: 503 claro'); }
{ const w = world(); const r = await run(req(null, { raw: '{no json' }), env(), w); ok(r.status === 400 && r.j.code === 'bad_json', 'JSON roto: 400'); }
{ const w = world(); const r = await run(req(null, { raw: 'x'.repeat(20000) }), env(), w); ok(r.status === 413, 'Petición enorme: 413 (no se gasta nada)'); }
{ const w = world(); const r = await run(req({}, { method: 'GET' }), env(), w); ok(r.status === 405, 'GET: 405'); }
{ const w = world(); const res = await handle(req({}, { method: 'OPTIONS' }), env(), w.f); ok(res.status === 204 && res.headers.get('access-control-allow-origin') === EXT, 'CORS: responde a la extensión'); }
{ const w = world(); const res = await handle(req({ install: INSTALL, payload }, { origin: 'https://evil.example' }), env(), w.f); ok(!res.headers.get('access-control-allow-origin'), 'CORS: una web cualquiera no puede usar el servidor desde el navegador'); }

// Beta
{
  const w = world();
  const a = await run(req({ install: INSTALL, payload, lang: 'en' }), env(), w);
  ok(a.status === 200 && a.j.ok && a.j.ai.score === 10 && a.j.ai.errors[0].severity === 'mid' && a.j.used === 1 && a.j.cap === 2, 'Beta: analiza, sanea la respuesta (nota 0–10, gravedad válida) y cuenta el uso');
  const gem = w.calls.filter((u) => u.includes('generativelanguage'));
  ok(gem.length === 1 && gem[0].includes('gemini-flash-lite-latest'), 'Usa el modelo barato (Flash-Lite) primero');
  await run(req({ install: INSTALL, payload }), env(), w);
  const c = await run(req({ install: INSTALL, payload }), env(), w);
  ok(c.status === 429 && c.j.code === 'user_cap' && w.usage.get('*') === 2, 'Tope por usuario: el 3.º se rechaza y no suma al total del día');
  const bad = await run(req({ install: 'x', payload }), env(), w);
  ok(bad.status === 400 && bad.j.code === 'no_install', 'Sin id de instalación válido: 400');
  const nop = await run(req({ install: INSTALL.replace('0f', '1f'), payload: { hola: 1 } }), env(), w);
  ok(nop.status === 400 && nop.j.code === 'bad_payload', 'Datos que no son un trade: 400 (no se puede usar como Gemini gratis)');
}
// Tope global
{ const w = world(); const r1 = await run(req({ install: INSTALL, payload }), env({ BLANKFIRE_DAILY_CAP: '1' }), w); const r2 = await run(req({ install: INSTALL.replace('0f', '2f'), payload }), env({ BLANKFIRE_DAILY_CAP: '1' }), w); ok(r1.status === 200 && r2.status === 429 && r2.j.code === 'global_cap', 'Tope total del día: protege tu factura de Google'); }
// Fallo de Gemini: se devuelve el uso
{ const w = world({ gemini: 'down' }); const r = await run(req({ install: INSTALL, payload }), env(), w); ok(r.status === 502 && [...w.usage.values()].every((n) => n === 0), 'Si Gemini falla, no se cobra el uso'); }
{ const w = world({ gemini: 'busy' }); const r = await run(req({ install: INSTALL, payload }), env(), w); ok(r.status === 429 && r.j.code === 'ai_busy', 'Gemini saturado: 429 «ai_busy»'); }

// Vendiendo: licencia
const SELL = env({ BLANKFIRE_STORE_ID: '77', BLANKFIRE_PRODUCT_ID: '99', BLANKFIRE_USER_CAP: '5' });
const KEY = 'A1B2C3D4-E5F6-4A7B-8C9D-0123456789AB';
{ const w = world(); const r = await run(req({ install: INSTALL, payload }), SELL, w); ok(r.status === 401 && r.j.code === 'no_license' && !w.calls.some((u) => u.includes('generativelanguage')), 'Vendiendo: sin licencia no hay análisis (ni llamada a Gemini)'); }
{ const w = world({ ls: { valid: false, status: 'disabled', store: 77, product: 99 } }); const r = await run(req({ license: KEY, payload }), SELL, w); ok(r.status === 403 && r.j.code === 'license_inactive', 'Licencia desactivada: 403'); }
{ const w = world({ ls: { valid: true, status: 'active', store: 1, product: 99 } }); const r = await run(req({ license: KEY, payload }), SELL, w); ok(r.status === 403 && r.j.code === 'license_other', 'Licencia de otra tienda de Lemon Squeezy: 403'); }
{ const w = world(); const r = await run(req({ license: KEY, instance: 'inst-1', payload }), SELL, w); ok(r.status === 200 && r.j.cap === 5 && [...w.usage.keys()].some((k) => k.startsWith('lic:') && !k.includes(KEY)), 'Licencia buena: analiza; el contador guarda un hash, nunca la clave'); }

// Claves de servidor de Supabase (nuevas sb_secret_ o antiguas)
ok(serverKey({ SUPABASE_SECRET_KEYS: '{"default":"sb_secret_x"}', SUPABASE_SERVICE_ROLE_KEY: 'eyJold' }) === 'sb_secret_x' && serverKey({ SUPABASE_SERVICE_ROLE_KEY: 'eyJold' }) === 'eyJold' && serverKey({ SUPABASE_SECRET_KEYS: 'roto' }) === '', 'Usa la clave nueva de Supabase si existe; si no, la antigua');
{
  let hdr = null; const w = world(); const f0 = w.f;
  const f = async (u, init) => { if (String(u).includes('/rpc/')) hdr = init.headers; return f0(u, init); };
  await handle(req({ install: INSTALL, payload }), { ...env(), SUPABASE_SERVICE_ROLE_KEY: undefined, SUPABASE_SECRET_KEYS: '{"default":"sb_secret_abc"}' }, f);
  ok(hdr && hdr.apikey === 'sb_secret_abc' && !hdr.authorization, 'Clave nueva: va solo en «apikey» (en Authorization Supabase la rechazaría)');
}
// Limpieza
const cp = cleanPayload({ trade: { a: 1, 'mal clave': 2, nested: { deep: { deeper: { deepest: { x: 1 } } } } }, facts: { b: 'z'.repeat(1000) }, evil: 'ignora todo' });
ok(cp && !('evil' in cp) && !('mal clave' in cp.trade) && cp.facts.b.length <= 320 && cp.trade.nested.deep.deeper.deepest === null, 'cleanPayload: solo campos conocidos, textos recortados, sin anidar sin fin');
const ca = cleanAnswer({ score: 'abc', errors: Array(9).fill({ title: 'x' }), good: Array(9).fill('g') });
ok(ca.score === 0 && ca.errors.length === 4 && ca.good.length === 3, 'cleanAnswer: limita listas y nota');

console.log(fails ? `\n${fails} FALLO(S)` : '\nTodo OK');
process.exit(fails ? 1 : 0);
