import type { Env } from '../types';
import { verifiserAccess } from '../access-jwt';
import { sendMail, avsenderEpost } from '../mail';
import { amountToNokMinor, buildCheckoutSessionParameters, validateOpsPaymentOrder, verifyStripeSignature } from '../payment-domain';

type QuoteRow = {
  id: number; inquiry_id: number; versjon: number; varenr: string | null; beskrivelse: string | null;
  pris_kr: number; total_kr: number | null; pris_type: string; sendt_at: number | null; gyldig_til: string | null;
  tillegg_json: string | null; navn: string; kontakt: string; regnr: string | null; inquiry_status: string;
};
type PaymentOrder = {
  id: string; inquiry_id: number; quote_id: number; quote_version: number; amount_minor: number;
  amount_breakdown_json: string; acceptance_method: string; acceptance_note: string; accepted_by: string;
  status: string; stripe_checkout_session_id: string | null; checkout_url: string | null; payment_link_sent_at: number | null;
};

function inquiryDb(env: Env): D1Database {
  if (env.ENVIRONMENT === 'staging' && env.FINNBILGLASS_STAGING_AUTH) return env.FINNBILGLASS_STAGING_AUTH;
  return env.FINNBILGLASS_DB;
}
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}
function stripeKeyAllowed(env: Env, key: string): boolean {
  if (env.ENVIRONMENT === 'staging') return /^(sk|rk)_test_/.test(key);
  if (env.ENVIRONMENT === 'production') return /^(sk|rk)_live_/.test(key);
  return false;
}

/** Public homepage can only advertise payment options when this environment can create verified Checkout sessions. */
export function availableCheckoutMethods(env: Env): Array<'card' | 'klarna'> {
  const key = env.STRIPE_SECRET_KEY || '';
  if (env.STRIPE_CHECKOUT_ENABLED !== 'true' || !env.STRIPE_WEBHOOK_SECRET || !stripeKeyAllowed(env, key)) return [];
  if (env.ENVIRONMENT === 'production' && !env.STRIPE_PAYMENT_METHOD_CONFIGURATION) return [];
  return ['card', 'klarna'];
}
function randomLetters(length: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => String.fromCharCode(97 + (b % 26))).join('');
}
function validExpiry(date: string | null): boolean {
  if (!date) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  return Date.now() <= Date.parse(`${date}T23:59:59.999Z`);
}

async function checkoutSession(env: Env, order: PaymentOrder, quote: QuoteRow, email: string, origin: string): Promise<{ id: string; url: string } | null> {
  const key = env.STRIPE_SECRET_KEY || '';
  if (!stripeKeyAllowed(env, key)) return null;
  const params = buildCheckoutSessionParameters({
    orderId: order.id, inquiryId: quote.inquiry_id, quoteId: quote.id, quoteVersion: quote.versjon,
    amountMinor: order.amount_minor, customerEmail: email, origin,
    paymentMethodConfiguration: env.STRIPE_PAYMENT_METHOD_CONFIGURATION,
  });
  params.set('integration_identifier', `finnbilglass_ops_${randomLetters(8)}`);
  const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Idempotency-Key': `fbg-checkout-${order.id}`,
      'Stripe-Version': '2026-10-28.endive',
    },
    body: params.toString(),
  });
  if (!response.ok) {
    // Never log or echo provider response bodies, which may contain customer or account data.
    console.error('Stripe Checkout creation failed', response.status);
    return null;
  }
  const result = await response.json().catch(() => null) as { id?: string; url?: string } | null;
  if (!result || typeof result.id !== 'string' || typeof result.url !== 'string') return null;
  try {
    const url = new URL(result.url);
    if (url.protocol !== 'https:' || !url.hostname.endsWith('.stripe.com')) return null;
  } catch { return null; }
  return { id: result.id, url: result.url };
}

function paymentEmail(quote: QuoteRow, order: PaymentOrder, paymentUrl: string): { subject: string; html: string; text: string } {
  const safe = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
  const amount = (order.amount_minor / 100).toLocaleString('nb-NO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const recipient = safe(quote.navn);
  const vehicle = quote.regnr ? ` for ${safe(quote.regnr)}` : '';
  const subject = `Betalingslenke for Finnbilglass-tilbud${quote.regnr ? ` — ${quote.regnr}` : ''}`;
  const html = `<p>Hei ${recipient},</p><p>Her er betalingslenken til tilbudet du har godtatt${vehicle}.</p><p><strong>Totalpris: ${amount} kr inkl. mva.</strong></p><p><a href="${safe(paymentUrl)}">Åpne sikker betaling hos Stripe</a></p><p>Stripe viser betalingsmåtene som er tilgjengelige for kjøpet.</p><p>Hvis saken er knyttet til kontoen du brukte da du sendte forespørselen, kan du se betalingsstatus og tilgjengelig faktura på <a href="https://finnbilglass.no/innlogging">Min side</a>.</p><p>Hvis betalingslenken ikke virker, svar på denne e-posten.</p><p>— Finnbilglass</p>`;
  const text = `Hei ${quote.navn},\n\nHer er betalingslenken til tilbudet du har godtatt${quote.regnr ? ` for ${quote.regnr}` : ''}.\n\nTotalpris: ${amount} kr inkl. mva.\n\nBetal sikkert her: ${paymentUrl}\n\nStripe viser betalingsmåtene som er tilgjengelige for kjøpet.\n\nHvis saken er knyttet til kontoen du brukte da du sendte forespørselen, kan du se betalingsstatus og tilgjengelig faktura på Min side: https://finnbilglass.no/innlogging.\n\nHvis betalingslenken ikke virker, svar på denne e-posten.\n\n— Finnbilglass`;
  return { subject, html, text };
}

/** Access-only operator action: freeze the accepted confirmed total, create Checkout and email its link. */
export async function handleCreatePaymentLink(request: Request, env: Env, inquiryId: number): Promise<Response> {
  if (env.STRIPE_CHECKOUT_ENABLED !== 'true') return json({ ok: false, error: 'BETALING_IKKE_AKTIVERT' }, 503);
  const stripeKey = env.STRIPE_SECRET_KEY || '';
  if (!stripeKeyAllowed(env, stripeKey) || !env.STRIPE_WEBHOOK_SECRET) return json({ ok: false, error: 'BETALINGSMILJO_IKKE_KONFIGURERT' }, 503);
  if (env.ENVIRONMENT !== 'staging' && env.ENVIRONMENT !== 'production') return json({ ok: false, error: 'UGYLDIG_BETALINGSMILJO' }, 503);
  const originHeader = request.headers.get('Origin');
  if (!originHeader || originHeader !== new URL(request.url).origin) return json({ ok: false, error: 'UGYLDIG_OPPRINNELSE' }, 403);
  const identity = await verifiserAccess(request, env);
  const admins = String(env.ADMIN_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const actor = identity?.epost?.toLowerCase();
  if (!actor || !admins.includes(actor)) return json({ ok: false, error: 'ACCESS_ADMIN_KREVES' }, 403);

  let body: Record<string, unknown>;
  try { const parsed = await request.json(); if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(); body = parsed as Record<string, unknown>; }
  catch { return json({ ok: false, error: 'UGYLDIG_JSON' }, 400); }
  const quoteId = Number(body.quoteId);
  const requestId = typeof body.requestId === 'string' ? body.requestId : '';
  if (!Number.isSafeInteger(quoteId) || quoteId < 1 || !/^[A-Za-z0-9_-]{16,100}$/.test(requestId)) return json({ ok: false, error: 'UGYLDIG_BETALINGSFORESPORSEL' }, 400);

  const db = inquiryDb(env);
  const quote = await db.prepare(
    `SELECT q.id, q.inquiry_id, q.versjon, q.varenr, q.beskrivelse, q.pris_kr, q.total_kr, q.pris_type, q.sendt_at, q.gyldig_til, q.tillegg_json,
            i.navn, i.kontakt, i.regnr, i.status AS inquiry_status
       FROM glass_quotes q JOIN beta_inquiries i ON i.id = q.inquiry_id
      WHERE q.id = ? AND q.inquiry_id = ?
        AND q.versjon = (SELECT MAX(q2.versjon) FROM glass_quotes q2 WHERE q2.inquiry_id = q.inquiry_id)`
  ).bind(quoteId, inquiryId).first<QuoteRow>();
  if (!quote) return json({ ok: false, error: 'TILBUD_FINNES_IKKE_ELLER_ER_IKKE_NYEST' }, 404);
  if (quote.pris_type !== 'BEKREFTET' || !quote.sendt_at || !quote.total_kr || quote.total_kr < quote.pris_kr || !validExpiry(quote.gyldig_til)) {
    return json({ ok: false, error: 'TILBUD_MA_VAERE_SENDT_BEKREFTET_MED_GYLDIG_TOTAL' }, 409);
  }
  if (quote.inquiry_status !== 'OFFERED') return json({ ok: false, error: 'SAKEN_MA_HA_ETT_AKTUELT_SENDT_TILBUD' }, 409);
  const email = quote.kontakt.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ ok: false, error: 'KUNDEN_MANGLER_GYLDIG_EPOST' }, 409);
  const method = String(body.acceptanceMethod || '').toUpperCase();
  const note = typeof body.acceptanceNote === 'string' ? body.acceptanceNote : '';
  let acceptance: ReturnType<typeof validateOpsPaymentOrder>;
  try { acceptance = validateOpsPaymentOrder({ totalNok: quote.total_kr, accepted: body.accepted, acceptanceMethod: method, acceptanceNote: note }); }
  catch { return json({ ok: false, error: 'KUNDEGODKJENNING_KREVES' }, 400); }
  const amountMinor = amountToNokMinor({ totalNok: quote.total_kr, priceType: quote.pris_type, sentAt: quote.sendt_at, totalConfirmed: true });
  const glassMinor = Math.round(quote.pris_kr * 100);
  const amountBreakdown = JSON.stringify({ totalMinor: amountMinor, glassMinor, remainderMinor: amountMinor - glassMinor });
  const now = Date.now();
  const orderId = `ord_${crypto.randomUUID().replace(/-/g, '')}`;
  await db.prepare(
    `INSERT OR IGNORE INTO quote_payment_orders
       (id, request_id, inquiry_id, quote_id, quote_version, amount_minor, amount_breakdown_json, acceptance_method, acceptance_note,
        accepted_at, accepted_by, status, created_at, created_by, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACCEPTED', ?, ?, ?)`
  ).bind(orderId, requestId, inquiryId, quote.id, quote.versjon, amountMinor, amountBreakdown, acceptance.method, acceptance.note,
    now, actor, now, actor, now).run();
  let order = await db.prepare('SELECT * FROM quote_payment_orders WHERE quote_id = ?').bind(quote.id).first<PaymentOrder>();
  if (!order) return json({ ok: false, error: 'ORDREKONFLIKT' }, 409);
  if (order.acceptance_method !== acceptance.method || order.acceptance_note !== acceptance.note || order.accepted_by !== actor || order.amount_minor !== amountMinor) {
    return json({ ok: false, error: 'TILBUD_ER_ALLEREDE_GODTATT_MED_ANNEN_REGISTRERING' }, 409);
  }
  if (order.status === 'PAID' || order.status === 'REFUNDED' || order.status === 'PARTIALLY_REFUNDED') return json({ ok: false, error: 'ORDREN_ER_ALLEREDE_BETALT' }, 409);
  if (order.status === 'PAYMENT_LINK_SENT' && order.payment_link_sent_at) return json({ ok: true, alreadySent: true, status: order.status, orderId: order.id });

  if (!order.stripe_checkout_session_id || !order.checkout_url) {
    const created = await checkoutSession(env, order, quote, email, env.STRIPE_RETURN_ORIGIN || '');
    if (!created) return json({ ok: false, error: 'CHECKOUT_KUNNE_IKKE_OPPRETTES' }, 502);
    await db.prepare('UPDATE quote_payment_orders SET stripe_checkout_session_id = ?, checkout_url = ?, updated_at = ? WHERE id = ? AND status = \'ACCEPTED\'')
      .bind(created.id, created.url, Date.now(), order.id).run();
    order = { ...order, stripe_checkout_session_id: created.id, checkout_url: created.url };
  }
  if (!order.checkout_url) return json({ ok: false, error: 'CHECKOUT_LENKE_MANGLER' }, 502);

  const mail = paymentEmail(quote, order, order.checkout_url);
  const sent = await sendMail(env, {
    to: email, ...mail, replyTo: env.SUPPORT_EPOST || avsenderEpost(env),
    idempotencyKey: `payment-order-${order.id}`,
  });
  if (!sent.ok) return json({ ok: false, error: 'LENKE_OPPRETTET_EPOST_AVVENTER_RETRY' }, 502);
  const sentAt = Date.now();
  await db.batch([
    db.prepare(`UPDATE quote_payment_orders SET status = 'PAYMENT_LINK_SENT', payment_link_sent_at = ?, updated_at = ?
      WHERE id = ? AND status = 'ACCEPTED'`).bind(sentAt, sentAt, order.id),
    db.prepare(`INSERT OR IGNORE INTO beta_inquiry_events (event_id, inquiry_id, event_type, note, created_at, created_by)
      VALUES (?, ?, 'note', ?, ?, ?)`).bind(`payment-link-${order.id}`, inquiryId, `Betalingslenke sendt for godtatt tilbud v${quote.versjon} (${(amountMinor / 100).toFixed(2)} NOK).`, sentAt, actor),
  ]);
  return json({ ok: true, alreadySent: false, status: 'PAYMENT_LINK_SENT', orderId: order.id });
}

/** Public Stripe webhook: verifies signature, amount and currency before changing order state. */
export async function handleStripeWebhook(request: Request, env: Env): Promise<Response> {
  const secret = env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return json({ ok: false, error: 'WEBHOOK_NOT_CONFIGURED' }, 503);
  const raw = await request.text();
  if (!(await verifyStripeSignature(raw, request.headers.get('Stripe-Signature') || '', secret))) return json({ ok: false, error: 'INVALID_SIGNATURE' }, 400);
  let event: Record<string, any>;
  try { event = JSON.parse(raw) as Record<string, any>; } catch { return json({ ok: false, error: 'INVALID_EVENT' }, 400); }
  if (typeof event.id !== 'string' || typeof event.type !== 'string' || !event.data?.object || typeof event.data.object !== 'object') return json({ ok: false, error: 'INVALID_EVENT' }, 400);
  const allowedEvents = new Set(['checkout.session.completed', 'checkout.session.async_payment_succeeded', 'checkout.session.async_payment_failed', 'checkout.session.expired', 'invoice.paid']);
  const db = inquiryDb(env);
  const now = Date.now();
  const object = event.data.object as Record<string, any>;
  const orderId = typeof object.metadata?.order_id === 'string' ? object.metadata.order_id : null;
  await db.prepare(`INSERT OR IGNORE INTO stripe_payment_events(event_id,order_id,event_type,received_at,processing_status)
    VALUES(?,?,?,?,'RECEIVED')`).bind(event.id, orderId, event.type, now).run();
  const eventRow = await db.prepare('SELECT processing_status FROM stripe_payment_events WHERE event_id = ?').bind(event.id).first<{ processing_status: string }>();
  if (eventRow?.processing_status === 'PROCESSED' || eventRow?.processing_status === 'IGNORED') return json({ received: true, duplicate: true });
  if (!allowedEvents.has(event.type)) {
    await db.prepare(`UPDATE stripe_payment_events SET processing_status='IGNORED',processed_at=? WHERE event_id=?`).bind(now, event.id).run();
    return json({ received: true, ignored: true });
  }
  if (!orderId || typeof object.id !== 'string') {
    await db.prepare(`UPDATE stripe_payment_events SET processing_status='IGNORED',processed_at=? WHERE event_id=?`).bind(now, event.id).run();
    return json({ received: true, ignored: true });
  }
  const order = await db.prepare('SELECT id,inquiry_id,amount_minor,currency,status,stripe_checkout_session_id FROM quote_payment_orders WHERE id=?').bind(orderId)
    .first<{ id: string; inquiry_id: number; amount_minor: number; currency: string; status: string; stripe_checkout_session_id: string | null }>();
  if (!order) {
    await db.prepare(`UPDATE stripe_payment_events SET processing_status='RETRY',error_code='ORDER_NOT_FOUND' WHERE event_id=?`).bind(event.id).run();
    return json({ ok: false, error: 'ORDER_NOT_FOUND' }, 500);
  }
  if (event.type === 'invoice.paid') {
    if (object.metadata?.order_id !== order.id || object.status !== 'paid' ||
      object.amount_paid !== order.amount_minor || String(object.currency || '').toLowerCase() !== order.currency.toLowerCase() ||
      object.livemode !== (env.ENVIRONMENT === 'production')) {
      await db.prepare(`UPDATE stripe_payment_events SET processing_status='RETRY',error_code='INVOICE_MISMATCH' WHERE event_id=?`).bind(event.id).run();
      return json({ ok: false, error: 'INVOICE_MISMATCH' }, 500);
    }
    const intentId = typeof object.payment_intent === 'string' ? object.payment_intent : null;
    const statements = [
      db.prepare(`UPDATE quote_payment_orders SET status='PAID',paid_at=COALESCE(paid_at,?),stripe_payment_intent_id=COALESCE(?,stripe_payment_intent_id),stripe_invoice_id=COALESCE(?,stripe_invoice_id),updated_at=? WHERE id=? AND status NOT IN ('REFUNDED','PARTIALLY_REFUNDED')`)
        .bind(now, intentId, object.id, now, order.id),
      db.prepare(`INSERT OR IGNORE INTO beta_inquiry_events(event_id,inquiry_id,event_type,note,created_at,created_by)
        VALUES(?,?,'note',?,?,'stripe-webhook')`).bind(`stripe-${event.id}`, order.inquiry_id, `Stripe bekreftet betalt faktura for ordren (${order.amount_minor} øre NOK).`, now),
      db.prepare(`UPDATE stripe_payment_events SET processing_status='PROCESSED',processed_at=?,error_code=NULL WHERE event_id=?`).bind(now, event.id),
    ];
    await db.batch(statements);
    return json({ received: true });
  }
  if (object.livemode !== (env.ENVIRONMENT === 'production')) {
    await db.prepare(`UPDATE stripe_payment_events SET processing_status='IGNORED',processed_at=?,error_code='LIVEMODE_MISMATCH' WHERE event_id=?`).bind(now, event.id).run();
    return json({ received: true, ignored: true });
  }
  if (order.stripe_checkout_session_id !== object.id || object.metadata?.order_id !== order.id) {
    await db.prepare(`UPDATE stripe_payment_events SET processing_status='IGNORED',processed_at=?,error_code='SESSION_MISMATCH' WHERE event_id=?`).bind(now, event.id).run();
    return json({ received: true, ignored: true });
  }
  let nextStatus: 'PAID' | 'PAYMENT_FAILED' | 'EXPIRED' | null = null;
  if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
    if (object.payment_status !== 'paid') {
      await db.prepare(`UPDATE stripe_payment_events SET processing_status='PROCESSED',processed_at=? WHERE event_id=?`).bind(now, event.id).run();
      return json({ received: true, pending: true });
    }
    if (object.amount_total !== order.amount_minor || String(object.currency || '').toLowerCase() !== order.currency.toLowerCase()) {
      await db.prepare(`UPDATE stripe_payment_events SET processing_status='RETRY',error_code='AMOUNT_MISMATCH' WHERE event_id=?`).bind(event.id).run();
      return json({ ok: false, error: 'AMOUNT_MISMATCH' }, 500);
    }
    nextStatus = 'PAID';
  } else if (event.type === 'checkout.session.async_payment_failed') nextStatus = 'PAYMENT_FAILED';
  else if (event.type === 'checkout.session.expired') nextStatus = 'EXPIRED';

  const intentId = typeof object.payment_intent === 'string' ? object.payment_intent : null;
  const invoiceId = typeof object.invoice === 'string' ? object.invoice
    : object.invoice && typeof object.invoice.id === 'string' ? object.invoice.id : null;
  const logEventId = `stripe-${event.id}`;
  const log = nextStatus ? `Stripe Checkout oppdatert ordren til ${nextStatus} (${order.amount_minor} øre NOK).` : '';
  const updateOrder = nextStatus === 'PAID'
    ? db.prepare(`UPDATE quote_payment_orders SET status='PAID',paid_at=COALESCE(paid_at,?),stripe_payment_intent_id=COALESCE(?,stripe_payment_intent_id),stripe_invoice_id=COALESCE(?,stripe_invoice_id),updated_at=? WHERE id=? AND status NOT IN ('REFUNDED','PARTIALLY_REFUNDED')`).bind(now, intentId, invoiceId, now, order.id)
    : db.prepare(`UPDATE quote_payment_orders SET status=?,updated_at=? WHERE id=? AND status NOT IN ('PAID','REFUNDED','PARTIALLY_REFUNDED')`).bind(nextStatus, now, order.id);
  const statements = [updateOrder];
  if (nextStatus) statements.push(db.prepare(`INSERT OR IGNORE INTO beta_inquiry_events(event_id,inquiry_id,event_type,note,created_at,created_by)
    VALUES(?,?,'note',?,?,'stripe-webhook')`).bind(logEventId, order.inquiry_id, log, now));
  statements.push(db.prepare(`UPDATE stripe_payment_events SET processing_status='PROCESSED',processed_at=?,error_code=NULL WHERE event_id=?`).bind(now, event.id));
  await db.batch(statements);
  return json({ received: true });
}
