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
const ok=(c,m)=>console.log((c?'OK  ':'FAIL')+' '+m);
const OUT2=TDIR+'tour2'; fs.rmSync(OUT2,{recursive:true,force:true}); fs.mkdirSync(OUT2);
const st=async()=>(await sw.evaluate(()=>chrome.storage.local.get('fogueo'))).fogueo;
const S=(sel)=>pg.locator('#fogueo-root').locator(sel);
const card=async()=>pg.evaluate(()=>{const c=document.querySelector('#fogueo-root').shadowRoot.querySelector('.tour-card'); if(!c) return null; return {t:c.querySelector('h3').textContent, count:c.querySelector('.tour-count').textContent, tryv:!c.querySelector('.tour-try').hidden, done:c.querySelector('.tour-try').classList.contains('done')};});
await S('[data-act="onboarded"]').click().catch(()=>{});
const before=await st();
await S('[data-act="tour"]').first().click(); await pg.waitForTimeout(700);
await pg.screenshot({path:`${OUT2}/00-welcome.png`});
ok((await S('[data-tour="core"]').count())===1 && (await S('[data-tour="all"]').count())===1, 'Bienvenida con «Lo esencial» y «Verlo todo»');
await S('[data-tour="core"]').click(); await pg.waitForTimeout(600);
let n=0, seen=[];
const doTry=async(title)=>{
  if (/rápidas/.test(title)) await S('[data-act="quick"]').nth(1).click();
  else if (/dinámico/.test(title)) { await S('[data-act="trail"]').click(); await pg.waitForTimeout(250); await S('[data-act="trail"]').click(); }
  else if (/posición, en vivo/.test(title)) await S('[data-act="unitPnl"]').click();
  else if (/^Vender$/.test(title)) { await S('[data-act="sell"]').click({force:true}).catch(()=>{}); await pg.waitForTimeout(300); await S('[data-act="sellpct"][data-pct="75"]').click(); }
  else if (/Revisa/.test(title)) { await S('[data-act="plan"]').first().click(); await pg.waitForTimeout(200); await S('[data-act="tag"]').nth(2).click(); }
};
for (let k=0;k<20;k++){
  const c=await card(); if(!c) break; seen.push(c.t);
  await pg.screenshot({path:`${OUT2}/c${String(k+1).padStart(2,'0')}.png`});
  if (c.tryv) {
    await doTry(c.t); await pg.waitForTimeout(250);
    const c2=await card(); ok(c2?.done, `Pruébalo hecho: ${c.t}`);
    await pg.screenshot({path:`${OUT2}/c${String(k+1).padStart(2,'0')}-done.png`});
    await pg.waitForTimeout(1900);
    const c3=await card(); ok(!c3 || c3.t!==c.t, `Avanza solo tras «${c.t}»`);
  } else { await pg.keyboard.press('ArrowRight'); await pg.waitForTimeout(450); }
}
console.log('esencial:', seen.length, seen.join(' | '));
ok(seen.length===11, 'Lo esencial = 11 pasos tras la bienvenida');
const after=await st();
ok(Object.keys(after.account.positions).length===Object.keys(before.account.positions).length && after.account.rounds.length===before.account.rounds.length && after.account.balance===before.account.balance, 'Cuenta real intacta (nada comprado ni vendido)');
ok(after.settings.useTrail===before.settings.useTrail && after.settings.pnlUnit===before.settings.pnlUnit, 'Ajustes reales intactos');
ok(after.ui.toured===true && !after.ui.tourResume, 'Terminado: toured y sin reanudar pendiente');
// reanudar
await S('[data-act="tour"]').first().click(); await pg.waitForTimeout(500);
await S('[data-tour="all"]').click(); await pg.waitForTimeout(400);
for (let k=0;k<6;k++){ await pg.keyboard.press('ArrowRight'); await pg.waitForTimeout(250); }
const mid=await card(); await pg.keyboard.press('Escape'); await pg.waitForTimeout(600);
ok((await st()).ui.tourResume?.i===7, 'Al salir a medias guarda el paso: '+JSON.stringify((await st()).ui.tourResume));
await S('[data-act="tour"]').first().click(); await pg.waitForTimeout(500);
await pg.screenshot({path:`${OUT2}/z-resume.png`});
await S('[data-tour="resume"]').click(); await pg.waitForTimeout(500);
ok((await card()).t===mid.t, 'Reanuda en «'+mid.t+'»');
// recorrer «todo» hasta el final con flechas
let cnt=0; for (let k=0;k<40;k++){ const c=await card(); if(!c) break; cnt++; await pg.keyboard.press('ArrowRight'); await pg.waitForTimeout(220); }
ok(cnt>0 && !(await card()), 'Termina «Verlo todo»');
ok(!(await st()).ui.tourResume, 'Reanudar limpio tras terminar');
await pg.waitForTimeout(500);
const rest=await pg.evaluate(()=>document.querySelector('#fogueo-root').shadowRoot.querySelector('.tour'));
ok(!rest, 'Capa del recorrido eliminada');
await pg.screenshot({path:`${OUT2}/zz-after.png`});
await ctx.close();
