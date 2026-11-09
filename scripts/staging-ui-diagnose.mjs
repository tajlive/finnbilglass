/** One-car, no-write UI trace for staging. Does not submit inquiries or call money endpoints. */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const expectedHtml=readFileSync(new URL('../public/index.html', import.meta.url),'utf8');
const expectedScripts=[...expectedHtml.matchAll(/<script\s+src="([^"]+)"/g)].map(x=>x[1]);
const base='https://finnbilglass-frontrute-staging.tomarnejensen.workers.dev';
const browser=await chromium.launch();
const page=await browser.newPage({viewport:{width:393,height:852}});
const exceptions=[],responses=[];
page.on('pageerror',e=>exceptions.push({message:String(e.message).slice(0,160),stack:String(e.stack||'').slice(0,500)}));
page.on('response',r=>{const u=new URL(r.url());if(u.pathname.startsWith('/api/')||u.pathname.endsWith('.js'))responses.push({path:u.pathname,status:r.status()})});
await page.route('**/api/opplaering',route=>route.fulfill({status:204,body:''}));
function get(id){return page.locator('#'+id)}
try{
  const remoteVariants=await Promise.all(['/', '/index.html', '/?fbg_check=20261109-v4', '/index.html?fbg_check=20261109-v4'].map(async path=>{
    const response=await fetch(base+path,{headers:{'Cache-Control':'no-cache'}});
    const html=await response.text();
    return {path,http:response.status,cfCache:response.headers.get('cf-cache-status'),cache:response.headers.get('cache-control'),
      hasViewScript:html.includes('src="frontrute-view.js?'),
      hasCurrentApp:html.includes('app.js?v=20261109-fastlane-dom-v2'),
      byteLength:html.length};
  }));
  console.log('STAGING_ROOT_FINGERPRINT '+JSON.stringify({expectedScripts,remoteVariants}));
  await page.goto(base+'/?fbg_check=20261109-v4',{waitUntil:'domcontentloaded'});
  await page.waitForTimeout(1300);
  const dependencies=await page.evaluate(()=>{
    const el=document.querySelector('kustom-payment-method-display');
    const widget=el?.shadowRoot;
    return {
      hasFBGView:!!window.FBGView,
      hasResultatStatus:typeof window.FBGView?.resultatStatus==='function',
      scripts:[...document.scripts].map(x=>x.getAttribute('src')).filter(Boolean),
      kustomLoader:typeof window.kustomElements,
      kustomQueue:!!window.kustomElements?._internal,
      kustomRegistered:!!customElements.get('kustom-payment-method-display'),
      kustomElementPresent:!!el,
      paymentDisplayRendered:!!el&&(el.childElementCount>0||!!widget?.children?.length),
      paymentLogoImages:el?.querySelectorAll('img,svg').length ?? 0
    };
  });
  await get('input-regnr').fill('CV80776');
  await page.locator('#form-regnr button[type=submit]').click();
  await page.waitForSelector('#screen-glass:not(.hidden)',{timeout:17000});
  await page.waitForFunction(()=>document.querySelector('#glassvalg')?.children.length>0||
    !!document.querySelector('#glassvalg-status')?.textContent?.match(/hjelper|ikke|feil/i),{timeout:15000}).catch(()=>{});
  const before={
    glassStatus:await get('glassvalg-status').textContent(),
    types:await page.locator('.glassopt[data-type]').evaluateAll(els=>els.map(e=>e.getAttribute('data-type'))),
    glassScreenVisible:await get('screen-glass').isVisible()
  };
  const front=page.locator('.glassopt[data-type="front"]');
  if(await front.count() && await front.isVisible()){
    await front.click();
    await page.waitForSelector('#screen-resultat:not(.hidden)',{timeout:15000});
    await page.waitForFunction(()=>document.querySelector('#btn-inquiry')?.disabled===false,{timeout:18000}).catch(()=>{});
  }else if(await get('btn-glass-hjelp').isVisible()){
    await get('btn-glass-hjelp').click();
  }
  const after={
    currentScreen:await page.locator('.screen:not(.hidden)').evaluateAll(els=>els.map(e=>e.id)),
    resultatKort:((await get('resultat-kort').textContent())||'').slice(0,260),
    resultatStatus:((await get('resultat-status').textContent())||'').slice(0,300),
    resultatOppsummering:((await get('resultat-oppsummering').textContent())||'').slice(0,260),
    resultatRegnr:((await get('resultat-regnr').textContent())||'').slice(0,120),
    btnInquiryDisabled:await get('btn-inquiry').isDisabled()
  };
  if(await get('btn-inquiry').isVisible()&&!after.btnInquiryDisabled)await get('btn-inquiry').click();
  const inquiry={
    visible:await get('inquiry-form').isVisible(),
    regnrValue:await get('inquiry-regnr').inputValue(),
    glassSummary:((await get('inquiry-glass-summary').textContent())||'').slice(0,220)
  };
  console.log('STAGING_UI_DIAGNOSTIC '+JSON.stringify({diagnostic:'v3-kustom-loader',dependencies,before,after,inquiry,responses,exceptions}));
}catch(e){
  console.log('STAGING_UI_DIAGNOSTIC_ERROR '+String(e.message).slice(0,240));
  console.log('STAGING_UI_LAST_RESPONSES '+JSON.stringify({responses,exceptions}));
  process.exitCode=1;
}finally{await page.close();await browser.close();}
