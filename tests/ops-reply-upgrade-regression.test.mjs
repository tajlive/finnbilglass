import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

// Upgrade rehearsal, not a fresh empty D1. Retains every preexisting reply row.
const oldSQL=readFileSync(new URL(
  '../migrations/proposed/0042_ops_reply_outbox.sql.proposed',import.meta.url),'utf8');
const newSQL=readFileSync(new URL(
  '../migrations/proposed/0046_ops_reply_attempts.sql.proposed',import.meta.url),'utf8');

function fixture(){
  const db=new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  db.exec('CREATE TABLE beta_inquiries(id INTEGER PRIMARY KEY)');
  db.exec('INSERT INTO beta_inquiries VALUES(1)');
  db.exec(oldSQL);
  const rows=[
    ['queued-original-00001','QUEUED',null],
    ['failed-original-00001','FAILED',null],
    ['sent-original-000001','SENT','resend-verified-old-001']
  ];
  for(const [id,status,providerId] of rows){
    db.prepare(
      'INSERT INTO ops_reply_outbox(request_id,inquiry_id,actor_email,recipient,body,status,provider_message_id,created_at,updated_at) ' +
      'VALUES (?,1,?,?,?,?,?,100,100)'
    ).run(id,'synthetic.operator@example.invalid','no-send@synthetic.invalid',
      'Old synthetic customer response',status,providerId);
  }
  const originals=()=>db.prepare(
    'SELECT request_id,inquiry_id,actor_email,recipient,body,status,provider_message_id,created_at,updated_at '+
    'FROM ops_reply_outbox ORDER BY request_id'
  ).all();
  return {db,originals};
}

test('upgrade existing reply outbox: preserves every row and quarantines ambiguous retries',()=>{
  const f=fixture();
  const before=f.originals();
  try{
    f.db.exec(newSQL);
    const rows=f.db.prepare(
      'SELECT request_id,status,provider_message_id FROM ops_reply_attempts ORDER BY request_id'
    ).all();
    assert.equal(rows.length,2);
    assert.deepEqual(rows.map(r=>r.request_id),
      ['failed-original-00001','queued-original-00001']);
    assert.ok(rows.every(r=>r.status==='REVIEW'));
    assert.ok(rows.every(r=>r.provider_message_id===null));
    assert.deepEqual(f.originals(),before,'No customer message or delivery state changed');
    assert.equal(f.db.prepare('PRAGMA foreign_key_check').all().length,0);
    f.db.exec(newSQL);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM ops_reply_attempts').get().n,2);
    assert.deepEqual(f.originals(),before,'Reapplying the migration changes no old records');
    assert.throws(
      ()=>f.db.prepare(
        "UPDATE ops_reply_attempts SET body='modified' WHERE request_id='queued-original-00001'"
      ).run(),/REPLY_PAYLOAD_IMMUTABLE/
    );
    assert.throws(
      ()=>f.db.prepare(
        "UPDATE ops_reply_attempts SET status='SENDING' WHERE request_id='queued-original-00001'"
      ).run(),/REPLY_STATUS_REGRESSION/
    );
    assert.throws(
      ()=>f.db.prepare(
        "DELETE FROM ops_reply_attempts WHERE request_id='failed-original-00001'"
      ).run(),/REPLY_ATTEMPT_IMMUTABLE/
    );
  }finally{f.db.close()}
});

test('fresh reply attempt cannot become SENT without provider identity',()=>{
  const f=fixture();
  try{
    f.db.exec(newSQL);
    const id='fresh-request-00000001';
    f.db.prepare(
      "INSERT INTO ops_reply_outbox(request_id,inquiry_id,actor_email,recipient,body,status,created_at,updated_at) " +
      "VALUES(?,1,'operator','synthetic@sample.org','Synthetic new reply','QUEUED',200,200)"
    ).run(id);
    f.db.prepare(
      "INSERT INTO ops_reply_attempts(request_id,inquiry_id,actor_email,recipient,body,sender,subject,text_body,html_body,status,created_at,updated_at) " +
      "VALUES(?,1,'operator','synthetic@sample.org','Synthetic new reply','support@finnbilglass.no','Subject','Text','<p>Text</p>','SENDING',200,200)"
    ).run(id);
    assert.throws(
      ()=>f.db.prepare(
        "UPDATE ops_reply_attempts SET status='SENT' WHERE request_id=?"
      ).run(id),/CHECK constraint failed/
    );
    assert.equal(f.db.prepare('SELECT status FROM ops_reply_attempts WHERE request_id=?').get(id).status,'SENDING');
    assert.equal(f.db.prepare('PRAGMA foreign_key_check').all().length,0);
  }finally{f.db.close()}
});
