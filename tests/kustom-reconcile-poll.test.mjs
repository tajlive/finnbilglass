/**
 * SQLite integration checks for the opt-in, provider-GET-only reconciliation.
 * No real Kustom credentials, HTTP calls, orders, capture or refund.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import {
  pollKnownKustomOrder, kustomPollingAllowed
} from '../src/payments/kustom-reconcile-poll.ts';

const internalOrderId = 'ord_reconcile_01';
const providerOrderId = '48fa4f0f-b269-4b02-9e8c-71704199cc10';
const hppId = '1eea377b-4c24-4ed9-985e-3d912301e0e3';
const amount = 187375;
const env = {
  ENVIRONMENT: 'staging',
  KUSTOM_ENABLED: 'true',
  KUSTOM_RECONCILIATION_ENABLED: 'true',
  KUSTOM_API_USERNAME: 'synthetic',
  KUSTOM_API_PASSWORD: 'synthetic',
};

function fixture({ failEvent = false } = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec([
    'CREATE TABLE quote_payment_orders (',
    'id TEXT PRIMARY KEY, request_id TEXT NOT NULL UNIQUE,',
    'inquiry_id INTEGER NOT NULL, quote_id INTEGER NOT NULL UNIQUE,',
    'quote_version INTEGER NOT NULL, amount_minor INTEGER NOT NULL,',
    'amount_breakdown_json TEXT NOT NULL, currency TEXT DEFAULT "nok",',
    'acceptance_method TEXT NOT NULL, acceptance_note TEXT NOT NULL,',
    'accepted_at INTEGER NOT NULL, accepted_by TEXT NOT NULL,',
    "status TEXT NOT NULL DEFAULT 'ACCEPTED',",
    'stripe_checkout_session_id TEXT, stripe_payment_intent_id TEXT,',
    'checkout_url TEXT, payment_link_sent_at INTEGER, paid_at INTEGER,',
    'refunded_minor INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL,',
    'created_by TEXT NOT NULL, updated_at INTEGER NOT NULL, stripe_invoice_id TEXT',
    ')'
  ].join(' '));
  db.exec(readFileSync(new URL('../migrations/staging-auth/0059_kustom_payment_preparation.sql', import.meta.url), 'utf8'));
  db.prepare([
    'INSERT INTO quote_payment_orders (',
    'id,request_id,inquiry_id,quote_id,quote_version,amount_minor,',
    'amount_breakdown_json,acceptance_method,acceptance_note,accepted_at,accepted_by,',
    'status,created_at,created_by,updated_at,payment_provider,kustom_order_id,',
    'kustom_hpp_session_id,refunded_minor',
    ") VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'kustom',?,?,0)"
  ].join(' ')).run(
    internalOrderId, 'request_reconcile_01', 1, 1, 1, amount, '{}',
    'EMAIL', 'synthetic', 1, 'test', 'PAYMENT_LINK_SENT',
    1, 'test', 1, providerOrderId, hppId
  );

  function prepared(sql, args = []) {
    return {
      bind(...values) { return prepared(sql, values); },
      async first() { return db.prepare(sql).get(...args) ?? null; },
      execute() {
        if (failEvent && sql.includes('INSERT OR IGNORE INTO kustom_payment_events')) {
          throw new Error('INJECTED_AUDIT_WRITE_FAILURE');
        }
        const res = db.prepare(sql).run(...args);
        return { success: true, meta: { changes: Number(res.changes) } };
      },
      async run() { return this.execute(); },
    };
  }
  const adapter = {
    prepare(sql) { return prepared(sql); },
    async batch(queries) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const result = queries.map(q => q.execute());
        db.exec('COMMIT');
        return result;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    }
  };
  return {
    db, adapter,
    row: () => db.prepare('SELECT * FROM quote_payment_orders WHERE id=?').get(internalOrderId),
    eventCount: () => db.prepare('SELECT COUNT(*) AS n FROM kustom_payment_events').get().n
  };
}

function withProvider({ hppState = 'COMPLETED', checkoutState = 'checkout_complete',
  managementState = 'AUTHORIZED', captured = 0, refunded = 0,
  mismatch = null } = {}, calls) {
  const previous = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const address = String(url);
    const method = options.method || 'GET';
    calls.push({ address, method });
    assert.equal(method, 'GET', 'poll must never acknowledge, capture, refund or create an order');
    const fakeOrderId = mismatch === 'providerOrder' ? '00000000-0000-0000-0000-000000000001' : providerOrderId;
    if (address.includes('/hpp/v1/sessions/')) {
      return Response.json({
        session_id: hppId, order_id: fakeOrderId, status: hppState
      });
    }
    if (address.includes('/checkout/v3/orders/')) {
      return Response.json({
        order_id: providerOrderId, status: checkoutState,
        order_amount: mismatch === 'amount' ? amount + 100 : amount,
        purchase_currency: 'NOK',
        merchant_reference1: mismatch === 'merchant' ? 'other_merchant_reference' : internalOrderId
      });
    }
    if (address.includes('/ordermanagement/v1/orders/')) {
      return Response.json({
        order_id: providerOrderId, status: managementState,
        fraud_status: 'ACCEPTED', order_amount: amount,
        original_order_amount: amount,
        captured_amount: captured, refunded_amount: refunded,
        remaining_authorized_amount: captured ? 0 : amount,
        purchase_currency: 'NOK'
      });
    }
    throw new Error('unexpected provider request');
  };
  return () => { globalThis.fetch = previous; };
}

test('missed callback: authorized payment is NOT paid, idempotent and GET-only', async () => {
  const f = fixture();
  const calls = [];
  const restore = withProvider({}, calls);
  try {
    const first = await pollKnownKustomOrder(f.adapter, env, internalOrderId);
    assert.equal(first.state, 'AUTHORIZED');
    assert.equal(first.updated, true);
    assert.equal(f.row().status, 'PAYMENT_LINK_SENT');
    assert.equal(f.row().kustom_capture_state, 'AUTHORIZED');
    assert.equal(f.row().paid_at, null);
    assert.equal(f.eventCount(), 1);
    const replay = await pollKnownKustomOrder(f.adapter, env, internalOrderId);
    assert.equal(replay.state, 'AUTHORIZED');
    assert.equal(replay.updated, false);
    assert.equal(f.eventCount(), 1);
    assert.equal(calls.length, 6);
  } finally { restore(); f.db.close(); }
});

test('provider captured full amount: mark PAID only after three matching GETs', async () => {
  const f = fixture();
  const calls = [];
  const restore = withProvider({ managementState: 'CAPTURED', captured: amount }, calls);
  try {
    const res = await pollKnownKustomOrder(f.adapter, env, internalOrderId);
    assert.equal(res.state, 'PAID');
    assert.equal(res.updated, true);
    assert.equal(f.row().status, 'PAID');
    assert.ok(f.row().paid_at);
    assert.equal(f.row().kustom_capture_state, 'PAID');
    assert.equal(f.eventCount(), 1);
    const again = await pollKnownKustomOrder(f.adapter, env, internalOrderId);
    assert.equal(again.state, 'ALREADY_FINAL');
    assert.equal(calls.length, 3);
    assert.equal(f.eventCount(), 1);
  } finally { restore(); f.db.close(); }
});

test('provider mismatched amount, merchant or order cannot write any state', async () => {
  for (const mismatch of ['amount', 'merchant', 'providerOrder']) {
    const f = fixture();
    const calls = [];
    const restore = withProvider({ mismatch }, calls);
    try {
      const res = await pollKnownKustomOrder(f.adapter, env, internalOrderId);
      assert.equal(res.state, 'REVIEW_REQUIRED');
      assert.equal(f.row().status, 'PAYMENT_LINK_SENT');
      assert.equal(f.eventCount(), 0);
      assert.equal(calls.some(x => x.method !== 'GET'), false);
    } finally { restore(); f.db.close(); }
  }
});

test('HPP WAITING, partial capture and a full refund never become PAID', async () => {
  for (const testCase of [
    { args: { hppState: 'WAITING' }, expected: 'PENDING' },
    { args: { managementState: 'PART_CAPTURED', captured: 10000 }, expected: 'REVIEW_REQUIRED' },
    { args: { managementState: 'CAPTURED', captured: amount, refunded: amount }, expected: 'REVIEW_REQUIRED' }
  ]) {
    const f = fixture();
    const calls = [];
    const restore = withProvider(testCase.args, calls);
    try {
      const res = await pollKnownKustomOrder(f.adapter, env, internalOrderId);
      assert.equal(res.state, testCase.expected);
      assert.equal(f.row().paid_at, null);
      assert.equal(f.eventCount(), 0);
    } finally { restore(); f.db.close(); }
  }
});

test('failure writing audit event rolls back PAID in the same SQLite transaction', async () => {
  const f = fixture({ failEvent: true });
  const calls = [];
  const restore = withProvider({ managementState: 'CAPTURED', captured: amount }, calls);
  try {
    await assert.rejects(
      pollKnownKustomOrder(f.adapter, env, internalOrderId),
      /INJECTED_AUDIT_WRITE_FAILURE/
    );
    assert.equal(f.row().status, 'PAYMENT_LINK_SENT');
    assert.equal(f.row().paid_at, null);
    assert.equal(f.eventCount(), 0);
    assert.equal(f.db.prepare('PRAGMA foreign_key_check').all().length, 0);
  } finally { restore(); f.db.close(); }
});

test('production polling is disabled without explicit approval and no provider call occurs', async () => {
  const f = fixture();
  const calls = [];
  const restore = withProvider({}, calls);
  try {
    assert.equal(kustomPollingAllowed({ ...env, ENVIRONMENT: 'production' }), false);
    await assert.rejects(
      pollKnownKustomOrder(f.adapter, { ...env, ENVIRONMENT: 'production' }, internalOrderId),
      /KUSTOM_POLL_DISABLED/
    );
    assert.equal(calls.length, 0);
    assert.equal(f.eventCount(), 0);
  } finally { restore(); f.db.close(); }
});
