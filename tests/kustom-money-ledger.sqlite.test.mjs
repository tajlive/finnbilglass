import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  claimMoneyOperationOnce,
  markMoneyOperationSubmitted,
  reconcileMoneyOperation,
  reserveFullMoneyOperation
} from '../src/payments/kustom-money-ledger.ts';
import { submitKustomMoneyOperation } from '../src/payments/kustom-money-ops.ts';

const paymentId = 'pay_test_0001';
const kustomOrderId = '48fa4f0f-b269-4b02-9e8c-71704199cc10';
const amountMinor = 187375;
const env = {
  ENVIRONMENT: 'staging',
  KUSTOM_ENABLED: 'true',
  KUSTOM_MONEY_MOVEMENTS_ENABLED: 'true',
  KUSTOM_API_BASE_URL: 'https://api.playground.kustom.co',
  KUSTOM_API_USERNAME: 'test-user',
  KUSTOM_API_PASSWORD: 'test-password'
};

function database(path) {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA busy_timeout=5000');
  return db;
}

function d1(db) {
  return {
    prepare(sql) {
      let args = [];
      const statement = {
        bind(...values) { args = values; return statement; },
        async first() { return db.prepare(sql).get(...args) ?? null; },
        async run() {
          const result = db.prepare(sql).run(...args);
          return { meta: { changes: Number(result.changes) } };
        }
      };
      return statement;
    }
  };
}

function createFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'kustom-ledger-sqlite-'));
  const path = join(dir, 'ledger.sqlite');
  const db = database(path);
  db.exec(`
    CREATE TABLE quote_payment_orders (
      id TEXT PRIMARY KEY,
      request_id TEXT NOT NULL UNIQUE,
      inquiry_id INTEGER NOT NULL,
      quote_id INTEGER NOT NULL UNIQUE,
      quote_version INTEGER NOT NULL,
      amount_minor INTEGER NOT NULL,
      amount_breakdown_json TEXT NOT NULL,
      currency TEXT NOT NULL DEFAULT 'nok',
      acceptance_method TEXT NOT NULL,
      acceptance_note TEXT NOT NULL,
      accepted_at INTEGER NOT NULL,
      accepted_by TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACCEPTED',
      stripe_checkout_session_id TEXT,
      stripe_payment_intent_id TEXT,
      checkout_url TEXT,
      payment_link_sent_at INTEGER,
      paid_at INTEGER,
      refunded_minor INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      created_by TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      stripe_invoice_id TEXT
    );
  `);
  for (const file of [
    'migrations/staging-auth/0059_kustom_payment_preparation.sql',
    'migrations/staging-auth/0060_kustom_money_operations.sql'
  ]) db.exec(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'));
  insertOrder(db, 'AUTHORIZED');
  return { dir, path, db };
}

function insertOrder(db, captureState, status = 'PAYMENT_LINK_SENT') {
  db.prepare(`INSERT INTO quote_payment_orders
    (id,request_id,inquiry_id,quote_id,quote_version,amount_minor,
     amount_breakdown_json,acceptance_method,acceptance_note,accepted_at,
     accepted_by,status,paid_at,refunded_minor,created_at,created_by,
     updated_at,payment_provider,kustom_order_id,kustom_capture_state,
     kustom_authorized_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'kustom',?,?,?)`)
    .run(paymentId, 'request_test_001', 1, 1, 1, amountMinor,
      '{}', 'EMAIL', 'synthetic SQLite test', 1, 'test', status,
      status === 'PAID' || status === 'REFUNDED' ? 1 : null, 0,
      1, 'test', 1, kustomOrderId, captureState, 1);
}

function managedState(state) {
  const captured = state === 'CAPTURED' || state === 'REFUNDED';
  const refunded = state === 'REFUNDED';
  return {
    order_id: kustomOrderId,
    status: captured ? 'CAPTURED' : 'AUTHORIZED',
    fraud_status: 'ACCEPTED',
    order_amount: amountMinor,
    original_order_amount: amountMinor,
    captured_amount: captured ? amountMinor : 0,
    refunded_amount: refunded ? amountMinor : 0,
    remaining_authorized_amount: captured ? 0 : amountMinor,
    purchase_currency: 'NOK'
  };
}

function mockManagedGet(state, calls) {
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method ?? 'GET' });
    if (init.method && init.method !== 'GET') {
      return new Response('{}', { status: 201 });
    }
    return Response.json(managedState(state));
  };
}

test('two simultaneous SQLite reservations create one immutable operation', async () => {
  const fixture = createFixture();
  const second = database(fixture.path);
  try {
    const [left, right] = await Promise.all([
      reserveFullMoneyOperation(d1(fixture.db), paymentId, 'capture'),
      reserveFullMoneyOperation(d1(second), paymentId, 'capture')
    ]);
    assert.equal(Number(left.created) + Number(right.created), 1);
    assert.equal(left.operation.operation_id, right.operation.operation_id);
    assert.equal(fixture.db.prepare('SELECT COUNT(*) AS n FROM kustom_money_operations').get().n, 1);
  } finally {
    second.close(); fixture.db.close(); rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test('capture survives process restart and cannot submit or capture twice', async () => {
  const fixture = createFixture();
  const calls = [];
  try {
    const db1 = d1(fixture.db);
    const { operation } = await reserveFullMoneyOperation(db1, paymentId, 'capture');
    assert.equal(await claimMoneyOperationOnce(db1, operation.operation_id), true);
    mockManagedGet('AUTHORIZED', calls);
    await submitKustomMoneyOperation(env, {
      operationId: operation.operation_id, paymentOrderId: paymentId,
      kustomOrderId, kind: 'capture', amountMinor,
      expectedOrderMinor: amountMinor
    });
    fixture.db.close();

    const restarted = database(fixture.path);
    const db2 = d1(restarted);
    assert.equal(await claimMoneyOperationOnce(db2, operation.operation_id), false);
    mockManagedGet('CAPTURED', calls);
    assert.equal(await reconcileMoneyOperation(db2, env, operation.operation_id), 'RECONCILED');
    assert.equal(calls.filter(call => call.method === 'POST').length, 1);
    assert.equal(calls.filter(call => call.method === 'GET').length, 2);
    assert.equal(restarted.prepare('SELECT status FROM quote_payment_orders WHERE id=?').get(paymentId).status, 'PAID');
    assert.equal(restarted.prepare('SELECT state FROM kustom_money_operations').get().state, 'RECONCILED');
    restarted.close();
  } finally {
    try { fixture.db.close(); } catch {}
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test('refund reconciles after restart without a second refund POST', async () => {
  const fixture = createFixture();
  const calls = [];
  try {
    fixture.db.prepare(`UPDATE quote_payment_orders
      SET status='PAID',kustom_capture_state='PAID',paid_at=1 WHERE id=?`).run(paymentId);
    const db1 = d1(fixture.db);
    const { operation } = await reserveFullMoneyOperation(db1, paymentId, 'refund');
    assert.equal(await claimMoneyOperationOnce(db1, operation.operation_id), true);
    mockManagedGet('CAPTURED', calls);
    await submitKustomMoneyOperation(env, {
      operationId: operation.operation_id, paymentOrderId: paymentId,
      kustomOrderId, kind: 'refund', amountMinor,
      expectedOrderMinor: amountMinor
    });
    fixture.db.close();

    const restarted = database(fixture.path);
    const db2 = d1(restarted);
    assert.equal(await claimMoneyOperationOnce(db2, operation.operation_id), false);
    mockManagedGet('REFUNDED', calls);
    assert.equal(await reconcileMoneyOperation(db2, env, operation.operation_id), 'RECONCILED');
    assert.equal(calls.filter(call => call.method === 'POST').length, 1);
    assert.equal(calls.filter(call => call.method === 'GET').length, 2);
    const payment = restarted.prepare('SELECT status,refunded_minor FROM quote_payment_orders WHERE id=?').get(paymentId);
    assert.equal(payment.status, 'REFUNDED');
    assert.equal(payment.refunded_minor, amountMinor);
    assert.equal(restarted.prepare('SELECT state FROM kustom_money_operations').get().state, 'RECONCILED');
    restarted.close();
  } finally {
    try { fixture.db.close(); } catch {}
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test('a crash after external POST leaves claim non-repeatable until GET reconciliation', async () => {
  const fixture = createFixture();
  const calls = [];
  try {
    const db1 = d1(fixture.db);
    const { operation } = await reserveFullMoneyOperation(db1, paymentId, 'capture');
    assert.equal(await claimMoneyOperationOnce(db1, operation.operation_id), true);
    mockManagedGet('AUTHORIZED', calls);
    await submitKustomMoneyOperation(env, {
      operationId: operation.operation_id, paymentOrderId: paymentId,
      kustomOrderId, kind: 'capture', amountMinor,
      expectedOrderMinor: amountMinor
    });
    fixture.db.close(); // simulated termination before the submitted marker

    const restarted = database(fixture.path);
    const db2 = d1(restarted);
    assert.equal(await claimMoneyOperationOnce(db2, operation.operation_id), false);
    mockManagedGet('CAPTURED', calls);
    assert.equal(await reconcileMoneyOperation(db2, env, operation.operation_id), 'RECONCILED');
    assert.equal(calls.filter(call => call.method === 'POST').length, 1);
    assert.equal(calls.filter(call => call.method === 'GET').length, 2);
    assert.equal(await markMoneyOperationSubmitted(db2, operation.operation_id), false);
    restarted.close();
  } finally {
    try { fixture.db.close(); } catch {}
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});
