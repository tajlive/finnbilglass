import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

const migration=readFileSync(new URL('../migrations/proposed/0040_ops_manual_offer_order.sql.proposed',import.meta.url),'utf8');
const inquiryId=12,offerId='offer_manual_001',orderId='order_manual_001',amount=215600;

function setup(){
  const db=new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  db.exec('CREATE TABLE beta_inquiries (id INTEGER PRIMARY KEY, navn TEXT NOT NULL)');
  db.prepare('INSERT INTO beta_inquiries(id,navn) VALUES (?,?)').run(inquiryId,'Syntetisk testkunde');
  db.exec(migration);
  const offer=db.prepare('INSERT INTO ops_manual_offers(offer_id,inquiry_id,version,sku,'+
    'fitment_evidence_ref,equipment_json,total_minor,currency,delivery_note,status,created_by,created_at) '+
    "VALUES(?,?,1,'GLASS-123','oe-photo-proof-001','{}',?,'NOK','Frakt avtales','DRAFT','operator',1000)");
  offer.run(offerId,inquiryId,amount);
  const insertOrder=db.prepare(
    "INSERT INTO ops_manual_orders(order_id,inquiry_id,offer_id,sku,total_minor,currency,created_at,created_by) "+
    "VALUES(?,?,?,'GLASS-123',?,'NOK',3000,'operator')"
  );
  const send=()=>db.prepare("UPDATE ops_manual_offers SET status='SENT',sent_at=2000 WHERE offer_id=?").run(offerId);
  const accept=(reference='Customer email case 12',when=2500,channel='EMAIL')=>
    db.prepare("UPDATE ops_manual_offers SET status='ACCEPTED',accepted_at=?,accepted_channel=?,acceptance_ref=? WHERE offer_id=?")
      .run(when,channel,reference,offerId);
  return {db,send,accept,insertOrder:()=>insertOrder.run(orderId,inquiryId,offerId,amount)};
}

test('cannot create manual order before customer acceptance, including direct SQL',()=>{
  const f=setup();
  try{
    assert.throws(()=>f.insertOrder(),/OFFER_NOT_ACCEPTED_OR_MISMATCH/);
    f.send();
    assert.throws(()=>f.insertOrder(),/OFFER_NOT_ACCEPTED_OR_MISMATCH/);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM ops_manual_orders').get().n,0);
  }finally{f.db.close();}
});
test('acceptance requires offer sent plus durable customer evidence and timestamp',()=>{
  const f=setup();
  try{
    assert.throws(()=>f.accept(),/CHECK constraint failed/);
    f.send();
    assert.throws(()=>f.accept('short'),/CHECK constraint failed/);
    assert.throws(()=>f.accept('Customer email case 12',1500),/CHECK constraint failed/);
    assert.throws(()=>f.accept('Customer email case 12',2500,'AUTO'),/CHECK constraint failed/);
    assert.equal(f.db.prepare('SELECT status FROM ops_manual_offers').get().status,'SENT');
    f.accept();
    assert.equal(f.db.prepare('SELECT status FROM ops_manual_offers').get().status,'ACCEPTED');
    assert.equal(f.db.prepare('SELECT accepted_at FROM ops_manual_offers').get().accepted_at,2500);
  }finally{f.db.close();}
});
test('accepted offer creates exactly one manual order with immutable glass and price',()=>{
  const f=setup();
  try{
    f.send();f.accept();f.insertOrder();
    const order=f.db.prepare('SELECT * FROM ops_manual_orders WHERE order_id=?').get(orderId);
    assert.equal(order.sku,'GLASS-123');
    assert.equal(order.total_minor,amount);
    assert.equal(order.currency,'NOK');
    assert.equal(order.status,'ORDER_CREATED');
    assert.equal(order.payment_link_reference,null);
    assert.throws(()=>f.insertOrder(),/UNIQUE constraint failed/);
    assert.throws(()=>f.db.prepare("UPDATE ops_manual_orders SET total_minor=1 WHERE order_id=?").run(orderId),
      /ORDER_TERMS_IMMUTABLE/);
    assert.throws(()=>f.db.prepare("UPDATE ops_manual_offers SET total_minor=5 WHERE offer_id=?").run(offerId),
      /ACCEPTED_OFFER_IMMUTABLE/);
  }finally{f.db.close();}
});
test('DB refuses order that changes accepted SKU, amount or inquiry even when bypassing service',()=>{
  const f=setup();
  try{
    f.send();f.accept();
    const create=(sku,price,iid)=>
      f.db.prepare("INSERT INTO ops_manual_orders(order_id,inquiry_id,offer_id,sku,total_minor,currency,created_at,created_by) VALUES(?,?,?,?,?,'NOK',3000,'operator')")
        .run('another_order',iid,offerId,sku,price);
    assert.throws(()=>create('GLASS-WRONG',amount,inquiryId),/OFFER_NOT_ACCEPTED_OR_MISMATCH/);
    assert.throws(()=>create('GLASS-123',amount+10,inquiryId),/OFFER_NOT_ACCEPTED_OR_MISMATCH/);
    f.db.prepare('INSERT INTO beta_inquiries(id,navn) VALUES(?,?)').run(13,'Another test user');
    assert.throws(()=>create('GLASS-123',amount,13),/OFFER_NOT_ACCEPTED_OR_MISMATCH/);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM ops_manual_orders').get().n,0);
  }finally{f.db.close();}
});
test('manual payment link and verified status require separate auditable evidence',()=>{
  const f=setup();
  try{
    f.send();f.accept();f.insertOrder();
    assert.throws(()=>f.db.prepare("UPDATE ops_manual_orders SET status='PAYMENT_LINK_SENT' WHERE order_id=?").run(orderId),
      /CHECK constraint failed/);
    assert.throws(()=>f.db.prepare("UPDATE ops_manual_orders SET status='PAYMENT_VERIFIED_MANUALLY' WHERE order_id=?").run(orderId),
      /CHECK constraint failed/);
    f.db.prepare("UPDATE ops_manual_orders SET status='PAYMENT_LINK_SENT',payment_link_reference=?,payment_link_sent_at=? WHERE order_id=?")
      .run('portal-link-unique-001',3200,orderId);
    assert.throws(()=>f.db.prepare("UPDATE ops_manual_orders SET status='PAYMENT_VERIFIED_MANUALLY' WHERE order_id=?").run(orderId),
      /CHECK constraint failed/);
    f.db.prepare("UPDATE ops_manual_orders SET status='PAYMENT_VERIFIED_MANUALLY',payment_verified_at=?,payment_verified_by=?,payment_verification_ref=? WHERE order_id=?")
      .run(3400,'operator','kustom-portal-case-001',orderId);
    assert.equal(f.db.prepare('SELECT status FROM ops_manual_orders').get().status,'PAYMENT_VERIFIED_MANUALLY');
    assert.throws(()=>f.db.prepare("UPDATE ops_manual_orders SET status='PAYMENT_LINK_SENT' WHERE order_id=?").run(orderId),
      /MANUAL_ORDER_STATUS_REGRESSION/);
    assert.throws(()=>f.db.prepare("UPDATE ops_manual_orders SET payment_verification_ref='modified' WHERE order_id=?").run(orderId),
      /MANUAL_ORDER_STATUS_REGRESSION/);
    assert.equal(f.db.prepare('PRAGMA foreign_key_check').all().length,0);
  }finally{f.db.close();}
});
test('separate customer inquiry cannot create an order for an unrelated offer',()=>{
  const f=setup();
  try{
    assert.throws(()=>f.db.prepare(
      "INSERT INTO ops_manual_offers(offer_id,inquiry_id,version,sku,fitment_evidence_ref,total_minor,delivery_note,created_by,created_at) "+
      "VALUES ('invalid',999,1,'GLASS-123','proof-ref-001',2000,'Delivery','operator',1000)"
    ).run(),/FOREIGN KEY constraint failed/);
  }finally{f.db.close();}
});
