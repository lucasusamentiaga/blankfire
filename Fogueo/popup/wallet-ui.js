// Blankfire — guía «Conectar Phantom a Padre», paso a paso y adaptada al navegador.
// Blankfire nunca toca la wallet: esto es solo una ayuda para empezar a operar de verdad.
import { tr } from '../lib/i18n.js';

export const PHANTOM_STORE = 'https://chromewebstore.google.com/detail/phantom/bfnaelmomeimhlpmgjnjophhpkkoljpa';
export const PADRE_URL = 'https://trade.padre.gg';

// Opera (y Opera GX) se identifican con «OPR/» en el user agent.
// Opera GX además se anuncia como «Opera GX» en navigator.userAgentData.brands.
export function browserName(ua = globalThis.navigator?.userAgent || '', brands = globalThis.navigator?.userAgentData?.brands || []) {
  const gx = brands.some((b) => /Opera GX/i.test(b.brand)) || /GX/i.test(ua);
  if (/OPR\/|Opera/.test(ua) || brands.some((b) => /Opera/i.test(b.brand))) return gx ? 'Opera GX' : 'Opera';
  if (/Edg\//.test(ua)) return 'Edge';
  if (/Brave/.test(ua)) return 'Brave';
  return 'Chrome';
}
export const isOpera = (ua) => browserName(ua).startsWith('Opera');
export const extensionsUrl = (ua) => (isOpera(ua) ? 'opera://extensions' : browserName(ua) === 'Edge' ? 'edge://extensions' : 'chrome://extensions');

const ic = {
  ext: '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M9 3h4v4M13 3 7.5 8.5M11.5 9.5V12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5.5a1 1 0 0 1 1-1h2.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  cube: '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 1.8 13.5 5v6L8 14.2 2.5 11V5L8 1.8Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M2.5 5 8 8.2 13.5 5M8 8.2v6" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>',
  pin: '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M9.6 2.2 13.8 6.4l-1.6.6-2.4 2.4.2 2.6-1.3 1.3L4.7 9.3 6 8l2.6.2L11 5.8l.6-1.6" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M5.6 10.4 2.4 13.6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
  ghost: '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M8 1.8a5.7 5.7 0 0 0-5.7 5.7v5.9c0 .7.8 1 1.3.6l.9-.8a.8.8 0 0 1 1 0l.9.8a.8.8 0 0 0 1.1 0l.9-.8a.8.8 0 0 1 1 0l.9.8a.8.8 0 0 0 1.1 0l.9-.8a.8.8 0 0 1 1 0l.9.8c.5.4 1.3.1 1.3-.6V7.5A5.7 5.7 0 0 0 8 1.8Z"/><circle cx="6" cy="7.2" r="1" fill="var(--fx-bg)"/><circle cx="10" cy="7.2" r="1" fill="var(--fx-bg)"/></svg>',
  shield: '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 1.8 13 3.8v3.7c0 3.1-2.1 5.6-5 6.7-2.9-1.1-5-3.6-5-6.7V3.8L8 1.8Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M8 5v3.4M8 10.6v.1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
};

export function phantomGuide(ui = {}, ua) {
  const br = browserName(ua);
  const opera = isOpera(ua);
  const step = (n, title, body, mock = '', extra = '') => `
      <li class="jg-step">
        <span class="jg-n num" aria-hidden="true">${n}</span>
        <div class="jg-c"><b>${title}</b><p>${body}</p>${mock}${extra}</div>
      </li>`;
  const install = opera
    ? tr('Abre la tienda de Chrome desde aquí. Si {b} te pregunta si permites extensiones de la Chrome Web Store, pulsa «Permitir». Luego «Añadir a Opera» y confirma. Comprueba antes que el autor sea Phantom, con la marca de verificado.').replace('{b}', br)
    : tr('Abre la tienda desde aquí, pulsa «Añadir a Chrome» y confirma. Comprueba antes que el autor sea Phantom, con la marca de verificado.');
  const pin = opera
    ? tr('En la barra de {b}, pulsa el icono del cubo (Extensiones) y luego la chincheta junto a Phantom. Así tendrás el fantasma siempre a mano.').replace('{b}', br)
    : tr('Pulsa el icono de la pieza de puzle (Extensiones) y luego la chincheta junto a Phantom. Así tendrás el fantasma siempre a mano.');
  const steps = `
    <ol class="jg-steps">
      ${step(1, tr('Instala Phantom'), install,
        `<div class="jg-mock m-store" aria-hidden="true"><span class="lg">${ic.ghost}</span><span class="nm">Phantom<small>phantom.com ✓</small></span><span class="b">${opera ? tr('Añadir a Opera') : tr('Añadir a Chrome')}</span></div>`,
        `<a class="btn sm brand jg-open" href="${PHANTOM_STORE}" target="_blank" rel="noopener">${tr('Abrir la tienda')}${ic.ext}</a>`)}
      ${step(2, tr('Fíjala en la barra'), pin,
        `<div class="jg-mock m-bar" aria-hidden="true"><span class="u"></span><span class="x">${ic.cube}</span><span class="p">${ic.ghost}<span>Phantom</span>${ic.pin}</span></div>`)}
      ${step(3, tr('Crea tu wallet y apunta la frase'), tr('Abre Phantom, elige «Crear una wallet nueva» y pon una contraseña. Escribe en papel las 12 palabras de recuperación y guárdalas sin conexión. Mejor una wallet solo para trading, aparte de tus ahorros.'),
        `<div class="jg-mock m-seed" aria-hidden="true">${['1','2','3','4','5','6'].map((n) => `<span><i>${n}</i>••••</span>`).join('')}</div>`)}
      ${step(4, tr('Abre Padre (mejor desde un marcador)'), tr('Entra en trade.padre.gg y guárdala en marcadores para volver siempre por ahí. Hay copias falsas con nombres parecidos: mira la dirección antes de conectar nada.'),
        `<div class="jg-mock m-url" aria-hidden="true"><i></i><i></i><i></i><span>trade.padre.gg</span></div>`,
        `<a class="btn sm plain jg-open" href="${PADRE_URL}" target="_blank" rel="noopener">${tr('Abrir Padre')}${ic.ext}</a>`)}
      ${step(5, tr('Entra con Phantom'), tr('En Padre pulsa «Log in» (arriba a la derecha) y elige Phantom. En la ventana de Phantom pulsa «Conectar» y después firma el mensaje. Firmar para entrar es gratis y no mueve dinero.'),
        `<div class="jg-mock m-sign" aria-hidden="true"><span class="lg">${ic.ghost}</span><span class="t">trade.padre.gg</span><span class="no">${tr('Cancelar')}</span><span class="b">${tr('Conectar')}</span></div>`)}
      ${step(6, tr('Deposita SOL para operar'), tr('Padre te da su propia wallet de trading. Pulsa «Deposit», copia la dirección y envía SOL desde Phantom, siempre por la red Solana. Sin SOL no puedes pagar las comisiones de ninguna operación.'),
        `<div class="jg-mock m-dep" aria-hidden="true"><span class="q"></span><span class="a">JAB6…PlVNj<small>Solana</small></span><span class="b">Copy address</span></div>`)}
    </ol>`;
  const safe = `
    <div class="pg-safe" role="note">
      ${ic.shield}
      <ul>
        <li>${tr('<b>Nunca compartas las 12 palabras</b> ni las escribas en ninguna web. Ni Phantom, ni Padre, ni Blankfire te las pedirán jamás.')}</li>
        <li>${tr('Si al entrar Phantom te pide aprobar una transacción o «permitir todo», recházalo: para iniciar sesión solo hace falta firmar.')}</li>
        <li>${tr('Desconfía de quien te ofrezca «migrar» tu cuenta tras el cambio de nombre a Terminal: es una estafa.')}</li>
      </ul>
    </div>`;
  return `
    <h2 id="walletSec">${tr('Conectar tu wallet a Padre')}</h2>
    <section class="jg pg" aria-labelledby="walletSec">
      <p class="hint">${tr('Para operar con dinero de verdad en Padre necesitas una wallet. Esta guía es para Phantom en {b}. Blankfire no la necesita: aquí practicas con SOL ficticio y nunca toca tu wallet.').replace('{b}', br)}</p>
      <details class="jg-more" data-ref="phantomGuide" ${ui?.walletOpen ? 'open' : ''}><summary>${tr('Ver la guía · 6 pasos')}</summary>${steps}${safe}</details>
    </section>`;
}
