/** One-car, no-write UI trace for staging. Does not submit inquiries or call money endpoints. */
import { chromium } from 'playwright';
const base='https://finnbilglass-frontrute-staging.tomarnejensen.workers.dev';
const browser=await chromium.launch();
const page=await browser.newPage({viewport:{width:393,height:852}});
const exceptions=[],responses=[];
page.on('pageerror',e=>exceptions.push(String(e.message).slice(0,160)));
page.on('response',r=>{const u=new URL(r.url());if(u.pathname.startsWith('/api/'))responses.push({path:u.pathname,status:r.status()})});
await page.route('**/api/opplaering',route=>route.fulfill({status:204,body:''}));
function get(id){return page.locator('#'+id)}
try{
  await page.goto(base,{waitUntil:'domcontentloaded'});
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
  console.log('STAGING_UI_DIAGNOSTIC '+JSON.stringify({before,after,inquiry,responses,exceptions}));
}catch(e){
  console.log('STAGING_UI_DIAGNOSTIC_ERROR '+String(e.message).slice(0,240));
  console.log('STAGING_UI_LAST_RESPONSES '+JSON.stringify({responses,exceptions}));
  process.exitCode=1;
}finally{await page.close();await browser.close();}
