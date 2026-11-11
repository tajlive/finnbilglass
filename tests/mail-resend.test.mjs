import test from 'node:test';
import assert from 'node:assert/strict';
import { sendMail, sendCaseReply } from '../src/mail.ts';

test('Resend: missing key does not perform any network request', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('Network must not be called'); };
  try {
    assert.deepEqual(await sendMail({}, { to: 'example@example.com', subject: 'Test', html: '<p>Test</p>', text: 'Test' }), { ok: false, error: 'RESEND_API_KEY mangler' });
  } finally { globalThis.fetch = original; }
});

test('Resend: case reply escapes user input and records provider ID', async () => {
  const original = globalThis.fetch;
  let seen = null;
  globalThis.fetch = async (url, options) => {
    seen = { url, options, payload: JSON.parse(options.body) };
    return new Response(JSON.stringify({ id: 'mail_12345' }), { status: 200 });
  };
  try {
    const result = await sendCaseReply(
      { RESEND_API_KEY: 'test-api-key', SUPPORT_FROM_EMAIL: 'support@finnbilglass.no' },
      'synthetic@example.com', '<Ola & Co>', 'SU18018', 'Kan du se på <b>kamera</b>?\nMvh',
    );
    assert.deepEqual(result, { ok: true, id: 'mail_12345' });
    assert.equal(seen.url, 'https://api.resend.com/emails');
    assert.equal(seen.options.headers.Authorization, 'Bearer test-api-key');
    assert.deepEqual(seen.payload.to, ['synthetic@example.com']);
    assert.equal(seen.payload.reply_to, 'support@finnbilglass.no');
    assert.match(seen.payload.subject, /SU18018/);
    assert.match(seen.payload.html, /&lt;Ola &amp; Co&gt;/);
    assert.match(seen.payload.html, /&lt;b&gt;kamera&lt;\/b&gt;/);
    assert.doesNotMatch(seen.payload.html, /<b>kamera<\/b>/);
    assert.match(seen.payload.text, /Kan du se på <b>kamera<\/b>\?/);
  } finally { globalThis.fetch = original; }
});

test('Resend: idempotency header is forwarded unchanged', async () => {
  const original = globalThis.fetch;
  let seen = null;
  globalThis.fetch = async (_url, options) => {
    seen = options.headers;
    return new Response('{}', { status: 202 });
  };
  try {
    const r = await sendMail({ RESEND_API_KEY: 'test' }, {
      to: 'synthetic@example.com', subject: 'Test', html: 'Hei', text: 'Hei', idempotencyKey: 'ops-case-123',
    });
    assert.equal(r.ok, true);
    assert.equal(seen['Idempotency-Key'], 'ops-case-123');
  } finally { globalThis.fetch = original; }
});

test('Resend: API errors and network errors are not acknowledged as sent', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response('provider rejected', { status: 403 });
    const rejected = await sendMail({ RESEND_API_KEY: 'test' }, {
      to: 'synthetic@example.com', subject: 'Test', html: 'Hei', text: 'Hei',
    });
    assert.equal(rejected.ok, false);
    assert.match(rejected.error, /Resend 403/);
    globalThis.fetch = async () => { throw new Error('network offline'); };
    const network = await sendMail({ RESEND_API_KEY: 'test' }, {
      to: 'synthetic@example.com', subject: 'Test', html: 'Hei', text: 'Hei',
    });
    assert.equal(network.ok, false);
    assert.match(network.error, /network offline/);
  } finally { globalThis.fetch = original; }
});
