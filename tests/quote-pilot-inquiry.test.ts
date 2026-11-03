import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
test('manual quote persists the selected glass in the operator note using existing schema',async()=>{
 let inserted:any[]=[];
 const db={prepare(sql:string){let args:unknown[]=[];return {sql, get args(){return args;},bind(...values:unknown[]){args=values;return this;},first:async()=>null,all:async()=>({results:[]}),run:async()=>({meta:{changes:1}})};},async batch(statements:any[]){inserted=statements;return [{meta:{last_row_id:42}},{meta:{changes:1}}];}};
 const selection={kind:'ventil',side:'left',placement:'rear'};
 const response=await worker.fetch(new Request('https://test.invalid/api/inquiry',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({regnr:'TEST',navn:'Synthetic Test',kontakt:'test@example.invalid',melding:'Test only',glassRequest:{schemaVersion:1,selection}})}),{ENVIRONMENT:'production',inquiries_enabled:'true',FINNBILGLASS_DB:db} as any,{waitUntil:()=>{}} as any);
 assert.equal(response.status,201,await response.clone().text());
 const statement=inserted.find(s=>s.sql.includes('INSERT INTO beta_inquiries'));
 assert.ok(statement);assert.match(statement.args[3],/"kind":"ventil"/);assert.match(statement.args[3],/"placement":"rear"/);
});

test('idempotency detects changed glass, equipment answers and second phone',async()=>{
 let reservation:any=null;let saves=0;let note='';
 const db={prepare(sql:string){let args:any[]=[];return {sql,get args(){return args;},bind(...v:any[]){args=v;return this;},async first(){return sql.includes('FROM inquiry_idempotency')?reservation:null;},async all(){return {results:[]};},async run(){
 if(sql.includes('INSERT INTO inquiry_idempotency')){if(reservation)return {meta:{changes:0}};reservation={request_hash:args[1],created_at:args[2],state:'PENDING',inquiry_id:null};}
 if(sql.includes("SET inquiry_id = ?, state = 'DONE'"))Object.assign(reservation,{state:'DONE',inquiry_id:args[0]});
 return {meta:{changes:1}};
 }};},async batch(statements:any[]){saves++;note=statements[0].args[3];return [{meta:{last_row_id:42}},{meta:{changes:1}}];}};
 const body={regnr:'TEST',navn:'Synthetic Test',kontakt:'test@example.invalid',melding:'Note',contactPreference:'begge',contactPhone:'12345678',glassRequest:{selection:{kind:'windshield'},answers:{sensor:'ja'}}};
 async function send(value:any){return worker.fetch(new Request('https://test.invalid/api/inquiry',{method:'POST',headers:{'content-type':'application/json','Idempotency-Key':'synthetic-key-123'},body:JSON.stringify(value)}),{ENVIRONMENT:'production',inquiries_enabled:'true',FINNBILGLASS_DB:db} as any,{waitUntil:()=>{}} as any);}
 assert.equal((await send(body)).status,201);assert.match(note,/"sensor":"ja"/);assert.match(note,/12345678/);
 assert.equal((await send(body)).status,201);assert.equal(saves,1);
 assert.equal((await send({...body,contactPhone:'87654321'})).status,409);
 assert.equal((await send({...body,glassRequest:{selection:{kind:'rear',layout:'single'}}})).status,409);
 assert.equal((await send({...body,glassRequest:{...body.glassRequest,answers:{sensor:'nei'}}})).status,409);
 assert.equal(saves,1);
});

test('newly saved inquiry schedules an escaped customer receipt for email contact only', async () => {
 const sent: any[] = [];
 const originalFetch = globalThis.fetch;
 globalThis.fetch = (async (_input: any, init?: any) => {
  sent.push(JSON.parse(init.body));
  return new Response('', { status: 201 });
 }) as any;
 const db={prepare(sql:string){let args:unknown[]=[];return {sql,get args(){return args;},bind(...values:unknown[]){args=values;return this;},first:async()=>null,all:async()=>({results:[]}),run:async()=>({meta:{changes:1}})};},async batch(){return [{meta:{last_row_id:314}},{meta:{changes:1}}];}};
 const background: Promise<unknown>[] = [];
 try {
  const response=await worker.fetch(new Request('https://test.invalid/api/inquiry',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({regnr:'TEST',navn:'<Test & kunde>',kontakt:'kunde@example.test',melding:'Test only'})}),{ENVIRONMENT:'production',inquiries_enabled:'true',FINNBILGLASS_DB:db,BREVO_API_KEY:'synthetic-key',SUPPORT_NOTIFY_EMAIL:'support-inbox@example.test'} as any,{waitUntil:(p:Promise<unknown>)=>background.push(p)} as any);
  assert.equal(response.status,201);
  await Promise.all(background);
  const receipt = sent.find((mail) => mail.to?.[0]?.email === 'kunde@example.test');
  assert.ok(receipt, 'customer receipt should be sent to the supplied email');
  assert.deepEqual(receipt.to, [{ email:'kunde@example.test', name:'<Test & kunde>' }]);
  assert.match(receipt.subject, /#314/);
  assert.deepEqual(receipt.replyTo, { email:'support-inbox@example.test', name:'Finnbilglass' });
  assert.deepEqual(receipt.headers, { 'List-Help':'<https://finnbilglass.no/om-oss>' });
  assert.match(receipt.htmlContent, /&lt;Test &amp; kunde&gt;/);
  assert.match(receipt.htmlContent, /kjøretøyet TEST/);
  assert.match(receipt.htmlContent, /Vi leverer glasset\. Montering avtaler du selv med et verksted\./);
  assert.match(receipt.textContent, /ikke en ordrebekreftelse/);
 } finally { globalThis.fetch = originalFetch; }
});
