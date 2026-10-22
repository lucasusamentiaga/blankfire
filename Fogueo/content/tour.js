// Blankfire — recorrido guiado por el panel.
import { tr } from '../lib/i18n.js';
import { simulateBuy, simulateSell, fmtSol, fmtPct, fmtCompact, fmtNum, tone } from '../lib/core.js';
// Ilumina cada parte real del panel y la enseña funcionando con datos de ejemplo.
// Tu cuenta no se toca: al terminar se restaura todo tal cual estaba.

const DEMO_KEY = 'solana:DEMO';

function demoState(real) {
  const now = Date.now();
  return {
    ...real,
    settings: { ...real.settings, useSl: true, useTp: true, useTrail: true, sizeMode: 'sol', dailyLossLimit: 0.5, pnlUnit: 'sol' },
    ui: { ...(real.ui || {}), onboarded: true },
    account: {
      ...real.account,
      balance: 9.42,
      positions: {
        [DEMO_KEY]: {
          id: 'demo-pos', key: DEMO_KEY, chain: 'solana', address: 'DEMO', symbol: 'DEMO', name: tr('Token de ejemplo'), icon: null,
          url: null, qty: 2.18e6, costSol: 0.501, investedSol: 0.501, returnedSol: 0, feesSol: 0.006,
          avgEntryUsd: 0.0000412, entryMcUsd: 41200, openedAt: now - 9 * 60000,
          tp: { pct: 100 }, sl: { pct: 30, trailing: true }, peakPct: 32, fills: [],
        },
        'solana:NEKO': {
          id: 'demo-pos2', key: 'solana:NEKO', chain: 'solana', address: 'NEKO', symbol: 'NEKO', name: 'Neko', icon: null,
          url: null, qty: 9.1e5, costSol: 0.25, investedSol: 0.25, returnedSol: 0, feesSol: 0.0035,
          avgEntryUsd: 0.000052, entryMcUsd: 52000, openedAt: now - 30 * 60000, tp: null, sl: { pct: 25 }, fills: [],
        },
      },
      orders: [{ id: 'demo-order', key: DEMO_KEY, chain: 'solana', symbol: 'DEMO', mc: 38000, solIn: 0.25, createdAt: now - 60000 }],
      fills: [...(real.account.fills || []), { id: 'demo-f', t: now - 3600000, side: 'sell', pnlSol: -0.12, key: 'x', symbol: 'X' }],
    },
  };
}

const DEMO_QUOTE = () => ({
  chain: 'solana', address: 'DEMO', pairAddress: 'DEMO', symbol: 'DEMO', name: tr('Token de ejemplo'), icon: null,
  priceUsd: 0.0000523, liquidityUsd: 48000, marketCapUsd: 52300, change: { m5: 6.4, h1: -3.1 }, at: Date.now(),
  stage: 'new', pairCreatedAt: Date.now() - 6 * 60000, graduatedAt: null,
});

// Capítulos del recorrido (el nombre sale encima del título de cada paso).
const CHAPTERS = ['Tu panel', 'Antes de comprar', 'Con la posición abierta', 'Vender y aprender', 'Más herramientas', 'Tu primer trade'];

// Cada paso: qué iluminar, qué contar y cómo preparar el panel.
// core: forma parte de «Lo esencial». try: el paso te pide hacerlo tú (solo acciones de demo, nunca compras reales).
const STEPS = [
  {
    ch: 0, core: true, choose: true,
    title: 'Bienvenido a Blankfire',
    body: 'Aquí practicas trades de memecoins en Padre con <b>SOL ficticio</b>: mismos precios, comisiones y slippage que en real, sin arriesgar nada. Te lo enseño con un token de ejemplo; tu cuenta no se toca.',
    hint: 'Algunos pasos te piden que lo pruebes tú. ← → para moverte, Esc para salir.',
  },
  {
    ch: 0, target: '.head-bal', title: 'Tu saldo de práctica',
    body: 'Es el SOL ficticio que tienes libre. Empiezas con 10 SOL y puedes cambiarlo o empezar de cero desde Ajustes. La etiqueta <b>práctica</b> te recuerda que nada de esto es real.',
  },
  {
    ch: 0, target: '.head', title: 'Muévelo a tu gusto',
    body: 'Arrastra la barra para colocarlo donde no estorbe. <b>Doble clic</b> lo minimiza y te deja solo el saldo y el resultado. <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>F</kbd> lo oculta del todo.',
  },
  {
    ch: 0, core: true, target: '[data-ref="tokenArea"]', title: 'El token que estás viendo',
    body: 'Blankfire lee el token de la página de Padre en la que estés: precio en vivo, cómo ha ido en 5 min y 1 h, market cap, liquidez y precio del SOL.',
  },
  {
    ch: 0, target: '.fresh', title: '¿El precio está fresco?',
    body: 'Punto verde: precio de los últimos segundos. Si se vuelve ámbar y dice «hace X s», la fuente no responde: <b>no operes con un precio congelado</b>. Al lado ves de dónde sale (DexScreener o Jupiter).',
  },
  {
    ch: 1, core: true, target: '.reco', title: 'Ajustes recomendados',
    setup: (p) => { p.st.ui = { ...p.st.ui, recoOpen: true }; },
    body: 'Blankfire detecta si el token es un <b>nuevo par</b> (aún en la curva de pump.fun, ámbar) o está <b>graduado</b> (ya en su pool, azul) y te propone tamaño, Stop, Take, slippage y prioridad, con el porqué. <b>Aplicar</b> los pone de golpe.',
  },
  {
    ch: 1, target: '.otype', title: 'Comprar ahora o esperar un precio',
    setup: (p) => { p.orderType = 'limit'; p.refs.limitMc.value = '38K'; },
    body: '<b>Ahora</b> compra al instante. <b>Si baja a…</b> crea una orden límite: compras solo cuando el market cap caiga hasta la cifra que pongas. Funciona aunque cierres Padre, mientras el navegador esté abierto.',
  },
  {
    ch: 1, target: '.amount', title: 'Cuánto meter',
    body: 'Escribe la cantidad en SOL o toca <b>SOL</b> para cambiar a <b>% de tu saldo</b>: así mides el riesgo en proporción, como los traders serios (p. ej. nunca más del 10 % por trade).',
  },
  {
    ch: 1, core: true, target: '[data-ref="quickBuys"]', title: 'Compras rápidas',
    setup: (p) => { p.refs.amount.value = ''; },
    body: 'Un toque rellena la cantidad. Con el ratón encima del panel, las teclas <kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> <kbd>4</kbd> <b>compran directamente</b>. Las cantidades se cambian en Ajustes.',
    try: { text: 'Pruébalo: toca una de las cantidades.', acts: ['quick'], done: 'Eso es: la cantidad ya está puesta.' },
  },
  {
    ch: 1, core: true, target: '.opts', title: 'Stop y Take antes de entrar',
    body: '<b>Stop</b> vende todo si pierdes ese %; <b>Take</b> vende todo si ganas ese %. Decidirlos antes de comprar es la regla nº 1: te quita la emoción del momento. Incluyen comisiones.',
  },
  {
    ch: 1, core: true, target: '[data-ref="trailBtn"]', title: 'Stop dinámico',
    body: 'Con él encendido, el stop <b>sube detrás del máximo</b> que alcances. Si el token sube un 40 % y luego se desploma, vendes con beneficio en vez de devolverlo todo.',
    try: { text: 'Pruébalo: toca el interruptor para apagarlo y otra vez para encenderlo.', acts: ['trail'], count: 2, done: 'Perfecto. En tus trades reales se queda como lo dejes.' },
  },
  {
    ch: 1, target: '[data-act="note"][data-for="buyNote"]', title: 'Apunta por qué entras',
    body: 'Una línea basta: «rompe 40K con volumen», «narrativa de IA»… Luego la verás en el historial junto al resultado y descubrirás qué razones te dan dinero.',
  },
  {
    ch: 1, core: true, target: '[data-ref="buyQuote"]', title: 'Lo que pasaría de verdad',
    body: 'Antes de pulsar ves cuántos tokens recibirías, el <b>slippage</b> (cuánto empeora el precio por el tamaño de tu orden) y los costes. Si el slippage supera tu máximo, la orden falla como en real.',
  },
  {
    ch: 2, core: true, live: true, target: '.pos', title: 'Tu posición, en vivo',
    body: 'Imagina que ya compraste 0,5 SOL de DEMO: mira cómo se mueve. Ves la ganancia o pérdida en SOL y en %, de qué market cap entraste, dónde está ahora y cuánto has invertido.',
    try: { text: 'Pruébalo: toca el resultado en verde para verlo en dólares.', acts: ['unitPnl'], done: 'Así lo ves en dólares. Tócalo otra vez para volver a SOL.' },
  },
  {
    ch: 2, core: true, live: true, target: '.range', title: 'Lo cerca que estás del Stop y del Take',
    body: 'El punto es tu resultado ahora; la rayita gris, tu entrada. A la izquierda el stop, a la derecha el take. La marca ámbar es el máximo que has tocado: el stop dinámico va detrás de ella.',
  },
  {
    ch: 2, live: true, target: '.targets', title: 'Cambia Stop y Take cuando quieras',
    body: 'Toca cualquiera de los dos para editarlo con la posición abierta. Escribe 0 para quitarlo.',
  },
  {
    ch: 2, target: '[data-ref="ordersArea"]', title: 'Órdenes pendientes',
    body: 'Tus órdenes límite aparecen aquí con lo lejos que está el precio. Puedes cancelarlas en cualquier momento.',
  },
  {
    ch: 3, core: true, target: '[data-ref="sellForm"]', title: 'Vender',
    setup: (p) => { p.side = 'sell'; p.sellPct = 50; },
    body: 'Vende el 25, 50, 75 o 100 % (teclas <kbd>Q</kbd> <kbd>W</kbd> <kbd>E</kbd> <kbd>R</kbd>). <b>Recuperar lo invertido</b> (<kbd>I</kbd>) vende justo lo necesario para sacar lo que metiste: el resto sigue corriendo gratis.',
    try: { text: 'Pruébalo: elige cuánto vender. (No se vende nada de verdad.)', acts: ['sellpct'], done: 'Bien. Fíjate cómo cambia lo que recibirías.' },
  },
  {
    ch: 3, core: true, target: '.review', title: 'Revisa cada trade al cerrarlo',
    setup: (p) => { p.review = { id: 'demo-r', symbol: 'DEMO', pnlSol: 0.084, pnlPct: 16.8 }; p.reviewDraft = { tags: ['narrativa'], followedPlan: null }; },
    body: 'Al cerrar una posición, responde <b>¿seguiste tu plan?</b> y marca qué pasó (FOMO, con prisa, venganza…). En Estadísticas verás cuánto ganas siguiendo tu plan y cuánto te cuesta saltártelo.',
    try: { text: 'Pruébalo: responde Sí o No y marca alguna etiqueta.', acts: ['plan', 'tag'], count: 2, done: 'Así de rápido. Con el tiempo, esto es lo que más te enseña.' },
  },
  {
    ch: 3, target: '.daily', title: 'Límite de pérdida diaria',
    body: 'Si lo activas en Ajustes, aquí ves cuánto llevas perdido hoy frente a tu límite. Al llegar, el panel <b>bloquea las compras hasta mañana</b>: evita la espiral de «recuperar lo perdido».',
  },
  {
    ch: 4, target: '[data-ref="posBtn"]', title: 'Todas tus posiciones',
    setup: (p) => { p.view = 'positions'; },
    spotlightAlso: '[data-ref="viewList"]',
    body: 'Todo lo que tienes abierto con su resultado en vivo y su barra de Stop/Take. Toca una para saltar a ese token en Padre. Tecla <kbd>P</kbd>.',
  },
  {
    ch: 4, target: '[data-v="keys"]', title: 'Atajos de teclado',
    body: 'Aquí tienes la chuleta de atajos. Solo funcionan con el ratón encima del panel, para no pisar los de Padre. Con el puntero encima, cada botón te enseña su tecla.',
  },
  {
    ch: 4, target: '.foot-btn.lang', title: 'English / Español',
    body: 'Este botón cambia todo Blankfire entre español e inglés: el panel, la ventana de la extensión, los recorridos y los avisos.',
  },
  {
    ch: 4, title: 'Y en el icono de Blankfire…',
    body: 'Haz clic en el icono de Blankfire de la barra del navegador para ver tu <b>Cartera</b>, el <b>Historial</b> con notas y revisiones, las <b>Estadísticas</b> (acierto, profit factor, plan vs. impulso…) y los <b>Ajustes</b>. Allí también hay un recorrido.',
  },
  {
    ch: 4, core: true, target: '[data-act="tour"]', title: '¡Listo para practicar!',
    body: 'Tu rutina: abre un token, aplica los ajustes recomendados, fija Stop y Take, entra pequeño y revisa cada trade. Cuando encadenes semanas en positivo con las mismas reglas, estarás más cerca del dinero real.',
    hint: 'Puedes repetir el recorrido con este botón.',
    final: true,
  },
];


// ---------- Trade guiado (solo en «Verlo todo») ----------
// Una compra y una venta completas con el token de ejemplo y TUS comisiones, para ver qué se queda por el camino.
const G_SOL = 0.5;      // lo que compramos
const G_UP = 1.3;       // el precio sube un 30 % antes de vender
const G_DOWN = 0.7;     // escenario contrario: baja un 30 %
const sx = (n) => fmtSol(n, { digits: 4 });
const sxs = (n) => fmtSol(n, { sign: true, digits: 4 });

function gQuote(p, mult = 1) {
  const base = DEMO_QUOTE();
  return { ...base, priceUsd: base.priceUsd * mult, marketCapUsd: base.marketCapUsd * mult, change: { m5: mult > 1 ? 30 : 0, h1: mult > 1 ? 30 : 0 }, at: Date.now() };
}
function gEnsureBuy(t) {
  const p = t.p;
  if (t.trade?.buy) return;
  const buy = simulateBuy({ solIn: G_SOL, quote: gQuote(p), solUsd: p.solUsd, settings: p.st.settings });
  t.trade = { buy, sell: null };
}
function gEnsureSell(t) {
  const p = t.p;
  gEnsureBuy(t);
  if (t.trade.sell) return;
  t.trade.sell = simulateSell({ qty: t.trade.buy.qty, quote: gQuote(p, G_UP), solUsd: p.solUsd, settings: p.st.settings });
}
function gApplyBought(t) {
  const p = t.p, b = t.trade.buy;
  const q = gQuote(p);
  p.st.account.positions = { ...p.st.account.positions, [DEMO_KEY]: {
    id: 'guided-pos', key: DEMO_KEY, chain: 'solana', address: 'DEMO', symbol: 'DEMO', name: tr('Token de ejemplo'), icon: null, url: null,
    qty: b.qty, costSol: b.totalDebit, investedSol: b.totalDebit, returnedSol: 0, feesSol: b.fee + b.priorityFee,
    avgEntryUsd: b.fillPrice, entryMcUsd: q.marketCapUsd, openedAt: Date.now() - 60000,
    tp: { pct: 100 }, sl: { pct: 30, trailing: false }, peakPct: 0, fills: [],
  } };
  p.st.account.balance = t.base.balance - b.totalDebit;
}
function gApplySold(t) {
  const p = t.p;
  const { [DEMO_KEY]: _gone, ...rest } = p.st.account.positions;
  p.st.account.positions = rest;
  p.st.account.balance = t.base.balance - t.trade.buy.totalDebit + t.trade.sell.netSol;
}
function gReset(t) {
  const p = t.p;
  const { [DEMO_KEY]: _gone, ...rest } = p.st.account.positions;
  p.st.account.positions = rest;
  p.st.account.orders = [];
}
// Resultado «marcado a mercado» (lo que enseña el panel) a un precio dado.
function gMark(t, mult) {
  const b = t.trade.buy;
  const value = (b.qty * gQuote(t.p, mult).priceUsd) / t.p.solUsd;
  return { pnl: value - b.totalDebit, pct: ((value - b.totalDebit) / b.totalDebit) * 100 };
}

const GUIDED_STEPS = [
  {
    ch: 5, guided: true, target: '[data-ref="buyForm"]', title: 'Primero, la compra',
    setup: (p, t) => { t.trade = null; gReset(t); p.quote = gQuote(p); p.refs.amount.value = fmtNum(0.5, 3); p.refs.useSl.checked = true; p.refs.useTp.checked = true; },
    body: (p) => tr('Vamos a hacer un trade completo con el token de ejemplo y <b>tus comisiones reales</b>: {fee} de Padre en cada compra y venta, más {prio} SOL de priority fee por transacción. Empezamos comprando {sol} SOL.', { fee: fmtPct(p.st.settings.feePct, 1), prio: sx(p.st.settings.priorityFee), sol: fmtSol(G_SOL) }),
    try: { text: 'Pruébalo: pulsa «Comprar 0,5 SOL». Es de práctica: tu saldo no cambia.', acts: ['buy'], done: 'Comprado. Mira lo que te ha costado entrar.' },
  },
  {
    ch: 5, guided: true, target: '.pos', title: 'Lo que te ha costado entrar',
    setup: (p, t) => { gEnsureBuy(t); gReset(t); gApplyBought(t); p.quote = gQuote(p); },
    body: (p, t) => {
      const b = t.trade.buy, m = gMark(t, 1);
      return tr('Has pagado <b>{total} SOL</b>: {net} van al token, {fee} de comisión de Padre y {prio} de priority fee. Además, el slippage te dio un precio un {slip} peor. Por eso empiezas en <b class="{tone}">{pct}</b> sin que el precio se haya movido: tiene que subir eso solo para quedarte igual.', {
        total: sx(b.totalDebit), net: sx(b.solIn - b.fee), fee: sx(b.fee), prio: sx(b.priorityFee), slip: fmtPct(b.slipPct, 2), pct: fmtPct(m.pct, 1, { sign: true }), tone: tone(m.pnl),
      });
    },
  },
  {
    ch: 5, guided: true, target: '.pos', title: 'El token sube un 30 %',
    setup: (p, t) => { gEnsureBuy(t); gReset(t); gApplyBought(t); p.quote = gQuote(p); t.tweenTo(G_UP); },
    body: (p, t) => {
      const m = gMark(t, G_UP);
      return tr('Mira el panel: el precio sube un 30 % y tu posición marca <b class="{tone}">{pnl} SOL ({pct})</b>. Es menos del 30 % porque las comisiones de entrada ya están descontadas. Y al vender pagarás otra vez.', { pnl: sxs(m.pnl), pct: fmtPct(m.pct, 1, { sign: true }), tone: tone(m.pnl) });
    },
  },
  {
    ch: 5, guided: true, target: '[data-ref="sellForm"]', title: 'Ahora, la venta',
    setup: (p, t) => { gEnsureBuy(t); t.trade.sell = null; gReset(t); gApplyBought(t); p.quote = gQuote(p, G_UP); p.side = 'sell'; p.sellPct = 100; },
    body: (p) => tr('Toca vender. Padre vuelve a cobrar su {fee} sobre lo que recibes y pagas otra priority fee de {prio} SOL. El 100 % ya está elegido.', { fee: fmtPct(p.st.settings.feePct, 1), prio: sx(p.st.settings.priorityFee) }),
    try: { text: 'Pruébalo: pulsa «Vender 100 %».', acts: ['sell'], done: 'Vendido. Vamos a ver las cuentas.' },
  },
  {
    ch: 5, guided: true, target: '.head-bal', title: 'Las cuentas de tu trade',
    setup: (p, t) => { gEnsureSell(t); gReset(t); gApplySold(t); p.quote = gQuote(p, G_UP); },
    body: (p, t) => {
      const b = t.trade.buy, sl = t.trade.sell;
      const pnl = sl.netSol - b.totalDebit, pct = (pnl / b.totalDebit) * 100;
      const fees = b.fee + b.priorityFee + sl.fee + sl.priorityFee;
      // Mismo trade sin comisiones ni slippage: el precio sube un 30 % y ya.
      const ideal = (G_UP - 1) * 100;
      // Escenario contrario: el precio cae un 30 %.
      const down = simulateSell({ qty: b.qty, quote: gQuote(p, G_DOWN), solUsd: p.solUsd, settings: p.st.settings });
      const dPnl = down.netSol - b.totalDebit, dPct = (dPnl / b.totalDebit) * 100;
      const row = (label, val, sub, cls = '') => `<div class="rc-row ${cls}"><span>${label}${sub ? `<small>${sub}</small>` : ''}</span><b class="num">${val}</b></div>`;
      return `<div class="tour-receipt">
        ${row(tr('Pagaste al comprar'), `−${sx(b.totalDebit)}`, tr('{sol} al token + {fee} comisión + {prio} prioridad', { sol: sx(b.solIn - b.fee), fee: sx(b.fee), prio: sx(b.priorityFee) }))}
        ${row(tr('Recibiste al vender'), `+${sx(sl.netSol)}`, tr('{gross} − {fee} comisión − {prio} prioridad', { gross: sx(sl.grossSol), fee: sx(sl.fee), prio: sx(sl.priorityFee) }))}
        ${row(tr('Comisiones y prioridad'), `−${sx(fees)}`, tr('más slippage: {a} al entrar, {b} al salir', { a: fmtPct(b.slipPct, 2), b: fmtPct(sl.slipPct, 2) }), 'muted')}
        ${row(tr('Resultado'), `<span class="${tone(pnl)}">${sxs(pnl)} SOL · ${fmtPct(pct, 1, { sign: true })}</span>`, '', 'total')}
      </div>
      <p class="rc-note">${tr('Tu saldo de ejemplo pasó de {a} a {b} SOL.', { a: fmtSol(t.base.balance, { digits: 3 }), b: fmtSol(p.st.account.balance, { digits: 3 }) })} ${tr('El precio subió un {ideal} y tú ganaste un {pct}: esa diferencia es lo que cuestan comisiones y slippage. Si hubiera <b>bajado</b> un 30 %, habrías perdido <b class="down">{dpct}</b> ({dpnl} SOL): los costes también suman en contra.', {
        ideal: fmtPct(ideal, 0), pct: fmtPct(pct, 1), dpct: fmtPct(dPct, 1, { sign: true }), dpnl: sxs(dPnl),
      })}</p>`;
    },
  },
];

// El trade guiado va justo después de «Lo que pasaría de verdad».
STEPS.splice(STEPS.findIndex((st) => st.target === '[data-ref="buyQuote"]') + 1, 0, ...GUIDED_STEPS);

const ICON_TAP = '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M6 8.5V3.2a1.2 1.2 0 012.4 0V7l3.3.6c.8.2 1.3.9 1.2 1.7l-.5 3.4a1.8 1.8 0 01-1.8 1.5H7.4c-.6 0-1.1-.3-1.5-.7L3.4 10.6a1.1 1.1 0 011.6-1.5L6 10" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICON_OK = '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3.5 8.4l2.9 2.9 6.1-6.6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';

export class Tour {
  constructor(panel) {
    this.p = panel;
    this.i = 0;
    this.steps = STEPS;
    this.mode = null;
    this.saved = null;
    this.realSt = null;
    this.tryCount = 0;
    this.tryDone = false;
  }

  start() {
    const p = this.p;
    if (!p.st) return;
    this.resume = p.st.ui?.tourResume || null;
    this.saved = {
      st: p.st, quote: p.quote, key: p.key, status: p.status, solUsd: p.solUsd, view: p.view, side: p.side,
      orderType: p.orderType, review: p.review, reviewDraft: p.reviewDraft, sellPct: p.sellPct,
      amount: p.refs.amount.value, limitMc: p.refs.limitMc.value, collapsed: p.el.classList.contains('is-collapsed'),
      useTp: p.refs.useTp.checked, useSl: p.refs.useSl.checked, tpPct: p.refs.tpPct.value, slPct: p.refs.slPct.value,
      allQuotes: p.allQuotes,
    };
    this.realSt = p.st;
    p.st = demoState(p.st);
    this.base = { positions: { ...p.st.account.positions }, balance: p.st.account.balance, orders: [...(p.st.account.orders || [])] };
    p.quote = DEMO_QUOTE();
    p.key = DEMO_KEY;
    p.status = 'ready';
    p.solUsd = 182.4;
    p.allQuotes = { 'solana:NEKO': { priceUsd: 0.0000468, marketCapUsd: 46800, at: Date.now() } };
    p.view = 'trade';
    p.side = 'buy';
    p.refs.useTp.checked = true; p.refs.useSl.checked = true;
    p.refs.tpPct.value = '100'; p.refs.slPct.value = '30';
    p.el.classList.remove('is-collapsed');
    p.host.hidden = false;
    p.tour = this;
    p.el.classList.add('touring');

    this.layer = document.createElement('div');
    this.layer.className = 'tour';
    this.layer.innerHTML = `
      <div class="tour-block" aria-hidden="true"></div>
      <div class="tour-spot" aria-hidden="true"></div>
      <div class="tour-card" role="dialog" aria-modal="true" aria-labelledby="tour-title">
        <div class="tour-top"><span class="tour-count"></span><button class="tour-x" data-tour="end" aria-label="${tr('Salir del recorrido')}">${tr('Salir')}</button></div>
        <h3 id="tour-title"></h3>
        <p class="tour-body"></p>
        <div class="tour-try" role="status" hidden><span class="tt-ico"></span><span class="tt-text"></span></div>
        <p class="tour-hint"></p>
        <div class="tour-bar" aria-hidden="true"><i></i></div>
        <div class="tour-nav"></div>
      </div>`;
    p.root.appendChild(this.layer);
    this.block = this.layer.querySelector('.tour-block');
    this.spot = this.layer.querySelector('.tour-spot');
    this.card = this.layer.querySelector('.tour-card');
    this.layer.addEventListener('click', (e) => {
      const a = e.target.closest('[data-tour]')?.dataset.tour;
      if (a === 'next') this.go(this.i + 1);
      else if (a === 'prev') this.go(this.i - 1);
      else if (a === 'end') this.end();
      else if (a === 'core' || a === 'all') this.choose(a);
      else if (a === 'resume') this.choose(this.resume.mode, this.resume.i);
      e.stopPropagation();
    });
    this.onResize = () => this.place();
    window.addEventListener('resize', this.onResize);
    this.ro = new ResizeObserver(() => this.place());
    this.ro.observe(p.el);
    this.scroller = p.el.querySelector('.body-inner');
    this.onScroll = () => this.place();
    this.scroller?.addEventListener('scroll', this.onScroll, { passive: true });
    this.go(0);
  }

  // «Lo esencial» o «Todo»: a partir de aquí el recorrido usa esa lista.
  choose(mode, at = 1) {
    this.mode = mode;
    this.steps = mode === 'core' ? STEPS.filter((s) => s.core) : STEPS;
    this.go(Math.min(Math.max(1, at), this.steps.length - 1));
  }

  onKey(e) {
    const k = e.key;
    if (k === 'ArrowRight' || k === 'Enter') { if (this.steps[this.i].choose && !this.mode) this.choose('core'); else this.go(this.i + 1); }
    else if (k === 'ArrowLeft') this.go(this.i - 1);
    else if (k === 'Escape') this.end();
    else return false;
    return true;
  }

  // El panel pregunta si un clic está permitido: solo lo que pide el paso «Pruébalo», dentro de lo iluminado.
  allows(act, el) {
    const t = this.steps[this.i]?.try;
    if (!t || !t.acts.includes(act)) return false;
    const target = this.target();
    return !!target && (target === el || target.contains(el));
  }

  // Comprar y vender en el trade guiado: se simula aquí, con tus comisiones, sin tocar tu cuenta.
  intercept(act) {
    const step = this.steps[this.i];
    if (!step?.guided) return false;
    const p = this.p;
    if (act === 'buy') { gEnsureBuy(this); gReset(this); gApplyBought(this); p.quote = gQuote(p); p.renderAll(); return true; }
    if (act === 'sell') { gEnsureSell(this); gReset(this); gApplySold(this); p.side = 'buy'; p.renderAll(); return true; }
    return false;
  }

  // Sube (o baja) el precio de ejemplo poco a poco hasta «mult» veces el de partida.
  tweenTo(mult, ms = 2600) {
    this.stopTween();
    const p = this.p;
    const from = 1, t0 = performance.now();
    this.tween = setInterval(() => {
      const k = Math.min(1, (performance.now() - t0) / ms);
      const e = 1 - Math.pow(1 - k, 3);
      p.quote = gQuote(p, from + (mult - from) * e);
      p.renderToken?.();
      p.renderPosition();
      if (k >= 1) this.stopTween();
    }, 90);
  }

  stopTween() { clearInterval(this.tween); this.tween = null; }

  // El panel avisa de que has hecho la acción del paso.
  notify(act) {
    const step = this.steps[this.i];
    if (!step?.try || !step.try.acts.includes(act) || this.tryDone) return;
    this.tryCount += 1;
    if (this.tryCount < (step.try.count || 1)) return;
    this.tryDone = true;
    this.renderTry(step);
    const at = this.i;
    clearTimeout(this.autoNext);
    this.autoNext = setTimeout(() => { if (this.layer && this.i === at) this.go(at + 1); }, 1700);
    requestAnimationFrame(() => this.place());
  }

  renderTry(step) {
    const box = this.card.querySelector('.tour-try');
    box.hidden = !step.try;
    if (!step.try) return;
    box.classList.toggle('done', this.tryDone);
    box.querySelector('.tt-ico').innerHTML = this.tryDone ? ICON_OK : ICON_TAP;
    box.querySelector('.tt-text').textContent = tr(this.tryDone ? step.try.done : step.try.text);
    this.spot.classList.toggle('try', !this.tryDone);
  }

  go(i) {
    const steps = this.steps;
    if (i >= steps.length) return this.end(true);
    if (i < 0) return;
    if (i === 0) { this.mode = null; this.steps = STEPS; }
    this.i = i;
    clearTimeout(this.autoNext);
    this.tryCount = 0; this.tryDone = false;
    const step = this.steps[i];
    const p = this.p;
    // Estado base de cada paso, para que ir hacia atrás también funcione.
    p.view = 'trade'; p.side = 'buy'; p.orderType = 'market'; p.review = null; p.sellPct = 50; p.editing = null;
    p.st.ui = { ...p.st.ui, recoOpen: false };
    p.st.settings = { ...p.st.settings, useTrail: true, pnlUnit: 'sol' };
    p.refs.amount.value = fmtNum(0.5, 3); p.refs.limitMc.value = '';
    p.st.account = { ...p.st.account, positions: { ...this.base.positions }, balance: this.base.balance, orders: [...this.base.orders] };
    this.stopTween();
    if (!step.live) this.stopLive();
    if (!step.live) p.quote = DEMO_QUOTE();
    step.setup?.(p, this);
    p.renderAll();
    if (p.review) p.renderReview();
    if (step.live) this.startLive();

    const total = this.mode ? this.steps.length - 1 : null;
    const chapter = tr(CHAPTERS[step.ch]);
    this.card.querySelector('.tour-count').innerHTML = i === 0 || !total
      ? `<b>${tr('Recorrido guiado')}</b>`
      : `<b>${chapter}</b> · ${tr('{i} de {n}', { i, n: total })}`;
    this.card.querySelector('h3').textContent = tr(step.title);
    this.card.querySelector('.tour-body').innerHTML = typeof step.body === 'function' ? step.body(p, this) : tr(step.body);
    const hint = this.card.querySelector('.tour-hint');
    hint.textContent = step.hint ? tr(step.hint) : '';
    hint.hidden = !step.hint;
    this.renderTry(step);
    if (!step.try) this.spot.classList.remove('try');
    const bar = this.card.querySelector('.tour-bar');
    bar.hidden = !total;
    if (total) bar.querySelector('i').style.transform = `scaleX(${i / total})`;
    this.renderNav(step);
    this.card.classList.remove('swap'); void this.card.offsetWidth; this.card.classList.add('swap');
    requestAnimationFrame(() => {
      this.scrollToTarget(); this.place();
      this.card.querySelector('.tour-next')?.focus({ preventScroll: true });
    });
  }

  renderNav(step) {
    const nav = this.card.querySelector('.tour-nav');
    nav.classList.toggle('choose', !!step.choose);
    if (step.choose) {
      const nCore = STEPS.filter((s) => s.core).length - 1, nAll = STEPS.length - 1;
      const canResume = this.resume && this.resume.i > 1;
      nav.innerHTML = `
        <button class="tour-next" data-tour="core"><span>${tr('Lo esencial')}</span><small>${tr('{n} pasos', { n: nCore })}</small></button>
        <button class="tour-alt" data-tour="all"><span>${tr('Verlo todo')}</span><small>${tr('{n} pasos', { n: nAll })}</small></button>
        ${canResume ? `<button class="tour-resume" data-tour="resume">${tr('Seguir donde lo dejé (paso {i})', { i: this.resume.i })}</button>` : ''}`;
      return;
    }
    nav.innerHTML = `
      <button class="tour-prev" data-tour="prev">${tr('Atrás')}</button>
      <button class="tour-next" data-tour="next">${tr(step.final ? 'Empezar a practicar' : step.try ? 'Saltar' : 'Siguiente')}</button>`;
    nav.querySelector('.tour-next').classList.toggle('quiet', !!step.try);
  }

  // Mientras explicamos la posición, el precio de ejemplo se mueve como uno de verdad.
  startLive() {
    if (this.live) return;
    const p = this.p;
    const entry = 0.0000412;
    let k = 0;
    this.live = setInterval(() => {
      if (!this.layer || !p.quote) return;
      k += 1;
      const m = 1.27 + 0.13 * Math.sin(k * 0.55) + 0.05 * Math.sin(k * 1.7);
      const price = entry * m;
      p.quote = { ...p.quote, priceUsd: price, marketCapUsd: price * 1.27e9, at: Date.now() };
      const pos = p.st.account.positions[DEMO_KEY];
      if (pos) pos.peakPct = Math.max(pos.peakPct || 0, (m - 1) * 100);
      p.renderToken?.();
      if (!p.editing) p.renderPosition();
    }, 1100);
  }

  stopLive() { clearInterval(this.live); this.live = null; }

  target() {
    const s = this.steps[this.i];
    return s?.target ? this.p.root.querySelector(s.target) : null;
  }

  scrollToTarget() {
    const t = this.target();
    if (!t) return;
    const box = this.p.el.querySelector('.body-inner');
    const tr = t.getBoundingClientRect(), br = box.getBoundingClientRect();
    if (tr.top < br.top || tr.bottom > br.bottom) box.scrollTop += tr.top - br.top - 16;
  }

  place() {
    if (!this.layer) return;
    const p = this.p;
    const fx = p.el.getBoundingClientRect();
    const step = this.steps[this.i];
    let t = this.target();
    let r = t?.getBoundingClientRect();
    if (t && step.spotlightAlso) {
      const b = p.root.querySelector(step.spotlightAlso)?.getBoundingClientRect();
      if (b && b.height) r = b;
    }
    const pad = 6;
    if (r && r.width && r.height) {
      this.spot.classList.remove('none');
      Object.assign(this.spot.style, {
        width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px`,
        transform: `translate(${r.left - fx.left - pad}px, ${r.top - fx.top - pad}px)`,
      });
    } else {
      this.spot.classList.add('none');
      Object.assign(this.spot.style, { width: `${fx.width}px`, height: `${fx.height}px`, transform: 'translate(0,0)' });
    }

    // Bloqueo de clics con un hueco en lo iluminado cuando el paso te pide probarlo.
    const W = window.innerWidth, H = window.innerHeight;
    Object.assign(this.block.style, { left: `${-fx.left}px`, top: `${-fx.top}px`, width: `${W}px`, height: `${H}px` });
    if (step.try && !this.tryDone && r && r.height) {
      const x1 = Math.max(0, r.left - pad), y1 = Math.max(0, r.top - pad), x2 = Math.min(W, r.right + pad), y2 = Math.min(H, r.bottom + pad);
      this.block.style.clipPath = `polygon(evenodd, 0 0, ${W}px 0, ${W}px ${H}px, 0 ${H}px, 0 0, ${x1}px ${y1}px, ${x1}px ${y2}px, ${x2}px ${y2}px, ${x2}px ${y1}px, ${x1}px ${y1}px)`;
    } else this.block.style.clipPath = 'none';

    // La tarjeta va al lado del panel con más sitio; si no cabe, encima del panel.
    const cw = Math.min(300, window.innerWidth - 24);
    this.card.style.width = `${cw}px`;
    const ch = this.card.offsetHeight;
    const right = window.innerWidth - fx.right, left = fx.left;
    let x, side;
    if (right >= cw + 20) { x = fx.width + 14; side = 'right'; }
    else if (left >= cw + 20) { x = -cw - 14; side = 'left'; }
    else { x = Math.max(8 - fx.left, (fx.width - cw) / 2); side = 'over'; }
    const cy = r && r.height ? r.top + r.height / 2 : fx.top + 120;
    let y = Math.min(Math.max(8, cy - ch / 2), window.innerHeight - ch - 8) - fx.top;
    if (side === 'over') {
      const below = r ? r.bottom + 12 : fx.top + 60;
      y = (below + ch < window.innerHeight - 8 ? below : Math.max(8, (r?.top || 60) - ch - 12)) - fx.top;
    }
    this.card.dataset.side = side;
    this.card.style.transform = `translate(${x}px, ${y}px)`;
    const arrowY = Math.min(Math.max(18, cy - fx.top - y), ch - 18);
    this.card.style.setProperty('--ay', `${arrowY}px`);
    this.card.classList.toggle('no-arrow', !r || side === 'over');
  }

  end(finished) {
    const p = this.p;
    const s = this.saved;
    clearTimeout(this.autoNext);
    this.stopLive();
    this.stopTween();
    window.removeEventListener('resize', this.onResize);
    this.ro?.disconnect();
    this.scroller?.removeEventListener('scroll', this.onScroll);
    this.layer?.remove();
    this.layer = null;
    p.el.classList.remove('touring');
    p.tour = null;
    p.st = this.realSt;
    Object.assign(p, {
      quote: s.quote, key: s.key, status: s.status, solUsd: s.solUsd, view: s.view, side: s.side,
      orderType: s.orderType, review: s.review, reviewDraft: s.reviewDraft, sellPct: s.sellPct, allQuotes: s.allQuotes, editing: null,
    });
    p.refs.amount.value = s.amount; p.refs.limitMc.value = s.limitMc;
    p.refs.useTp.checked = s.useTp; p.refs.useSl.checked = s.useSl; p.refs.tpPct.value = s.tpPct; p.refs.slPct.value = s.slPct;
    p.el.classList.toggle('is-collapsed', s.collapsed);
    p.el.querySelector('.body-inner').scrollTop = 0;
    p.lastPrice = null;
    p.refs.tokenArea.innerHTML = '';
    p.refs.posArea.innerHTML = '';
    p.renderAll();
    p.clampPosition();
    // Si lo dejas a medias, la próxima vez te ofrece seguir por donde ibas.
    const resume = !finished && this.mode && this.i > 1 ? { mode: this.mode, i: this.i } : null;
    p.saveUiAfterTour(finished, resume);
    if (p.address) p.status === 'ready' ? p.tick(true) : p.resolve();
  }
}
