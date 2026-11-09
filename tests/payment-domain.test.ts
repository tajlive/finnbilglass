import { test } from 'node:test';
import assert from 'node:assert/strict';
import { amountToNokMinor, buildCheckoutSessionParameters, customerTotalForOffer, verifyCheckoutCompleted, verifyStripeSignature } from '../src/payment-domain';

test('checkout amount uses confirmed whole NOK quote and converts to øre', () => {
  assert.equal(amountToNokMinor({ totalNok: 5724, priceType: 'BEKREFTET', sentAt: 1, totalConfirmed: true }), 572400);
});

test('checkout cannot be created for unconfirmed, unsent or incomplete totals', () => {
  assert.throws(() => amountToNokMinor({ totalNok: 5724, priceType: 'VEILEDENDE', sentAt: 1, totalConfirmed: true }), /confirmed/i);
  assert.throws(() => amountToNokMinor({ totalNok: 5724, priceType: 'BEKREFTET', sentAt: null, totalConfirmed: true }), /sent/i);
  assert.throws(() => amountToNokMinor({ totalNok: 5724, priceType: 'BEKREFTET', sentAt: 1, totalConfirmed: false }), /total/i);
});

test('webhook fulfillment requires paid status and exact amount/currency', () => {
  const order = { amountMinor: 572400, currency: 'nok' };
  assert.equal(verifyCheckoutCompleted(order, { payment_status: 'paid', amount_total: 572400, currency: 'nok' }), true);
  assert.equal(verifyCheckoutCompleted(order, { payment_status: 'unpaid', amount_total: 572400, currency: 'nok' }), false);
  assert.equal(verifyCheckoutCompleted(order, { payment_status: 'paid', amount_total: 572399, currency: 'nok' }), false);
  assert.equal(verifyCheckoutCompleted(order, { payment_status: 'paid', amount_total: 572400, currency: 'usd' }), false);
});

test('payment link requires explicit customer acceptance and a valid acceptance method', async () => {
  const { validateOpsPaymentOrder } = await import('../src/payment-domain');
  assert.deepEqual(validateOpsPaymentOrder({ totalNok: 5724, accepted: true, acceptanceMethod: 'PHONE', acceptanceNote: 'Kunden godtok totalen' }), { amountMinor: 572400, method: 'PHONE', note: 'Kunden godtok totalen' });
  assert.throws(() => validateOpsPaymentOrder({ totalNok: 5724, accepted: false, acceptanceMethod: 'PHONE', acceptanceNote: 'ok' }), /acceptance/i);
  assert.throws(() => validateOpsPaymentOrder({ totalNok: 5724, accepted: true, acceptanceMethod: 'OTHER', acceptanceNote: 'ok' }), /method/i);
  assert.throws(() => validateOpsPaymentOrder({ totalNok: 5724, accepted: true, acceptanceMethod: 'EMAIL', acceptanceNote: '' }), /note/i);
});

test('Checkout uses the server total, NOK and only cards plus Klarna with a quote-bound identity', () => {
  const p = buildCheckoutSessionParameters({
    orderId: 'ord_12345678', inquiryId: 14, quoteId: 29, quoteVersion: 2,
    amountMinor: 572400, customerEmail: 'kunde@example.no', origin: 'https://finnbilglass.no',
  });
  assert.equal(p.get('mode'), 'payment');
  assert.equal(p.get('line_items[0][price_data][currency]'), 'nok');
  assert.equal(p.get('line_items[0][price_data][unit_amount]'), '572400');
  assert.equal(p.get('customer_email'), 'kunde@example.no');
  assert.equal(p.get('metadata[order_id]'), 'ord_12345678');
  assert.equal(p.get('metadata[quote_id]'), '29');
  assert.equal(p.get('payment_method_types[0]'), 'card');
  assert.equal(p.get('payment_method_types[1]'), 'klarna');
  assert.equal(p.get('payment_method_types[2]'), null);
  assert.match(p.get('success_url') || '', /finnbilglass\.no\/betaling/);
  const configured = buildCheckoutSessionParameters({
    orderId: 'ord_12345678', inquiryId: 14, quoteId: 29, quoteVersion: 2,
    amountMinor: 572400, customerEmail: 'kunde@example.no', origin: 'https://finnbilglass.no',
    paymentMethodConfiguration: 'pmc_123abc',
  });
  assert.equal(configured.get('payment_method_configuration'), 'pmc_123abc');
  assert.equal(configured.get('payment_method_types[0]'), null);
  assert.equal(configured.get('payment_method_types[1]'), null);
  assert.throws(() => buildCheckoutSessionParameters({
    orderId: 'ord_12345678', inquiryId: 14, quoteId: 29, quoteVersion: 2,
    amountMinor: 572400, customerEmail: 'kunde@example.no', origin: 'https://finnbilglass.no',
    paymentMethodConfiguration: 'arbitrary-value',
  }), /configuration/i);
  assert.throws(() => buildCheckoutSessionParameters({
    orderId: 'ord_12345678', inquiryId: 14, quoteId: 29, quoteVersion: 2,
    amountMinor: 0, customerEmail: 'kunde@example.no', origin: 'https://finnbilglass.no',
  }), /amount/i);
});

test('Stripe webhook signature accepts a valid recent signature and rejects altered, invalid and stale requests', async () => {
  const secret = 'whsec_test_only_for_unit_tests';
  const timestamp = 1_800_000_000;
  const payload = '{"id":"evt_test","type":"checkout.session.completed"}';
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const digest = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(`${timestamp}.${payload}`)));
  const signature = [...digest].map((b) => b.toString(16).padStart(2, '0')).join('');
  const header = `t=${timestamp},v1=${signature}`;
  assert.equal(await verifyStripeSignature(payload, header, secret, timestamp * 1000), true);
  assert.equal(await verifyStripeSignature(payload + ' ', header, secret, timestamp * 1000), false);
  assert.equal(await verifyStripeSignature(payload, `t=${timestamp},v1=bad`, secret, timestamp * 1000), false);
  assert.equal(await verifyStripeSignature(payload, header, secret, (timestamp + 301) * 1000), false);
});

test('a sent offer requires an explicit confirmed customer total that covers the glass price', () => {
  assert.equal(customerTotalForOffer({ glassNok: 5200, totalNok: 5724, priceType: 'BEKREFTET', send: true }), 5724);
  assert.equal(customerTotalForOffer({ glassNok: 5200, totalNok: null, priceType: 'VEILEDENDE', send: false }), null);
  assert.throws(() => customerTotalForOffer({ glassNok: 5200, totalNok: null, priceType: 'BEKREFTET', send: true }), /total/i);
  assert.throws(() => customerTotalForOffer({ glassNok: 5200, totalNok: 5000, priceType: 'BEKREFTET', send: true }), /total/i);
  assert.throws(() => customerTotalForOffer({ glassNok: 5200, totalNok: 5724, priceType: 'VEILEDENDE', send: true }), /confirmed/i);
});
