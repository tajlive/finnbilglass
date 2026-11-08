import type { Env } from '../types';
import { verifiserAccess, type AccessIdentitet } from '../access-jwt';

// Playground and production can have different Merchant IDs. This is the ID
// shown for FinnBilglass in portal.playground.kustom.co; M00808102 remains the
// owner-provided production MID we explicitly probe through the config API.
const PLAYGROUND_MERCHANT_ID = 'PM00730041';
const REQUESTED_MERCHANT_ID = 'M00808102';
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
      merchantMatchesPlaygroundPortal: client.merchant_id === PLAYGROUND_MERCHANT_ID,
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
  merchantHeader?: string,
): Promise<{ status: number | null; value: unknown; errorType?: string; errorCode?: string | null }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetcher(`${PLAYGROUND_API}${path}`, {
      method: 'GET',
      // Never forward Authorization to a redirect destination; report its status instead.
      redirect: 'manual',
      signal: controller.signal,
      headers: {
        Authorization: authorization,
        Accept: 'application/json',
        ...(merchantHeader ? { 'X-merchant-id': merchantHeader } : {}),
      },
    });
    let value: unknown = null;
    if ((res.headers.get('content-type') || '').includes('json')) {
      try { value = await res.json(); } catch { value = null; }
    }
    return { status: res.status, value };
  } catch (error) {
    const cause = error instanceof Error ? error.cause : undefined;
    const rawCode = cause && typeof cause === 'object' && 'code' in cause
      ? (cause as { code?: unknown }).code
      : undefined;
    const safeCode = typeof rawCode === 'string' && /^[A-Z0-9_]{1,32}$/.test(rawCode) ? rawCode : null;
    return {
      status: null,
      value: null,
      // Expose no exception text or request details.
      errorType: error instanceof Error && error.name === 'AbortError' ? 'TIMEOUT' : 'REQUEST_FAILED',
      errorCode: safeCode,
    };
  } finally {
    clearTimeout(timeout);
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
  const merchantMatches = username.startsWith(`${PLAYGROUND_MERCHANT_ID}-`);
  const playgroundCredential = password.startsWith('kco_test_api_');
  if (!merchantMatches || !playgroundCredential) {
    return response({
      ok: false,
      merchantId: REQUESTED_MERCHANT_ID,
      playgroundPortalMerchantId: PLAYGROUND_MERCHANT_ID,
      credentialMerchantMatches: merchantMatches,
      credentialIsPlayground: playgroundCredential,
      error: 'CREDENTIAL_SCOPE_MISMATCH',
    }, 409);
  }

  const authorization = `Basic ${btoa(`${username}:${password}`)}`;
  const [checkout, allConfig, noConfig, elements] = await Promise.all([
    getJson(deps.fetch, '/checkout/v3/orders/does-not-exist', authorization, undefined),
    getJson(deps.fetch, '/config/checkout/v1/config/expressCheckoutPaymentMethods', authorization, REQUESTED_MERCHANT_ID),
    getJson(deps.fetch, '/config/checkout/v1/config/country/NO/expressCheckoutPaymentMethods', authorization, REQUESTED_MERCHANT_ID),
    getJson(deps.fetch, '/elements/v1/clients/', authorization, PLAYGROUND_MERCHANT_ID),
  ]);

  return response({
    ok: checkout.status === 404,
    merchantId: REQUESTED_MERCHANT_ID,
    playgroundPortalMerchantId: PLAYGROUND_MERCHANT_ID,
    credentials: { merchantMatches, environment: 'playground' },
    checkoutAuthentication: { httpStatus: checkout.status, accepted: checkout.status === 404 },
    expressCheckoutPaymentMethods: {
      allCountries: { httpStatus: allConfig.status, errorType: allConfig.errorType ?? null, errorCode: allConfig.errorCode ?? null, configuration: allConfig.status === 200 ? projectConfig(allConfig.value) : null },
      norway: { httpStatus: noConfig.status, errorType: noConfig.errorType ?? null, errorCode: noConfig.errorCode ?? null, configuration: noConfig.status === 200 ? projectConfig(noConfig.value) : null },
    },
    elements: {
      clientsHttpStatus: elements.status,
      clientsErrorType: elements.errorType ?? null,
      clientsErrorCode: elements.errorCode ?? null,
      clients: elements.status === 200 ? projectElements(elements.value) : null,
    },
  });
}
