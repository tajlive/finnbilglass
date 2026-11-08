import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleKustomPlaygroundDiagnostics } from '../src/routes/kustom-playground-diagnostics.ts';

const admin = { epost: 'admin@example.com' };
const env = {
  ENVIRONMENT: 'staging', ADMIN_EMAILS: 'admin@example.com',
  KUSTOM_API_USERNAME: 'PM00730041-key', KUSTOM_API_PASSWORD: 'kco_test_api_test',
};
function request({ host = 'ops-staging.finnbilglass.no', method = 'GET', path = '/api/ops/kustom-playground-diagnostics', headers = {} } = {}) {
  return new Request(`https://${host}${path}`, { method, headers });
}
function deps({ identity = admin, fetcher = async () => new Response('{}', { status: 404 }) } = {}) {
  return { verifyAccess: async () => identity, fetch: fetcher };
}

test('Kustom diagnostics fail closed before network access without Access and ADMIN allowlist', async () => {
  let calls = 0;
  const fetcher = async () => { calls++; return new Response('{}'); };
  const noAccess = await handleKustomPlaygroundDiagnostics(request(), env, deps({ identity: null, fetcher }));
  assert.equal(noAccess.status, 401);
  const noAdminAllowlist = await handleKustomPlaygroundDiagnostics(request(), { ...env, ADMIN_EMAILS: 'other@example.com' }, deps({ fetcher }));
  assert.equal(noAdminAllowlist.status, 403);
  assert.equal(calls, 0);
});

test('diagnostics are limited to staging ops host and clean GET requests', async () => {
  let calls = 0;
  const fetcher = async () => { calls++; return new Response('{}'); };
  assert.equal((await handleKustomPlaygroundDiagnostics(request({ host: 'finnbilglass.no' }), env, deps({ fetcher }))).status, 404);
  assert.equal((await handleKustomPlaygroundDiagnostics(request({ method: 'POST' }), env, deps({ fetcher }))).status, 405);
  assert.equal((await handleKustomPlaygroundDiagnostics(request({ path: '/api/ops/kustom-playground-diagnostics?debug=1' }), env, deps({ fetcher }))).status, 400);
  assert.equal((await handleKustomPlaygroundDiagnostics(request(), { ...env, ENVIRONMENT: 'production' }, deps({ fetcher }))).status, 404);
  assert.equal(calls, 0);
});

test('credential scope mismatch exposes no credential material and makes no API requests', async () => {
  let calls = 0;
  const secret = 'never-return-this-password';
  const res = await handleKustomPlaygroundDiagnostics(request(), { ...env, KUSTOM_API_PASSWORD: secret }, deps({
    fetch: async () => { calls++; return new Response('{}'); },
  }));
  const body = await res.text();
  assert.equal(res.status, 409);
  assert.equal(calls, 0);
  assert.equal(body.includes(secret), false);
  assert.equal(body.includes(env.KUSTOM_API_USERNAME), false);
});

test('authenticated diagnostic queries fixed Playground GET endpoints and projects safe fields', async () => {
  const seen = [];
  const fetcher = async (url, init) => {
    seen.push({ url: String(url), init });
    if (String(url).endsWith('/checkout/v3/orders/does-not-exist')) return new Response('', { status: 404 });
    if (String(url).endsWith('/config/checkout/v1/config/expressCheckoutPaymentMethods')) {
      return Response.json([{ merchantId: 'M00808102', country: 'SE', revision: 9,
        expressCheckoutPaymentMethods: [{ method: 'applePay', enabled: true }, { method: 'madeUp', enabled: true }], secret: 'drop-me' }]);
    }
    if (String(url).endsWith('/config/checkout/v1/config/country/NO/expressCheckoutPaymentMethods')) {
      return Response.json({ merchantId: 'M00808102', country: 'NO', revision: 10,
        expressCheckoutPaymentMethods: [{ method: 'klarna', enabled: false }, { method: 'googlePay', enabled: true }], updatedBy: 'drop-me' });
    }
  return Response.json([{ id: 'playground_af2f89ec-92ca-4e8c-949f-0854a62d90ee', merchant_id: 'PM00730041',
      allowed_origins: ['https://preview.finnbilglass.no'], placements: [{ key: 'primary', content: [{ type: 'PAYMENT_METHOD' }] }], credentials: 'drop-me' }]);
  };
  const res = await handleKustomPlaygroundDiagnostics(request(), env, deps({ fetcher }));
  const bodyText = await res.text();
  const body = JSON.parse(bodyText);
  assert.equal(res.status, 200);
  assert.equal(body.checkoutAuthentication.accepted, true);
  assert.equal(body.checkoutAuthentication.httpStatus, 404);
  assert.deepEqual(body.expressCheckoutPaymentMethods.allCountries.configuration[0].expressCheckoutPaymentMethods, [{ method: 'applePay', enabled: true }]);
  assert.deepEqual(body.expressCheckoutPaymentMethods.norway.configuration[0].expressCheckoutPaymentMethods,
    [{ method: 'klarna', enabled: false }, { method: 'googlePay', enabled: true }]);
  assert.equal(body.elements.clients[0].merchantMatchesPlaygroundPortal, true);
  assert.equal(body.elements.clients[0].publicKeyMatchesStagingPreview, true);
  assert.deepEqual(body.elements.clients[0].allowedOrigins, ['https://preview.finnbilglass.no']);
  assert.equal(bodyText.includes('drop-me'), false);
  assert.equal(bodyText.includes(env.KUSTOM_API_PASSWORD), false);
  assert.equal(seen.length, 4);
  assert.ok(seen.every(({ url, init }) => url.startsWith('https://api.playground.kustom.co/') && init.method === 'GET'));
  const configCalls = seen.filter(({ url }) => url.includes('/config/'));
  assert.ok(configCalls.every(({ init }) => init.headers['X-merchant-id'] === 'M00808102'));
  const elementsCall = seen.find(({ url }) => url.includes('/elements/v1/clients/'));
  assert.equal(elementsCall.init.headers['X-merchant-id'], 'PM00730041');
  assert.ok(seen.every(({ init }) => init.redirect === 'manual'));
});
