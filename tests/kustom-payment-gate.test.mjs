import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.ts';

const env = {
  ENVIRONMENT: 'staging',
  PAYMENTS_ENABLED: 'false',
  KUSTOM_ENABLED: 'true',
  KUSTOM_OPS_ROUTE_ENABLED: 'true',
  KUSTOM_MONEY_MOVEMENTS_ENABLED: 'false',
  STRIPE_CHECKOUT_ENABLED: 'true',
  STRIPE_SECRET_KEY: 'sk_test_fixture_only',
  STRIPE_PAYMENT_METHOD_CONFIGURATION: 'pmc_test_fixture_only',
};

async function send(path, method = 'GET') {
  return worker.fetch(new Request(`https://ops.finnbilglass.no${path}`, {
    method,
    headers: { host: 'ops.finnbilglass.no' },
  }), env);
}

test('payment methods remain hidden while payment activation is off', async () => {
  const response = await send('/api/payment-methods');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { methods: [] });
});

test('payment link creation is rejected before any provider request while disabled', async () => {
  const response = await send('/api/ops/inquiries/1/payment-link', 'POST');
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, 'BETALING_IKKE_AKTIVERT');
});

test('Kustom and Stripe callback routes reject while payment is disabled', async () => {
  const kustom = await send('/api/kustom/push', 'POST');
  const stripe = await send('/api/stripe/webhook', 'POST');
  assert.equal(kustom.status, 503);
  assert.equal(stripe.status, 503);
});

test('refund route rejects while payment and money movements are disabled', async () => {
  const response = await send('/api/ops/inquiries/1/payment-orders/order_12345678/refund', 'POST');
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, 'BETALING_IKKE_AKTIVERT');
});
