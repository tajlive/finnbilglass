import { test } from 'node:test';
import assert from 'node:assert/strict';
import { availableCheckoutMethods, handleCreatePaymentLink, handleStripeWebhook } from '../src/routes/stripe-payments';

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
