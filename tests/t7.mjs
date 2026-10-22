import { chromium } from 'playwright';
const TDIR = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
import fs from 'fs';
const EXT=new URL('../Fogueo', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), SOL='So11111111111111111111111111111111111111112';
const NEWT='52u2Z2PZkPgX8nzzZvN7ADCroDBTRiT4VNkpAgm3pump';   // en la curva (DS: pumpfun)
const GRAD='Hb1DD3TgUkiU1dJsEcckuyEprLW3CuyHYsYrAUmxpump';   // graduado (solo Jupiter dice graduatedPool)
const BIG='pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn';     // token asentado (sin launchpad)
const OUT=TDIR+'reco'; fs.rmSync(OUT,{recursive:true,force:true}); fs.mkdirSync(OUT);
const ok=(c,m)=>console.log((c?'OK  ':'FAIL')+' '+m);
const ctx = await chromium.launchPersistentContext(TDIR+'p7-'+Date.now(), { headless:true, channel:'chromium', locale:'es-ES', viewport:{width:1280,height:1000}, deviceScaleFactor:2, args:[`--disable-extensions-except=${EXT}`,`--load-extension=${EXT}`,'--lang=es-ES'] });
const pair=(addr,sym,dex,price,liq)=>({chainId:'solana',dexId:dex,pairAddress:'P'+addr.slice(1,30),baseToken:{address:addr,symbol:sym,name:sym},quoteToken:{symbol:'SOL'},priceUsd:String(price),liquidity:{usd:liq},marketCap:price*1e9,priceChange:{m5:3,h1:12},pairCreatedAt:Date.now()-7*60000,info:{}});
await ctx.route('https://api.dexscreener.com/**', (route) => {
  const u=route.request().url();
  if (u.includes(SOL)&&![NEWT,GRAD,BIG].some(a=>u.includes(a))) return route.fulfill({json:[{chainId:'solana',pairAddress:'x',baseToken:{address:SOL,symbol:'SOL'},quoteToken:{symbol:'USDC'},priceUsd:'104.5',liquidity:{usd:9e6}}]});
  const ps=[]; if(u.includes(NEWT)) ps.push(pair(NEWT,'DOUG','pumpfun',0.0000045,9000)); if(u.includes(GRAD)) ps.push(pair(GRAD,'KIMCHI','pumpswap',0.00051,500000)); if(u.includes(BIG)) ps.push(pair(BIG,'PUMP','orca',0.0048,2.3e6));
  return route.fulfill({json: u.includes('/search')?{pairs:ps}:ps});
});
await ctx.route('https://lite-api.jup.ag/**', (route) => {
  const u=route.request().url(); const out=[];
  if(u.includes(NEWT)) out.push({id:NEWT,symbol:'DOUG',name:'Doug',usdPrice:0.0000045,launchpad:'pump.fun'});
  if(u.includes(GRAD)) out.push({id:GRAD,symbol:'KIMCHI',name:'Kimchi',usdPrice:0.00051,launchpad:'pump.fun',graduatedPool:'xx',graduatedAt:new Date(Date.now()-3*3600e3).toISOString()});
  if(u.includes(BIG)) out.push({id:BIG,symbol:'PUMP',name:'Pump',usdPrice:0.0048});
  return route.fulfill({json: u.includes('/price/v3')?{}:out});
});
const fake=fs.readFileSync(TDIR+'fake-padre.html','utf8');
await ctx.route('https://trade.padre.gg/**', (r) => r.fulfill({ body: fake, contentType:'text/html' }));
let [sw]=ctx.serviceWorkers(); if(!sw) sw=await ctx.waitForEvent('serviceworker');
const extId=sw.url().split('/')[2];
const pg=await ctx.newPage(); pg.on('pageerror', e=>console.log('PAGEERR', e.message));
const P=pg.locator('#fogueo-root');
const st=async()=>(await sw.evaluate(()=>chrome.storage.local.get('fogueo'))).fogueo;
await pg.goto('https://trade.padre.gg/trade/solana/'+NEWT); await pg.waitForTimeout(2500);
await P.locator('[data-act="onboarded"]').click();
await pg.waitForTimeout(300);
ok((await P.locator('.reco .stage').innerText()).includes('Nuevo par'), 'Detecta NUEVO PAR (pumpfun)');
await P.screenshot({path:`${OUT}/1-new-collapsed.png`});
await P.locator('[data-act="recoToggle"]').click(); await pg.waitForTimeout(300);
await P.screenshot({path:`${OUT}/2-new-open.png`});
await P.locator('[data-act="recoApply"]').click(); await pg.waitForTimeout(700);
let s=(await st()).settings;
ok(s.maxSlippagePct===20 && s.priorityFee===0.003 && s.defaultSlPct===30 && s.defaultTpPct===100 && s.useTrail, 'Aplicar → ajustes de nuevo par guardados');
ok(await P.locator('[data-ref="amount"]').inputValue()==='0,2', 'Tamaño 2 % de 10 SOL = 0,2: '+await P.locator('[data-ref="amount"]').inputValue());
ok((await P.locator('.reco-apply').innerText()).includes('Aplicados'), 'Botón pasa a "Aplicados"');
await P.screenshot({path:`${OUT}/3-new-applied.png`});
// activar automático e ir a un graduado
await P.locator('[data-act="recoAuto"]').click(); await pg.waitForTimeout(400);
await pg.goto('https://trade.padre.gg/trade/solana/'+GRAD); await pg.waitForTimeout(3000);
ok((await P.locator('.reco .stage').innerText()).includes('Graduado'), 'Detecta GRADUADO (Jupiter graduatedPool)');
ok((await P.locator('.reco-when').innerText()).includes('graduado hace 3 h'), 'Cuándo se graduó: '+await P.locator('.reco-when').innerText());
s=(await st()).settings;
ok(s.maxSlippagePct===10 && s.defaultSlPct===20 && s.defaultTpPct===60, 'Auto-aplicado perfil graduado');
ok(await P.locator('[data-ref="amount"]').inputValue()==='0,5', 'Tamaño 5 % = 0,5: '+await P.locator('[data-ref="amount"]').inputValue());
await P.screenshot({path:`${OUT}/4-grad-auto.png`});
// token asentado: sin recomendación
await pg.goto('https://trade.padre.gg/trade/solana/'+BIG); await pg.waitForTimeout(3000);
ok(await P.locator('.reco').count()===0, 'Token asentado (PUMP): sin recomendación');
// modo % saldo + aplicar
await pg.goto('https://trade.padre.gg/trade/solana/'+NEWT); await pg.waitForTimeout(3000);
await P.locator('[data-act="unit"]').click(); await pg.waitForTimeout(300);
await P.locator('[data-act="recoApply"]').click().catch(()=>{}); await pg.waitForTimeout(400);
ok(await P.locator('[data-ref="amount"]').inputValue()==='2', 'En modo % saldo aplica "2": '+await P.locator('[data-ref="amount"]').inputValue());
// popup ajustes
const pop=await ctx.newPage(); await pop.setViewportSize({width:392,height:600});
await pop.goto(`chrome-extension://${extId}/popup/popup.html`); await pop.waitForTimeout(1200); await pop.keyboard.press('Escape'); await pop.waitForTimeout(300);
await pop.click('[data-tab="settings"]'); await pop.waitForTimeout(300);
await pop.evaluate(()=>document.querySelector('.presets').scrollIntoView()); await pop.waitForTimeout(200);
await pop.screenshot({path:`${OUT}/5-popup.png`});
ok(await pop.locator('[data-act="autoPreset"]').getAttribute('aria-checked')==='true', 'Popup refleja "aplicar automáticamente"');
// recorrido con paso nuevo
await P.locator('[data-act="tour"]').first().click(); await pg.waitForTimeout(600);
for (let i=0;i<2;i++){ await pg.keyboard.press('ArrowRight'); await pg.waitForTimeout(450);} 
await pg.waitForTimeout(500); await pg.screenshot({path:`${OUT}/6-tour-step.png`});
const title = await P.locator('.tour-card h3').innerText(); ok(title==='Ajustes recomendados', 'Paso del recorrido: '+title);
await pg.keyboard.press('Escape'); await pg.waitForTimeout(500);
s=(await st()).settings; ok(s.maxSlippagePct===20, 'El recorrido no altera tus ajustes');
await ctx.close();
