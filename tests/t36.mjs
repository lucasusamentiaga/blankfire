// Guía «Conectar Phantom a Padre»: navegador detectado, pasos, enlaces oficiales y avisos de seguridad.
import { phantomGuide, browserName, extensionsUrl, PHANTOM_STORE, PADRE_URL } from '../Fogueo/popup/wallet-ui.js';
import { setLang } from '../Fogueo/lib/i18n.js';
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log((c ? 'OK  ' : 'FAIL') + ' ' + m); };
const GX = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 OPR/125.0.0.0';
const CH = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
ok(browserName(GX, [{ brand: 'Opera GX' }]) === 'Opera GX' && browserName(GX, []) === 'Opera' && browserName(CH, []) === 'Chrome', 'detecta Opera GX, Opera y Chrome');
ok(extensionsUrl(GX) === 'opera://extensions' && extensionsUrl(CH) === 'chrome://extensions', 'página de extensiones según el navegador');
ok(PHANTOM_STORE.startsWith('https://chromewebstore.google.com/detail/phantom/bfnaelmomeimhlpmgjnjophhpkkoljpa') && PADRE_URL === 'https://trade.padre.gg', 'enlaces oficiales de Phantom y Padre');
const strip = (h) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
for (const lang of ['es', 'en']) {
  setLang(lang);
  const op = phantomGuide({}, GX), ch = phantomGuide({}, CH);
  const steps = (op.match(/class="jg-step"/g) || []).length;
  ok(steps === 6, `${lang}: seis pasos`);
  ok(lang === 'es' ? /Añadir a Opera/.test(op) && /cubo/.test(op) && /Añadir a Chrome/.test(ch) && /puzle/.test(ch) : /Add to Opera/.test(op) && /cube/.test(op) && /Add to Chrome/.test(ch) && /puzzle/.test(ch), `${lang}: textos de instalación y barra adaptados al navegador`);
  ok(lang === 'es' ? /Nunca compartas las 12 palabras/.test(op) && /marcadores/.test(op) && /migrar/.test(op) : /Never share the 12 words/.test(op) && /bookmark/.test(op) && /migrate/.test(op), `${lang}: avisos de frase semilla, marcador y estafa de «migrar»`);
  ok(!/[áéíóñ¿¡]/i.test(strip(op).replace(/Phantom|trade\.padre\.gg/g, '')) || lang === 'es', `${lang}: sin restos en español`);
  ok(/rel="noopener"/.test(op) && !/<input/.test(op), `${lang}: enlaces seguros y ningún campo para escribir datos de la wallet`);
  ok(/open/.test(phantomGuide({ walletOpen: true }, GX).match(/<details[^>]*>/)[0]) && !/ open/.test(op.match(/<details[^>]*>/)[0]), `${lang}: se abre solo cuando se pide`);
}
console.log(fails ? `\n${fails} fallos` : '\nTodo bien'); process.exit(fails ? 1 : 0);
