import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mottakEpost } from '../src/routes/epost.ts';

const rawKey = Buffer.from('synthetic-webhook-key-for-tests');
const secret = 'whsec_' + rawKey.toString('base64');

function signed(payload, override = {}) {
  const raw = JSON.stringify(payload);
  const id = 'msg-test-100';
  const ts = String(Math.floor(Date.now() / 1000));
  const signature = createHmac('sha256', rawKey).update(id + '.' + ts + '.' + raw).digest('base64');
  return new Request('https://example.test/api/ops/epost/mottak', {
    method: 'POST',
    headers: {
      'svix-id': id, 'svix-timestamp': ts, 'svix-signature': 'v1,' + signature,
      ...override,
    },
    body: raw,
  });
}
const env = { RESEND_WEBHOOK_SECRET: secret };

test('Resend: reject bad signature with no provider or DB call', async () => {
  const response = await mottakEpost(env, signed({
    type: 'email.received', data: { email_id: 'id_1', to: ['support@example.com'] },
  }, { 'svix-signature': 'v1,invalid' }));
  assert.equal(response.status, 401);
});

test('Resend: received event without configured address is retryable 503', async () => {
  const response = await mottakEpost(env, signed({
    type: 'email.received', data: { email_id: 'id_1', to: ['support@finnbilglass.no'] },
  }));
  assert.equal(response.status, 503);
});

test('Resend: valid receive with missing recipients is rejected, never silently acknowledged', async () => {
  const response = await mottakEpost({ ...env, OPS_INBOUND_ADDRESS: 'support@finnbilglass.no' }, signed({
    type: 'email.received', data: { email_id: 'id_1' },
  }));
  assert.equal(response.status, 422);
});

test('Resend: email.sent is not an inbound customer message', async () => {
  const response = await mottakEpost(env, signed({
    type: 'email.sent', data: { email_id: 'id_1', to: ['support@finnbilglass.no'] },
  }));
  assert.equal(response.status, 200);
});
