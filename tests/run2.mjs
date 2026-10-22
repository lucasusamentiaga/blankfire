import { chromium } from 'playwright';
const TDIR = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
import fs from 'fs';

const EXT = new URL('../Fogueo', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const OUT = TDIR+'shots2';
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const TOKEN = 'Hb1DD3TgUkiU1dJsEcckuyEprLW3CuyHYsYrAUmxpump';
const TOKEN2 = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';
const SOL = 'So11111111111111111111111111111111111111112';

const px = { [TOKEN]: 0.0000412, [TOKEN2]: 0.00031 };
let drift = 0;
const meta = { [TOKEN]: ['GORILLA', 'Gorilla Mode'], [TOKEN2]: ['NEKO', 'Neko Inu'] };
const pair = (addr) => ({
  chainId: 'solana', dexId: 'pumpswap', pairAddress: 'P' + addr.slice(1),
  baseToken: { address: addr, symbol: meta[addr][0], name: meta[addr][1] },
  quoteToken: { address: SOL, symbol: 'SOL' },
  priceUsd: String(px[addr]), liquidity: { usd: 52000 }, marketCap: px[addr] * 1e9,
  priceChange: { m5: 4.2, h1: -12.8 }, info: {},
});
const solPair = { chainId: 'solana', pairAddress: 'x', baseToken: { address: SOL, symbol: 'SOL' }, quoteToken: { symbol: 'USDC' }, priceUsd: '182.40', liquidity: { usd: 9e6 } };

const ctx = await chromium.launchPersistentContext(TDIR+'profile2-' + Date.now(), {
  headless: true, channel: 'chromium', viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`,'--lang=es-ES'],
});
await ctx.route('https://api.dexscreener.com/**', (route) => {
  const u = route.request().url();
  if (u.includes(SOL) && !u.includes(TOKEN)) return route.fulfill({ json: [solPair] });
  px[TOKEN] *= 1 + drift + (Math.random() - 0.5) * 0.004;
  const addrs = [TOKEN, TOKEN2].filter((a) => u.includes(a));
  if (u.includes('/search')) return route.fulfill({ json: { pairs: addrs.map(pair) } });
  return route.fulfill({ json: addrs.map(pair) });
});
const fake = fs.readFileSync(TDIR+'fake-padre.html', 'utf8');
await ctx.route('https://lite-api.jup.ag/**', (r) => r.fulfill({json: r.request().url().includes('/price/v3') ? {} : []}));
await ctx.route('https://trade.padre.gg/**', (route) => route.fulfill({ body: fake, contentType: 'text/html' }));

let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent('serviceworker');
const extId = sw.url().split('/')[2];

const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('[page]', m.text()); });
await page.goto('https://trade.padre.gg/trade/solana/' + TOKEN);
await page.waitForTimeout(2500);
const P = page.locator('#fogueo-root');
const shot = (n) => P.screenshot({ path: `${OUT}/${n}.png` });
const wait = (ms) => page.waitForTimeout(ms);

await shot('01-onboarding');
await P.locator('[data-act="onboarded"]').click();
await wait(500);

// Stop + Take + stop dinámico, comprar con la tecla 3
await P.locator('.opt.sl label').click();
await P.locator('.opt.tp label').click();
await P.locator('[data-act="trail"]').click();
await P.hover({ position: { x: 150, y: 20 } });
await wait(300);
await shot('02-hover-keys');
await page.keyboard.press('3');
await wait(1500);
drift = 0.02;
await wait(9000);
drift = -0.004;
await wait(5000);
await shot('03-trailing-peak');

// Recuperar inversión con I
await P.hover({ position: { x: 150, y: 20 } });
await page.keyboard.press('v');
await wait(400);
await shot('04-sell-form');
await page.keyboard.press('i');
await wait(1500);
await shot('05-after-initials');

// Cerrar todo con R -> revisión
drift = 0;
await page.keyboard.press('r');
await wait(1500);
await shot('06-review');
await P.locator('[data-act="plan"][data-v="yes"]').click();
await P.locator('[data-act="tag"][data-id="narrativa"]').click();
await P.locator('[data-act="tag"][data-id="volumen"]').click();
await wait(200);
await shot('07-review-filled');
await P.locator('[data-act="reviewSave"]').click();
await wait(800);

// Modo % del saldo
await P.locator('[data-act="unit"]').click();
await wait(300);
await shot('08-pct-mode');
await P.locator('[data-act="unit"]').click();

// Orden límite
await P.locator('[data-act="otype"][data-o="limit"]').click();
await P.locator('[data-ref="limitMc"]').fill('38k');
await P.locator('[data-act="quick"]').nth(1).click();
await wait(400);
await shot('09-limit-form');
await P.locator('[data-act="buy"]').click();
await wait(1000);
await shot('10-limit-placed');
drift = -0.05;
await wait(9000);
drift = 0;
await wait(1500);
await shot('11-limit-filled');

// SL clásico sin trailing -> pérdida -> revisión "No" + FOMO
await P.locator('[data-act="side"][data-side="buy"]').click().catch(() => {});
drift = -0.15;
await wait(9000);
drift = 0;
await wait(1500);
await shot('12-after-sl');
const rv = P.locator('[data-act="plan"][data-v="no"]');
if (await rv.count()) {
  await rv.click();
  await P.locator('[data-act="tag"][data-id="fomo"]').click();
  await P.locator('[data-act="reviewSave"]').click();
}

// Límite diario
await sw.evaluate(async () => {
  const { fogueo } = await chrome.storage.local.get('fogueo');
  fogueo.settings.dailyLossLimit = 0.05;
  await chrome.storage.local.set({ fogueo });
});
await wait(800);
await P.locator('[data-act="quick"]').nth(0).click();
await wait(300);
await shot('13-daily-locked');

// Vistas: posiciones y atajos
await P.locator('[data-act="view"][data-v="keys"]').click();
await wait(300);
await shot('14-keys');
await P.locator('[data-act="view"][data-v="positions"]').first().click();
await wait(1500);
await shot('15-positions');

// Otra pestaña sin token
const p2 = await ctx.newPage();
await p2.goto('https://trade.padre.gg/');
await p2.waitForTimeout(3500);
await p2.locator('#fogueo-root').screenshot({ path: `${OUT}/16-no-token.png` });

// Popup
const pop = await ctx.newPage();
pop.on('pageerror', (e) => console.log('[popuperror]', e.message));
await pop.setViewportSize({ width: 392, height: 600 });
await pop.goto(`chrome-extension://${extId}/popup/popup.html`);
await pop.waitForTimeout(1500);
await pop.keyboard.press('Escape');
await pop.waitForTimeout(500);
await pop.screenshot({ path: `${OUT}/20-wallet.png` });
await pop.click('[data-tab="history"]');
await pop.locator('[data-row]').first().click();
await pop.waitForTimeout(400);
await pop.screenshot({ path: `${OUT}/21-history.png`, fullPage: false });
await pop.evaluate(() => document.querySelector('.views').scrollTo(0, 200));
await pop.waitForTimeout(200);
await pop.screenshot({ path: `${OUT}/22-history-review.png` });
await pop.click('[data-tab="stats"]');
await pop.waitForTimeout(400);
await pop.evaluate(() => document.querySelector('.views').scrollTo(0, 9999));
await pop.waitForTimeout(200);
await pop.screenshot({ path: `${OUT}/23-stats-plan.png` });
await pop.click('[data-tab="settings"]');
await pop.waitForTimeout(400);
await pop.evaluate(() => document.querySelector('.views').scrollTo(0, 380));
await pop.waitForTimeout(200);
await pop.screenshot({ path: `${OUT}/24-settings.png` });

const { fogueo } = await sw.evaluate(() => chrome.storage.local.get('fogueo'));
const a = fogueo.account;
console.log('balance', a.balance.toFixed(4), 'pos', Object.keys(a.positions).length, 'orders', a.orders.length);
console.log('rounds', a.rounds.map((r) => [r.reason, r.pnlSol.toFixed(4), r.followedPlan, (r.tags || []).join('+')]));
console.log('fills', a.fills.map((f) => `${f.side}${f.via ? '/' + f.via : ''}${f.reason ? '/' + f.reason : ''}${f.failed ? '/FAIL' : ''}`).join(' '));
await ctx.close();
