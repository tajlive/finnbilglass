/**
 * Kustom Checkout + Hosted Payment Page. Kun serverside.
 * Dette er en adapter; Ops/D1 og sikre callbacks må kobles til før produksjonsbruk.
 */
export interface KustomCredentials {
  KUSTOM_API_USERNAME: string;
  KUSTOM_API_PASSWORD: string;
  KUSTOM_API_BASE_URL?: string;
}

export interface KustomOrderLine {
  type: 'physical' | 'shipping_fee' | 'discount' | 'digital';
  reference: string;
  name: string;
  quantity: number;
  unit_price: number;
  tax_rate: number;
  total_amount: number;
  total_tax_amount: number;
  total_discount_amount?: number;
  quantity_unit?: string;
}

export interface KustomOrder {
  purchase_country: 'NO';
  purchase_currency: 'NOK';
  locale: 'nb-NO';
  order_amount: number;
  order_tax_amount: number;
  order_lines: KustomOrderLine[];
  merchant_urls: {
    terms: string;
    checkout: string;
    confirmation: string;
    push: string;
  };
  merchant_reference1: string;
  options?: Record<string, unknown>;
}

export function validateKustomOrder(order: KustomOrder): void {
  if (order.purchase_country !== 'NO' || order.purchase_currency !== 'NOK') {
    throw new Error('Kustom: Kun NO/NOK er tillatt i FinnBilGlass');
  }
  if (!order.merchant_reference1 || !order.order_lines.length) {
    throw new Error('Kustom: Mangler stabil ordre-ID eller ordrelinjer');
  }
  for (const [key, value] of Object.entries(order.merchant_urls)) {
    if (!value.startsWith('https://')) {
      throw new Error(`Kustom: ${key} må være HTTPS`);
    }
  }
  const integer = (n: number) => Number.isSafeInteger(n);
  if (!integer(order.order_amount) || order.order_amount <= 0 || !integer(order.order_tax_amount) || order.order_tax_amount < 0) {
    throw new Error('Kustom: Ugyldig total i øre');
  }
  for (const line of order.order_lines) {
    const nums = [line.quantity, line.unit_price, line.total_amount, line.total_tax_amount, line.tax_rate, line.total_discount_amount ?? 0];
    if (nums.some(n => !integer(n)) || line.quantity < 1 || line.tax_rate < 0) {
      throw new Error('Kustom: Ugyldig ordrelinje');
    }
    if (line.total_amount !== line.quantity * line.unit_price - (line.total_discount_amount ?? 0)) {
      throw new Error('Kustom: Linjebeløpet stemmer ikke');
    }
  }
  const sum = (f: 'total_amount' | 'total_tax_amount') => order.order_lines.reduce((n, line) => n + line[f], 0);
  if (sum('total_amount') !== order.order_amount || sum('total_tax_amount') !== order.order_tax_amount) {
    throw new Error('Kustom: Linjer og totalsummer stemmer ikke');
  }
}

function apiRoot(env: KustomCredentials): string {
  const url = env.KUSTOM_API_BASE_URL || 'https://api.playground.kustom.co';
  if (url !== 'https://api.playground.kustom.co' && url !== 'https://api.kustom.co') {
    throw new Error('Kustom: Uventet API-domene');
  }
  return url;
}

async function apiCall<T>(env: KustomCredentials, path: string, method: 'GET' | 'POST', body?: unknown): Promise<T> {
  const root = apiRoot(env);
  if (!env.KUSTOM_API_USERNAME || !env.KUSTOM_API_PASSWORD) {
    throw new Error('Kustom: Mangler API secrets');
  }
  const response = await fetch(root + path, {
    method,
    headers: {
      Authorization: `Basic ${btoa(`${env.KUSTOM_API_USERNAME}:${env.KUSTOM_API_PASSWORD}`)}`,
      Accept: 'application/json',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  if (!response.ok) {
    // Ikke logg responsbody: den kan inneholde persondata.
    throw new Error(`Kustom API ${method} ${path.split('?')[0]} HTTP ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export async function createKustomHostedPayment(
  env: KustomCredentials,
  lockedOrder: KustomOrder,
  hppUrls?: { success?: string; failure?: string; back?: string; status_update?: string }
): Promise<{ orderId: string; sessionId: string; redirectUrl: string; sessionUrl: string; expiresAt?: string }> {
  validateKustomOrder(lockedOrder);
  // Kall kun fra Ops etter registrert kundeaksept og låst ordrebeløp.
  const created = await apiCall<{ order_id: string }>(env, '/checkout/v3/orders', 'POST', lockedOrder);
  if (!created.order_id) throw new Error('Kustom: Ingen order_id');
  const root = apiRoot(env);
  const session = await apiCall<{
    session_id: string; redirect_url: string; session_url: string; expires_at?: string;
  }>(env, '/hpp/v1/sessions', 'POST', {
    payment_session_url: `${root}/checkout/v3/orders/${encodeURIComponent(created.order_id)}`,
    ...(hppUrls ? { merchant_urls: hppUrls } : {})
  });
  if (!session.session_id || !session.redirect_url || !session.session_url) {
    throw new Error('Kustom: HPP-respons mangler lenke eller ID');
  }
  if (new URL(session.session_url).origin !== root || new URL(session.redirect_url).protocol !== 'https:') {
    throw new Error('Kustom: Uventet HPP-lenke');
  }
  return {
    orderId: created.order_id,
    sessionId: session.session_id,
    redirectUrl: session.redirect_url,
    sessionUrl: session.session_url,
    expiresAt: session.expires_at
  };
}

export async function readKustomHostedSession(
  env: KustomCredentials,
  sessionId: string
): Promise<{ session_id: string; status: string; order_id?: string }> {
  if (!/^[0-9a-fA-F-]{16,64}$/.test(sessionId)) throw new Error('Kustom: Ugyldig session-ID');
  return apiCall(env, `/hpp/v1/sessions/${encodeURIComponent(sessionId)}`, 'GET');
}
