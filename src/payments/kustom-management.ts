import {
  apiBase,
  classifyKustomOrderManagement,
  type KustomEnvironment
} from './kustom-core.js';

const validId =
  /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export type KustomManagedOrder = {
  order_id: string;
  status: string;
  fraud_status: string;
  order_amount: number;
  original_order_amount: number;
  captured_amount: number;
  refunded_amount: number;
  remaining_authorized_amount: number;
  purchase_currency: string;
};

export type ReconciledState =
  | 'AUTHORIZED'
  | 'PAID'
  | 'REFUNDED'
  | 'PENDING_REVIEW'
  | 'REJECTED'
  | 'NEEDS_RECONCILIATION';

function checkId(id: string): void {
  if (!validId.test(id)) {
    throw new Error('UGYLDIG_KUSTOM_ORDRE_ID');
  }
}

function auth(env: KustomEnvironment): string {
  if (!env.KUSTOM_API_USERNAME ||
      !env.KUSTOM_API_PASSWORD) {
    throw new Error('KUSTOM_SECRETS_MANGLER');
  }

  return 'Basic ' + btoa(
    `${env.KUSTOM_API_USERNAME}:${env.KUSTOM_API_PASSWORD}`
  );
}

export async function readKustomManagedOrder(
  env: KustomEnvironment,
  id: string
): Promise<KustomManagedOrder> {
  checkId(id);

  const response = await fetch(
    `${apiBase(env)}/ordermanagement/v1/orders/${id}`,
    {
      headers: {
        Authorization: auth(env),
        Accept: 'application/json'
      },
      signal: AbortSignal.timeout(12000)
    }
  );

  if (!response.ok) {
    throw new Error(
      `KUSTOM_ORDER_READ_HTTP_${response.status}`
    );
  }

  const data = await response.json() as Partial<KustomManagedOrder>;

  const amounts = [
    data.order_amount,
    data.original_order_amount,
    data.captured_amount,
    data.refunded_amount,
    data.remaining_authorized_amount
  ];

  if (
    data.order_id !== id ||
    typeof data.status !== 'string' ||
    typeof data.fraud_status !== 'string' ||
    typeof data.purchase_currency !== 'string' ||
    !amounts.every(
      n => Number.isSafeInteger(n) && Number(n) >= 0
    )
  ) {
    throw new Error('KUSTOM_ORDER_INVALID_RESPONSE');
  }

  return data as KustomManagedOrder;
}

export function reconcileKustomManagedOrder(
  order: KustomManagedOrder,
  expected: {
    kustomOrderId: string;
    amountMinor: number;
  }
): ReconciledState {
  const amount = expected.amountMinor;

  if (
    order.order_id !== expected.kustomOrderId ||
    !Number.isSafeInteger(amount) ||
    amount <= 0 ||
    order.purchase_currency.toUpperCase() !== 'NOK' ||
    order.order_amount !== amount ||
    order.original_order_amount !== amount ||
    order.captured_amount > amount ||
    order.refunded_amount > order.captured_amount ||
    order.remaining_authorized_amount > amount
  ) {
    return 'NEEDS_RECONCILIATION';
  }

  const fraud = order.fraud_status.toUpperCase();

  if (fraud === 'PENDING') return 'PENDING_REVIEW';
  if (fraud === 'REJECTED') return 'REJECTED';

  if (fraud !== 'ACCEPTED') {
    return 'NEEDS_RECONCILIATION';
  }

  return classifyKustomOrderManagement(order, amount);
}

// Kalles kun etter varig lagring i databasen.
export async function acknowledgeKustomManagedOrder(
  env: KustomEnvironment,
  id: string
): Promise<void> {
  checkId(id);

  const response = await fetch(
    `${apiBase(env)}/ordermanagement/v1/orders/${id}/acknowledge`,
    {
      method: 'POST',
      headers: {
        Authorization: auth(env),
        Accept: 'application/json', 'Klarna-Idempotency-Key': id
      },
      signal: AbortSignal.timeout(12000)
    }
  );

  if (!response.ok) {
    throw new Error(
      `KUSTOM_ORDER_ACK_HTTP_${response.status}`
    );
  }
}
