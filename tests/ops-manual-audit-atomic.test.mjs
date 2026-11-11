import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import {
  recordCustomerAcceptance,createOrderFromAcceptedOffer,recordPortalPaymentLink
} from '../src/ops-manual-order.ts';

const SCHEMA=readFileSync(new URL('../migrations/proposed/0040_ops_manual_offer_order.sql.proposed',import.meta.url),'utf8');
const OFFER='offer_manual_001',ORDER='order_manual_001';
const ACCEPT={offerId:OFFER,actor:'operator@example.test',acceptedAt:2500,
  channel:'EMAIL',evidenceReference:'synthetic-acceptance-proof-001'};

function setup() {
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  sqlite.exec("CREATE TABLE beta_inquiries(id INTEGER PRIMARY KEY,navn TEXT)");
  sqlite.prepare("INSERT INTO beta_inquiries VALUES(1,'Synthetic')").run();
  sqlite.exec(SCHEMA);
  sqlite.exec("CREATE TABLE ops_staff_activity(event_id TEXT PRIMARY KEY,actor_email TEXT NOT NULL,action TEXT NOT NULL,subject_type TEXT NOT NULL,subject_id TEXT NOT NULL,created_at INTEGER NOT NULL,details_json TEXT NOT NULL)");
  sqlite.prepare("INSERT INTO ops_manual_offers(offer_id,inquiry_id,version,sku,fitment_evidence_ref,total_minor,delivery_note,created_by,created_at,status,sent_at) VALUES (?,1,1,'GLASS-123','independent-evidence-001',215600,'Synthetic delivery','operator@example.test',1000,'SENT',2000)").run(OFFER);
  function prep(sql,args=[]){
    return {
      sql,args,
      bind(...a){return prep(sql,a)},
      async first(){return sqlite.prepare(sql).get(...args)??null},
      async run(){const r=sqlite.prepare(sql).run(...args);return {meta:{changes:Number(r.changes)}}}
    };
  }
  const db={
    prepare(sql){return prep(sql)},
    async batch(statements){
      sqlite.exec('BEGIN IMMEDIATE');
      try{
        const results=statements.map(s=>{
          const r=sqlite.prepare(s.sql).run(...s.args);
          return {meta:{changes:Number(r.changes)}};
        });
        sqlite.exec('COMMIT');
        return results;
      }catch(e){
        sqlite.exec('ROLLBACK');
        throw e;
      }
    }
  };
  const count=(action)=>sqlite.prepare('SELECT COUNT(*) AS n FROM ops_staff_activity WHERE action=?').get(action).n;
  function failAudit(){sqlite.exec("CREATE TRIGGER fail_audit BEFORE INSERT ON ops_staff_activity BEGIN SELECT RAISE(ABORT,'AUDIT_FAILURE_INJECTED'); END");}
  return {db,sqlite,count,failAudit,close(){sqlite.close()}};
}

test('acceptance and its audit are a single transaction, retry has no duplicate audit',async()=>{
  const f=setup();
  try{
    const a=await recordCustomerAcceptance(f.db,{...ACCEPT,audit:true});
    assert.equal(a.recorded,true);
    assert.equal(f.count('OFFER_ACCEPTED'),1);
    const b=await recordCustomerAcceptance(f.db,{...ACCEPT,audit:true});
    assert.equal(b.recorded,false);
    assert.equal(f.count('OFFER_ACCEPTED'),1);
    assert.equal(f.sqlite.prepare('SELECT status FROM ops_manual_offers WHERE offer_id=?').get(OFFER).status,'ACCEPTED');
  }finally{f.close()}
});
test('order creation and its audit are atomic, retry keeps exactly one order',async()=>{
  const f=setup();
  try{
    await recordCustomerAcceptance(f.db,ACCEPT);
    const a=await createOrderFromAcceptedOffer(f.db,{offerId:OFFER,orderId:ORDER,actor:ACCEPT.actor,createdAt:3000,audit:true});
    assert.equal(a.created,true);
    const b=await createOrderFromAcceptedOffer(f.db,{offerId:OFFER,orderId:'retry_order_00002',actor:ACCEPT.actor,createdAt:3100,audit:true});
    assert.equal(b.created,false);
    assert.equal(f.count('ORDER_CREATED'),1);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM ops_manual_orders').get().n,1);
  }finally{f.close()}
});
test('portal link registration audits the single change, never implies PAID',async()=>{
  const f=setup();
  try{
    await recordCustomerAcceptance(f.db,ACCEPT);
    await createOrderFromAcceptedOffer(f.db,{offerId:OFFER,orderId:ORDER,actor:ACCEPT.actor,createdAt:3000});
    assert.equal(await recordPortalPaymentLink(f.db,{orderId:ORDER,reference:'synthetic-portal-ref-001',sentAt:3500,actor:ACCEPT.actor,audit:true}),true);
    assert.equal(await recordPortalPaymentLink(f.db,{orderId:ORDER,reference:'synthetic-portal-ref-002',sentAt:3600,actor:ACCEPT.actor,audit:true}),false);
    assert.equal(f.count('PAYMENT_LINK_RECORDED'),1);
    assert.equal(f.sqlite.prepare('SELECT status FROM ops_manual_orders').get().status,'PAYMENT_LINK_SENT');
  }finally{f.close()}
});
test('audit failure rolls back customer acceptance',async()=>{
  const f=setup();
  try{
    f.failAudit();
    await assert.rejects(
      recordCustomerAcceptance(f.db,{...ACCEPT,audit:true}),/AUDIT_FAILURE_INJECTED/);
    assert.equal(f.sqlite.prepare('SELECT status FROM ops_manual_offers').get().status,'SENT');
    assert.equal(f.count('OFFER_ACCEPTED'),0);
  }finally{f.close()}
});
test('audit failure rolls back order insertion',async()=>{
  const f=setup();
  try{
    await recordCustomerAcceptance(f.db,ACCEPT);
    f.failAudit();
    await assert.rejects(
      createOrderFromAcceptedOffer(f.db,{offerId:OFFER,orderId:ORDER,actor:ACCEPT.actor,createdAt:3000,audit:true}),
      /AUDIT_FAILURE_INJECTED/);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM ops_manual_orders').get().n,0);
    assert.equal(f.count('ORDER_CREATED'),0);
  }finally{f.close()}
});
test('audit failure rolls back portal reference and status change',async()=>{
  const f=setup();
  try{
    await recordCustomerAcceptance(f.db,ACCEPT);
    await createOrderFromAcceptedOffer(f.db,{offerId:OFFER,orderId:ORDER,actor:ACCEPT.actor,createdAt:3000});
    f.failAudit();
    await assert.rejects(
      recordPortalPaymentLink(f.db,{orderId:ORDER,reference:'synthetic-portal-ref-001',
        sentAt:3500,actor:ACCEPT.actor,audit:true}),
      /AUDIT_FAILURE_INJECTED/);
    const order=f.sqlite.prepare('SELECT status,payment_link_reference FROM ops_manual_orders').get();
    assert.equal(order.status,'ORDER_CREATED');
    assert.equal(order.payment_link_reference,null);
    assert.equal(f.count('PAYMENT_LINK_RECORDED'),0);
  }finally{f.close()}
});
