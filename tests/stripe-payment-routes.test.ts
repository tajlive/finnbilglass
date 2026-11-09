import { test } from 'node:test';
import assert from 'node:assert/strict';
import { availableCheckoutMethods, handleCreatePaymentLink, handleStripeWebhook } from '../src/routes/stripe-payments';
import { localD1 } from '../scripts/lib/local-d1.mjs';
import { refundPaidQuoteOrder } from '../src/routes/stripe-payment-refunds';

function request(path: string, body = '{}') {
  return new Request(`https://ops-staging.finnbilglass.no${path}`, {
    method: 'POST', headers: { Origin: 'https://ops-staging.finnbilglass.no', 'Content-Type': 'application/json' }, body,
  });
}

test('homepage payment marks are hidden until Checkout and signed webhooks are configured', () => {
  assert.deepEqual(availableCheckoutMethods({
    ENVIRONMENT: 'staging', STRIPE_CHECKOUT_ENABLED: 'true',
    STRIPE_SECRET_KEY: 'sk_test_staging', STRIPE_WEBHOOK_SECRET: 'whsec_staging',
  } as never), ['card', 'klarna']);
  assert.deepEqual(availableCheckoutMethods({
    ENVIRONMENT: 'production', STRIPE_CHECKOUT_ENABLED: 'true',
    STRIPE_SECRET_KEY: 'sk_live_production', STRIPE_WEBHOOK_SECRET: 'whsec_production',
  } as never), []);
  assert.deepEqual(availableCheckoutMethods({
    ENVIRONMENT: 'production', STRIPE_CHECKOUT_ENABLED: 'true',
    STRIPE_SECRET_KEY: 'sk_live_production', STRIPE_WEBHOOK_SECRET: 'whsec_production',
    STRIPE_PAYMENT_METHOD_CONFIGURATION: 'pmc_live123',
  } as never), ['card', 'klarna']);
  assert.deepEqual(availableCheckoutMethods({
    ENVIRONMENT: 'production', STRIPE_CHECKOUT_ENABLED: 'false',
    STRIPE_SECRET_KEY: 'sk_live_production', STRIPE_WEBHOOK_SECRET: 'whsec_production',
    STRIPE_PAYMENT_METHOD_CONFIGURATION: 'pmc_live123',
  } as never), []);
});

test('staging refuses payment-link creation without test key and webhook secret', async () => {
  const response = await handleCreatePaymentLink(request('/api/ops/inquiries/1/payment-link'), {
    ENVIRONMENT: 'staging', STRIPE_CHECKOUT_ENABLED: 'true',
  } as never, 1);
  assert.equal(response.status, 503);
  assert.match((await response.json() as { error: string }).error, /miljo/i);
});

test('production Checkout kill switch refuses link creation before touching external services', async () => {
  const response = await handleCreatePaymentLink(request('/api/ops/inquiries/1/payment-link'), {
    ENVIRONMENT: 'production', STRIPE_CHECKOUT_ENABLED: 'false', STRIPE_SECRET_KEY: 'sk_live_unusable', STRIPE_WEBHOOK_SECRET: 'whsec_unusable',
  } as never, 1);
  assert.equal(response.status, 503);
  assert.match((await response.json() as { error: string }).error, /ikke_aktivert/i);
});

test('webhook is unavailable until the signing secret is installed', async () => {
  const response = await handleStripeWebhook(request('/api/stripe/webhook', '{"id":"evt_test"}'), { ENVIRONMENT: 'staging' } as never);
  assert.equal(response.status, 503);
  assert.match((await response.json() as { error: string }).error, /not_configured/i);
});

test('webhook never marks a staging order paid from a live-mode Stripe event', async () => {
  const db = localD1(':memory:', { readOnly: false });
  db.exec(`CREATE TABLE stripe_payment_events(event_id TEXT PRIMARY KEY,order_id TEXT,event_type TEXT NOT NULL,received_at INTEGER NOT NULL,processed_at INTEGER,processing_status TEXT NOT NULL,error_code TEXT);
    CREATE TABLE quote_payment_orders(id TEXT PRIMARY KEY,inquiry_id INTEGER NOT NULL,amount_minor INTEGER NOT NULL,currency TEXT NOT NULL,status TEXT NOT NULL,stripe_checkout_session_id TEXT,stripe_payment_intent_id TEXT,stripe_invoice_id TEXT,paid_at INTEGER,refunded_minor INTEGER NOT NULL DEFAULT 0,updated_at INTEGER NOT NULL);
    CREATE TABLE beta_inquiry_events(event_id TEXT PRIMARY KEY,inquiry_id INTEGER,event_type TEXT,note TEXT,created_at INTEGER,created_by TEXT);
    INSERT INTO quote_payment_orders(id,inquiry_id,amount_minor,currency,status,stripe_checkout_session_id,updated_at) VALUES('ord_test_12345678',1,10000,'nok','PAYMENT_LINK_SENT','cs_test_123',1);`);
  const secret = 'test-webhook-signing-secret';
  const event = { id: 'evt_live_on_staging', type: 'checkout.session.completed', data: { object: {
    id: 'cs_test_123', payment_status: 'paid', amount_total: 10000, currency: 'nok', livemode: true,
    metadata: { order_id: 'ord_test_12345678' }, payment_intent: 'pi_live_wrong_mode',
  } } };
  const raw = JSON.stringify(event);
  const timestamp = Math.floor(Date.now() / 1000);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = Array.from(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${raw}`))), b => b.toString(16).padStart(2, '0')).join('');
  const response = await handleStripeWebhook(new Request('https://staging.example/api/stripe/webhook', { method: 'POST', headers: { 'Stripe-Signature': `t=${timestamp},v1=${signature}` }, body: raw }), {
    ENVIRONMENT: 'staging', FINNBILGLASS_DB: db, STRIPE_WEBHOOK_SECRET: secret,
  } as never);
  assert.equal(response.status, 200);
  assert.equal((await response.json() as { ignored?: boolean }).ignored, true);
  assert.equal((await db.prepare('SELECT status FROM quote_payment_orders WHERE id=?').bind('ord_test_12345678').first() as { status: string }).status, 'PAYMENT_LINK_SENT');
  db.close();
});

test('full payment refund is idempotent and confirmed by Stripe test mode', async () => {
  const db = localD1(':memory:', { readOnly: false });
  db.exec(`CREATE TABLE quote_payment_orders(id TEXT PRIMARY KEY,inquiry_id INTEGER NOT NULL,amount_minor INTEGER NOT NULL,currency TEXT NOT NULL,status TEXT NOT NULL,stripe_payment_intent_id TEXT,paid_at INTEGER,refunded_minor INTEGER NOT NULL DEFAULT 0,updated_at INTEGER NOT NULL);
    CREATE TABLE stripe_payment_refunds(id TEXT PRIMARY KEY,order_id TEXT NOT NULL,idempotency_key TEXT NOT NULL UNIQUE,stripe_refund_id TEXT UNIQUE,amount_minor INTEGER NOT NULL,reason TEXT NOT NULL,status TEXT NOT NULL,requested_by TEXT NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
    CREATE TABLE beta_inquiry_events(event_id TEXT PRIMARY KEY,inquiry_id INTEGER,event_type TEXT,note TEXT,created_at INTEGER,created_by TEXT);
    INSERT INTO quote_payment_orders(id,inquiry_id,amount_minor,currency,status,stripe_payment_intent_id,paid_at,updated_at) VALUES('ord_test_12345678',1,10000,'nok','PAID','pi_test_123',1,1);`);
  const env = { ENVIRONMENT: 'staging', STRIPE_CHECKOUT_ENABLED: 'true', STRIPE_SECRET_KEY: 'sk_test_fixture', STRIPE_WEBHOOK_SECRET: 'whsec_fixture' } as never;
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (input, init) => {
    calls++;
    assert.equal(String(input), 'https://api.stripe.com/v1/refunds');
    assert.equal(new Headers(init?.headers).get('Idempotency-Key'), 'fbg-refund-request_12345678');
    assert.equal(new URLSearchParams(String(init?.body)).get('payment_intent'), 'pi_test_123');
    return Response.json({ id: 're_test_123', status: 'succeeded', amount: 10000, payment_intent: 'pi_test_123', livemode: false });
  };
  try {
    const input = { orderId: 'ord_test_12345678', inquiryId: 1, requestId: 'request_12345678', reason: 'Customer requested refund', actor: 'operator@example.test' };
    const first = await refundPaidQuoteOrder(db as never, env, input);
    const replay = await refundPaidQuoteOrder(db as never, env, input);
    assert.equal(first.status, 'REFUNDED');
    assert.equal(replay.status, 'REFUNDED');
    assert.equal(calls, 1);
    const order = await db.prepare('SELECT status,refunded_minor FROM quote_payment_orders WHERE id=?').bind(input.orderId).first() as { status: string; refunded_minor: number };
    assert.deepEqual({ ...order }, { status: 'REFUNDED', refunded_minor: 10000 });
  } finally {
    globalThis.fetch = originalFetch;
    db.close();
  }
});
