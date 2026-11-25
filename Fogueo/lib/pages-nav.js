// Navegación común de las ventanas grandes de Blankfire (Bot, Radar, Repetición).
import { tr } from './i18n.js';
const PAGES = [['bot', 'Bot', '../bot/bot.html'], ['radar', 'Radar', '../radar/radar.html'], ['replay', 'Repetición', '../replay/replay.html']];
export function pagesNav(current) {
  return `<nav class="pnav" aria-label="${tr('Ventanas de Blankfire')}">${PAGES.map(([id, label, href]) => `<a href="${href}" ${id === current ? 'aria-current="page"' : ''}>${tr(label)}</a>`).join('')}</nav>`;
}
