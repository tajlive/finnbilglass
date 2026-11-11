import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { sendDurableOpsReply } from '../src/ops-reply-outbox.ts';

const oldSchema=readFileSync(new URL('../migrations/proposed/0042_ops_reply_outbox.sql.proposed',import.meta.url),'utf8');
const newSchema=readFileSync(new URL('../migrations/proposed/0046_ops_reply_attempts.sql.proposed',import.meta.url),'utf8');
const KEY='test-request-000000001';
const input={
  requestId:KEY,inquiryId:1,actor:'Operator',staffEmail:'staff@finnbilglass.no',
  recipient:'customer@sample.org',customerName:'Synthetic',regnr:'XX12345',
  body:'Synthetic approved reply to customer',createdAt:100000
};

function fixture({legacyStatus=null,failHistory=false}={}){
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  sqlite.exec('CREATE TABLE beta_inquiries(id INTEGER PRIMARY KEY)');
  sqlite.exec('INSERT INTO beta_inquiries VALUES(1)');
  sqlite.exec(oldSchema);
  if(legacyStatus){
    sqlite.prepare("INSERT INTO ops_reply_outbox(request_id,inquiry_id,actor_email,recipient,body,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)")
      .run(KEY,1,input.actor,input.recipient,input.body,legacyStatus,100,100);
  }
  sqlite.exec(newSchema);
  sqlite.exec("CREATE TABLE beta_inquiry_events(event_id TEXT PRIMARY KEY,inquiry_id INTEGER,event_type TEXT,note TEXT,created_at INTEGER,created_by TEXT,meta_json TEXT)");
  sqlite.exec("CREATE TABLE ops_staff_activity(event_id TEXT PRIMARY KEY,actor_email TEXT,action TEXT,subject_type TEXT,subject_id TEXT,created_at INTEGER,details_json TEXT)");
  if(failHistory)sqlite.exec("CREATE TRIGGER fail_history BEFORE INSERT ON beta_inquiry_events BEGIN SELECT RAISE(ABORT,'AUDIT_FAILURE_AFTER_SEND'); END");
  function prepare(sql,args=[]){
    return {
      sql,args,bind(...v){return prepare(sql,v)},
      async run(){const r=sqlite.prepare(sql).run(...args);return {meta:{changes:Number(r.changes)}}},
      async first(){return sqlite.prepare(sql).get(...args)??null}
    };
  }
  const db={
    prepare(sql){return prepare(sql)},
    async batch(stmts){
      sqlite.exec('BEGIN IMMEDIATE');
      try{
        const results=stmts.map(s=>{
          const r=sqlite.prepare(s.sql).run(...s.args);
          return {meta:{changes:Number(r.changes)}};
        });
        sqlite.exec('COMMIT');return results;
      }catch(err){sqlite.exec('ROLLBACK');throw err}
    }
  };
  const env={FINNBILGLASS_DB:db,SUPPORT_FROM_EMAIL:'support@finnbilglass.no'};
  const count=(table)=>sqlite.prepare('SELECT COUNT(*) AS n FROM '+table).get().n;
  return {sqlite,env,count,close(){sqlite.close()}};
}
test('one provider call, frozen payload, one event and audit; 25h retry is no-op',async()=>{
  const f=fixture();let calls=0;
  try{
    const send=async(_env,mail)=>{
      calls++;
      assert.equal(mail.idempotencyKey,'ops-reply-'+KEY);
      assert.equal(mail.from,'support@finnbilglass.no');
      assert.match(mail.html,/Synthetic approved reply/);
      return {ok:true,id:'resend-accepted-001'};
    };
    const first=await sendDurableOpsReply(f.env,input,send);
    assert.equal(first.status,'SENT');
    assert.equal(first.ok,true);
    const retry=await sendDurableOpsReply(f.env,{...input,createdAt:100000+26*3600_000},send);
    assert.equal(retry.alreadySent,true);
    assert.equal(calls,1);
    assert.equal(f.count('beta_inquiry_events'),1);
    assert.equal(f.count('ops_staff_activity'),1);
    const attempt=f.sqlite.prepare('SELECT status,subject,text_body,html_body,provider_message_id FROM ops_reply_attempts').get();
    assert.equal(attempt.status,'SENT');
    assert.ok(attempt.subject);
    assert.ok(attempt.text_body);
    assert.ok(attempt.html_body);
    assert.equal(attempt.provider_message_id,'resend-accepted-001');
  }finally{f.close()}
});
test('two simultaneous calls can reserve at most one send',async()=>{
  const f=fixture();let calls=0,resume,mark;
  const started=new Promise(resolve=>mark=resolve);
  const barrier=new Promise(resolve=>resume=resolve);
  try{
    const provider=async()=>{calls++;mark();await barrier;return {ok:true,id:'resend-accepted-002'}};
    const firstPromise=sendDurableOpsReply(f.env,input,provider);
    await started;
    const second=await sendDurableOpsReply(f.env,input,provider);
    assert.equal(second.requiresReview,true);
    assert.equal(calls,1);
    resume();
    const first=await firstPromise;
    assert.equal(first.ok,true);
    assert.equal(f.count('beta_inquiry_events'),1);
  }finally{resume?.();f.close()}
});
test('provider timeout after possible acceptance never auto-resends after 25h',async()=>{
  const f=fixture();let calls=0;
  try{
    const provider=async()=>{calls++;throw new Error('timeout after provider acceptance')};
    const first=await sendDurableOpsReply(f.env,input,provider);
    assert.equal(first.requiresReview,true);
    const retry=await sendDurableOpsReply(f.env,{...input,createdAt:100000+26*3600_000},provider);
    assert.equal(retry.requiresReview,true);
    assert.equal(calls,1);
    assert.equal(f.sqlite.prepare('SELECT status FROM ops_reply_attempts').get().status,'REVIEW');
    assert.equal(f.count('beta_inquiry_events'),0);
  }finally{f.close()}
});
test('D1 failure after provider success leaves permanent SENDING claim, no duplicate journal',async()=>{
  const f=fixture({failHistory:true});let calls=0;
  try{
    const provider=async()=>{calls++;return {ok:true,id:'resend-accepted-003'}};
    const first=await sendDurableOpsReply(f.env,input,provider);
    assert.equal(first.requiresReview,true);
    assert.equal(f.sqlite.prepare('SELECT status FROM ops_reply_attempts').get().status,'SENDING');
    assert.equal(f.sqlite.prepare('SELECT status FROM ops_reply_outbox').get().status,'QUEUED');
    assert.equal(f.count('beta_inquiry_events'),0);
    const retry=await sendDurableOpsReply(f.env,{...input,createdAt:100000+26*3600_000},provider);
    assert.equal(retry.requiresReview,true);
    assert.equal(calls,1);
  }finally{f.close()}
});
test('legacy ambiguous QUEUED row is quarantined by additive migration',async()=>{
  const f=fixture({legacyStatus:'QUEUED'});let calls=0;
  try{
    assert.equal(f.sqlite.prepare('SELECT status FROM ops_reply_attempts').get().status,'REVIEW');
    const result=await sendDurableOpsReply(f.env,input,async()=>{calls++;return {ok:true,id:'unexpected'}});
    assert.equal(result.requiresReview,true);
    assert.equal(calls,0);
  }finally{f.close()}
});
test('provider 2xx without provider ID is REVIEW, never SENT',async()=>{
  const f=fixture();let calls=0;
  try{
    const result=await sendDurableOpsReply(f.env,input,async()=>{calls++;return {ok:true}});
    assert.equal(result.requiresReview,true);
    assert.equal(calls,1);
    assert.equal(f.sqlite.prepare('SELECT status FROM ops_reply_attempts').get().status,'REVIEW');
    assert.equal(f.sqlite.prepare('SELECT status FROM ops_reply_outbox').get().status,'QUEUED');
  }finally{f.close()}
});
test('same request ID with changed body is refused before provider call',async()=>{
  const f=fixture();let calls=0;
  try{
    const provider=async()=>{calls++;return {ok:false}};
    await sendDurableOpsReply(f.env,input,provider);
    const conflict=await sendDurableOpsReply(f.env,{...input,body:'Different text'},provider);
    assert.equal(conflict.status,'REJECTED');
    assert.equal(calls,1);
  }finally{f.close()}
});
