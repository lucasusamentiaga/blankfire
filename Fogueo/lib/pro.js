// Blankfire Pro — licencia de pago con Lemon Squeezy (de Stripe), sin servidor propio.
// Lemon Squeezy cobra, hace las facturas con IVA y genera una clave de licencia por compra.
// La extensión activa y comprueba esa clave con su License API pública (no necesita ninguna clave secreta).
//
// Para empezar a cobrar, rellena estos datos con los de tu tienda y tu servidor (ver README · «Cobrar el Pro»):
export const PRO_CONFIG = {
  aiUrl: '',         // servidor del análisis con IA, p. ej. https://xxxx.supabase.co/functions/v1/blankfire-ai
  checkoutUrl: '',   // enlace de compra del producto, p. ej. https://blankfire.lemonsqueezy.com/buy/xxxx
  storeId: null,     // número de tu tienda (Settings → Stores)
  productId: null,   // número del producto Blankfire Pro
};
// Mientras checkoutUrl esté vacío, el Pro funciona gratis para todos como «beta».
// Mientras aiUrl esté vacío, el análisis con IA sale como «próximamente» (el resto del Pro funciona igual).
export const LEGAL = {
  terms: 'https://github.com/lucasusamentiaga/blankfire/blob/main/docs/terminos.md',
  privacy: 'https://github.com/lucasusamentiaga/blankfire/blob/main/docs/privacidad.md',
};

export const PRO_KEY = 'blankfirePro';
export const LS_API = 'https://api.lemonsqueezy.com/v1/licenses';
export const REVALIDATE_MS = 3 * 24 * 3600e3;   // se vuelve a comprobar cada 3 días
export const GRACE_MS = 14 * 24 * 3600e3;       // sin conexión, la licencia sigue valiendo 14 días

export const proSelling = () => !!PRO_CONFIG.checkoutUrl;

// ¿Está desbloqueado el Pro? info = lo guardado en storage[PRO_KEY]
export function isPro(info, now = Date.now()) {
  if (!proSelling()) return true;   // beta gratis
  if (!info || info.status !== 'active' || !info.key) return false;
  return now - (info.validatedAt || 0) < GRACE_MS;
}

export function proState(info, now = Date.now()) {
  if (!proSelling()) return 'beta';
  if (isPro(info, now)) return 'active';
  if (info?.status === 'active') return 'stale';     // activa pero sin comprobar hace más de 14 días
  if (info?.status && info.status !== 'none') return info.status;   // expired | disabled | invalid
  return 'free';
}

// La respuesta de Lemon Squeezy tiene que ser de TU tienda y de TU producto (si no, cualquier
// clave de otra tienda de Lemon Squeezy valdría).
export function licenseMatches(meta) {
  if (!meta) return false;
  if (PRO_CONFIG.storeId != null && Number(meta.store_id) !== Number(PRO_CONFIG.storeId)) return false;
  if (PRO_CONFIG.productId != null && Number(meta.product_id) !== Number(PRO_CONFIG.productId)) return false;
  return true;
}

export const maskKey = (k) => (k ? `${String(k).slice(0, 4)}…${String(k).slice(-4)}` : '');
