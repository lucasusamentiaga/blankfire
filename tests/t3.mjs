import { chromium } from 'playwright';
const TDIR = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const EXT=new URL('../Fogueo', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), TOKEN='Hb1DD3TgUkiU1dJsEcckuyEprLW3CuyHYsYrAUmxpump', SOL='So11111111111111111111111111111111111111112';
let price=0.00004;
const ctx = await chromium.launchPersistentContext(TDIR+'p3-'+Date.now(), { headless:true, channel:'chromium', locale:'es-ES', viewport:{width:1300,height:950}, deviceScaleFactor:2, args:[`--disable-extensions-except=${EXT}`,`--load-extension=${EXT}`,'--lang=es-ES'] });
await ctx.route('https://api.dexscreener.com/**', (route) => {
  const u=route.request().url();
  if (u.includes(SOL)&&!u.includes(TOKEN)) return route.fulfill({json:[{chainId:'solana',pairAddress:'x',baseToken:{address:SOL,symbol:'SOL'},quoteToken:{symbol:'USDC'},priceUsd:'182',liquidity:{usd:9e6}}]});
  const p={chainId:'solana',dexId:'x',pairAddress:'P1',baseToken:{address:TOKEN,symbol:'GOR',name:'Gorilla'},quoteToken:{symbol:'SOL'},priceUsd:String(price),liquidity:{usd:5e5},marketCap:price*1e9,priceChange:{},info:{}};
  return route.fulfill({json: u.includes('/search')?{pairs:[p]}:[p]});
});
await ctx.route('https://lite-api.jup.ag/**', (r) => r.fulfill({json: r.request().url().includes('/price/v3') ? {} : []}));
await ctx.route('https://trade.padre.gg/**', (r) => r.fulfill({ body: '<html><body style="background:#070707"></body></html>', contentType:'text/html' }));
let [sw]=ctx.serviceWorkers(); if(!sw) sw=await ctx.waitForEvent('serviceworker');
const pg=await ctx.newPage(); pg.on('pageerror', e=>console.log('ERR', e.message));
const P=pg.locator('#fogueo-root');
const rounds = async()=> (await sw.evaluate(()=>chrome.storage.local.get('fogueo'))).fogueo.account.rounds.map(r=>`${r.reason}:${r.pnlPct.toFixed(1)}%`);
await pg.goto('https://trade.padre.gg/'); await pg.waitForTimeout(1500);
await P.locator('[data-act="onboarded"]').click();
await pg.goto('https://trade.padre.gg/trade/solana/'+TOKEN); await pg.waitForTimeout(2000);
// 1) trailing: SL 30 dinámico
await P.locator('.opt.sl label').click(); await P.locator('[data-act="trail"]').click();
await P.locator('[data-act="quick"]').nth(2).click(); await P.locator('[data-act="buy"]').click(); await pg.waitForTimeout(1200);
price*=1.45; await pg.waitForTimeout(6000);
await P.screenshot({path:TDIR+'t3-peak.png'});
price*=0.65; await pg.waitForTimeout(6000);  // −35 % desde el máximo: salta el dinámico del 30 %
console.log('after trail', await rounds());
// 2) SL normal
await P.locator('[data-act="trail"]').click();
await P.locator('[data-act="buy"]').click(); await pg.waitForTimeout(1200);
price*=0.6; await pg.waitForTimeout(6000);
console.log('after sl', await rounds());
// 3) TP
await P.locator('.opt.sl label').click(); await P.locator('.opt.tp label').click();
await P.locator('[data-ref="tpPct"]').fill('50'); await P.locator('[data-ref="tpPct"]').dispatchEvent('change');
await P.locator('[data-act="buy"]').click(); await pg.waitForTimeout(1200);
price*=1.7; await pg.waitForTimeout(6000);
console.log('after tp', await rounds());
await P.screenshot({path:TDIR+'t3-end.png'});
await pg.goto('https://trade.padre.gg/'); await pg.waitForTimeout(2500);
await P.screenshot({path:TDIR+'t3-notoken.png'});
await ctx.close();
