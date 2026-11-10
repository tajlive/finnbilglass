import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { sendQueuedOffer, reconcileOfferSend } from '../src/ops-offer-outbox.ts';

const schema = ['0040_ops_manual_offer_order','0041_ops_staff_invites_activity',
  '0044_ops_offer_outbox'].map(file=>readFileSync(new URL(
    '../migrations/proposed/'+file+'.sql.proposed',import.meta.url),'utf8'));

function fixture(){
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  sqlite.exec('CREATE TABLE beta_inquiries (id INTEGER PRIMARY KEY,navn TEXT, kontakt TEXT)');
  sqlite.exec('CREATE TABLE beta_inquiry_events (event_id TEXT PRIMARY KEY,inquiry_id INTEGER,event_type TEXT,note TEXT,created_at INTEGER,created_by TEXT,meta_json TEXT)');
  sqlite.prepare("INSERT INTO beta_inquiries(id,navn,kontakt) VALUES (1,'Syntetisk testkunde','synthetic@example.com')").run();
  for(const sql of schema)sqlite.exec(sql);
  const offerId='offer_0000000000000001';
  sqlite.prepare("INSERT INTO ops_manual_offers(offer_id,inquiry_id,version,sku,fitment_evidence_ref,equipment_json,total_minor,currency,delivery_note,status,created_by,created_at) VALUES(?,1,1,'GLASS-001','independent-oe-proof','{}',115000,'NOK','Avtalt frakt','DRAFT','admin@example.com',1000)").run(offerId);
  const offer={offer_id:offerId,inquiry_id:1,version:1,sku:'GLASS-001',total_minor:115000,
    delivery_note:'Avtalt frakt',navn:'Syntetisk testkunde',kontakt:'synthetic@example.com',status:'DRAFT'};
  const statement=(sql,args=[])=>({
    bind(...items){return statement(sql,items)},
    async first(){return sqlite.prepare(sql).get(...args)??null},
    async run(){const r=sqlite.prepare(sql).run(...args);return {meta:{changes:Number(r.changes)}}},
    async all(){return {results:sqlite.prepare(sql).all(...args)}}
  });
  const db={prepare:sql=>statement(sql),async batch(statements){
    sqlite.exec('BEGIN');
    try{
      const results=[];
      for(const s of statements)results.push(await s.run());
      sqlite.exec('COMMIT');
      return results;
    }catch(e){sqlite.exec('ROLLBACK');throw e}
  }};
  const env={FINNBILGLASS_DB:db,RESEND_API_KEY:'synthetic-resend-key',SUPPORT_FROM_EMAIL:'support@finnbilglass.no'};
  return {sqlite,offer,env,close(){sqlite.close()},
    outbox:()=>sqlite.prepare('SELECT * FROM ops_offer_outbox WHERE offer_id=?').get(offerId),
    sent:()=>sqlite.prepare('SELECT status FROM ops_manual_offers WHERE offer_id=?').get(offerId).status,
    eventCount:()=>sqlite.prepare('SELECT count(*) AS n FROM beta_inquiry_events').get().n,
    auditCount:()=>sqlite.prepare("SELECT count(*) AS n FROM ops_staff_activity WHERE action='OFFER_SENT'").get().n
  };
}
test('reserved synthetic staging addresses cannot queue or trigger Resend',async()=>{
  for(const contact of ['qa-inquiry-20261110@example.invalid','dummy@qa.test','qa@sub.example','qa@localhost']){
    const f=fixture(),oldFetch=globalThis.fetch;let sends=0;
    globalThis.fetch=async()=>{sends++;throw new Error('PROVIDER_CALL_FORBIDDEN')};
    try{
      const result=await sendQueuedOffer(f.env,{...f.offer,kontakt:contact},'admin@example.com');
      assert.equal(result.ok,false);
      assert.equal(result.status,'REJECTED');
      assert.equal(result.error,'TESTADRESSE_KAN_IKKE_MOTTA_TILBUD');
      assert.equal(f.outbox(),undefined,'No outbox payload may be queued for a reserved domain');
      assert.equal(f.sent(),'DRAFT');
      assert.equal(f.eventCount(),0);
      assert.equal(f.auditCount(),0);
      assert.equal(sends,0);
    }finally{globalThis.fetch=oldFetch;f.close()}
  }
});
test('one immutable D1 record before Resend, one send even on repeated clicks',async()=>{
 const f=fixture(),original=globalThis.fetch;let calls=0;
 globalThis.fetch=async(_url,options)=>{
   calls++;
   assert.equal(f.outbox().status,'SENDING');
   assert.equal(options.headers['Idempotency-Key'],f.outbox().request_id);
   return new Response(JSON.stringify({id:'resend_msg_001'}),{status:200});
 };
 try{
   const a=await sendQueuedOffer(f.env,f.offer,'admin@example.com');
   assert.equal(a.status,'SENT');assert.equal(a.ok,true);
   const b=await sendQueuedOffer(f.env,f.offer,'admin@example.com');
   assert.equal(b.alreadySent,true);assert.equal(calls,1);
   assert.equal(f.sent(),'SENT');assert.equal(f.outbox().status,'SENT');
   assert.equal(f.eventCount(),1);assert.equal(f.auditCount(),1);
   assert.throws(()=>f.sqlite.prepare("UPDATE ops_offer_outbox SET text_body='altered'").run(),/OFFER_SEND_PAYLOAD_IMMUTABLE/);
 }finally{globalThis.fetch=original;f.close()}
});
test('unknown Resend result blocks retries permanently, including beyond 24 hours',async()=>{
 const f=fixture(),original=globalThis.fetch;let calls=0;
 globalThis.fetch=async()=>{calls++;throw new Error('uncertain network timeout')};
 try{
   const a=await sendQueuedOffer(f.env,f.offer,'admin@example.com');
   assert.equal(a.status,'REVIEW');assert.equal(a.requiresReview,true);
   const b=await sendQueuedOffer(f.env,f.offer,'admin@example.com');
   assert.equal(b.status,'REVIEW');assert.equal(calls,1);
   assert.equal(f.sent(),'DRAFT');assert.equal(f.eventCount(),0);
 }finally{globalThis.fetch=original;f.close()}
});
test('reconciliation uses only Resend GET, validates matching message and records audit',async()=>{
 const f=fixture(),original=globalThis.fetch;const requests=[];
 globalThis.fetch=async(url,options)=>{
   requests.push([url,options]);
   if(options?.method==='POST')throw new Error('send must fail');
   return new Response(JSON.stringify({id:'resend_msg_001',to:['synthetic@example.com'],
     subject:'Tilbud på bilglass – sak 1, versjon 1'}),{status:200});
 };
 try{
   // Simulate ambiguous status already persisted by the previous run.
   f.sqlite.prepare("INSERT INTO ops_offer_outbox(offer_id,inquiry_id,request_id,recipient,subject,text_body,html_body,status,created_at,updated_at) VALUES(?,1,'ops-offer-001','synthetic@example.com','Tilbud på bilglass – sak 1, versjon 1','Hei','<p>Hei</p>','REVIEW',1000,1000)").run(f.offer.offer_id);
   const mismatch=await reconcileOfferSend(f.env,f.offer.offer_id,'admin@example.com','invalid-id-not-found');
   assert.equal(mismatch.ok,false);
   const ok=await reconcileOfferSend(f.env,f.offer.offer_id,'admin@example.com','resend_msg_001');
   assert.equal(ok.status,'SENT');assert.equal(f.sent(),'SENT');
   assert.equal(f.eventCount(),1);assert.equal(f.auditCount(),1);
   assert.equal(requests.every(([url,opt])=>String(url).startsWith('https://api.resend.com/emails/')&&!opt.method),true);
 }finally{globalThis.fetch=original;f.close()}
});
test('concurrent clicks can reserve at most one provider send',async()=>{
 const f=fixture(),original=globalThis.fetch;let calls=0;
 globalThis.fetch=async()=>{calls++;await new Promise(resolve=>setTimeout(resolve,8));
   return new Response(JSON.stringify({id:'resend_msg_concurrent'}),{status:200})};
 try{
   const [a,b]=await Promise.all([
     sendQueuedOffer(f.env,f.offer,'admin@example.com'),
     sendQueuedOffer(f.env,f.offer,'admin@example.com')
   ]);
   assert.equal(calls,1);
   assert.equal([a.status,b.status].includes('SENT'),true);
   assert.equal(f.outbox().status,'SENT');assert.equal(f.eventCount(),1);
 }finally{globalThis.fetch=original;f.close()}
});
