// Blankfire — idiomas. El texto en español es la clave; EN traduce.
// tr('Hola {n}', { n: 2 }) → «Hola 2» / «Hi 2».
import { EN } from './i18n-en.js';

let LANG = 'es';

export function detectLang() {
  try { return String(navigator.language || 'es').toLowerCase().startsWith('es') ? 'es' : 'en'; } catch { return 'es'; }
}

export function setLang(l) { LANG = l === 'en' || l === 'es' ? l : detectLang(); return LANG; }
export function getLang() { return LANG; }
export function locale() { return LANG === 'en' ? 'en-US' : 'es-ES'; }

export function tr(s, vars) {
  let out = LANG === 'en' ? (EN[s] ?? s) : s;
  if (vars) out = out.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  return out;
}

// Para pruebas: cadenas que se pidieron en inglés y no tenían traducción.
export const MISSING = new Set();
export function trChecked(s, vars) { if (LANG === 'en' && !(s in EN)) MISSING.add(s); return tr(s, vars); }
