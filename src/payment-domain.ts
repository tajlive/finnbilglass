export type ConfirmedQuote = { totalNok: number; priceType: string; sentAt: number | null; totalConfirmed: boolean };
export type CheckoutOrder = { amountMinor: number; currency: string };
export type CheckoutSessionState = { payment_status: string; amount_total: number | null; currency: string | null };

/** Checkout is permitted only against an explicitly confirmed customer total, never glass-only quote price. */
export function amountToNokMinor(quote: ConfirmedQuote): number {
  if (quote.priceType !== 'BEKREFTET') throw new Error('Quote must be confirmed before payment');
  if (!quote.sentAt) throw new Error('Quote must be sent before payment');
  if (!quote.totalConfirmed) throw new Error('Confirmed customer total is required');
  if (!Number.isSafeInteger(quote.totalNok) || quote.totalNok <= 0 || quote.totalNok > 10_000_000) {
    throw new Error('Quote total is invalid');
  }
  return quote.totalNok * 100;
}

export function customerTotalForOffer(input: { glassNok: number; totalNok: unknown; priceType: string; send: boolean }): number | null {
  if (!Number.isSafeInteger(input.glassNok) || input.glassNok < 1 || input.glassNok > 10_000_000) throw new Error('Glass price is invalid');
  if (input.totalNok == null || input.totalNok === '') {
    if (input.send) throw new Error('A confirmed customer total is required');
    return null;
  }
  const total = Number(input.totalNok);
  if (!Number.isSafeInteger(total) || total < input.glassNok || total > 10_000_000) throw new Error('Customer total is invalid');
  if (input.send && input.priceType !== 'BEKREFTET') throw new Error('A confirmed quote is required before sending');
  return total;
}

export type CheckoutSessionInput = {
  orderId: string; inquiryId: number; quoteId: number; quoteVersion: number;
  amountMinor: number; customerEmail: string; origin: string;
  paymentMethodConfiguration?: string;
};

/** Build Stripe's hosted Checkout request exclusively from the persisted order amount. */
export function buildCheckoutSessionParameters(input: CheckoutSessionInput): URLSearchParams {
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor < 1 || input.amountMinor > 1_000_000_000) {
    throw new Error('Checkout amount is invalid');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.customerEmail)) throw new Error('Customer email is invalid');
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(input.orderId) || !Number.isSafeInteger(input.inquiryId) || !Number.isSafeInteger(input.quoteId) || !Number.isSafeInteger(input.quoteVersion)) {
    throw new Error('Checkout identity is invalid');
  }
  const base = new URL(input.origin);
  const allowedHost = base.hostname === 'finnbilglass.no' || base.hostname.endsWith('.finnbilglass.no') || base.hostname.endsWith('.workers.dev') || base.hostname === 'localhost';
  if (!allowedHost || (base.protocol !== 'https:' && !(base.protocol === 'http:' && base.hostname === 'localhost')) || base.username || base.password) {
    throw new Error('Checkout return origin is invalid');
  }
  const p = new URLSearchParams({
    mode: 'payment',
    customer_email: input.customerEmail,
    client_reference_id: input.orderId,
    success_url: `${base.origin}/betaling?status=complete&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${base.origin}/betaling?status=cancelled`,
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': 'nok',
    'line_items[0][price_data][unit_amount]': String(input.amountMinor),
    'line_items[0][price_data][product_data][name]': `Finnbilglass tilbud #${input.inquiryId}`,
    'metadata[order_id]': input.orderId,
    'metadata[inquiry_id]': String(input.inquiryId),
    'metadata[quote_id]': String(input.quoteId),
    'metadata[quote_version]': String(input.quoteVersion),
  });
  // Create a post-payment invoice that can be retrieved for the signed-in customer.
  p.set('customer_creation', 'always');
  p.set('invoice_creation[enabled]', 'true');
  p.set('invoice_creation[invoice_data][metadata][order_id]', input.orderId);
  // Stripe accepts either an explicit method list or a payment-method configuration,
  // never both. The configured staging account is already limited to card + Klarna.
  if (input.paymentMethodConfiguration) {
    if (!/^pmc_[A-Za-z0-9]+$/.test(input.paymentMethodConfiguration)) throw new Error('Payment method configuration is invalid');
    p.set('payment_method_configuration', input.paymentMethodConfiguration);
  } else {
    p.set('payment_method_types[0]', 'card');
    p.set('payment_method_types[1]', 'klarna');
  }
  return p;
}

/** Verify Stripe-Signature using the raw request body and a five-minute replay window. */
export async function verifyStripeSignature(rawBody: string, signatureHeader: string, secret: string | undefined, nowMs = Date.now()): Promise<boolean> {
  if (!secret || !rawBody || rawBody.length > 1_000_000) return false;
  const fields = signatureHeader.split(',').map((s) => s.trim());
  const timestampRaw = fields.find((s) => s.startsWith('t='))?.slice(2);
  if (!timestampRaw || !/^\d{1,12}$/.test(timestampRaw)) return false;
  const timestamp = Number(timestampRaw);
  if (Math.abs(nowMs / 1000 - timestamp) > 300) return false;
  const candidates = fields.filter((s) => s.startsWith('v1=')).map((s) => s.slice(3)).filter((s) => /^[0-9a-f]{64}$/i.test(s));
  if (!candidates.length) return false;
  try {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    const message = new TextEncoder().encode(`${timestamp}.${rawBody}`);
    for (const hex of candidates) {
      const signature = Uint8Array.from(hex.match(/.{2}/g) || [], (part) => parseInt(part, 16));
      if (await crypto.subtle.verify('HMAC', key, signature, message)) return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function verifyCheckoutCompleted(order: CheckoutOrder, session: CheckoutSessionState): boolean {
  return session.payment_status === 'paid' &&
    session.amount_total === order.amountMinor &&
    session.currency?.toLowerCase() === order.currency.toLowerCase();
}

export type OpsPaymentOrderInput = { totalNok: unknown; accepted: unknown; acceptanceMethod: unknown; acceptanceNote: unknown };
export function validateOpsPaymentOrder(input: OpsPaymentOrderInput): { amountMinor: number; method: 'PHONE' | 'EMAIL' | 'IN_PERSON'; note: string } {
  if (input.accepted !== true) throw new Error('Customer acceptance is required');
  const method = String(input.acceptanceMethod || '').toUpperCase();
  if (!['PHONE', 'EMAIL', 'IN_PERSON'].includes(method)) throw new Error('Acceptance method is invalid');
  const note = typeof input.acceptanceNote === 'string' ? input.acceptanceNote.trim().slice(0, 300) : '';
  if (note.length < 3) throw new Error('Acceptance note is required');
  const totalNok = Number(input.totalNok);
  if (!Number.isSafeInteger(totalNok) || totalNok < 1 || totalNok > 10_000_000) throw new Error('Confirmed total is invalid');
  return { amountMinor: totalNok * 100, method: method as 'PHONE' | 'EMAIL' | 'IN_PERSON', note };
}
