// Blankfire — sección «Chequeo de monedas» de Ajustes.
import { tr } from '../lib/i18n.js';
import { screenLimits, checkWhy, checkName, fmtScreenPct as p } from '../lib/screen.js';

const RIGORS = [
  ['strict', 'Prudente', 'Pide más para dar el «bien»'],
  ['normal', 'Normal', 'Lo que recomiendo para empezar'],
  ['loose', 'Arriesgado', 'Tolera más concentración'],
];

export function screenSettings(s) {
  const rigor = s.screenRigor || 'normal';
  const L = screenLimits(rigor);
  const row = (name, ok, bad) => `<tr><th>${name}</th><td class="ok num">${ok}</td><td class="bad num">${bad}</td></tr>`;
  const why = (id, extra = {}) => `<div class="gl-row"><dt>${checkName(id)}</dt><dd>${checkWhy({ id, ...extra })}</dd></div>`;
  return `
    <h2 id="screenSec">${tr('Chequeo de monedas')}</h2>
    <div class="scr">
      <p class="hint">${tr('Antes de comprar, el panel revisa lo que Padre ya enseña de cada moneda (top 10, dev, snipers, insiders, bundles y liquidez) y te dice si pinta bien, si hay que ir con cuidado o si es mejor evitarla.')}</p>
      <ul class="scr-legend" aria-label="${tr('Qué significa cada marca')}">
        <li class="v-good"><i></i><b>${tr('Bien')}</b><span>${tr('ninguna señal en rojo')}</span></li>
        <li class="v-care"><i></i><b>${tr('Ojo')}</b><span>${tr('dos o más señales flojas')}</span></li>
        <li class="v-avoid"><i></i><b>${tr('Evitar')}</b><span>${tr('al menos una en rojo')}</span></li>
      </ul>
      <div class="switch"><span>${tr('Marcar las monedas en Trenches')}<small class="muted" style="display:block;font-size:11.5px">${tr('Una etiqueta junto a cada tarjeta; pasa el ratón para ver por qué')}</small></span><button role="switch" aria-checked="${s.screenBadges !== false}" data-act="screenBadges" aria-label="${tr('Marcar las monedas en Trenches')}"></button></div>
      <div class="scr-rigor">
        <span class="scr-lbl" id="rigorLbl">${tr('Rigor')}</span>
        <div class="seg3" role="radiogroup" aria-labelledby="rigorLbl">
          ${RIGORS.map(([id, name, help]) => `<button role="radio" aria-checked="${rigor === id}" data-act="screenRigor" data-v="${id}" title="${tr(help)}">${tr(name)}</button>`).join('')}
        </div>
      </div>
      <table class="ptable scr-table">
        <thead><tr><td></td><th class="ok">${tr('Bien hasta')}</th><th class="bad">${tr('Peligro desde')}</th></tr></thead>
        <tbody>
          ${row(tr('Top 10 holders'), p(L.top10.ok), `+${p(L.top10.warn)}`)}
          ${row(tr('Dev'), p(L.dev.ok), `+${p(L.dev.warn)}`)}
          ${row(tr('Snipers dentro'), p(L.snipers.ok), `+${p(L.snipers.warn)}`)}
          ${row(tr('Insiders'), p(L.insiders.ok), `+${p(L.insiders.warn)}`)}
          ${row(tr('Bundles · MC < $15K'), p(L.bundlesSmall.ok), `+${p(L.bundlesSmall.warn)}`)}
          ${row(tr('Bundles · MC $15-60K'), p(L.bundlesMid.ok), `+${p(L.bundlesMid.warn)}`)}
          ${row(tr('Bundles · MC > $60K'), p(L.bundlesBig.ok), `+${p(L.bundlesBig.warn)}`)}
          ${row(tr('Liquidez / MC'), `${tr('desde')} ${p(L.liq.ok)}`, `${tr('bajo')} ${p(L.liq.warn)}`)}
        </tbody>
      </table>
      <details class="scr-gloss">
        <summary>${tr('Qué significa cada cosa')}</summary>
        <dl>
          ${why('top10', { lim: L.top10 })}
          ${why('dev', { lim: L.dev })}
          ${why('snipers', { lim: L.snipers })}
          ${why('insiders', { lim: L.insiders })}
          ${why('bundles', { generic: true })}
          ${why('liq', { okR: L.liq.ok, warnR: L.liq.warn })}
          ${why('auth')}
        </dl>
      </details>
      <p class="scr-note">${tr('Son reglas para practicar a filtrar, no una garantía. Cuando la IA esté activa, también las usará para revisar tus entradas.')}</p>
    </div>`;
}
