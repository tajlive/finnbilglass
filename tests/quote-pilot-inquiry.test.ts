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
  const response=await worker.fetch(new Request('https://test.invalid/api/inquiry',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({regnr:'TEST',navn:'<Test & kunde>',kontakt:'kunde@example.test',melding:'Test only'})}),{ENVIRONMENT:'production',inquiries_enabled:'true',FINNBILGLASS_DB:db,RESEND_API_KEY:'re_test',SUPPORT_NOTIFY_EMAIL:'support-inbox@example.test'} as any,{waitUntil:(p:Promise<unknown>)=>background.push(p)} as any);
  assert.equal(response.status,201);
  await Promise.all(background);
  const receipt = sent.find((mail) => (mail.to || []).includes('kunde@example.test'));
  assert.ok(receipt, 'customer receipt should be sent to the supplied email');
  assert.equal(receipt.from, 'Finnbilglass <support@finnbilglass.no>');
  assert.match(receipt.subject, /#314/);
  assert.equal(receipt.reply_to, 'support-inbox@example.test');
  assert.match(receipt.html, /&lt;Test &amp; kunde&gt;/);
  assert.match(receipt.html, /kjøretøyet TEST/);
  assert.match(receipt.html, /Vi leverer glasset\. Montering avtaler du selv med et verksted\./);
  assert.match(receipt.text, /ikke en ordrebekreftelse/);
  assert.ok(!sent.some((m) => m.headers || m.htmlContent), 'ingen Brevo-format igjen');
 } finally { globalThis.fetch = originalFetch; }
});

test('receipt goes only through Resend - a rejected send is logged, never retried via Brevo', async () => {
 const calls: {url:string; body:any}[] = [];
 const originalFetch = globalThis.fetch;
 const feil: string[] = [];
 const origError = console.error;
 console.error = (...args: any[]) => { feil.push(args.join(' ')); };
 globalThis.fetch = (async (input:any, init?:any) => {
  const url = String(input);
  calls.push({ url, body: init?.body ? JSON.parse(init.body) : null });
  if (url.includes('api.resend.com')) return new Response('{"message":"domain is not verified"}', { status: 403 });
  return new Response('', { status: 201 });
 }) as any;
 const db={prepare(_sql:string){let args:unknown[]=[];return {sql:_sql,get args(){return args;},bind(...values:unknown[]){args=values;return this;},first:async()=>null,all:async()=>({results:[]}),run:async()=>({meta:{changes:1}})};},async batch(){return [{meta:{last_row_id:314}},{meta:{changes:1}}];}};
 const background: Promise<unknown>[] = [];
 try {
  const response=await worker.fetch(new Request('https://test.invalid/api/inquiry',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({regnr:'TEST',navn:'Resend Test',kontakt:'kunde@example.test',melding:'Test'})}),{ENVIRONMENT:'production',inquiries_enabled:'true',FINNBILGLASS_DB:db,RESEND_API_KEY:'re_test',SUPPORT_NOTIFY_EMAIL:'svar@finnbilglass.no'} as any,{waitUntil:(p:Promise<unknown>)=>background.push(p)} as any);
  assert.equal(response.status,201);
  await Promise.all(background);
  assert.ok(calls.some((c) => c.url.includes('api.resend.com')), 'Resend brukes');
  assert.ok(!calls.some((c) => c.url.includes('api.brevo.com')), 'Brevo skal ikke brukes lenger');
  assert.ok(feil.some((f) => /kvittering/i.test(f)), 'feil skal logges');
 } finally { globalThis.fetch = originalFetch; console.error = origError; }
});

test('receipt summarises what the customer submitted and uses one reply address', async () => {
 const sent: any[] = [];
 const originalFetch = globalThis.fetch;
 globalThis.fetch = (async (_i:any, init?:any) => { sent.push(JSON.parse(init.body)); return new Response('', { status: 201 }); }) as any;
 const db={prepare(sql:string){let args:unknown[]=[];return {sql,get args(){return args;},bind(...v:unknown[]){args=v;return this;},first:async()=>null,all:async()=>({results:[]}),run:async()=>({meta:{changes:1}})};},async batch(){return [{meta:{last_row_id:501}},{meta:{changes:1}}];}};
 const background: Promise<unknown>[] = [];
 try {
  const response = await worker.fetch(new Request('https://test.invalid/api/inquiry',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({regnr:'TEST12345',navn:'Kari Nordmann',kontakt:'kunde@example.test',leveringssted:'Trondheim',glassRequest:{selection:{kind:'door',side:'left',door:'front'}}})}),{ENVIRONMENT:'production',inquiries_enabled:'true',FINNBILGLASS_DB:db,RESEND_API_KEY:'k',SUPPORT_EPOST:'svar@finnbilglass.no'} as any,{waitUntil:(p:Promise<unknown>)=>background.push(p)} as any);
  assert.equal(response.status,201);
  await Promise.all(background);
  // Resend bruker to: [adresse].
  const adresser = (m: any) => (m.to || []).map((t: any) => (typeof t === 'string' ? t : t.email));
  const receipt = sent.find((m) => adresser(m).includes('kunde@example.test'));
  assert.ok(receipt, 'kvittering skal sendes');
  assert.equal(receipt.reply_to, 'svar@finnbilglass.no');
  assert.match(receipt.text, /Dette har vi mottatt/);
  assert.match(receipt.text, /Bil: TEST12345/);
  assert.match(receipt.text, /Glass\/plassering: Dørrute · fremre dør · venstre side/);
  assert.match(receipt.text, /Ønsket leveringssted: Trondheim/);
  assert.match(receipt.text, /svar@finnbilglass\.no/);
  assert.doesNotMatch(receipt.text, /ordrebekreftelse\s*\./);
 } finally { globalThis.fetch = originalFetch; }
});
