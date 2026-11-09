import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { sweepStaleKustomPayments } from '../src/payments/kustom-reconcile-sweep.ts';

const now=1_000_000;
const env={
  ENVIRONMENT:'staging',
  KUSTOM_ENABLED:'true',
  KUSTOM_RECONCILIATION_ENABLED:'true',
  KUSTOM_API_USERNAME:'synthetic',
  KUSTOM_API_PASSWORD:'synthetic'
};

function setup() {
  const db=new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  db.exec('CREATE TABLE quote_payment_orders (id TEXT PRIMARY KEY,payment_provider TEXT,' +
    'status TEXT,kustom_order_id TEXT,kustom_hpp_session_id TEXT,updated_at INTEGER,kustom_capture_state TEXT)');
  db.exec(readFileSync(new URL('../migrations/staging-auth/0061_kustom_reconciliation_attempts.sql',import.meta.url),'utf8'));
  const insert=db.prepare('INSERT INTO quote_payment_orders VALUES(?,?,?,?,?,?,?)');
  const add=(id, updatedAt, status='PAYMENT_LINK_SENT', provider='kustom', session='valid',state=null) =>
    insert.run(id,provider,status,'48fa4f0f-b269-4b02-9e8c-71704199cc10',session,updatedAt,state);
  for(let i=0;i<6;i++) add('ord_stale_'+i,1000+i*100);
  add('ord_fresh_1',950000);
  add('ord_stripe_1',1000,'PAYMENT_LINK_SENT','stripe');
  add('ord_paid_1',1000,'PAID');
  add('ord_session_missing_1',1000,'PAYMENT_LINK_SENT','kustom',null);
  add('ord_invalid_capture_1',1000,'PAYMENT_LINK_SENT','kustom','valid','REFUNDED');
  const d1={
    prepare(sql) {
      return {
        bind(...values) {
          return {
            async all() { return { results:db.prepare(sql).all(...values) }; },
            async run() { const r=db.prepare(sql).run(...values); return { meta:{changes:Number(r.changes)} }; }
          };
        }
      };
    }
  };
  return {db,d1};
}

test('sweep is explicitly disabled for all production envs and inactive staging',async()=>{
  const f=setup(),called=[];
  const dummy=async()=>{called.push(1);throw new Error('should never run');};
  try {
    await assert.rejects(sweepStaleKustomPayments(f.d1,{
      ...env,ENVIRONMENT:'production',KUSTOM_PRODUCTION_APPROVED:'true'
    },{now,pollOne:dummy}),/KUSTOM_SWEEP_DISABLED/);
    await assert.rejects(sweepStaleKustomPayments(f.d1,{
      ...env,KUSTOM_RECONCILIATION_ENABLED:'false'
    },{now,pollOne:dummy}),/KUSTOM_SWEEP_DISABLED/);
    assert.equal(called.length,0);
  } finally{f.db.close();}
});

test('sweep selects only oldest five stale incomplete Kustom orders',async()=>{
  const f=setup(),seen=[];
  try {
    const summary=await sweepStaleKustomPayments(f.d1,env,{now,pollOne:async (_db,_env,id)=>{
      seen.push(id);
      return {orderId:id,state:'AUTHORIZED',updated:true};
    }});
    assert.deepEqual(seen,['ord_stale_0','ord_stale_1','ord_stale_2','ord_stale_3','ord_stale_4']);
    assert.equal(summary.checked,5);
    assert.equal(summary.updated,5);
    assert.equal(summary.authorized,5);
    assert.equal(summary.errors,0);
  } finally{f.db.close();}
});

test('sweep reports PENDING/REVIEW/PAID/errors without retrying money operations',async()=>{
  const f=setup(),seen=[];
  const states=['PENDING','REVIEW_REQUIRED','PAID','ALREADY_FINAL','ERROR'];
  try {
    const summary=await sweepStaleKustomPayments(f.d1,env,{now,pollOne:async (_db,_env,id)=>{
      seen.push(id);
      const state=states[seen.length-1];
      if(state==='ERROR')throw new Error('provider unavailable');
      return {orderId:id,state,updated:state==='PAID'};
    }});
    assert.equal(summary.checked,5);
    assert.equal(summary.updated,1);
    assert.equal(summary.pending,1);
    assert.equal(summary.manualReview,1);
    assert.equal(summary.paid,1);
    assert.equal(summary.alreadyFinal,1);
    assert.equal(summary.errors,1);
  } finally { f.db.close(); }
});

test('fair retries: a sixth order is not starved by five older PENDING callbacks',async()=>{
  const f=setup(),seen=[];
  const pollOne=async (_db,_env,id)=>{
    seen.push(id);
    return {orderId:id,state:'PENDING',updated:false};
  };
  try {
    const first=await sweepStaleKustomPayments(f.d1,env,{now,pollOne});
    assert.equal(first.checked,5);
    assert.deepEqual(seen,['ord_stale_0','ord_stale_1','ord_stale_2','ord_stale_3','ord_stale_4']);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM kustom_reconcile_attempts').get().n,5);
    // Same minute: cooldown prevents repeated calls to the oldest five.
    const second=await sweepStaleKustomPayments(f.d1,env,{now:now+10_000,pollOne});
    assert.equal(second.checked,1);
    assert.equal(seen[5],'ord_stale_5');
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM kustom_reconcile_attempts').get().n,6);
    const third=await sweepStaleKustomPayments(f.d1,env,{now:now+20_000,pollOne});
    assert.equal(third.checked,0);
    // Fifteen-minute cooldown permits another GET-only retry, not a money operation.
    const later=await sweepStaleKustomPayments(f.d1,env,{now:now+901_000,pollOne});
    assert.equal(later.checked,5);
  } finally{f.db.close();}
});

test('provider failures get a durable outcome and do not suppress newer rows',async()=>{
  const f=setup(),seen=[];
  try {
    const first=await sweepStaleKustomPayments(f.d1,env,{now,pollOne:async(_db,_env,id)=>{
      seen.push(id);
      throw new Error('synthetic provider GET failed');
    }});
    assert.equal(first.errors,5);
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM kustom_reconcile_attempts WHERE outcome='ERROR' AND consecutive_errors=1").get().n,5);
    const second=await sweepStaleKustomPayments(f.d1,env,{now:now+10_000,pollOne:async(_db,_env,id)=>{
      seen.push(id);return {orderId:id,state:'PENDING',updated:false};
    }});
    assert.equal(second.checked,1);
    assert.equal(seen[5],'ord_stale_5');
    assert.equal(f.db.prepare('PRAGMA foreign_key_check').all().length,0);
  }finally{f.db.close();}
});
