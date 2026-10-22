import { chromium } from 'playwright';
const TDIR = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const EXT=new URL('../Fogueo', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), SOL='So11111111111111111111111111111111111111112';
const NEW='52u2Z2PZkPgX8nzzZvN7ADCroDBTRiT4VNkpAgm3pump';   // solo en Jupiter
const TOK='pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn';    // token con 2 pares
const PAIR_A='BofA2ViUSudPBTUms2KRuG6AHNeMawjNfwqTJDgx5BKW';  // el que se ve en Padre (menos liquidez)
const PAIR_B='8sLbNZoA1cfnvMJLPfp98ZLAnFSYCFApfJKMbiXNLwxj';  // más liquidez, otro precio
let jupPrice=0.0000031, dsDown=false, jupDown=false;
const ok=(c,m)=>console.log((c?'OK  ':'FAIL')+' '+m);
const ctx = await chromium.launchPersistentContext(TDIR+'p5-'+Date.now(), { headless:true, channel:'chromium', locale:'es-ES', viewport:{width:1280,height:900}, args:[`--disable-extensions-except=${EXT}`,`--load-extension=${EXT}`,'--lang=es-ES'] });
const pair=(pa,price,liq)=>({chainId:'solana',dexId:'orca',pairAddress:pa,baseToken:{address:TOK,symbol:'PUMP',name:'Pump'},quoteToken:{symbol:'SOL'},priceUsd:String(price),liquidity:{usd:liq},marketCap:price*1e9,priceChange:{},info:{}});
await ctx.route('https://api.dexscreener.com/**', (route) => {
  const u=route.request().url();
  if (dsDown) return route.fulfill({status:500, body:'x'});
  if (u.includes(SOL)&&!u.includes(TOK)&&!u.includes(NEW)) return route.fulfill({json:[{chainId:'solana',pairAddress:'x',baseToken:{address:SOL,symbol:'SOL'},quoteToken:{symbol:'USDC'},priceUsd:'104.5',liquidity:{usd:9e6}}]});
  if (u.includes(NEW)) return route.fulfill({json: u.includes('/search')?{pairs:[]}:[]});
  const both=[pair(PAIR_A,0.0048,2.3e6), pair(PAIR_B,0.0051,9e6)];
  if (u.includes('/search')) return route.fulfill({json:{pairs:[both[0]]}});
  return route.fulfill({json: both});
});
await ctx.route('https://lite-api.jup.ag/**', (route) => {
  const u=route.request().url();
  if (jupDown) return route.fulfill({status:503, body:'x'});
  if (u.includes('/price/v3')) return route.fulfill({json:{[SOL]:{usdPrice:104.5}}});
  return route.fulfill({json: u.includes(NEW) ? [{id:NEW,symbol:'DOUG',name:'Doug',usdPrice:jupPrice,mcap:jupPrice*1e9,liquidity:3200,launchpad:'pump.fun',stats5m:{priceChange:-12},stats1h:{priceChange:40}}] : []});
});
await ctx.route('https://trade.padre.gg/**', (r) => r.fulfill({ body: '<html><body style="background:#070707"><input id="padreInput" style="position:fixed;right:20px;top:20px"></body></html>', contentType:'text/html' }));
let [sw]=ctx.serviceWorkers(); if(!sw) sw=await ctx.waitForEvent('serviceworker');
const pg=await ctx.newPage(); pg.on('pageerror', e=>console.log('PAGEERR', e.message));
const P=pg.locator('#fogueo-root');
const state=async()=>(await sw.evaluate(()=>chrome.storage.local.get('fogueo'))).fogueo;
await pg.goto('https://trade.padre.gg/trade/solana/'+NEW); await pg.waitForTimeout(2500);
await P.locator('[data-act="onboarded"]').click().catch(()=>{});
const symTxt = await P.locator('.sym').innerText().catch(()=> 'none');
ok(symTxt.includes('DOUG'), 'Token nuevo (solo Jupiter) detectado: '+symTxt);
const fresh = await P.locator('[data-ref="freshText"]').innerText();
ok(/Jupiter/.test(fresh), 'Fuente mostrada: '+fresh);
await P.locator('[data-act="quick"]').nth(1).click(); await P.locator('[data-act="buy"]').click(); await pg.waitForTimeout(1200);
let st=await state();
ok(Object.keys(st.account.positions).includes('solana:'+NEW), 'Compra de token Jupiter');
jupPrice*=1.5; await pg.waitForTimeout(6500);
const pnl = await P.locator('[data-ref="ppnl"]').innerText();
ok(pnl.includes('+'), 'PnL se actualiza con Jupiter: '+pnl.replace(/\n/g,' '));
// atajo con foco en un input de Padre: no debe comprar
await pg.locator('#padreInput').focus();
await P.hover({position:{x:150,y:20}}); await pg.keyboard.press('1'); await pg.waitForTimeout(800);
st=await state(); ok(st.account.fills.filter(f=>f.side==='buy').length===1, 'Tecla 1 con foco en input de Padre NO compra');
await pg.locator('#padreInput').blur?.();
await pg.evaluate(()=>document.activeElement.blur());
await P.hover({position:{x:150,y:20}}); await pg.keyboard.press('1'); await pg.waitForTimeout(1200);
st=await state(); ok(st.account.fills.filter(f=>f.side==='buy').length===2, 'Tecla 1 sin foco SÍ compra');
// orden límite + caída de APIs: la orden no se cancela
await P.locator('[data-act="otype"][data-o="limit"]').click();
await P.locator('[data-ref="limitMc"]').fill(String(Math.round(jupPrice*1e9*0.5)));
await P.locator('[data-act="buy"]').click(); await pg.waitForTimeout(800);
dsDown=true; jupDown=true; jupPrice*=0.3;
await pg.waitForTimeout(19000);
st=await state(); ok(st.account.orders.length===1, 'Con APIs caídas la orden límite sigue viva');
const stale = await P.locator('[data-ref="freshText"]').innerText();
ok(/hace/i.test(stale), 'Aviso de precio viejo: '+stale);
const qb = await P.locator('[data-ref="buyQuote"]').innerText();
await P.locator('[data-act="otype"][data-o="market"]').click();
await P.locator('[data-act="quick"]').nth(0).click(); await pg.waitForTimeout(300);
ok(await P.locator('[data-act="buy"]').isDisabled(), 'Botón Comprar bloqueado con precio congelado');
const extId=sw.url().split('/')[2];
const pop=await ctx.newPage(); await pop.goto(`chrome-extension://${extId}/popup/popup.html`); await pop.waitForTimeout(800);
const res = await pop.evaluate(async (k)=> await new Promise(r=>chrome.runtime.sendMessage({type:'buy',key:k,solIn:0.1},r)), 'solana:'+NEW);
ok(res && res.ok===false && /precio/i.test(res.error||''), 'El motor rechaza comprar con precio viejo: '+(res?.error||'').slice(0,90));
await pop.close();
dsDown=false; jupDown=false;
await pg.waitForTimeout(6000);
st=await state(); ok(st.account.orders.length===0 && st.account.fills.some(f=>f.via==='limit'), 'Al volver las APIs, la orden límite se ejecuta');
// par preferido
await pg.goto('https://trade.padre.gg/trade/solana/'+PAIR_A); await pg.waitForTimeout(6500);
const price = await P.locator('.price').innerText();
ok(price.includes('0,0048'), 'Precio del par que ves en Padre (0,0048, no 0,0051): '+price);
await ctx.close();
