/**
 * Kustom capture/refund client.
 * NOT connected to routes, callbacks or scheduled jobs.
 * Caller must reserve the operation in D1 and verify
 * administrative approval and fulfilment first.
 */
import {
  apiBase,
  type KustomEnvironment
} from './kustom-core.js';
import {
  readKustomManagedOrder
} from './kustom-management.js';

export type MoneyEnv = KustomEnvironment & {
  KUSTOM_MONEY_MOVEMENTS_ENABLED?: string;
};

export type MoneyOperation = {
  operationId: string;
  paymentOrderId: string;
  kustomOrderId: string;
  kind: 'capture' | 'refund';
  amountMinor: number;
  expectedOrderMinor: number;
};

const uuid = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const uuidV4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const internalId = /^[A-Za-z0-9_-]{8,100}$/;

export async function submitKustomMoneyOperation(
  env: MoneyEnv,
  operation: Readonly<MoneyOperation>
): Promise<{
  state: 'PENDING_RECONCILIATION';
  httpStatus: 201;
}> {
  if (env.KUSTOM_MONEY_MOVEMENTS_ENABLED !== 'true') {
    throw new Error('KUSTOM_MONEY_MOVEMENTS_DISABLED');
  }

  const op = operation;

  if (
    !uuidV4.test(op.operationId) ||
    !uuid.test(op.kustomOrderId) ||
    !internalId.test(op.paymentOrderId) ||
    !['capture', 'refund'].includes(op.kind) ||
    !Number.isSafeInteger(op.amountMinor) ||
    !Number.isSafeInteger(op.expectedOrderMinor) ||
    op.amountMinor <= 0 ||
    op.amountMinor !== op.expectedOrderMinor
  ) {
    throw new Error('KUSTOM_MONEY_OPERATION_INVALID');
  }

  const base = apiBase(env);

  if (!env.KUSTOM_API_USERNAME || !env.KUSTOM_API_PASSWORD) {
    throw new Error('KUSTOM_MONEY_SECRETS_MISSING');
  }

  const order = await readKustomManagedOrder(
    env, op.kustomOrderId
  );

  const expected = op.expectedOrderMinor;

  if (
    order.order_id !== op.kustomOrderId ||
    order.purchase_currency.toUpperCase() !== 'NOK' ||
    order.original_order_amount !== expected ||
    order.order_amount !== expected ||
    order.fraud_status.toUpperCase() !== 'ACCEPTED'
  ) {
    throw new Error('KUSTOM_MONEY_ORDER_MISMATCH');
  }

  if (op.kind === 'capture') {
    if (
      order.status.toUpperCase() !== 'AUTHORIZED' ||
      order.captured_amount !== 0 ||
      order.refunded_amount !== 0 ||
      order.remaining_authorized_amount !== expected
    ) {
      throw new Error('KUSTOM_NOT_READY_FOR_FULL_CAPTURE');
    }
  } else if (
    order.status.toUpperCase() !== 'CAPTURED' ||
    order.captured_amount !== expected ||
    order.refunded_amount !== 0
  ) {
    throw new Error('KUSTOM_NOT_READY_FOR_FULL_REFUND');
  }

  const path =
    `/ordermanagement/v1/orders/${op.kustomOrderId}/` +
    (op.kind === 'capture' ? 'captures' : 'refunds');

  const body = op.kind === 'capture'
    ? {
        captured_amount: expected,
        reference: op.paymentOrderId,
        description: 'Bilglass levert'
      }
    : {
        refunded_amount: expected,
        reference: op.paymentOrderId,
        description: 'Tilbakebetaling for bilglassordre'
      };

  let response: Response;

  try {
    response = await fetch(base + path, {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + btoa(
          `${env.KUSTOM_API_USERNAME}:${env.KUSTOM_API_PASSWORD}`
        ),
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'Klarna-Idempotency-Key': op.operationId
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(12000)
    });
  } catch {
    throw new Error(
      'KUSTOM_MONEY_UNKNOWN_OUTCOME_RECONCILE_FIRST'
    );
  }

  if (response.status >= 500) {
    throw new Error(
      'KUSTOM_MONEY_UNKNOWN_OUTCOME_RECONCILE_FIRST'
    );
  }

  if (response.status !== 201) {
    throw new Error(
      `KUSTOM_MONEY_HTTP_${response.status}`
    );
  }

  // HTTP 201 is not proof that D1 is reconciled.
  // A separate read-back and durable state update is required.
  return {
    state: 'PENDING_RECONCILIATION',
    httpStatus: 201
  };
}
