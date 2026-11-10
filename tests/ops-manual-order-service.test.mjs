import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import {
  recordCustomerAcceptance, createOrderFromAcceptedOffer, recordPortalPaymentLink
} from '../src/ops-manual-order.ts';

const offerId='offer_manual_001';
const orderId='order_manual_001';
const migration=readFileSync(new URL('../migrations/proposed/0040_ops_manual_offer_order.sql.proposed',import.meta.url),'utf8');

function fixture(){
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  sqlite.exec('CREATE TABLE beta_inquiries(id INTEGER PRIMARY KEY,navn TEXT NOT NULL)');
  sqlite.prepare('INSERT INTO beta_inquiries VALUES(1,?)').run('Syntetisk test');
  sqlite.exec(migration);
  sqlite.prepare(
    "INSERT INTO ops_manual_offers(offer_id,inquiry_id,version,sku,fitment_evidence_ref,"+
    "total_minor,delivery_note,created_by,created_at,status,sent_at) "+
    "VALUES (?,1,1,'GLASS-123','verified-evidence-001',215600,'Etter avtale','operator',1000,'SENT',2000)"
  ).run(offerId);
  function prepare(sql,args=[]){
    return {
      bind(...values){return prepare(sql,values)},
      async first(){return sqlite.prepare(sql).get(...args)??null},
      async run(){const res=sqlite.prepare(sql).run(...args);return {success:true,meta:{changes:Number(res.changes)}}}
    };
  }
  return {
    sqlite,db:{prepare(sql){return prepare(sql)}},
    order:()=>sqlite.prepare('SELECT * FROM ops_manual_orders').get(),
    offer:()=>sqlite.prepare('SELECT * FROM ops_manual_offers').get()
  };
}
const acceptance={
  offerId,actor:'operator',acceptedAt:2500,channel:'EMAIL',
  evidenceReference:'message-id:customer-accept-001'
};

test('manual service cannot create order until acceptance proof is written',async()=>{
  const f=fixture();
  try{
    await assert.rejects(createOrderFromAcceptedOffer(f.db,{offerId,orderId,actor:'operator',createdAt:2600}),
      /OPS_MANUAL_OFFER_NOT_ACCEPTED/);
    assert.equal(f.order(),undefined);
    assert.equal(f.offer().status,'SENT');
    const accepted=await recordCustomerAcceptance(f.db,acceptance);
    assert.deepEqual(accepted,{offerId,recorded:true});
    const replay=await recordCustomerAcceptance(f.db,acceptance);
    assert.deepEqual(replay,{offerId,recorded:false});
  }finally{f.sqlite.close();}
});
test('idempotent manual order remains same one even with a different retry orderId',async()=>{
  const f=fixture();
  try{
    await recordCustomerAcceptance(f.db,acceptance);
    const first=await createOrderFromAcceptedOffer(f.db,{offerId,orderId,actor:'operator',createdAt:3000});
    assert.equal(first.created,true);
    assert.equal(first.order.order_id,orderId);
    assert.equal(first.order.status,'ORDER_CREATED');
    const replay=await createOrderFromAcceptedOffer(f.db,{
      offerId,orderId:'retry_order_0002',actor:'operator',createdAt:3100
    });
    assert.equal(replay.created,false);
    assert.equal(replay.order.order_id,orderId);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM ops_manual_orders').get().n,1);
  }finally{f.sqlite.close();}
});
test('acceptance only accepts explicit customer evidence and cannot silently replace proof',async()=>{
  const f=fixture();
  try{
    await assert.rejects(recordCustomerAcceptance(f.db,{...acceptance,evidenceReference:'short'}),
      /OPS_MANUAL_ACCEPTANCE_EVIDENCE_REQUIRED/);
    await recordCustomerAcceptance(f.db,acceptance);
    await assert.rejects(recordCustomerAcceptance(f.db,{
      ...acceptance,evidenceReference:'different-customer-evidence'
    }),/OPS_MANUAL_OFFER_NOT_SENT_OR_ALREADY_CHANGED/);
    assert.equal(f.offer().acceptance_ref,acceptance.evidenceReference);
  }finally{f.sqlite.close();}
});
test('manual portal link is only recorded, not generated or sent, and requires existing order',async()=>{
  const f=fixture();
  const originalFetch=globalThis.fetch;
  let externalCalls=0;
  globalThis.fetch=async()=>{externalCalls++;throw new Error('NO_EXTERNAL_PROVIDER_POST')};
  try{
    assert.equal(await recordPortalPaymentLink(f.db,{
      orderId,reference:'kustom-portal-001',sentAt:3200
    }),false);
    await recordCustomerAcceptance(f.db,acceptance);
    await createOrderFromAcceptedOffer(f.db,{offerId,orderId,actor:'operator',createdAt:3000});
    assert.equal(await recordPortalPaymentLink(f.db,{orderId,reference:'kustom-portal-001',sentAt:3200}),true);
    assert.equal(await recordPortalPaymentLink(f.db,{orderId,reference:'kustom-portal-002',sentAt:3300}),false);
    assert.equal(f.order().payment_link_reference,'kustom-portal-001');
    assert.equal(f.order().status,'PAYMENT_LINK_SENT');
    assert.equal(externalCalls,0);
  }finally{globalThis.fetch=originalFetch;f.sqlite.close();}
});
