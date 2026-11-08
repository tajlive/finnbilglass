import type { Env } from '../types';
import { verifiserAccess, type AccessIdentitet } from '../access-jwt';

const MERCHANT_ID = 'M00808102';
const PLAYGROUND_API = 'https://api.playground.kustom.co';
const ELEMENTS_PUBLIC_KEY = 'playground_af2f89ec-92ca-4e8c-949f-0854a62d90ee';
const METHODS = new Set(['amazonPay', 'applePay', 'googlePay', 'klarna', 'paypal']);

type DiagnosticDeps = {
  verifyAccess: (request: Request, env: Env) => Promise<AccessIdentitet | null>;
  fetch: typeof fetch;
};

function response(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: { 'Cache-Control': 'no-store', 'Pragma': 'no-cache' },
  });
}

function projectConfig(value: unknown): unknown {
  const rows = Array.isArray(value) ? value : [value];
  return rows.map((row) => {
    if (!row || typeof row !== 'object') return null;
    const item = row as Record<string, unknown>;
    const methods = Array.isArray(item.expressCheckoutPaymentMethods)
      ? item.expressCheckoutPaymentMethods
          .filter((method): method is Record<string, unknown> => !!method && typeof method === 'object')
          .filter((method) => typeof method.method === 'string' && METHODS.has(method.method))
          .map((method) => ({ method: method.method, enabled: method.enabled === true }))
      : [];
    return {
      merchantId: typeof item.merchantId === 'string' ? item.merchantId : null,
      country: typeof item.country === 'string' ? item.country : null,
      expressCheckoutPaymentMethods: methods,
      revision: Number.isSafeInteger(item.revision) ? item.revision : null,
    };
  });
}

function projectElements(value: unknown): unknown[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    if (!entry || typeof entry !== 'object') return null;
    const client = entry as Record<string, unknown>;
    const id = typeof client.id === 'string' ? client.id : null;
    const placements = Array.isArray(client.placements) ? client.placements : [];
    return {
      merchantMatches: client.merchant_id === MERCHANT_ID,
      allowedOrigins: Array.isArray(client.allowed_origins)
        ? client.allowed_origins.filter((origin): origin is string => typeof origin === 'string')
        : [],
      publicKeyMatchesStagingPreview: id === ELEMENTS_PUBLIC_KEY,
      placements: placements.flatMap((placement) => {
        if (!placement || typeof placement !== 'object') return [];
        const p = placement as Record<string, unknown>;
        const content = Array.isArray(p.content) ? p.content : [];
        return [{
          key: typeof p.key === 'string' ? p.key : null,
          containsPaymentMethodDisplay: content.some((part) =>
            !!part && typeof part === 'object' && (part as Record<string, unknown>).type === 'PAYMENT_METHOD'),
        }];
      }),
    };
  }).filter(Boolean);
}

async function getJson(
  fetcher: typeof fetch,
  path: string,
  authorization: string,
  merchantHeader: boolean,
): Promise<{ status: number | null; value: unknown }> {
  try {
    const res = await fetcher(`${PLAYGROUND_API}${path}`, {
      method: 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(8000),
      headers: {
        Authorization: authorization,
        Accept: 'application/json',
        ...(merchantHeader ? { 'X-merchant-id': MERCHANT_ID } : {}),
      },
    });
    let value: unknown = null;
    if ((res.headers.get('content-type') || '').includes('json')) {
      try { value = await res.json(); } catch { value = null; }
    }
    return { status: res.status, value };
  } catch {
    return { status: null, value: null };
  }
}

/** Read-only, staging-only probe; API credentials never leave this Worker runtime. */
export async function handleKustomPlaygroundDiagnostics(
  request: Request,
  env: Env,
  deps: DiagnosticDeps = {
    verifyAccess: verifiserAccess,
    fetch: globalThis.fetch.bind(globalThis),
  },
): Promise<Response> {
  if (env.ENVIRONMENT !== 'staging') return response({ ok: false, error: 'NOT_FOUND' }, 404);
  if (new URL(request.url).hostname !== 'ops-staging.finnbilglass.no') {
    return response({ ok: false, error: 'STAGING_OPS_HOST_REQUIRED' }, 404);
  }
  if (request.method !== 'GET') return response({ ok: false, error: 'METHOD_NOT_ALLOWED' }, 405);
  if (new URL(request.url).search || request.headers.get('Origin') && request.headers.get('Origin') !== new URL(request.url).origin) {
    return response({ ok: false, error: 'INVALID_REQUEST' }, 400);
  }

  const identity = await deps.verifyAccess(request, env);
  if (!identity?.epost) return response({ ok: false, error: 'CLOUDFLARE_ACCESS_REQUIRED' }, 401);
  const allowlist = String(env.ADMIN_EMAILS || '').split(',').map((email) => email.trim().toLowerCase());
  if (!allowlist.includes(identity.epost.toLowerCase())) {
    return response({ ok: false, error: 'ADMIN_ROLE_REQUIRED' }, 403);
  }

  const username = env.KUSTOM_API_USERNAME || '';
  const password = env.KUSTOM_API_PASSWORD || '';
  if (!username || !password) return response({ ok: false, error: 'PLAYGROUND_CREDENTIALS_MISSING' }, 503);
  const merchantMatches = username.startsWith(`${MERCHANT_ID}-`);
  const playgroundCredential = password.startsWith('kco_test_api_');
  if (!merchantMatches || !playgroundCredential) {
    return response({
      ok: false,
      merchantId: MERCHANT_ID,
      credentialMerchantMatches: merchantMatches,
      credentialIsPlayground: playgroundCredential,
      error: 'CREDENTIAL_SCOPE_MISMATCH',
    }, 409);
  }

  const authorization = `Basic ${btoa(`${username}:${password}`)}`;
  const [checkout, allConfig, noConfig, elements] = await Promise.all([
    getJson(deps.fetch, '/checkout/v3/orders/does-not-exist', authorization, false),
    getJson(deps.fetch, '/config/checkout/v1/config/expressCheckoutPaymentMethods', authorization, true),
    getJson(deps.fetch, '/config/checkout/v1/config/country/NO/expressCheckoutPaymentMethods', authorization, true),
    getJson(deps.fetch, '/elements/v1/clients/', authorization, true),
  ]);

  return response({
    ok: checkout.status === 404,
    merchantId: MERCHANT_ID,
    credentials: { merchantMatches, environment: 'playground' },
    checkoutAuthentication: { httpStatus: checkout.status, accepted: checkout.status === 404 },
    expressCheckoutPaymentMethods: {
      allCountries: { httpStatus: allConfig.status, configuration: allConfig.status === 200 ? projectConfig(allConfig.value) : null },
      norway: { httpStatus: noConfig.status, configuration: noConfig.status === 200 ? projectConfig(noConfig.value) : null },
    },
    elements: {
      clientsHttpStatus: elements.status,
      clients: elements.status === 200 ? projectElements(elements.value) : null,
    },
  });
}
