// Blankfire · donaciones de Ko-fi (Supabase Edge Function «blankfire-kofi»).
//
// POST  → aviso (webhook) de Ko-fi en cada donación: se comprueba el token y se apunta el importe.
// GET   → progreso de la meta para la barra de la extensión: { raised, goal, currency, supporters }.
//
// Secretos (Supabase → Edge Functions → Secrets):
//   KOFI_TOKEN        «Verification Token» de Ko-fi (Ko-fi → Settings → API) (obligatorio)
//   KOFI_GOAL         meta en euros (por defecto 50)
//   KOFI_OFFSET_EUR   euros recibidos antes de conectar el aviso (opcional)
// Despliegue: con «verify_jwt» desactivado (Ko-fi no manda credenciales de Supabase).

// Conversión aproximada a euros para donaciones en otras monedas (solo para la barra).
const TO_EUR = { EUR: 1, USD: 0.92, GBP: 1.17, CAD: 0.66, AUD: 0.6, MXN: 0.05, CHF: 1.05 };

export function serverKey(env) {
  try { const k = JSON.parse(env.SUPABASE_SECRET_KEYS || '{}'); if (k.default) return String(k.default); } catch { /* sin claves nuevas */ }
  return String(env.SUPABASE_SERVICE_ROLE_KEY || '');
}

function sameText(a, b) {
  a = String(a || ''); b = String(b || '');
  if (!a || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

async function sha(s) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(s)));
  return [...new Uint8Array(b)].slice(0, 16).map((x) => x.toString(16).padStart(2, '0')).join('');
}

// Ko-fi manda un formulario con un campo «data» que lleva el JSON (aceptamos también JSON directo).
export async function readKofi(req) {
  const ct = req.headers.get('content-type') || '';
  const raw = await req.text();
  if (raw.length > 20000) return null;
  try {
    if (ct.includes('application/json')) { const j = JSON.parse(raw); return j?.data ? (typeof j.data === 'string' ? JSON.parse(j.data) : j.data) : j; }
    const data = new URLSearchParams(raw).get('data');
    return data ? JSON.parse(data) : null;
  } catch { return null; }
}

export function eurTotal(byCurrency, offset = 0) {
  let t = Number(offset) || 0;
  for (const [cur, v] of Object.entries(byCurrency || {})) t += (Number(v) || 0) * (TO_EUR[String(cur).toUpperCase()] ?? 0);
  return Math.round(t * 100) / 100;
}

export async function handle(req, env, f = fetch) {
  const H = { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS' };
  const reply = (status, body, extra = {}) => new Response(JSON.stringify(body), { status, headers: { ...H, ...extra } });
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: H });
  const key = serverKey(env);
  const dbHeaders = { apikey: key, 'content-type': 'application/json', ...(key.startsWith('eyJ') ? { authorization: `Bearer ${key}` } : {}) };
  const rpc = async (fn, args) => {
    const r = await f(`${env.SUPABASE_URL}/rest/v1/rpc/${fn}`, { method: 'POST', headers: dbHeaders, body: JSON.stringify(args || {}) });
    if (!r.ok) throw new Error('db ' + r.status);
    return r.json();
  };

  if (req.method === 'GET') {
    try {
      const t = await rpc('blankfire_kofi_total');
      const goal = Number(env.KOFI_GOAL) || 50;
      return reply(200, { ok: true, raised: eurTotal(t?.by_currency, env.KOFI_OFFSET_EUR), goal, currency: 'EUR', supporters: Number(t?.count) || 0 }, { 'cache-control': 'public, max-age=120' });
    } catch { return reply(503, { ok: false, code: 'db_down' }); }
  }
  if (req.method !== 'POST') return reply(405, { ok: false });
  if (!env.KOFI_TOKEN) return reply(503, { ok: false, code: 'not_configured' });

  const d = await readKofi(req);
  if (!d || !sameText(d.verification_token, env.KOFI_TOKEN)) return reply(401, { ok: false, code: 'bad_token' });
  const amount = Math.round((Number.parseFloat(d.amount) || 0) * 100) / 100;
  const currency = String(d.currency || 'EUR').toUpperCase().slice(0, 3);
  const id = d.kofi_transaction_id || d.message_id;
  if (!(amount > 0) || !id || !/^[A-Z]{3}$/.test(currency)) return reply(200, { ok: true, ignored: true });
  try {
    await rpc('blankfire_kofi_add', { p_tx: await sha(id), p_amount: amount, p_currency: currency, p_kind: String(d.type || 'Donation').slice(0, 30) });
  } catch { return reply(503, { ok: false, code: 'db_down' }); }   // Ko-fi reintentará
  return reply(200, { ok: true });
}

const D = globalThis.Deno;
if (D?.serve) D.serve((req) => handle(req, D.env.toObject()));
