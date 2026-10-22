import { chromium } from 'playwright';
const TDIR = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
import fs from 'fs';
const EXT=new URL('../Fogueo', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), TOKEN='Hb1DD3TgUkiU1dJsEcckuyEprLW3CuyHYsYrAUmxpump', SOL='So11111111111111111111111111111111111111112';
const OUT=TDIR+'tour'; fs.rmSync(OUT,{recursive:true,force:true}); fs.mkdirSync(OUT);
const ctx = await chromium.launchPersistentContext(TDIR+'p4-'+Date.now(), { headless:true, channel:'chromium', locale:'es-ES', viewport:{width:1280,height:860}, deviceScaleFactor:1.5, args:[`--disable-extensions-except=${EXT}`,`--load-extension=${EXT}`,'--lang=es-ES'] });
await ctx.route('https://api.dexscreener.com/**', (route) => {
  const u=route.request().url();
  if (u.includes(SOL)&&!u.includes(TOKEN)) return route.fulfill({json:[{chainId:'solana',pairAddress:'x',baseToken:{address:SOL,symbol:'SOL'},quoteToken:{symbol:'USDC'},priceUsd:'182',liquidity:{usd:9e6}}]});
  const p={chainId:'solana',dexId:'x',pairAddress:'P1',baseToken:{address:TOKEN,symbol:'GORILLA',name:'Gorilla'},quoteToken:{symbol:'SOL'},priceUsd:'0.00004',liquidity:{usd:5e4},marketCap:4e4,priceChange:{m5:1,h1:2},info:{}};
  return route.fulfill({json: u.includes('/search')?{pairs:[p]}:[p]});
});
const fake=fs.readFileSync(TDIR+'fake-padre.html','utf8');
await ctx.route('https://lite-api.jup.ag/**', (r) => r.fulfill({json: r.request().url().includes('/price/v3') ? {} : []}));
await ctx.route('https://trade.padre.gg/**', (r) => r.fulfill({ body: fake, contentType:'text/html' }));
let [sw]=ctx.serviceWorkers(); if(!sw) sw=await ctx.waitForEvent('serviceworker');
const extId=sw.url().split('/')[2];
const pg=await ctx.newPage(); pg.on('pageerror', e=>console.log('ERR', e.message));
await pg.goto('https://trade.padre.gg/trade/solana/'+TOKEN); await pg.waitForTimeout(2500);
const P=pg.locator('#fogueo-root');
await pg.screenshot({path:`${OUT}/p00.png`});
await P.locator('[data-act="tour"]').first().click(); await pg.waitForTimeout(500); await P.locator('[data-tour="all"]').click();
for (let i=1;i<=29;i++){ await pg.waitForTimeout(650); await pg.screenshot({path:`${OUT}/p${String(i).padStart(2,'0')}.png`}); await pg.keyboard.press('ArrowRight'); }
await pg.waitForTimeout(900);
await pg.screenshot({path:`${OUT}/p99-after.png`});
const st=(await sw.evaluate(()=>chrome.storage.local.get('fogueo'))).fogueo;
console.log('after panel tour: balance', st.account.balance, 'positions', Object.keys(st.account.positions).length, 'ui', JSON.stringify(st.ui));
const pop=await ctx.newPage(); pop.on('pageerror', e=>console.log('POPERR', e.message));
await pop.setViewportSize({width:392,height:600});
await pop.goto(`chrome-extension://${extId}/popup/popup.html`); await pop.waitForTimeout(1400);
await pop.waitForTimeout(500); await pop.screenshot({path:`${OUT}/q00.png`}); await pop.locator('[data-pt="all"]').click();
for (let i=1;i<=18;i++){ await pop.waitForTimeout(650); await pop.screenshot({path:`${OUT}/q${String(i).padStart(2,'0')}.png`}); await pop.keyboard.press('ArrowRight'); }
await pop.waitForTimeout(700); await pop.screenshot({path:`${OUT}/q99-after.png`});
const st2=(await sw.evaluate(()=>chrome.storage.local.get('fogueo'))).fogueo;
console.log('after popup tour: rounds', st2.account.rounds.length, 'ui', JSON.stringify(st2.ui));
await ctx.close();
