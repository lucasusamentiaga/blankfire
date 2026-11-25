// Blankfire — caja fuerte de la wallet del bot. La clave privada se guarda cifrada con AES-256-GCM;
// la llave sale de tu contraseña con PBKDF2-SHA256 (600.000 rondas) y una sal aleatoria.
// Sin la contraseña, lo guardado no sirve para nada aunque alguien copie tus datos del navegador.
const ITER = 600000;
const enc = new TextEncoder();
const b64 = (u8) => btoa(String.fromCharCode(...u8));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function deriveKey(password, salt, iter) {
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
export function passwordProblem(pw) {
  const p = String(pw || '');
  if (p.length < 10) return 'Mínimo 10 caracteres.';
  if (/^(.)\1+$/.test(p) || /^(0123456789|1234567890|password|contraseña|qwertyuiop)/i.test(p)) return 'Demasiado fácil de adivinar.';
  if (!(/[a-zA-Z]/.test(p) && /[^a-zA-Z]/.test(p))) return 'Mezcla letras con números o símbolos.';
  return null;
}
export async function seal(secretBytes, password, { iter = ITER } = {}) {
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, iter);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, secretBytes));
  return { v: 1, kdf: 'PBKDF2-SHA256', iter, salt: b64(salt), iv: b64(iv), ct: b64(ct) };
}
export async function open(box, password) {
  try {
    const key = await deriveKey(password, unb64(box.salt), box.iter || ITER);
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(box.iv) }, key, unb64(box.ct)));
  } catch { throw new Error('Contraseña incorrecta.'); }
}
