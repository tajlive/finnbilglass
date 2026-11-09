import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { handleKustomCallback } from '../src/routes/kustom-ops.ts';

const oid = '48fa4f0f-b269-4b02-9e8c-71704199cc10';
const hppId = '1f45bd80-9091-4b41-814e-205f787f5500';
const localId = 'ord_callback_synthetic_01';
const amount = 187375;
const token = 'f'.repeat(64);
const tokenHash = createHash('sha256').update(token).digest('hex');

function fixture({ breakEvent = false } = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  db.exec([
    'CREATE TABLE quote_payment_orders (',
    'id TEXT PRIMARY KEY,payment_provider TEXT NOT NULL,kustom_order_id TEXT,',
    'kustom_hpp_session_id TEXT,kustom_notification_token_hash TEXT,',
    'kustom_acknowledged_at INTEGER,amount_minor INTEGER,status TEXT,',
    'kustom_capture_state TEXT,paid_at INTEGER,kustom_authorized_at INTEGER,',
    'refunded_minor INTEGER NOT NULL DEFAULT 0,updated_at INTEGER)',
    ';',
    'CREATE TABLE kustom_payment_events (event_id TEXT PRIMARY KEY,',
    'order_id TEXT,kustom_order_id TEXT,kustom_session_id TEXT,',
    'received_at INTEGER NOT NULL,processed_at INTEGER,state TEXT NOT NULL,error_code TEXT);'
  ].join(' '));
  db.prepare([
    'INSERT INTO quote_payment_orders ',
    '(id,payment_provider,kustom_order_id,kustom_hpp_session_id,',
    'kustom_notification_token_hash,amount_minor,status,refunded_minor)',
    "VALUES(?,'kustom',?,?,?,?, 'PAYMENT_LINK_SENT',0)"
  ].join(' ')).run(localId,oid,hppId,tokenHash,amount);

  function statement(sql,args=[]) {
    return {
      bind(...values) { return statement(sql,values); },
      async first() { return db.prepare(sql).get(...args) ?? null; },
      execute() {
        if (breakEvent && sql.includes('INSERT OR IGNORE INTO kustom_payment_events')) {
          throw new Error('INJECTED_EVENT_INSERT_FAILURE');
        }
        const result = db.prepare(sql).run(...args);
        return {success:true,meta:{changes:Number(result.changes)},results:[]};
      },
      async run() { return this.execute(); }
    };
  }
  const d1 = {
    prepare(sql) { return statement(sql); },
    async batch(statements) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const result=statements.map(s=>s.execute());
        db.exec('COMMIT');
        return result;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    }
  };
  const env = {
    ENVIRONMENT:'staging',
    KUSTOM_ENABLED:'true',
    KUSTOM_OPS_ROUTE_ENABLED:'true',
    KUSTOM_API_USERNAME:'synthetic',
    KUSTOM_API_PASSWORD:'synthetic',
    KUSTOM_RETURN_ORIGIN:'https://staging.finnbilglass.no',
    FINNBILGLASS_STAGING_AUTH:d1
  };
  return {
    db,env,
    row:()=>db.prepare('SELECT * FROM quote_payment_orders WHERE id=?').get(localId),
    events:()=>db.prepare('SELECT COUNT(*) AS count FROM kustom_payment_events').get().count
  };
}

function provider({state='AUTHORIZED',captured=0,refunded=0,checkoutAmount=amount}={},calls=[]) {
  const before=globalThis.fetch;
  globalThis.fetch=async (url, init={}) => {
    const address=String(url);
    const method=init.method||'GET';
    calls.push({address,method});
    if (address.endsWith('/acknowledge')) {
      assert.equal(method,'POST');
      return new Response(null,{status:204});
    }
    assert.equal(method,'GET','callback must not initiate money operations');
    if (address.includes('/checkout/v3/orders/')) return Response.json({
      order_id:oid,merchant_reference1:localId,order_amount:checkoutAmount,
      purchase_currency:'NOK',status:'checkout_complete'
    });
    if (address.includes('/hpp/v1/sessions/')) return Response.json({
      session_id:hppId,order_id:oid,status:'COMPLETED'
    });
    if (address.includes('/ordermanagement/v1/orders/')) return Response.json({
      order_id:oid,status:state,fraud_status:'ACCEPTED',
      order_amount:amount,original_order_amount:amount,purchase_currency:'NOK',
      captured_amount:captured,refunded_amount:refunded,
      remaining_authorized_amount:captured ? 0 : amount
    });
    throw new Error('UNEXPECTED_PROVIDER_ENDPOINT');
  };
  return ()=>{globalThis.fetch=before;};
}

async function callback(env,kind='push',suppliedToken=token) {
  const path=kind==='push'
    ? '/api/kustom/push?order_id='+oid+'&token='+suppliedToken
    : '/api/kustom/status-update?token='+suppliedToken+'&hppId='+hppId;
  const response=await handleKustomCallback(
    new Request('https://staging.finnbilglass.no'+path,{method:'POST'}),
    env,kind
  );
  return {status:response.status,body:await response.json()};
}

test('invalid token performs no provider call or D1 modification',async()=>{
  const f=fixture(),calls=[],restore=provider({},calls);
  try {
    const res=await callback(f.env,'push','e'.repeat(64));
    assert.equal(res.status,403);
    assert.equal(calls.length,0);
    assert.equal(f.events(),0);
    assert.equal(f.row().status,'PAYMENT_LINK_SENT');
  } finally { restore();f.db.close(); }
});

test('authorized callback records one durable event and only one acknowledgement across duplicate callbacks',async()=>{
  const f=fixture(),calls=[],restore=provider({},calls);
  try {
    const first=await callback(f.env,'push');
    assert.equal(first.status,200);
    assert.equal(f.row().kustom_capture_state,'AUTHORIZED');
    assert.equal(f.row().paid_at,null);
    assert.equal(f.events(),1);
    assert.ok(f.row().kustom_acknowledged_at,'Kustom must be acknowledged durably');
    const again=await callback(f.env,'push');
    const statusUpdate=await callback(f.env,'status-update');
    assert.equal(again.status,200);
    assert.equal(statusUpdate.status,200);
    assert.equal(f.events(),1,'same state must dedup across push and HPP callback');
    assert.equal(calls.filter(c=>c.method==='POST').length,1,'ack once, no capture/refund');
    assert.equal(calls.filter(c=>c.method==='GET').length,9);
  } finally { restore();f.db.close(); }
});

test('full provider capture marks PAID; no local refund or provider money POST',async()=>{
  const f=fixture(),calls=[],restore=provider({state:'CAPTURED',captured:amount},calls);
  try {
    const res=await callback(f.env);
    assert.equal(res.status,200);
    assert.equal(f.row().status,'PAID');
    assert.ok(f.row().paid_at);
    assert.equal(f.events(),1);
    assert.equal(calls.filter(c=>c.method==='POST').length,1);
    assert.ok(calls.every(c=>c.method==='GET'||c.address.endsWith('/acknowledge')));
  } finally { restore();f.db.close(); }
});

test('cancelled order cannot become AUTHORIZED even with zero capture',async()=>{
  const f=fixture(),calls=[],restore=provider({state:'CANCELLED'},calls);
  try {
    const res=await callback(f.env);
    assert.equal(res.status,409);
    assert.equal(f.row().status,'PAYMENT_LINK_SENT');
    assert.equal(f.row().kustom_capture_state,null);
    assert.equal(f.events(),0);
    assert.equal(calls.filter(c=>c.method==='POST').length,0);
  } finally { restore();f.db.close(); }
});

test('amount disagreement fails closed before D1 write or acknowledgement',async()=>{
  const f=fixture(),calls=[],restore=provider({checkoutAmount:amount+100},calls);
  try {
    const res=await callback(f.env);
    assert.equal(res.status,409);
    assert.equal(f.events(),0);
    assert.equal(calls.filter(c=>c.method==='POST').length,0);
  } finally { restore();f.db.close(); }
});

test('failed event insert rolls back PAID transition; no acknowledgement',async()=>{
  const f=fixture({breakEvent:true}),calls=[],
    restore=provider({state:'CAPTURED',captured:amount},calls);
  try {
    const res=await callback(f.env);
    assert.equal(res.status,503);
    assert.equal(f.row().status,'PAYMENT_LINK_SENT');
    assert.equal(f.row().paid_at,null);
    assert.equal(f.events(),0);
    assert.equal(calls.filter(c=>c.method==='POST').length,0);
    assert.equal(f.db.prepare('PRAGMA foreign_key_check').all().length,0);
  } finally { restore();f.db.close(); }
});