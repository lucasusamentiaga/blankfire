// Modo inglés: recorre panel, popup y los dos tours buscando restos en español; luego vuelve a español.
import { chromium } from 'playwright';
const TDIR = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
import fs from 'fs';
const EXT=new URL('../Fogueo', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), SOL='So11111111111111111111111111111111111111112';
const TOKEN='52u2Z2PZkPgX8nzzZvN7ADCroDBTRiT4VNkpAgm3pump';
const OUT=TDIR+'en'; fs.rmSync(OUT,{recursive:true,force:true}); fs.mkdirSync(OUT);
const ok=(c,m)=>console.log((c?'OK  ':'FAIL')+' '+m);
const ES=/[áéíóúñ¿¡]|\b(de|del|el|la|los|las|que|con|para|por|tu|tus|sin|una|en|es|hoy|ayer|hace|compra|venta|comprar|vender|saldo|aquí|cuenta|ajustes|todo|más|cada|desde|hasta)\b/i;
const SKIP=new Set(['ES','Español','English / Español']);
const leftovers=(txt)=>txt.split(/\n+/).map(s=>s.trim()).filter(s=>s && !SKIP.has(s) && ES.test(s));
const ctx = await chromium.launchPersistentContext(TDIR+'p9-'+Date.now(), { headless:true, channel:'chromium', locale:'en-US', viewport:{width:1280,height:900}, args:[`--disable-extensions-except=${EXT}`,`--load-extension=${EXT}`,'--lang=en-US'] });
await ctx.route('https://api.dexscreener.com/**', (route) => {
  const u=route.request().url();
  if (u.includes(SOL)&&!u.includes(TOKEN)) return route.fulfill({json:[{chainId:'solana',pairAddress:'x',baseToken:{address:SOL,symbol:'SOL'},quoteToken:{symbol:'USDC'},priceUsd:'182',liquidity:{usd:9e6}}]});
  const p={chainId:'solana',dexId:'pumpfun',pairAddress:'P1',baseToken:{address:TOKEN,symbol:'DOUG',name:'Doug'},quoteToken:{symbol:'SOL'},priceUsd:'0.00004',liquidity:{usd:5e4},marketCap:4e4,priceChange:{m5:1,h1:2},pairCreatedAt:Date.now()-7*60000,info:{}};
  return route.fulfill({json: u.includes('/search')?{pairs:[p]}:[p]});
});
await ctx.route('https://lite-api.jup.ag/**', (r) => r.fulfill({json: r.request().url().includes('/price/v3')?{}:[{id:TOKEN,symbol:'DOUG',name:'Doug',usdPrice:0.00004,launchpad:'pump.fun'}]}));
const fake=fs.readFileSync(TDIR+'fake-padre.html','utf8');
await ctx.route('https://trade.padre.gg/**', (r) => r.fulfill({ body: fake, contentType:'text/html' }));
let [sw]=ctx.serviceWorkers(); if(!sw) sw=await ctx.waitForEvent('serviceworker');
const extId=sw.url().split('/')[2];
const st=async()=>(await sw.evaluate(()=>chrome.storage.local.get('fogueo'))).fogueo;
const pg=await ctx.newPage(); const errs=[]; pg.on('pageerror', e=>errs.push(e.message));
await pg.goto('https://trade.padre.gg/trade/solana/'+TOKEN); await pg.waitForTimeout(2800);
const P=pg.locator('#fogueo-root');
const panelText=()=>pg.evaluate(()=>document.querySelector('#fogueo-root').shadowRoot.querySelector('.fx, .panel, :host > *')?.innerText || document.querySelector('#fogueo-root').shadowRoot.textContent);
const shadowAll=()=>pg.evaluate(()=>{const r=document.querySelector('#fogueo-root').shadowRoot; const out=[]; const w=document.createTreeWalker(r,NodeFilter.SHOW_TEXT); for(let n=w.nextNode();n;n=w.nextNode()){ if(n.parentElement?.closest('style')) continue; const t=n.nodeValue.trim(); if(t) out.push(t);} r.querySelectorAll('[placeholder],[aria-label],[title]').forEach(e=>['placeholder','aria-label','title'].forEach(a=>{const v=e.getAttribute(a); if(v) out.push('@'+a+': '+v);})); return out.join('\n');});
const report=(where,txt)=>{ const l=[...new Set(leftovers(txt))]; ok(l.length===0, `${where}: sin español`+(l.length?' → '+JSON.stringify(l.slice(0,12)):'')); };
ok(await P.count()===1, 'Panel cargado');
report('Panel (onboarding)', await shadowAll());
await pg.screenshot({path:`${OUT}/1-panel-onboard.png`});
await P.locator('[data-act="onboarded"]').click(); await pg.waitForTimeout(400);
await P.locator('[data-act="recoToggle"]').click().catch(()=>{}); await pg.waitForTimeout(300);
report('Panel (operar + reco)', await shadowAll());
await pg.screenshot({path:`${OUT}/2-panel-trade.png`});
// comprar 0.5
await P.locator('[data-ref="amount"]').fill('0.5');
await P.locator('[data-act="buy"]').click(); await pg.waitForTimeout(1500);
let s=await st();
ok(Object.keys(s.account.positions).length===1, 'Compra con decimal inglés "0.5" → posición: '+Object.values(s.account.positions)[0]?.costSol);
report('Panel (con posición)', await shadowAll());
await pg.screenshot({path:`${OUT}/3-panel-pos.png`});
// vistas del panel
for (const v of ['positions','keys']) { const b=P.locator(`[data-view="${v}"], [data-act="view-${v}"], [data-tab="${v}"]`).first(); if(await b.count()){ await b.click(); await pg.waitForTimeout(300); report('Panel vista '+v, await shadowAll()); } }
// tour panel
await P.locator('[data-act="tour"]').first().click(); await pg.waitForTimeout(500);
const tourTexts=[await pg.evaluate(()=>document.querySelector('#fogueo-root').shadowRoot.querySelector('.tour-card').innerText)];
await P.locator('[data-tour="all"]').click(); await pg.waitForTimeout(400);
for (let i=0;i<34;i++){ await pg.waitForTimeout(350); const t=await pg.evaluate(()=>{const r=document.querySelector('#fogueo-root').shadowRoot; const c=r.querySelector('.tour-card'); return c? c.innerText : null;}); if(!t) break; tourTexts.push(t); if(i===3) await pg.screenshot({path:`${OUT}/4-panel-tour.png`}); await pg.keyboard.press('ArrowRight'); }
ok(tourTexts.length===30, 'Tour del panel (todo): '+tourTexts.length+' pasos');
report('Tour del panel', tourTexts.join('\n'));
// vender todo para tener historial
await pg.waitForTimeout(500);
await P.locator('[data-act="side"][data-side="sell"]').click(); await pg.waitForTimeout(200); await P.locator('[data-act="sellpct"][data-pct="100"]').click(); await P.locator('[data-act="sell"]').click(); await pg.waitForTimeout(1500);
s=await st(); ok(s.account.rounds.length>=1, 'Venta → ronda cerrada');
report('Panel (tras vender)', await shadowAll());
// popup
const pop=await ctx.newPage(); pop.on('pageerror', e=>errs.push('POPUP '+e.message));
await pop.setViewportSize({width:400,height:600});
await pop.goto(`chrome-extension://${extId}/popup/popup.html`); await pop.waitForTimeout(1200);
const popTour=[await pop.evaluate(()=>document.querySelector('.ptour-card')?.innerText||'')];
await pop.locator('[data-pt="all"]').click(); await pop.waitForTimeout(400);
for (let i=0;i<20;i++){ const t=await pop.evaluate(()=>document.querySelector('.ptour-card')?.innerText||null); if(!t) break; popTour.push(t); if(i===8) await pop.screenshot({path:`${OUT}/5-popup-tour.png`}); await pop.keyboard.press('ArrowRight'); await pop.waitForTimeout(450); }
ok(popTour.length===19, 'Tour del popup: '+popTour.length+' pasos');
report('Tour del popup (+ vistas demo)', popTour.join('\n'));
const allPop=()=>pop.evaluate(()=>{const out=[]; const w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT); for(let n=w.nextNode();n;n=w.nextNode()){ const el=n.parentElement; if(!el||el.closest('style,script,textarea')) continue; if(el.closest('[hidden]')) continue; const t=n.nodeValue.trim(); if(t) out.push(t);} document.querySelectorAll('[placeholder],[aria-label],[title]').forEach(e=>['placeholder','aria-label','title'].forEach(a=>{const v=e.getAttribute(a); if(v && !(a==='aria-label'&&e.matches('.lang-btn'))&&!(a==='title'&&e.matches('.lang-btn'))) out.push('@'+a+': '+v);})); return out.join('\n');});
for (const t of ['wallet','history','stats','settings']) {
  await pop.locator(`[data-tab="${t}"]`).click(); await pop.waitForTimeout(400);
  if (t==='history') { await pop.locator('[data-row]').first().click().catch(()=>{}); await pop.waitForTimeout(300); }
  report('Popup '+t, await allPop());
  await pop.screenshot({path:`${OUT}/6-popup-${t}.png`, fullPage:true});
}
ok((await pop.locator('.top .brand').innerText())==='Blankfire', 'Marca Blankfire en el popup');
ok((await pop.locator('.lang-btn').innerText())==='ES', 'Botón de idioma muestra ES en inglés');
// cambiar a español desde el popup
await pop.locator('.lang-btn').click(); await pop.waitForTimeout(1500);
s=await st(); ok(s.settings.lang==='es', 'lang guardado = es');
ok((await pop.locator('[data-tab="wallet"]').innerText())==='Cartera', 'Popup en español tras cambiar: '+await pop.locator('[data-tab="wallet"]').innerText());
await pg.waitForTimeout(800);
const pt=await shadowAll();
ok(/Comprar|Posiciones|Operar/.test(pt), 'Panel en Padre cambia a español solo');
ok((await pop.locator('.lang-btn').innerText())==='EN', 'Botón muestra EN en español');
// y de vuelta a inglés desde el panel
await P.locator('[data-act="lang"]').first().click(); await pg.waitForTimeout(800);
s=await st(); ok(s.settings.lang==='en', 'Botón del panel → en');
await pop.waitForTimeout(1500);
ok((await pop.locator('[data-tab="wallet"]').innerText())==='Wallet', 'Popup sigue al panel: '+await pop.locator('[data-tab="wallet"]').innerText());
// manifiesto
const man=await sw.evaluate(()=>chrome.runtime.getManifest());
ok(man.name.startsWith('Blankfire') && man.version==='1.9.1', 'Manifiesto: '+man.name+' '+man.version);
// error de background traducido
const r=await sw.evaluate(async()=>{ return await new Promise(res=>chrome.runtime.sendMessage({type:'cancelOrder',id:'nope'},res)).catch(e=>String(e)); }).catch(e=>'n/a');
ok(errs.length===0, 'Sin errores JS'+(errs.length?': '+errs.join(' | '):''));
await ctx.close();
