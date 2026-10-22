import { chromium } from 'playwright';
const TDIR = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
import fs from 'fs';
const EXT=new URL('../Fogueo', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), SOL='So11111111111111111111111111111111111111112';
const TOKEN='52u2Z2PZkPgX8nzzZvN7ADCroDBTRiT4VNkpAgm3pump';
const LANG=process.argv[3]||'es';
const OUT=process.argv[2]; fs.rmSync(OUT,{recursive:true,force:true}); fs.mkdirSync(OUT);
const ctx = await chromium.launchPersistentContext(TDIR+'pv2-'+Date.now(), { headless:true, channel:'chromium', locale:LANG==='es'?'es-ES':'en-US', viewport:{width:1100,height:860}, deviceScaleFactor:2, args:[`--disable-extensions-except=${EXT}`,`--load-extension=${EXT}`,`--lang=${LANG==='es'?'es-ES':'en-US'}`] });
let price=0.0000045, down=false;
await ctx.route('https://api.dexscreener.com/**', (route) => {
  if (down) return route.abort();
  const u=route.request().url();
  if (u.includes(SOL)&&!u.includes(TOKEN)) return route.fulfill({json:[{chainId:'solana',pairAddress:'x',baseToken:{address:SOL,symbol:'SOL'},quoteToken:{symbol:'USDC'},priceUsd:'182.4',liquidity:{usd:9e6}}]});
  const p={chainId:'solana',dexId:'pumpfun',pairAddress:'P1',baseToken:{address:TOKEN,symbol:'DOUG',name:'Doug the Dog'},quoteToken:{symbol:'SOL'},priceUsd:String(price),liquidity:{usd:21000},marketCap:price*1e9,priceChange:{m5:12.4,h1:-3.1},pairCreatedAt:Date.now()-7*60000,info:{}};
  return route.fulfill({json: u.includes('/search')?{pairs:[p]}:[p]});
});
await ctx.route('https://lite-api.jup.ag/**', (r) => down ? r.abort() : r.fulfill({json: r.request().url().includes('/price/v3')?{}:[{id:TOKEN,symbol:'DOUG',name:'Doug the Dog',usdPrice:price,launchpad:'pump.fun'}]}));
const fake=fs.readFileSync(TDIR+'fake-padre.html','utf8');
await ctx.route('https://trade.padre.gg/**', (r) => r.fulfill({ body: fake, contentType:'text/html' }));
let [sw]=ctx.serviceWorkers(); if(!sw) sw=await ctx.waitForEvent('serviceworker');
const extId=sw.url().split('/')[2];
const pg=await ctx.newPage(); const errs=[]; pg.on('pageerror', e=>errs.push(e.message));
const S=(s)=>pg.locator('#fogueo-root').locator(s);
const full=async(n)=>pg.screenshot({path:`${OUT}/${n}.png`});
const shot=async(n)=>{ const fx=await pg.evaluate(()=>{const r=document.querySelector('#fogueo-root').shadowRoot.querySelector('.fx').getBoundingClientRect(); return {x:r.x,y:r.y,w:r.width,h:r.height};}); const vh=pg.viewportSize().height; await pg.screenshot({path:`${OUT}/${n}.png`, clip:{x:Math.max(0,fx.x-10),y:Math.max(0,fx.y-10),width:fx.w+20,height:Math.min(vh-Math.max(0,fx.y-10), fx.h+20)}}); };
await pg.goto('https://trade.padre.gg/'); await pg.waitForTimeout(1800);
await shot('01-onboard');
// tour desde el botón de la bienvenida
await S('.onboard [data-act="tour"]').click(); await pg.waitForTimeout(700); await full('02-tour-welcome');
await pg.keyboard.press('Escape'); await pg.waitForTimeout(500); await shot('03-after-tour-exit');
await pg.goto('https://trade.padre.gg/trade/solana/'+TOKEN); await pg.waitForTimeout(2500);
await shot('04-token');
// plegado
await pg.evaluate(()=>document.querySelector('#fogueo-root').shadowRoot.querySelector('.head').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))); await pg.waitForTimeout(500); await shot('05-collapsed');
await pg.evaluate(()=>document.querySelector('#fogueo-root').shadowRoot.querySelector('.head').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))); await pg.waitForTimeout(500);
// precio retrasado
down=true; await pg.waitForTimeout(19000); await shot('06-stale'); down=false; await pg.waitForTimeout(4000);
// tour: elección, paso pruébalo, recibo
await S('.foot [data-act="tour"]').click(); await pg.waitForTimeout(600);
await S('[data-tour="all"]').click(); await pg.waitForTimeout(400);
for (let k=0;k<30;k++){ const t=await pg.evaluate(()=>document.querySelector('#fogueo-root').shadowRoot.querySelector('.tour-card h3')?.textContent||''); if(/Primero, la compra|First, the buy/.test(t)) break; await pg.keyboard.press('ArrowRight'); await pg.waitForTimeout(220); }
await full('07-tour-buy');
for (let k=0;k<4;k++){ await pg.keyboard.press('ArrowRight'); await pg.waitForTimeout(500);} await pg.waitForTimeout(300); await full('08-tour-receipt');
await pg.keyboard.press('Escape'); await pg.waitForTimeout(400);
// ventana pequeña
await pg.setViewportSize({width:720,height:600}); await pg.waitForTimeout(600); await full('09-small');
await S('.foot [data-act="tour"]').click(); await pg.waitForTimeout(600); await S('[data-tour="core"]').click(); await pg.waitForTimeout(300);
for (let k=0;k<2;k++){ await pg.keyboard.press('ArrowRight'); await pg.waitForTimeout(450);} await full('10-small-tour');
await pg.keyboard.press('Escape'); await pg.waitForTimeout(400);
// popup
const pop=await ctx.newPage(); pop.on('pageerror', e=>errs.push('POP '+e.message)); await pop.setViewportSize({width:400,height:600});
await pop.goto(`chrome-extension://${extId}/popup/popup.html`); await pop.waitForTimeout(1200); await pop.screenshot({path:`${OUT}/11-popup-tour.png`});
await pop.keyboard.press('Escape'); await pop.waitForTimeout(400); await pop.screenshot({path:`${OUT}/12-popup.png`});
console.log('errores:', JSON.stringify(errs));
await ctx.close();
