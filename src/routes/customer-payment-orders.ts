import type { Env } from '../types';

type PaymentOrderRow = {
  id: string; inquiry_id: number; quote_version: number; amount_minor: number; currency: string;
  status: string; payment_link_sent_at: number | null; paid_at: number | null; created_at: number;
  stripe_invoice_id: string | null; regnr: string | null;
};

function response(body: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers },
  });
}

function isStripeKeyForEnvironment(env: Env): boolean {
  const key = env.STRIPE_SECRET_KEY || '';
  return env.ENVIRONMENT === 'staging'
    ? /^(sk|rk)_test_/.test(key)
    : env.ENVIRONMENT === 'production' && /^(sk|rk)_live_/.test(key);
}

/** Authenticated customer projection; ownership is the immutable customer_id, never email. */
export async function handleCustomerPaymentOrders(request: Request, env: Env, db: D1Database, userId: string): Promise<Response> {
  const match = /^\/api\/customer\/payment-orders\/([A-Za-z0-9_-]{8,100})\/invoice$/.exec(new URL(request.url).pathname);
  if (match && request.method === 'GET') {
    if (!isStripeKeyForEnvironment(env)) return response({ ok: false, error: 'FAKTURA_IKKE_TILGJENGELIG' }, 404);
    const order = await db.prepare(
      `SELECT o.id, o.amount_minor, o.currency, o.status, o.stripe_invoice_id
         FROM quote_payment_orders o
         JOIN beta_inquiries i ON i.id = o.inquiry_id
        WHERE o.id = ? AND i.customer_id = ?`,
    ).bind(match[1], userId).first<Pick<PaymentOrderRow, 'id' | 'amount_minor' | 'currency' | 'status' | 'stripe_invoice_id'>>();
    if (!order) return response({ ok: false, error: 'ORDRE_FINNES_IKKE' }, 404);
    if (order.status !== 'PAID' || !order.stripe_invoice_id) return response({ ok: false, error: 'FAKTURA_IKKE_KLAR' }, 404);

    const key = env.STRIPE_SECRET_KEY!;
    const stripeResponse = await fetch(`https://api.stripe.com/v1/invoices/${encodeURIComponent(order.stripe_invoice_id)}`, {
      headers: { Authorization: `Bearer ${key}`, 'Stripe-Version': '2026-10-28.endive' },
    });
    if (!stripeResponse.ok) return response({ ok: false, error: 'FAKTURA_KUNNE_IKKE_HENTES' }, 502);
    const invoice = await stripeResponse.json().catch(() => null) as {
      id?: string; status?: string; amount_paid?: number; currency?: string; livemode?: boolean;
      metadata?: Record<string, string>; invoice_pdf?: string | null; hosted_invoice_url?: string | null;
    } | null;
    const expectedLive = env.ENVIRONMENT === 'production';
    if (!invoice || invoice.id !== order.stripe_invoice_id || invoice.metadata?.order_id !== order.id ||
      invoice.status !== 'paid' || invoice.amount_paid !== order.amount_minor ||
      invoice.currency?.toLowerCase() !== order.currency.toLowerCase() || invoice.livemode !== expectedLive) {
      return response({ ok: false, error: 'FAKTURA_KONTROLL_FEILET' }, 502);
    }
    const documentUrl = invoice.invoice_pdf || invoice.hosted_invoice_url;
    if (!documentUrl) return response({ ok: false, error: 'FAKTURA_IKKE_KLAR' }, 404);
    try {
      const parsed = new URL(documentUrl);
      if (parsed.protocol !== 'https:' || !['pay.stripe.com', 'invoice.stripe.com'].includes(parsed.hostname)) {
        return response({ ok: false, error: 'UGYLDIG_FAKTURAADRESSE' }, 502);
      }
    } catch { return response({ ok: false, error: 'UGYLDIG_FAKTURAADRESSE' }, 502); }
    return new Response(null, { status: 302, headers: { Location: documentUrl, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
  }

  if (request.method !== 'GET' || new URL(request.url).pathname !== '/api/customer/payment-orders') {
    return response({ ok: false, error: 'FINNES_IKKE' }, 404);
  }
  try {
    const result = await db.prepare(
      `SELECT o.id, o.inquiry_id, o.quote_version, o.amount_minor, o.currency, o.status,
              o.payment_link_sent_at, o.paid_at, o.created_at, o.stripe_invoice_id, i.regnr
         FROM quote_payment_orders o
         JOIN beta_inquiries i ON i.id = o.inquiry_id
        WHERE i.customer_id = ?
        ORDER BY o.created_at DESC
        LIMIT 100`,
    ).bind(userId).all<PaymentOrderRow>();
    const orders = (result.results ?? []).map((order) => ({
      id: order.id,
      inquiryId: order.inquiry_id,
      reference: order.regnr ? `Forespørsel #${order.inquiry_id} · ${order.regnr}` : `Forespørsel #${order.inquiry_id}`,
      quoteVersion: order.quote_version,
      amountNok: order.amount_minor / 100,
      currency: order.currency.toUpperCase(),
      status: order.status,
      paymentLinkSentAt: order.payment_link_sent_at,
      paidAt: order.paid_at,
      createdAt: order.created_at,
      invoiceAvailable: order.status === 'PAID' && Boolean(order.stripe_invoice_id),
    }));
    return response({ ok: true, orders });
  } catch {
    // Fail closed instead of treating schema or database errors as an empty account.
    return response({ ok: false, error: 'BETALINGSORDRER_IKKE_TILGJENGELIGE' }, 503);
  }
}
