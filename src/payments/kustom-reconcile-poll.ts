/**
 * Safe backstop for a missed Kustom HPP status callback.
 *
 * NOT wired to cron, HTTP routes, or an automatic money movement.
 * Reads provider state with GET only; writes only verified status and
 * deduplicated audit event into our own D1 transaction.
 * Must be separately approved, configured, and tested on staging
 * before any production scheduler or API route is added.
 */
import type { KustomEnvironment } from './kustom-core.js';
import { readHpp, readKustomCheckout } from './kustom-core.js';
import { readKustomManagedOrder, reconcileKustomManagedOrder } from './kustom-management.js';

export type PollState = 'AUTHORIZED' | 'PAID' | 'PENDING' | 'REVIEW_REQUIRED' | 'ALREADY_FINAL';
export type PollResult = {
  orderId: string;
  state: PollState;
  updated: boolean;
  reason?: string;
};

type PaymentOrder = {
  id: string;
  payment_provider: string;
  kustom_order_id: string | null;
  kustom_hpp_session_id: string | null;
  amount_minor: number;
  status: string;
  kustom_capture_state: string | null;
  kustom_authorized_at: number | null;
  paid_at: number | null;
  refunded_minor: number;
};

const internalId = /^[A-Za-z0-9_-]{8,100}$/;
const providerUuid = /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;

/** A separate fail-closed gate, intentionally absent from production config. */
export function kustomPollingAllowed(env: KustomEnvironment & {
  KUSTOM_RECONCILIATION_ENABLED?: string;
}): boolean {
  return env.KUSTOM_ENABLED === 'true' &&
    env.KUSTOM_RECONCILIATION_ENABLED === 'true' &&
    Boolean(env.KUSTOM_API_USERNAME && env.KUSTOM_API_PASSWORD) &&
    (env.ENVIRONMENT === 'staging' ||
      (env.ENVIRONMENT === 'production' && env.KUSTOM_PRODUCTION_APPROVED === 'true'));
}

/**
 * This function cannot initiate a new checkout, capture, refund or acknowledge.
 * It intentionally accepts one internal payment order ID and never searches
 * customers or performs a mass operation.
 */
export async function pollKnownKustomOrder(
  db: D1Database,
  env: KustomEnvironment & { KUSTOM_RECONCILIATION_ENABLED?: string },
  orderId: string
): Promise<PollResult> {
  if (!kustomPollingAllowed(env)) throw new Error('KUSTOM_POLL_DISABLED');
  if (!internalId.test(orderId)) throw new Error('KUSTOM_POLL_ORDER_ID_INVALID');

  const order = await db.prepare(
    'SELECT id,payment_provider,kustom_order_id,kustom_hpp_session_id,' +
    'amount_minor,status,kustom_capture_state,kustom_authorized_at,paid_at,refunded_minor ' +
    'FROM quote_payment_orders WHERE id=?'
  ).bind(orderId).first<PaymentOrder>();

  const result = (state: PollState, reason?: string): PollResult =>
    ({ orderId, state, updated: false, ...(reason ? { reason } : {}) });

  if (!order || order.payment_provider !== 'kustom' ||
      !order.kustom_order_id || !providerUuid.test(order.kustom_order_id) ||
      !order.kustom_hpp_session_id || !providerUuid.test(order.kustom_hpp_session_id) ||
      !Number.isSafeInteger(order.amount_minor) || order.amount_minor <= 0 ||
      !Number.isSafeInteger(order.refunded_minor) || order.refunded_minor !== 0) {
    return result('REVIEW_REQUIRED', 'LOCAL_ORDER_INVALID');
  }
  if (['PAID', 'REFUNDED', 'PARTIALLY_REFUNDED', 'REFUND_PENDING'].includes(order.status)) {
    return result('ALREADY_FINAL');
  }
  if (!['ACCEPTED', 'PAYMENT_LINK_SENT'].includes(order.status) || order.paid_at !== null) {
    return result('REVIEW_REQUIRED', 'LOCAL_STATE_INVALID');
  }

  let checkout, hpp, managed;
  try {
    // Only the three provider GETs. The callback token is never logged or sent.
    hpp = await readHpp(env, order.kustom_hpp_session_id);
    checkout = await readKustomCheckout(env, order.kustom_order_id);
    if (!hpp || hpp.session_id !== order.kustom_hpp_session_id ||
        (hpp.order_id && hpp.order_id !== order.kustom_order_id) ||
        !checkout || checkout.order_id !== order.kustom_order_id ||
        checkout.merchant_reference1 !== order.id ||
        checkout.order_amount !== order.amount_minor ||
        typeof checkout.purchase_currency !== 'string' ||
        checkout.purchase_currency.toUpperCase() !== 'NOK') {
      return result('REVIEW_REQUIRED', 'PROVIDER_IDENTITY_MISMATCH');
    }
    if (typeof hpp.status !== 'string' || typeof checkout.status !== 'string') {
      return result('REVIEW_REQUIRED', 'PROVIDER_STATUS_INVALID');
    }
    if (hpp.status.toUpperCase() !== 'COMPLETED' ||
        checkout.status.toLowerCase() !== 'checkout_complete') {
      return result('PENDING');
    }
    if (hpp.order_id !== order.kustom_order_id) {
      return result('REVIEW_REQUIRED', 'HPP_ORDER_ID_MISMATCH');
    }
    managed = await readKustomManagedOrder(env, order.kustom_order_id);
  } catch {
    // Missing/expired Checkout records cannot be guessed from HPP alone.
    return result('REVIEW_REQUIRED', 'PROVIDER_GET_FAILED');
  }

  const state = reconcileKustomManagedOrder(managed, {
    kustomOrderId: order.kustom_order_id,
    amountMinor: order.amount_minor
  });
  if (state !== 'AUTHORIZED' && state !== 'PAID') {
    // Never automatically mark refunded, rejected or partly captured orders.
    return result('REVIEW_REQUIRED', 'PROVIDER_STATE_REQUIRES_MANUAL_REVIEW');
  }
  // Reconciliation is limited to no-refund orders in the initial release.
  if (managed.refunded_amount !== 0 || managed.fraud_status.toUpperCase() !== 'ACCEPTED') {
    return result('REVIEW_REQUIRED', 'PROVIDER_MONEY_MISMATCH');
  }
  const now = Date.now();
  const update = state === 'AUTHORIZED'
    ? db.prepare(
      "UPDATE quote_payment_orders SET kustom_capture_state='AUTHORIZED'," +
      'kustom_authorized_at=COALESCE(kustom_authorized_at,?),updated_at=? ' +
      "WHERE id=? AND payment_provider='kustom' AND kustom_order_id=? AND " +
      'kustom_hpp_session_id=? AND amount_minor=? ' +
      "AND status IN ('ACCEPTED','PAYMENT_LINK_SENT') AND paid_at IS NULL " +
      "AND refunded_minor=0 AND (kustom_capture_state IS NULL OR " +
      "kustom_capture_state='PENDING_REVIEW')"
    ).bind(now, now, order.id, order.kustom_order_id, order.kustom_hpp_session_id, order.amount_minor)
    : db.prepare(
      "UPDATE quote_payment_orders SET status='PAID',paid_at=COALESCE(paid_at,?)," +
      "kustom_capture_state='PAID',updated_at=? " +
      "WHERE id=? AND payment_provider='kustom' AND kustom_order_id=? " +
      'AND kustom_hpp_session_id=? AND amount_minor=? ' +
      "AND status IN ('ACCEPTED','PAYMENT_LINK_SENT') AND paid_at IS NULL " +
      "AND refunded_minor=0 AND (kustom_capture_state IS NULL OR " +
      "kustom_capture_state IN ('AUTHORIZED','PENDING_REVIEW'))"
    ).bind(now, now, order.id, order.kustom_order_id, order.kustom_hpp_session_id, order.amount_minor);

  const eventId = [
    'kustom_poll', order.kustom_order_id, state,
    managed.captured_amount, managed.refunded_amount
  ].join('_');
  const audit = db.prepare(
    'INSERT OR IGNORE INTO kustom_payment_events ' +
    '(event_id,order_id,kustom_order_id,kustom_session_id,received_at,processed_at,state,error_code) ' +
    'SELECT ?,id,kustom_order_id,kustom_hpp_session_id,?,?,?,NULL ' +
    "FROM quote_payment_orders WHERE id=? AND payment_provider='kustom' " +
    'AND kustom_order_id=? AND kustom_hpp_session_id=? AND amount_minor=? ' +
    'AND kustom_capture_state=? AND refunded_minor=0'
  ).bind(eventId, now, now, state, order.id, order.kustom_order_id,
    order.kustom_hpp_session_id, order.amount_minor, state);

  // D1 batch is atomic. Failure of event insertion rolls back state update.
  const results = await db.batch([update, audit]);
  const persisted = await db.prepare(
    'SELECT status,kustom_capture_state,kustom_authorized_at,paid_at,refunded_minor ' +
    "FROM quote_payment_orders WHERE id=? AND payment_provider='kustom' AND " +
    'kustom_order_id=? AND kustom_hpp_session_id=?'
  ).bind(order.id, order.kustom_order_id, order.kustom_hpp_session_id).first<
    Pick<PaymentOrder, 'status'|'kustom_capture_state'|'kustom_authorized_at'|'paid_at'|'refunded_minor'>
  >();

  const valid = persisted && persisted.refunded_minor === 0 &&
    (state === 'AUTHORIZED'
      ? (persisted.status === 'ACCEPTED' || persisted.status === 'PAYMENT_LINK_SENT') &&
        persisted.kustom_capture_state === 'AUTHORIZED' && persisted.kustom_authorized_at !== null
      : persisted.status === 'PAID' && persisted.kustom_capture_state === 'PAID' &&
        persisted.paid_at !== null);
  if (!valid) return result('REVIEW_REQUIRED', 'CONCURRENT_STATE_CHANGE');
  return {
    orderId,
    state,
    updated: Number(results[0]?.meta?.changes ?? 0) === 1
  };
}
