import type { Env } from '../types';
import type { D1Database } from '@cloudflare/workers-types';

type RefundInput = { orderId: string; inquiryId: number; requestId: string; reason: string; actor: string };
type RefundStatus = 'REFUNDED' | 'REFUND_PENDING';

function keyAllowed(env: Env): boolean {
  const key = env.STRIPE_SECRET_KEY || '';
  return env.STRIPE_CHECKOUT_ENABLED === 'true' && Boolean(env.STRIPE_WEBHOOK_SECRET) &&
    (env.ENVIRONMENT === 'staging' ? /^(sk|rk)_test_/.test(key) : env.ENVIRONMENT === 'production' && /^(sk|rk)_live_/.test(key));
}

export async function refundPaidQuoteOrder(
  db: D1Database,
  env: Env,
  input: RefundInput,
): Promise<{ status: RefundStatus; alreadyProcessed?: boolean }> {
  if (!keyAllowed(env)) throw new Error('BETALESMILJO_IKKE_KONFIGURERT');
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(input.orderId) || !/^[A-Za-z0-9_-]{16,100}$/.test(input.requestId)) {
    throw new Error('UGYLDIG_REFUSJONSFORESPORSEL');
  }
  const reason = input.reason.trim().slice(0, 300);
  if (reason.length < 3) throw new Error('REFUSJONSGRUNN_KREVES');
  const order = await db.prepare(`SELECT id,inquiry_id,amount_minor,currency,status,stripe_payment_intent_id,refunded_minor
    FROM quote_payment_orders WHERE id=? AND inquiry_id=?`).bind(input.orderId, input.inquiryId).first<{
      id: string; inquiry_id: number; amount_minor: number; currency: string; status: string;
      stripe_payment_intent_id: string | null; refunded_minor: number;
    }>();
  if (!order) throw new Error('ORDRE_FINNES_IKKE');
  const refund = await db.prepare(`SELECT id,order_id,amount_minor,status,stripe_refund_id FROM stripe_payment_refunds WHERE idempotency_key=?`)
    .bind(input.requestId).first<{ id: string; order_id: string; amount_minor: number; status: string; stripe_refund_id: string | null }>();
  if (refund && (refund.order_id !== order.id || refund.amount_minor !== order.amount_minor)) throw new Error('IDEMPOTENSKONFLIKT');
  if (refund?.status === 'SUCCEEDED') return { status: 'REFUNDED', alreadyProcessed: true };
  if (order.status !== 'PAID' && !(order.status === 'REFUND_PENDING' && refund?.order_id === order.id)) throw new Error('ORDRE_IKKE_BETALT');
  if (!order.stripe_payment_intent_id || order.currency.toLowerCase() !== 'nok' || order.refunded_minor !== 0) throw new Error('ORDRE_IKKE_REFUNDERBAR');

  const now = Date.now();
  if (!refund) {
    const reserved = await db.prepare(`UPDATE quote_payment_orders SET status='REFUND_PENDING',updated_at=?
      WHERE id=? AND inquiry_id=? AND status='PAID' AND refunded_minor=0`).bind(now, order.id, input.inquiryId).run();
    if (reserved.meta.changes !== 1) throw new Error('REFUSJON_ALLEREDE_BEHANDLES');
    await db.prepare(`INSERT INTO stripe_payment_refunds(id,order_id,idempotency_key,amount_minor,reason,status,requested_by,created_at,updated_at)
      VALUES(?,?,?,?,?,'PENDING',?,?,?)`).bind(`ref_${crypto.randomUUID().replace(/-/g, '')}`, order.id, input.requestId,
      order.amount_minor, reason, input.actor, now, now).run();
  }

  let response: Response;
  try {
    response = await fetch('https://api.stripe.com/v1/refunds', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Idempotency-Key': `fbg-refund-${input.requestId}`,
        'Stripe-Version': '2026-10-28.endive',
      },
      body: new URLSearchParams({ payment_intent: order.stripe_payment_intent_id, amount: String(order.amount_minor), reason: 'requested_by_customer' }).toString(),
    });
  } catch {
    // Keep REFUND_PENDING so a retry with the same idempotency key reconciles safely.
    return { status: 'REFUND_PENDING' };
  }
  const result = await response.json().catch(() => null) as {
    id?: string; status?: string; amount?: number; payment_intent?: string; livemode?: boolean;
  } | null;
  if (response.status >= 500) return { status: 'REFUND_PENDING' };
  const live = env.ENVIRONMENT === 'production';
  if (!response.ok || !result || typeof result.id !== 'string' || result.amount !== order.amount_minor ||
      result.payment_intent !== order.stripe_payment_intent_id || result.livemode !== live ||
      !['succeeded', 'pending'].includes(String(result.status))) {
    await db.batch([
      db.prepare(`UPDATE stripe_payment_refunds SET status='FAILED',updated_at=? WHERE idempotency_key=?`).bind(Date.now(), input.requestId),
      db.prepare(`UPDATE quote_payment_orders SET status='PAID',updated_at=? WHERE id=? AND status='REFUND_PENDING'`).bind(Date.now(), order.id),
    ]);
    throw new Error('STRIPE_REFUSJON_FEILET');
  }
  if (result.status === 'pending') {
    await db.prepare(`UPDATE stripe_payment_refunds SET stripe_refund_id=?,updated_at=? WHERE idempotency_key=?`).bind(result.id, Date.now(), input.requestId).run();
    return { status: 'REFUND_PENDING' };
  }
  const completedAt = Date.now();
  await db.batch([
    db.prepare(`UPDATE stripe_payment_refunds SET stripe_refund_id=?,status='SUCCEEDED',updated_at=? WHERE idempotency_key=?`).bind(result.id, completedAt, input.requestId),
    db.prepare(`UPDATE quote_payment_orders SET status='REFUNDED',refunded_minor=amount_minor,updated_at=? WHERE id=? AND status='REFUND_PENDING'`).bind(completedAt, order.id),
    db.prepare(`INSERT OR IGNORE INTO beta_inquiry_events(event_id,inquiry_id,event_type,note,created_at,created_by)
      VALUES(?,?,'note','Stripe-refusjon bekreftet for full ordre.',?,'stripe-refund')`).bind(`refund-${result.id}`, input.inquiryId, completedAt),
  ]);
  return { status: 'REFUNDED' };
}

export async function handleRefundPaymentOrder(
  request: Request,
  env: Env,
  db: D1Database,
  inquiryId: number,
  orderId: string,
): Promise<Response> {
  const origin = request.headers.get('Origin');
  if (!origin || origin !== new URL(request.url).origin) {
    return new Response(JSON.stringify({ ok: false, error: 'UGYLDIG_OPPRINNELSE' }), { status: 403, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  }
  let body: Record<string, unknown>;
  try {
    const raw = await request.text();
    if (raw.length > 10000) throw new Error();
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    body = parsed as Record<string, unknown>;
  } catch {
    return new Response(JSON.stringify({ ok: false, error: 'UGYLDIG_JSON' }), { status: 400, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  }
  const requestId = typeof body.requestId === 'string' ? body.requestId : '';
  const reason = typeof body.reason === 'string' ? body.reason : '';
  try {
    const result = await refundPaidQuoteOrder(db, env, { orderId, inquiryId, requestId, reason, actor: 'ops-admin' });
    return new Response(JSON.stringify({ ok: true, ...result }), { status: result.status === 'REFUND_PENDING' ? 202 : 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    const status = code === 'BETALESMILJO_IKKE_KONFIGURERT' ? 503 : code === 'ORDRE_FINNES_IKKE' ? 404 : code.includes('IKKE_BETALT') || code.includes('ALLEREDE') || code.includes('KONFLIKT') ? 409 : 400;
    return new Response(JSON.stringify({ ok: false, error: code || 'REFUSJON_FEILET' }), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  }
}
