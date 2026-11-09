/** One isolated synthetic staging inquiry: no real customer, no checkout or capture.
 * The form is the public inquiry path; all later sales remain manual in Ops.
 */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const base='https://finnbilglass-frontrute-staging.tomarnejensen.workers.dev';
if (process.env.FBG_STAGING_INQUIRY_TEST !== '1' ||
    new URL(base).hostname !== 'finnbilglass-frontrute-staging.tomarnejensen.workers.dev') {
  throw new Error('STAGING_ONLY_TEST_DISABLED');
}
const browser=await chromium.launch();
const page=await browser.newPage({viewport:{width:393,height:852}});
let inquiryPosts=0, inquiryHttp=null, paymentPosts=0;
page.on('request',request=>{
  const path=new URL(request.url()).pathname;
  if(path==='/api/inquiry' && request.method()==='POST') inquiryPosts++;
  if(/\/(api\/kustom|api\/stripe|api\/ops\/kustom)/.test(path) && request.method()==='POST') paymentPosts++;
});
await page.route('**/api/opplaering',route=>route.fulfill({status:204,body:''}));
try {
  await page.goto(base,{waitUntil:'domcontentloaded',timeout:20000});
  await page.locator('#input-regnr').fill('CV80776');
  await page.locator('#form-regnr button[type=submit]').click();
  await page.waitForSelector('#screen-glass:not(.hidden)',{timeout:17000});
  await page.waitForSelector('.glassopt[data-type="front"]',{timeout:15000});
  await page.locator('.glassopt[data-type="front"]').click();
  await page.waitForSelector('#screen-resultat:not(.hidden)',{timeout:15000});
  await page.waitForFunction(()=>document.querySelector('#btn-inquiry')?.disabled===false,{timeout:15000});
  await page.locator('#btn-inquiry').click();
  await page.waitForSelector('#inquiry-form:not(.hidden)',{timeout:7000});
  const reg=(await page.locator('#inquiry-regnr').inputValue()).replace(/[^A-Z0-9]/gi,'');
  assert.equal(reg,'CV80776');
  await page.locator('#inquiry-navn').fill('Test Automatisk stagingtest');
  await page.locator('#inquiry-kontaktpreferanse').selectOption('epost');
  await page.locator('#inquiry-kontakt').fill('post@finnbilglass.no');
  await page.locator('#inquiry-melding').fill('Syntetisk QA test i staging. Ikke behandle som kundeordre.');
  const pending=page.waitForResponse(response=>{
    const u=new URL(response.url());
    return u.pathname==='/api/inquiry' && response.request().method()==='POST';
  },{timeout:20000});
  await page.locator('#btn-inquiry-send').click();
  inquiryHttp=(await pending).status();
  if(inquiryHttp!==200 && inquiryHttp!==201) {
    const err=(await page.locator('#inquiry-feil').textContent()||'').slice(0,180);
    throw new Error('STAGING_INQUIRY_HTTP_'+inquiryHttp+' '+err);
  }
  await page.waitForSelector('#inquiry-bekreftet:not(.hidden)',{timeout:12000});
  assert.equal(inquiryPosts,1,'Only one synthetic inquiry may be submitted');
  assert.equal(paymentPosts,0,'No checkout, capture or refund API may be called');
  const visible=await page.locator('#inquiry-bekreftet').isVisible();
  assert.equal(visible,true);
  console.log('STAGING_SYNTHETIC_INQUIRY '+JSON.stringify({
    outcome:'CONFIRMED',inquiryHttp,inquiryPosts,paymentPosts,
    vehicle:'CV80776',contact:'designated staging mailbox',
    didNotCreateCheckout:true
  }));
} catch(e) {
  console.log('STAGING_SYNTHETIC_INQUIRY_ERROR '+JSON.stringify({
    reason:String(e.message).slice(0,260),inquiryHttp,inquiryPosts,paymentPosts
  }));
  process.exitCode=1;
}finally {
  await page.close();await browser.close();
}
