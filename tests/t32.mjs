// Servidor de donaciones (server/supabase/functions/blankfire-kofi): aviso de Ko-fi y progreso de la meta, sin red.
import fs from 'fs';
const _src_t32 = fs.readFileSync(new URL('../server/supabase/functions/blankfire-kofi/index.ts', import.meta.url), 'utf8');
const _tmp_t32 = new URL('./.blankfire-kofi.mjs', import.meta.url); fs.writeFileSync(_tmp_t32, _src_t32);
const { handle, readKofi, eurTotal } = await import(_tmp_t32.href);
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log((c ? 'OK  ' : 'FAIL') + ' ' + m); };

function world() {
  const rows = new Map();
  const J = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const f = async (url, init = {}) => {
    const fn = String(url).split('/rpc/')[1], a = JSON.parse(init.body || '{}');
    if (fn === 'blankfire_kofi_add') { if (rows.has(a.p_tx)) return J(200, false); rows.set(a.p_tx, a); return J(200, true); }
    if (fn === 'blankfire_kofi_total') {
      const by = {}; for (const r of rows.values()) by[r.p_currency] = (by[r.p_currency] || 0) + r.p_amount;
      return J(200, { by_currency: by, count: rows.size });
    }
    return J(404, {});
  };
  return { f, rows };
}
const env = { KOFI_TOKEN: 'tok-123', SUPABASE_URL: 'https://db', SUPABASE_SECRET_KEYS: '{"default":"sb_secret_x"}' };
const kofi = (data, token = 'tok-123') => new Request('https://x/functions/v1/blankfire-kofi', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ data: JSON.stringify({ verification_token: token, ...data }) }) });
const get = () => new Request('https://x/functions/v1/blankfire-kofi');

const w = world();
let r = await handle(kofi({ type: 'Donation', amount: '5.00', currency: 'EUR', kofi_transaction_id: 'tx1', from_name: 'Ana', email: 'ana@example.com' }), env, w.f);
ok(r.status === 200 && w.rows.size === 1, 'Donación de Ko-fi apuntada');
ok(!JSON.stringify([...w.rows.values()]).includes('Ana') && !JSON.stringify([...w.rows.values()]).includes('example.com') && ![...w.rows.keys()][0].includes('tx1'), 'No se guardan nombres, emails ni el id real (solo un hash)');
r = await handle(kofi({ type: 'Donation', amount: '5.00', currency: 'EUR', kofi_transaction_id: 'tx1' }), env, w.f);
ok(r.status === 200 && w.rows.size === 1, 'Si Ko-fi reintenta el mismo aviso, no cuenta dos veces');
r = await handle(kofi({ type: 'Donation', amount: '100', currency: 'EUR', kofi_transaction_id: 'tx9' }, 'falso'), env, w.f);
ok(r.status === 401 && w.rows.size === 1, 'Token falso: rechazado (nadie puede inflar la barra)');
await handle(kofi({ type: 'Donation', amount: '10', currency: 'USD', kofi_transaction_id: 'tx2' }), env, w.f);
await handle(kofi({ type: 'Donation', amount: '-3', currency: 'EUR', kofi_transaction_id: 'tx3' }), env, w.f);
r = await handle(get(), { ...env, KOFI_OFFSET_EUR: '2' }, w.f);
const j = await r.json();
ok(r.status === 200 && j.raised === 16.2 && j.goal === 50 && j.supporters === 2, `Progreso: ${j.raised} € de ${j.goal} € (5 € + 10 $ ≈ 9,20 € + 2 € de antes), ${j.supporters} apoyos`);
ok(r.headers.get('access-control-allow-origin') === '*' && /max-age=120/.test(r.headers.get('cache-control')), 'La barra se puede leer desde la extensión y se cachea 2 min');
r = await handle(kofi({}), { ...env, KOFI_TOKEN: '' }, w.f);
ok(r.status === 503, 'Sin token configurado: no acepta avisos');
const jr = await readKofi(new Request('https://x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ data: { verification_token: 'a', amount: '1' } }) }));
ok(jr?.verification_token === 'a', 'Acepta también el aviso en JSON');
ok(eurTotal({ EUR: 10, XYZ: 99 }) === 10, 'Monedas desconocidas no suman');

console.log(fails ? `\n${fails} FALLO(S)` : '\nTodo OK');
process.exit(fails ? 1 : 0);
