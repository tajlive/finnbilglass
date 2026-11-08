import test from 'node:test';
import assert from 'node:assert/strict';
import {
  submitKustomMoneyOperation
} from '../src/payments/kustom-money-ops.ts';

const id = '48fa4f0f-b269-4b02-9e8c-71704199cc10';

const env = {
  ENVIRONMENT: 'staging',
  KUSTOM_ENABLED: 'true',
  KUSTOM_MONEY_MOVEMENTS_ENABLED: 'true',
  KUSTOM_API_USERNAME: 'mock',
  KUSTOM_API_PASSWORD: 'mock'
};

const operation = {
  operationId: '550e8400-e29b-41d4-a716-446655440000',
  paymentOrderId: 'ord_1234567890',
  kustomOrderId: id,
  kind: 'capture',
  amountMinor: 187375,
  expectedOrderMinor: 187375
};

const authorized = {
  order_id: id,
  status: 'AUTHORIZED',
  fraud_status: 'ACCEPTED',
  order_amount: 187375,
  original_order_amount: 187375,
  captured_amount: 0,
  refunded_amount: 0,
  remaining_authorized_amount: 187375,
  purchase_currency: 'NOK'
};

test('disabled by default', async () => {
  await assert.rejects(
    submitKustomMoneyOperation(
      {...env, KUSTOM_MONEY_MOVEMENTS_ENABLED:'false'},
      operation
    ),
    /DISABLED/
  );
});

test('capture uses idempotency and returns pending', async () => {
  const original = globalThis.fetch;
  let posts = 0;

  try {
    globalThis.fetch = async (url, options = {}) => {
      if (options.method === 'POST') {
        posts++;
        assert.match(String(url), /\/captures$/);
        assert.equal(
          options.headers['Klarna-Idempotency-Key'],
          operation.operationId
        );
        assert.equal(
          JSON.parse(options.body).captured_amount,
          187375
        );
        return new Response(null, {status:201});
      }
      return Response.json(authorized);
    };

    const result = await submitKustomMoneyOperation(
      env, operation
    );

    assert.equal(result.state, 'PENDING_RECONCILIATION');
    assert.equal(posts, 1);
  } finally {
    globalThis.fetch = original;
  }
});

test('rejects manipulated amount', async () => {
  await assert.rejects(
    submitKustomMoneyOperation(
      env, {...operation, amountMinor:123}
    ),
    /INVALID/
  );
});

test('rejects repeated full capture', async () => {
  const original = globalThis.fetch;
  let posts = 0;

  try {
    globalThis.fetch = async (_, options = {}) => {
      if (options.method === 'POST') {
        posts++;
        return new Response(null, {status:201});
      }
      return Response.json({
        ...authorized,
        status:'CAPTURED',
        captured_amount:187375,
        remaining_authorized_amount:0
      });
    };

    await assert.rejects(
      submitKustomMoneyOperation(env, operation),
      /NOT_READY/
    );

    assert.equal(posts, 0);
  } finally {
    globalThis.fetch = original;
  }
});

test('full refund is submitted with the correct amount', async () => {
  const original = globalThis.fetch;
  let posts = 0;

  try {
    globalThis.fetch = async (url, options = {}) => {
      if (options.method === 'POST') {
        posts++;
        assert.match(String(url), /\/refunds$/);
        assert.equal(
          JSON.parse(options.body).refunded_amount,
          187375
        );
        return new Response(null, {status:201});
      }
      return Response.json({
        ...authorized,
        status:'CAPTURED',
        captured_amount:187375,
        remaining_authorized_amount:0
      });
    };

    const result = await submitKustomMoneyOperation(
      env, {...operation, kind:'refund'}
    );

    assert.equal(result.state, 'PENDING_RECONCILIATION');
    assert.equal(posts, 1);
  } finally {
    globalThis.fetch = original;
  }
});
