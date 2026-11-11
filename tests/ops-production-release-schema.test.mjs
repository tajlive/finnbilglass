import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

const names = ['0040_ops_manual_offer_order','0041_ops_staff_invites_activity','0044_ops_offer_outbox'];
const release = names.map(name => readFileSync(new URL('../migrations/release/'+name+'.sql',import.meta.url),'utf8'));
const proposed = names.map(name => readFileSync(new URL('../migrations/proposed/'+name+'.sql.proposed',import.meta.url),'utf8'));
const ddl = sql => sql.split('\n').filter(line => !/^\s*--/.test(line)).join(' ').replace(/\s+/g,' ').trim();

test('release SQL is exactly the tested staging DDL, not a new destructive migration',() => {
  for (let i=0;i<names.length;i++){
    assert.match(release[i],/^-- PRODUCTION-REVIEWED ADDITIVE SCHEMA:/);
    assert.equal(ddl(release[i]),ddl(proposed[i]),names[i]);
    assert.doesNotMatch(ddl(release[i]),/\b(?:DROP|ALTER|DELETE|REPLACE)\s+(?:TABLE|FROM|INTO)\b/i);
  }
});

test('production sequence preserves historical customer and old ops_offers rows',() => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('PRAGMA foreign_keys=ON');
    db.exec('CREATE TABLE beta_inquiries (id INTEGER PRIMARY KEY, navn TEXT, kontakt TEXT, status TEXT)');
    db.exec('CREATE TABLE beta_inquiry_events (event_id TEXT PRIMARY KEY, inquiry_id INTEGER, note TEXT)');
    db.exec('CREATE TABLE ops_offers (inquiry_id INTEGER, version INTEGER, request_id TEXT, snapshot_json TEXT, status TEXT, created_at INTEGER, created_by TEXT, sent_at INTEGER, accepted_at INTEGER)');
    db.exec("INSERT INTO beta_inquiries VALUES(7,'Historical','hidden@synthetic.invalid','CLOSED')");
    db.exec("INSERT INTO beta_inquiry_events VALUES('event1',7,'original')");
    db.exec("INSERT INTO ops_offers VALUES(7,1,'legacy1','{}','SENT',123,'operator',124,NULL)");
    const before = ['beta_inquiries','beta_inquiry_events','ops_offers'].map(table => JSON.stringify(db.prepare('SELECT * FROM '+table).all()));
    for(const sql of release) db.exec(sql);
    const after = ['beta_inquiries','beta_inquiry_events','ops_offers'].map(table => JSON.stringify(db.prepare('SELECT * FROM '+table).all()));
    assert.deepEqual(after,before);
    for(const table of ['ops_manual_offers','ops_manual_orders','ops_staff_memberships','ops_staff_activity','ops_offer_outbox'])
      assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name=?").get(table).n,1,table);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
    const requiredTriggers=['ops_manual_order_requires_accepted_offer','ops_manual_accepted_offer_immutable','ops_manual_order_immutable_terms','ops_manual_order_no_status_regression','ops_staff_activity_no_update','ops_staff_activity_no_delete','ops_offer_outbox_payload_immutable'];
    for(const tr of requiredTriggers) assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='trigger' AND name=?").get(tr).n,1,tr);
    // Replaying additive DDL is schema-idempotent, not an instruction to auto-replay in production.
    for(const sql of release) db.exec(sql);
    assert.deepEqual(['beta_inquiries','beta_inquiry_events','ops_offers'].map(table => JSON.stringify(db.prepare('SELECT * FROM '+table).all())), before);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
  } finally {db.close();}
});

test('manual order is blocked before accepted offer and Resend payload cannot be rewritten',()=>{
  const db = new DatabaseSync(':memory:');
  try{
    db.exec('PRAGMA foreign_keys=ON');
    db.exec('CREATE TABLE beta_inquiries(id INTEGER PRIMARY KEY)');
    db.exec('INSERT INTO beta_inquiries(id) VALUES(1)');
    for(const sql of release)db.exec(sql);
    db.prepare("INSERT INTO ops_manual_offers(offer_id,inquiry_id,version,sku,fitment_evidence_ref,total_minor,delivery_note,created_by,created_at) VALUES('of1',1,1,'sku1','independent-evidence-123',249000,'synthetic','qa',1)").run();
    assert.throws(()=>db.exec("INSERT INTO ops_manual_orders(order_id,inquiry_id,offer_id,sku,total_minor,created_by,created_at) VALUES('or1',1,'of1','sku1',249000,'qa',2)"),/OFFER_NOT_ACCEPTED_OR_MISMATCH/);
    db.exec("INSERT INTO ops_offer_outbox(offer_id,inquiry_id,request_id,recipient,subject,text_body,html_body,created_at,updated_at) VALUES('of1',1,'req1','qa@synthetic.invalid','subject','body','html',1,1)");
    assert.throws(()=>db.exec("UPDATE ops_offer_outbox SET recipient='other@synthetic.invalid' WHERE offer_id='of1'"),/OFFER_SEND_PAYLOAD_IMMUTABLE/);
    assert.throws(()=>db.exec("INSERT INTO ops_offer_outbox(offer_id,inquiry_id,request_id,recipient,subject,text_body,html_body,created_at,updated_at) VALUES('of1',1,'req2','qa@synthetic.invalid','subject','body','html',1,1)"),/UNIQUE constraint failed/);
  } finally {db.close();}
});
