import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCommercial, commercialRoute } from '../src/inquiry-commercial';
import worker from '../src/index';
import { commercialDb } from './commercial-db.mjs';
const input = { eventId:'aaaaaaaa-bbbb-cccc-dddd',version:0,stage:'PAID',delivery:'GLASS_ONLY',source:'WEB',followUp:'',paidOn:'2026-09-01',revenueOre:500000,directCostOre:200000,incremental:true,attribution:'Kunden ville ellers ringt videre.',note:'Betaling kontrollert.',actor:'Tester' };
const request = body => new Request('https://finnbilglass.test/api/ops/inquiries/1/commercial',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
test('money, dates, source and attribution validated without changing fitment',()=>{
 assert.equal(validateCommercial(input).revenueOre,500000);
 for(const patch of [{revenueOre:1.2},{directCostOre:-1},{paidOn:''},{paidOn:'2026-02-30'},{attribution:''},{source:'untrusted'},{actor:''}]) assert.throws(()=>validateCommercial({...input,...patch}));
});
test('append-only ledger, retries, source lock, concurrent edits and summary exclude demos',async()=>{
 const {db,sqlite}=commercialDb();
 try{
 assert.equal((await commercialRoute(request(input),db,1)).status,201);
 assert.equal((await commercialRoute(request(input),db,1)).status,200);
 assert.equal((await commercialRoute(request({...input,revenueOre:700000}),db,1)).status,409);
 assert.equal((await commercialRoute(request({...input,eventId:'another-aaaaaaaa-bbbb'}),db,1)).status,409);
 assert.equal((await commercialRoute(request({...input,version:1,eventId:'source-change-aaaaaa',source:'DEMO'}),db,1)).status,400);
 assert.equal((await commercialRoute(request({...input,eventId:'demo-aaaaaaaa-bbbbbb',source:'DEMO',revenueOre:99999999}),db,2)).status,201);
 const summary=await (await commercialRoute(new Request('https://finnbilglass.test/api/ops/commercial'),db,null)).json();
 assert.equal(summary.totals.paid,1);assert.equal(summary.totals.revenueOre,500000);assert.equal(summary.totals.incrementalOre,300000);assert.equal(summary.totals.demos,1);
 assert.equal((await commercialRoute(request({...input,version:1,eventId:'correction-aaaaaaaa',stage:'LOST'}),db,1)).status,201);
 assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM inquiry_commercial_events WHERE inquiry_id=1').get().n,2);
 assert.equal(sqlite.prepare('SELECT status FROM beta_inquiries WHERE id=1').get().status,'CONFIRMED');
 const after=await (await commercialRoute(new Request('https://finnbilglass.test/api/ops/commercial'),db,null)).json();assert.equal(after.totals.paid,0);
 }finally{sqlite.close()}
});
test('routes keep existing support authentication and environment gates',async()=>{
 const {db,sqlite}=commercialDb();
 try{
 const env={ENVIRONMENT:'staging',FINNBILGLASS_DB:db,SUPPORT_EVIDENCE_TOKEN:'test-only-token'};
 for(const path of ['/api/ops/commercial','/api/ops/inquiries/1/commercial']){
  const req=new Request('https://finnbilglass.test'+path);
  assert.equal((await worker.fetch(req,env)).status,401);
  const authed=new Request(req,{headers:{Authorization:'Bearer test-only-token'}});
  assert.equal((await worker.fetch(authed,env)).status,200);
  assert.equal((await worker.fetch(authed,{...env,ENVIRONMENT:'dev'})).status,404);
 }
 const bad=request(input);assert.equal((await worker.fetch(bad,env)).status,401);
 }finally{sqlite.close()}
});
test('parallel revisions allow only one write and oversized requests fail',async()=>{
 const {db,sqlite}=commercialDb();
 try{
 const results=await Promise.all([commercialRoute(request(input),db,1),commercialRoute(request({...input,eventId:'parallel-aaaaaaaaaaa'}),db,1)]);
 assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);
 assert.equal((await commercialRoute(request({...input,note:'x'.repeat(9000)}),db,1)).status,413);
 assert.equal((await commercialRoute(request(input),db,99)).status,404);
 }finally{sqlite.close()}
});
