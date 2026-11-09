/**
 * FinnBilGlass Kustom Checkout / HPP core.
 * Standalone review candidate. Do not publish before Ops/D1 reconciliation and E2E tests.
 * No browser credentials; all calls MUST originate from the trusted Worker.
 */
export interface KustomEnvironment {
  ENVIRONMENT: 'staging' | 'production' | string;
  KUSTOM_API_USERNAME?: string;
  KUSTOM_API_PASSWORD?: string;
  KUSTOM_ENABLED?: string;
  KUSTOM_PRODUCTION_APPROVED?: string;
}

export type CheckoutLine = {
  type: 'physical' | 'shipping_fee';
  reference: string;
  name: string;
  quantity: 1;
  quantity_unit: 'pcs';
  unit_price: number;
  tax_rate: 2500;
  total_amount: number;
  total_tax_amount: number;
};

export type KustomCheckoutRequest = {
  purchase_country: 'NO'; purchase_currency: 'NOK'; locale: 'nb-NO';
  order_amount: number; order_tax_amount: number;
  order_lines: CheckoutLine[];
  merchant_reference1: string;
  merchant_urls: { terms: string; checkout: string; confirmation: string; push: string };
};

export const SHIPPING_INCL_VAT_MINOR = 87375;
export const SHIPPING_TAX_MINOR = 17475;

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const idPattern = /^[A-Za-z0-9_-]{8,100}$/;

function integerMinor(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 1_000_000_000) throw new Error(`Ugyldig belop: ${label}`);
}

export function nokToMinor(value: number): number {
  if (!Number.isFinite(value) || value <= 0 || value > 10_000_000) throw new Error('Ugyldig NOK-belop');
  const minor = Math.round(value * 100);
  if (Math.abs(value * 100 - minor) > 1e-6 || !Number.isSafeInteger(minor)) {
    throw new Error('Belop maa oppgis med maks to desimaler');
  }
  return minor;
}

export function vatInMinor(grossMinor: number): number {
  integerMinor(grossMinor, 'brutto');
  return Math.round(grossMinor / 5); // 25% VAT already included => 20% of gross.
}

function ensureOrigin(origin: string): string {
  const parsed = new URL(origin);
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error('Kundedomene maa vaere en ren HTTPS-origin');
  }
  if (parsed.hostname !== 'finnbilglass.no' && !parsed.hostname.endsWith('.finnbilglass.no') && !parsed.hostname.endsWith('.workers.dev')) {
    throw new Error('Kundedomene er ikke tillatt');
  }
  return parsed.origin;
}

/** Does not amend historical offers. The total must already INCLUDE the shipping fee. */
export function buildLockedKustomOrder(input: {
  internalOrderId: string;
  amountMinor: number;
  customerOrigin: string;
  shippingMinor: number;
  callbackToken: string;
}): KustomCheckoutRequest {
  if (!idPattern.test(input.internalOrderId)) throw new Error('Ugyldig intern ordre-ID');
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(input.callbackToken)) throw new Error('Mangler sterk tilfeldig callback-token');
  integerMinor(input.amountMinor, 'total');
  integerMinor(input.shippingMinor, 'frakt');
  if (input.shippingMinor !== SHIPPING_INCL_VAT_MINOR) throw new Error('Frakten stemmer ikke med 699 kr ekskl. mva.');
  const goods = input.amountMinor - input.shippingMinor;
  if (goods <= 0) throw new Error('Lagt inn frakt, men ordrebelopet dekker ikke glass');
  const origin = ensureOrigin(input.customerOrigin);
  const lines: CheckoutLine[] = [
    { type: 'physical', reference: input.internalOrderId, name: 'Bilglass og avtalt tilbehor', quantity: 1, quantity_unit: 'pcs',
      unit_price: goods, tax_rate: 2500, total_amount: goods, total_tax_amount: vatInMinor(goods) },
    { type: 'shipping_fee', reference: 'FRAKT-699-EX', name: 'Fast frakt (699 kr ekskl. mva.)', quantity: 1, quantity_unit: 'pcs',
      unit_price: SHIPPING_INCL_VAT_MINOR, tax_rate: 2500, total_amount: SHIPPING_INCL_VAT_MINOR, total_tax_amount: SHIPPING_TAX_MINOR },
  ];
  const order: KustomCheckoutRequest = {
    purchase_country: 'NO', purchase_currency: 'NOK', locale: 'nb-NO',
    merchant_reference1: input.internalOrderId,
    order_amount: input.amountMinor,
    order_tax_amount: lines.reduce((n, l) => n + l.total_tax_amount, 0),
    order_lines: lines,
    merchant_urls: {
      terms: `${origin}/betaling`,
      checkout: `${origin}/betaling`,
      confirmation: `${origin}/betaling?status=complete&order_id={checkout.order.id}`,
      push: `${origin}/api/kustom/push?order_id={checkout.order.id}&token=${encodeURIComponent(input.callbackToken)}`,
    },
  };
  assertKustomOrder(order);
  return order;
}

export function assertKustomOrder(order: KustomCheckoutRequest): void {
  integerMinor(order.order_amount, 'total'); integerMinor(order.order_tax_amount, 'mva');
  if (order.purchase_country !== 'NO' || order.purchase_currency !== 'NOK' || order.locale !== 'nb-NO') throw new Error('Feil land eller valuta');
  if (!idPattern.test(order.merchant_reference1)) throw new Error('Mangler gyldig intern referanse');
  if (!Array.isArray(order.order_lines) || !order.order_lines.length) throw new Error('Mangler ordrelinjer');
  let amount = 0, tax = 0;
  for (const l of order.order_lines) {
    integerMinor(l.unit_price, l.reference); integerMinor(l.total_amount, l.reference); integerMinor(l.total_tax_amount, l.reference);
    if (l.quantity !== 1 || l.tax_rate !== 2500 || l.total_amount !== l.unit_price || vatInMinor(l.total_amount) !== l.total_tax_amount) {
      throw new Error('Ugyldig eller feilbeskattet ordrelinje');
    }
    amount += l.total_amount; tax += l.total_tax_amount;
  }
  if (amount !== order.order_amount || tax !== order.order_tax_amount) throw new Error('Kustom ordrelinjer stemmer ikke med laast total');
  for (const u of Object.values(order.merchant_urls)) {
    if (!u.startsWith('https://')) throw new Error('Kustom URL maa bruke HTTPS');
  }
}

export function apiBase(env: KustomEnvironment): string {
  if (env.KUSTOM_ENABLED !== 'true') throw new Error('KUSTOM_DEAKTIVERT');
  if (env.ENVIRONMENT === 'staging') return 'https://api.playground.kustom.co';
  if (env.ENVIRONMENT === 'production' && env.KUSTOM_PRODUCTION_APPROVED === 'true') return 'https://api.kustom.co';
  throw new Error('KUSTOM_MILJO_IKKE_TILLATT');
}

function credentials(env: KustomEnvironment): string {
  if (!env.KUSTOM_API_USERNAME || !env.KUSTOM_API_PASSWORD) throw new Error('KUSTOM_SECRETS_MANGLER');
  return `Basic ${btoa(`${env.KUSTOM_API_USERNAME}:${env.KUSTOM_API_PASSWORD}`)}`;
}

async function call<T>(env: KustomEnvironment, path: string, method: 'GET' | 'POST', body?: unknown, idempotencyKey?: string): Promise<T> {
  const response = await fetch(apiBase(env) + path, {
    method,
    headers: {
      Authorization: credentials(env), Accept: 'application/json',
      ...(body == null ? {} : { 'Content-Type': 'application/json' }),
      ...(idempotencyKey ? { 'Kustom-Idempotency-Key': idempotencyKey } : {}),
    },
    ...(body == null ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new Error(`KUSTOM_HTTP_${response.status}`);
  const obj = await response.json() as T;
  return obj;
}

/** This POST has NO idempotency key. Caller must first atomically reserve creation in D1. */
export async function createKustomCheckout(env: KustomEnvironment, payload: KustomCheckoutRequest): Promise<string> {
  assertKustomOrder(payload);
  const result = await call<{ order_id?: string }>(env, '/checkout/v3/orders', 'POST', payload);
  if (typeof result.order_id !== 'string' || !uuid.test(result.order_id)) throw new Error('KUSTOM_ORDRE_ID_MANGLER');
  return result.order_id;
}

/** Caller MUST persist checkout order_id before calling this function. */
export async function createKustomHpp(env: KustomEnvironment, kustomOrderId: string, customerOrigin: string, callbackToken: string): Promise<{
  sessionId: string; redirectUrl: string;
}> {
  if (!uuid.test(kustomOrderId)) throw new Error('Ugyldig Kustom ordre-ID');
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(callbackToken)) throw new Error('Mangler sterk tilfeldig HPP callback-token');
  const origin = ensureOrigin(customerOrigin);
  const response = await call<{ session_id?: string; redirect_url?: string }>(env, '/hpp/v1/sessions', 'POST', {
    payment_session_url: `${apiBase(env)}/checkout/v3/orders/${kustomOrderId}`,
    merchant_urls: {
      success: `${origin}/betaling?status=complete`,
      failure: `${origin}/betaling?status=failed`,
      cancel: `${origin}/betaling?status=cancelled`,
      status_update: `${origin}/api/kustom/status-update?token=${encodeURIComponent(callbackToken)}&hppId={{session_id}}`,
    },
  });
  if (!response.session_id || !uuid.test(response.session_id) || !response.redirect_url) throw new Error('KUSTOM_HPP_UGYLDIG_RESPONS');
  const u = new URL(response.redirect_url);
  if (u.protocol !== 'https:' || u.username || u.password || !(
    u.hostname === 'pay.klarna.com' || u.hostname.endsWith('.klarna.com') ||
    u.hostname === 'pay.kustom.co' || u.hostname.endsWith('.kustom.co')
  )) throw new Error('KUSTOM_HPP_UGYLDIG_LENKE');
  return { sessionId: response.session_id, redirectUrl: response.redirect_url };
}

export async function readHpp(env: KustomEnvironment, sessionId: string): Promise<{
  session_id: string; order_id?: string; status: string;
}> {
  if (!uuid.test(sessionId)) throw new Error('Ugyldig HPP-ID');
  return call(env, `/hpp/v1/sessions/${sessionId}`, 'GET');
}

export async function readKustomCheckout(env: KustomEnvironment, orderId: string): Promise<{
  order_id: string; status: string; order_amount: number; purchase_currency: string; merchant_reference1?: string;
}> {
  if (!uuid.test(orderId)) throw new Error('Ugyldig Kustom ordre-ID');
  return call(env, `/checkout/v3/orders/${orderId}`, 'GET');
}

export function checkoutAuthorized(input: {
  internalOrderId: string; amountMinor: number; kustomOrderId: string; sessionId: string;
}, session: { session_id: string; order_id?: string; status: string }, order: {
  order_id: string; status: string; order_amount: number; purchase_currency: string; merchant_reference1?: string;
}): boolean {
  return session.session_id === input.sessionId && session.status === 'COMPLETED' && session.order_id === input.kustomOrderId &&
    order.order_id === input.kustomOrderId && order.status === 'checkout_complete' &&
    order.order_amount === input.amountMinor && order.purchase_currency.toUpperCase() === 'NOK' &&
    order.merchant_reference1 === input.internalOrderId;
}

/** COMPLETED indicates authorization only; NEVER treat as captured or refunded. */
export function classifyKustomOrderManagement(input: {
  status: string; captured_amount: number; refunded_amount: number; original_order_amount: number; purchase_currency: string;
}, expectedMinor: number): 'AUTHORIZED' | 'PAID' | 'REFUNDED' | 'NEEDS_RECONCILIATION' {
  if (!Number.isSafeInteger(expectedMinor) || expectedMinor <= 0 ||
    typeof input.status !== 'string' ||
    input.purchase_currency.toUpperCase() !== 'NOK' ||
    input.original_order_amount !== expectedMinor ||
    ![input.captured_amount, input.refunded_amount].every(v => Number.isSafeInteger(v) && v >= 0) ||
    input.refunded_amount > input.captured_amount) return 'NEEDS_RECONCILIATION';

  // Money totals alone are not proof of authorization or capture:
  // CANCELLED / EXPIRED with captured_amount=0 MUST NOT become AUTHORIZED.
  // PART_CAPTURED / CLOSED / unknown statuses require explicit review.
  const providerStatus = input.status.toUpperCase();
  if (providerStatus === 'AUTHORIZED' &&
      input.captured_amount === 0 && input.refunded_amount === 0) return 'AUTHORIZED';
  if (providerStatus === 'CAPTURED' && input.captured_amount === expectedMinor) {
    if (input.refunded_amount === expectedMinor) return 'REFUNDED';
    if (input.refunded_amount === 0) return 'PAID';
  }
  return 'NEEDS_RECONCILIATION';
}
