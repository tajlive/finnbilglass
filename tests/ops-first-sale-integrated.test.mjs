import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { sendQueuedOffer } from '../src/ops-offer-outbox.ts';
import {
  recordCustomerAcceptance, createOrderFromAcceptedOffer, recordPortalPaymentLink
} from '../src/ops-manual-order.ts';

// Entirely offline, synthetic integration. No Cloudflare, customer, Kustom or Resend network.
const migrationNames=['0040_ops_manual_offer_order','0041_ops_staff_invites_activity','0044_ops_offer_outbox'];
const migrations=migrationNames.map(name=>readFileSync(
  new URL('../migrations/proposed/'+name+'.sql.proposed',import.meta.url),'utf8'
));
const OFFER_ID='offer_first_sale_0001';
const ORDER_ID='order_first_sale_0001';
const ACTOR='operator@synthetic.invalid';

function fixture() {
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  sqlite.exec('CREATE TABLE beta_inquiries(id INTEGER PRIMARY KEY,navn TEXT,kontakt TEXT,status TEXT)');
  sqlite.exec('CREATE TABLE beta_inquiry_events(event_id TEXT PRIMARY KEY,inquiry_id INTEGER,event_type TEXT,previous_status TEXT,status TEXT,note TEXT,created_at INTEGER,created_by TEXT,meta_json TEXT)');
  sqlite.prepare("INSERT INTO beta_inquiries VALUES(99,'Historic offline case','archived@synthetic.invalid','CLOSED')").run();
  sqlite.prepare("INSERT INTO beta_inquiry_events VALUES('historic-1',99,'created',NULL,'CLOSED','Historic note',1,'operator','{}')").run();
  sqlite.prepare("INSERT INTO beta_inquiries VALUES(1,'Synthetic staging case','never-deliver@acceptance-fixture.org','NEW')").run();
  for(const schema of migrations)sqlite.exec(schema);
  const now=Date.now();
  sqlite.prepare(
    "INSERT INTO ops_manual_offers(offer_id,inquiry_id,version,sku,fitment_evidence_ref," +
    "equipment_json,total_minor,currency,delivery_note,status,created_by,created_at) " +
    "VALUES(?,1,1,'UTEN-VARENUMMER',?,?,?,?,?,'DRAFT',?,?)"
  ).run(OFFER_ID,'synthetic-independent-photo-proof-001',
    JSON.stringify({offerProduct:{name:'Synthetic VW Transporter glass',
      description:'With rain sensor',partNumber:null,source:'MANUAL'}}),
    249000,'NOK','Synthetic delivery, including freight',ACTOR,now-5000);
  const statement=(sql,args=[])=>({
    sql,args,
    bind(...items){return statement(sql,items)},
    async first(){return sqlite.prepare(sql).get(...args)??null},
    async all(){return {results:sqlite.prepare(sql).all(...args)}},
    async run(){const r=sqlite.prepare(sql).run(...args);return {meta:{changes:Number(r.changes)}}}
  });
  const db={
    prepare(sql){return statement(sql)},
    async batch(statements){
      sqlite.exec('BEGIN IMMEDIATE');
      try{
        const results=[];
        for(const s of statements){
          const r=sqlite.prepare(s.sql).run(...s.args);
          results.push({meta:{changes:Number(r.changes)}});
        }
        sqlite.exec('COMMIT');
        return results;
      }catch(e){sqlite.exec('ROLLBACK');throw e}
    }
  };
  const env={FINNBILGLASS_DB:db,RESEND_API_KEY:'synthetic-never-used',
    SUPPORT_FROM_EMAIL:'support@finnbilglass.no'};
  const offer=()=>sqlite.prepare(
    'SELECT o.*,i.navn,i.kontakt FROM ops_manual_offers o JOIN beta_inquiries i ON i.id=o.inquiry_id WHERE o.offer_id=?'
  ).get(OFFER_ID);
  const historical=()=>({
    inquiry:sqlite.prepare('SELECT id,navn,kontakt,status FROM beta_inquiries WHERE id=99').get(),
    events:sqlite.prepare('SELECT * FROM beta_inquiry_events WHERE inquiry_id=99').all()
  });
  return {sqlite,env,db,offer,historical,
    order:()=>sqlite.prepare('SELECT * FROM ops_manual_orders WHERE offer_id=?').get(OFFER_ID),
    count:(table)=>sqlite.prepare('SELECT COUNT(*) AS n FROM '+table).get().n,
    close(){sqlite.close()}};
}

test('complete synthetic first sale: inquiry > offer > accept > one order > manual portal reference',async()=>{
  const f=fixture();
  const savedHistory=structuredClone(f.historical());
  const originalFetch=globalThis.fetch;
  let providerCalls=0;
  globalThis.fetch=async(url,options)=>{
    assert.equal(String(url),'https://api.resend.com/emails');
    assert.equal(options.method,'POST');
    providerCalls++;
    const payload=JSON.parse(options.body);
    assert.equal(payload.to[0],'never-deliver@acceptance-fixture.org');
    assert.doesNotMatch(payload.text,/UTEN-VARENUMMER/);
    assert.match(payload.text,/Synthetic VW Transporter glass/);
    assert.match(payload.text,/2490\.00 NOK/);
    return new Response(JSON.stringify({id:'resend-synthetic-offer-001'}),{status:200});
  };
  try{
    assert.equal(f.order(),undefined,'Inquiry must not create order');
    await assert.rejects(
      createOrderFromAcceptedOffer(f.db,{offerId:OFFER_ID,orderId:ORDER_ID,
        actor:ACTOR,createdAt:Date.now(),audit:true}),
      /OPS_MANUAL_OFFER_NOT_ACCEPTED/
    );
    const sent=await sendQueuedOffer(f.env,f.offer(),ACTOR);
    assert.equal(sent.ok,true);
    assert.equal(sent.status,'SENT');
    assert.equal(providerCalls,1);
    assert.equal(f.offer().status,'SENT');
    assert.equal(f.order(),undefined,'SENT is not customer acceptance');
    const resubmit=await sendQueuedOffer(f.env,f.offer(),ACTOR);
    assert.equal(resubmit.alreadySent,true);
    assert.equal(providerCalls,1,'Resending same offer must be a no-op');
    await assert.rejects(
      createOrderFromAcceptedOffer(f.db,{offerId:OFFER_ID,orderId:ORDER_ID,
        actor:ACTOR,createdAt:Date.now(),audit:true}),
      /OPS_MANUAL_OFFER_NOT_ACCEPTED/
    );
    const acceptedAt=Date.now()+1000;
    const acceptance={offerId:OFFER_ID,actor:ACTOR,acceptedAt,channel:'EMAIL',
      evidenceReference:'synthetic-customer-acceptance-mail-0001',audit:true};
    assert.equal((await recordCustomerAcceptance(f.db,acceptance)).recorded,true);
    assert.equal((await recordCustomerAcceptance(f.db,acceptance)).recorded,false);
    const created=await createOrderFromAcceptedOffer(f.db,{
      offerId:OFFER_ID,orderId:ORDER_ID,actor:ACTOR,createdAt:acceptedAt+1000,audit:true
    });
    assert.equal(created.created,true);
    assert.equal(created.order.total_minor,249000);
    const retry=await createOrderFromAcceptedOffer(f.db,{
      offerId:OFFER_ID,orderId:'retry_order_first_sale_0002',
      actor:ACTOR,createdAt:acceptedAt+2000,audit:true
    });
    assert.equal(retry.created,false);
    assert.equal(retry.order.order_id,ORDER_ID);
    assert.equal(f.count('ops_manual_orders'),1);
    assert.equal(await recordPortalPaymentLink(f.db,{
      orderId:ORDER_ID,reference:'portal-manual-reference-0001',
      sentAt:acceptedAt+3000,actor:ACTOR,audit:true}),true);
    assert.equal(await recordPortalPaymentLink(f.db,{
      orderId:ORDER_ID,reference:'portal-manual-reference-0002',
      sentAt:acceptedAt+4000,actor:ACTOR,audit:true}),false);
    assert.equal(f.order().status,'PAYMENT_LINK_SENT','A link is not a payment');
    assert.equal(f.order().payment_verified_at,null,'No payment proof was created');
    assert.equal(f.count('ops_manual_orders'),1);
    assert.equal(f.count('ops_offer_outbox'),1);
    assert.equal(f.count('ops_staff_activity'),4,'Send, accept, order and portal reference');
    assert.equal(f.count('beta_inquiry_events'),2,'Historic event and new offer');
    assert.equal(providerCalls,1);
    assert.deepEqual(f.historical(),savedHistory,'Old case and history unchanged');
    assert.equal(f.sqlite.prepare('PRAGMA foreign_key_check').all().length,0);
  }finally{globalThis.fetch=originalFetch;f.close()}
});
