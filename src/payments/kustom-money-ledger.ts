import {
  readKustomManagedOrder,
  type KustomManagedOrder
} from './kustom-management.js';
import type {
  KustomEnvironment
} from './kustom-core.js';

export type MoneyKind = 'capture' | 'refund';

export type PaymentSnapshot = {
  id: string;
  payment_provider: string;
  kustom_order_id: string | null;
  amount_minor: number;
  status: string;
  kustom_capture_state: string | null;
  kustom_authorized_at: number | null;
  paid_at: number | null;
  refunded_minor: number;
};

export type LedgerOperation = {
  operation_id: string;
  payment_order_id: string;
  kustom_order_id: string;
  operation_type: MoneyKind;
  amount_minor: number;
  state: 'RESERVED' | 'UNKNOWN' |
    'SUBMITTED' | 'RECONCILED' | 'FAILED';
};

const uuid =
  /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export function canReserveFullMoneyOperation(
  order: PaymentSnapshot,
  kind: MoneyKind
): boolean {
  if (
    order.payment_provider !== 'kustom' ||
    !order.kustom_order_id ||
    !uuid.test(order.kustom_order_id) ||
    !Number.isSafeInteger(order.amount_minor) ||
    order.amount_minor <= 0 ||
    order.refunded_minor !== 0
  ) return false;

  if (kind === 'capture') {
    return (
      ['ACCEPTED', 'PAYMENT_LINK_SENT'].includes(order.status) &&
      order.kustom_capture_state === 'AUTHORIZED' &&
      order.kustom_authorized_at !== null &&
      order.paid_at === null
    );
  }

  return (
    kind === 'refund' &&
    order.status === 'PAID' &&
    order.kustom_capture_state === 'PAID' &&
    order.paid_at !== null
  );
}

export function providerConfirmsFullMovement(
  managed: KustomManagedOrder,
  op: LedgerOperation
): boolean {
  const amount = op.amount_minor;

  if (
    managed.order_id !== op.kustom_order_id ||
    managed.purchase_currency.toUpperCase() !== 'NOK' ||
    managed.fraud_status.toUpperCase() !== 'ACCEPTED' ||
    managed.original_order_amount !== amount ||
    managed.order_amount !== amount ||
    managed.remaining_authorized_amount !== 0 ||
    managed.captured_amount !== amount
  ) return false;

  if (op.operation_type === 'capture') {
    return (
      managed.status.toUpperCase() === 'CAPTURED' &&
      managed.refunded_amount === 0
    );
  }

  return (
    op.operation_type === 'refund' &&
    managed.status.toUpperCase() === 'CAPTURED' &&
    managed.refunded_amount === amount
  );
}

/**
 * Reserve one immutable operation per payment and type.
 * Must be called only by an authorized Ops workflow.
 * Does not initiate a provider request.
 */
export async function reserveFullMoneyOperation(
  db: D1Database,
  paymentOrderId: string,
  kind: MoneyKind
): Promise<{
  created: boolean;
  operation: LedgerOperation;
}> {
  if (
    !/^[A-Za-z0-9_-]{8,100}$/.test(paymentOrderId) ||
    !['capture', 'refund'].includes(kind)
  ) {
    throw new Error('KUSTOM_LEDGER_INPUT_INVALID');
  }

  const find = () => db.prepare(`
    SELECT operation_id,payment_order_id,kustom_order_id,
           operation_type,amount_minor,state
    FROM kustom_money_operations
    WHERE payment_order_id=? AND operation_type=?
  `).bind(paymentOrderId,kind).first<LedgerOperation>();

  const existing = await find();

  if (existing) {
    return { created: false, operation: existing };
  }

  const payment = await db.prepare(`
    SELECT id,payment_provider,kustom_order_id,
           amount_minor,status,kustom_capture_state,
           kustom_authorized_at,paid_at,refunded_minor
    FROM quote_payment_orders WHERE id=?
  `).bind(paymentOrderId).first<PaymentSnapshot>();

  if (
    !payment ||
    !canReserveFullMoneyOperation(payment,kind)
  ) {
    throw new Error('KUSTOM_LEDGER_ORDER_NOT_ELIGIBLE');
  }

  const result = await db.prepare(`
    INSERT INTO kustom_money_operations
    (operation_id,payment_order_id,kustom_order_id,
     operation_type,amount_minor,state,reserved_at)

    SELECT ?,id,kustom_order_id,?,amount_minor,
           'RESERVED',?

    FROM quote_payment_orders

    WHERE id=?
      AND payment_provider='kustom'
      AND kustom_order_id=?
      AND amount_minor=?
      AND refunded_minor=0
      AND (
        (?='capture'
         AND status IN ('ACCEPTED','PAYMENT_LINK_SENT')
         AND kustom_capture_state='AUTHORIZED'
         AND kustom_authorized_at IS NOT NULL
         AND paid_at IS NULL)

        OR

        (?='refund'
         AND status='PAID'
         AND kustom_capture_state='PAID'
         AND paid_at IS NOT NULL)
      )

    ON CONFLICT(payment_order_id,operation_type)
    DO NOTHING
  `).bind(
    crypto.randomUUID(),kind,Date.now(),
    paymentOrderId,payment.kustom_order_id,
    payment.amount_minor,kind,kind
  ).run();

  const operation = await find();

  if (!operation) {
    throw new Error('KUSTOM_LEDGER_RESERVATION_NOT_SAVED');
  }

  return {
    created: result.meta.changes === 1,
    operation
  };
}

/**
 * Mark outcome UNKNOWN BEFORE any external POST.
 * A crash must never trigger an automatic second POST.
 */
export async function claimMoneyOperationOnce(
  db: D1Database,
  operationId: string
): Promise<boolean> {
  if (!uuid.test(operationId)) {
    throw new Error('KUSTOM_LEDGER_OPERATION_ID_INVALID');
  }

  const result = await db.prepare(`
    UPDATE kustom_money_operations
    SET state='UNKNOWN',submitted_at=?
    WHERE operation_id=? AND state='RESERVED'
  `).bind(Date.now(),operationId).run();

  return result.meta.changes === 1;
}

export async function markMoneyOperationSubmitted(
  db: D1Database,
  operationId: string
): Promise<boolean> {
  const result = await db.prepare(`
    UPDATE kustom_money_operations
    SET state='SUBMITTED'
    WHERE operation_id=? AND state='UNKNOWN'
  `).bind(operationId).run();

  return result.meta.changes === 1;
}

/**
 * Provider GET only; no capture/refund POST.
 * Mark reconciled only when the exact full movement
 * is confirmed by Kustom Order Management.
 */
export async function reconcileMoneyOperation(
  db: D1Database,
  env: KustomEnvironment,
  operationId: string
): Promise<'RECONCILED' | 'REVIEW_REQUIRED'> {
  const op = await db.prepare(`
    SELECT operation_id,payment_order_id,kustom_order_id,
           operation_type,amount_minor,state
    FROM kustom_money_operations
    WHERE operation_id=?
  `).bind(operationId).first<LedgerOperation>();

  if (!op) {
    throw new Error('KUSTOM_LEDGER_OPERATION_NOT_FOUND');
  }

  if (op.state === 'RECONCILED') {
    return 'RECONCILED';
  }

  if (!['UNKNOWN','SUBMITTED'].includes(op.state)) {
    return 'REVIEW_REQUIRED';
  }

  const payment = await db.prepare(`
    SELECT id,payment_provider,kustom_order_id,
           amount_minor,status,kustom_capture_state,
           kustom_authorized_at,paid_at,refunded_minor
    FROM quote_payment_orders WHERE id=?
  `).bind(op.payment_order_id).first<PaymentSnapshot>();

  if (
    !payment ||
    payment.payment_provider !== 'kustom' ||
    payment.kustom_order_id !== op.kustom_order_id ||
    payment.amount_minor !== op.amount_minor
  ) return 'REVIEW_REQUIRED';

  const managed = await readKustomManagedOrder(
    env, op.kustom_order_id
  );

  if (!providerConfirmsFullMovement(managed,op)) {
    return 'REVIEW_REQUIRED';
  }


  // KUSTOM_SYNC_VERIFIED_BEFORE_LEDGER
  // Provider GET is already verified above.
  // Each update is idempotent. A failed ledger write
  // can be resumed without repeating a money POST.
  const syncNow = Date.now();

  if (op.operation_type === 'capture') {
    await db.prepare(`
      UPDATE quote_payment_orders
      SET status='PAID',
          kustom_capture_state='PAID',
          paid_at=COALESCE(paid_at,?),
          updated_at=?
      WHERE id=?
        AND payment_provider='kustom'
        AND kustom_order_id=?
        AND amount_minor=?
        AND status IN ('ACCEPTED','PAYMENT_LINK_SENT','PAID')
        AND refunded_minor=0
    `).bind(
      syncNow, syncNow,
      op.payment_order_id, op.kustom_order_id,
      op.amount_minor
    ).run();
  } else {
    await db.prepare(`
      UPDATE quote_payment_orders
      SET status='REFUNDED',
          kustom_capture_state='REFUNDED',
          refunded_minor=?,
          updated_at=?
      WHERE id=?
        AND payment_provider='kustom'
        AND kustom_order_id=?
        AND amount_minor=?
        AND status IN ('PAID','REFUND_PENDING','REFUNDED')
        AND paid_at IS NOT NULL
        AND refunded_minor IN (0,?)
    `).bind(
      op.amount_minor, syncNow,
      op.payment_order_id, op.kustom_order_id,
      op.amount_minor, op.amount_minor
    ).run();
  }

  const synced = await db.prepare(`
    SELECT id,payment_provider,kustom_order_id,
           amount_minor,status,kustom_capture_state,
           kustom_authorized_at,paid_at,refunded_minor
    FROM quote_payment_orders WHERE id=?
  `).bind(op.payment_order_id).first<PaymentSnapshot>();

  if (
    !synced ||
    synced.payment_provider !== 'kustom' ||
    synced.kustom_order_id !== op.kustom_order_id ||
    synced.amount_minor !== op.amount_minor ||
    synced.paid_at === null ||
    !(
      op.operation_type === 'capture'
        ? (
            synced.status === 'PAID' &&
            synced.kustom_capture_state === 'PAID' &&
            synced.refunded_minor === 0
          )
        : (
            synced.status === 'REFUNDED' &&
            synced.kustom_capture_state === 'REFUNDED' &&
            synced.refunded_minor === op.amount_minor
          )
    )
  ) {
    return 'REVIEW_REQUIRED';
  }

  const result = await db.prepare(`
    UPDATE kustom_money_operations
    SET state='RECONCILED',reconciled_at=?
    WHERE operation_id=?
      AND state IN ('UNKNOWN','SUBMITTED')
  `).bind(Date.now(),operationId).run();

  return result.meta.changes === 1
    ? 'RECONCILED'
    : 'REVIEW_REQUIRED';
}
