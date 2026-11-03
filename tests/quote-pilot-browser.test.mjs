import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {chromium} from 'playwright';
import worker from '../src/index.ts';
test('Chrome: six glass selections reach real local inquiry handler',async()=>{
 const notes=[];
 const db={prepare(sql){let args=[];return {sql,get args(){return args;},bind(...v){args=v;return this;},first:async()=>null,all:async()=>({results:[]}),run:async()=>({meta:{changes:1}})};},async batch(s){notes.push(s[0].args[3]);return [{meta:{last_row_id:notes.length}},{meta:{changes:1}}];}};
 const env={ENVIRONMENT:'production',inquiries_enabled:'true',FINNBILGLASS_DB:db};
 const server=createServer(async(req,res)=>{try{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/api/regnr'){res.setHeader('content-type','application/json');res.end(JSON.stringify({ok:true,bil:{merke:'VW',modell:'SYNTHETIC',aar:2020},resolver:null}));return;}
  if(url.pathname.startsWith('/api/')){let data='';for await(const chunk of req)data+=chunk;const result=await worker.fetch(new Request(url,{method:req.method,headers:req.headers,body:data||undefined}),env,{waitUntil(){}});res.writeHead(result.status,Object.fromEntries(result.headers));res.end(await result.text());return;}
  const root=resolve('public');const file=resolve(root,'.'+(url.pathname==='/'?'/index.html':url.pathname));if(!file.startsWith(root+'/'))throw Error('path');const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png'};res.setHeader('content-type',types[extname(file)]||'application/octet-stream');res.end(await readFile(file));
 }catch(e){res.writeHead(500);res.end(String(e));}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{const page=await browser.newPage();
 for(const kind of ['front','door','side','rear','ventil','roof']){
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.locator('#input-regnr').fill('AB12345');await page.locator('#form-regnr button').click();
  await page.locator(`.glassopt[data-type="${kind}"]`).click();
  if(kind!=='front'){for(const field of await page.locator('#glass-placement-fields select').all()){if(await field.isVisible())await field.selectOption('unknown');}await page.locator('#btn-glass-search').click();}
  await page.locator('#btn-inquiry').waitFor({state:'visible'});await page.locator('#btn-inquiry').click();
  await page.locator('#inquiry-navn').fill('Synthetic Test');await page.locator('#inquiry-kontakt').fill('12345678');await page.locator('#btn-inquiry-send').click();
  await page.locator('#inquiry-bekreftet').waitFor({state:'visible'});
  assert.match(notes.at(-1),/Glassvalg:/);assert.match(notes.at(-1),new RegExp(`"kind":"${kind==='front'?'windshield':kind}"`));
 }
 assert.equal(notes.length,6);
 }finally{await browser.close();await new Promise(r=>server.close(r));}
});
