/**
 * FinnBilGlass — Felles test-hjelpemodul for integrasjonstester (Fase 5.6/5.7)
 *
 * Oppretter en minimal Env og hjelpefunksjoner for å kalle faktiske
 * API-rutehåndtere (auth, admin) i Node.js uten Cloudflare-kjøretid.
 */

import assert from 'node:assert/strict';

/**
 * Minimal miljøobjekt for lokale tester.
 * FINNBILGLASS_DB brukes ikke av auth-rutene (de bruker D1Emulator internt),
 * men må finnes for å tilfredsstille Env-grensesnittet.
 */
export function createTestEnv(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ENVIRONMENT: 'test',
    FINNBILGLASS_DB: {
      prepare: () => ({
        bind: () => ({
          run: async () => ({}),
          first: async () => null,
          all: async () => ({ results: [] }),
        }),
        first: async () => null,
        all: async () => ({ results: [] }),
        batch: async () => [],
      }),
    },
    ...overrides,
  };
}

/**
 * Bygg en HTTP Request for testformål.
 */
export function createTestRequest(
  method: string,
  url: string,
  body?: unknown,
  headers: Record<string, string> = {}
): Request {
  const init: RequestInit = { method, headers };
  if (body && method !== 'GET' && method !== 'HEAD') {
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
    if (!init.headers['Content-Type']) {
      (init.headers as Record<string, string>)['Content-Type'] = 'application/json';
    }
  }
  return new Request(url, init);
}

/**
 * Kall en API-rutehåndterer og returner parsed JSON-respons + status + headers.
 */
export async function callRoute(
  handler: (request: Request, env: Record<string, unknown>) => Promise<Response>,
  method: string,
  url: string,
  env: Record<string, unknown>,
  body?: unknown,
  extraHeaders: Record<string, string> = {}
): Promise<{ status: number; body: unknown; headers: Headers }> {
  const request = createTestRequest(method, url, body, extraHeaders);
  const response = await handler(request, env);
  const headers = response.headers;
  let parsed: unknown = null;
  const contentType = headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    parsed = await response.json();
  } else {
    parsed = await response.text();
  }
  return { status: response.status, body: parsed, headers };
}

/**
 * Hent sesjons-ID fra Set-Cookie-header.
 */
export function extractSessionCookie(headers: Headers): string | null {
  const setCookie = headers.get('set-cookie') ?? '';
  const match = setCookie.match(/fb_session=([^;]+)/);
  return match ? match[1] : null;
}

/**
 * Bygg Cookie-header fra sesjons-ID.
 */
export function sessionCookieHeader(sessionId: string): string {
  return `fb_session=${sessionId}`;
}

/**
 * Sett en testbruker med eksplisitt rolle (ikke hardkodet e-post-mapping).
 */
export function setTestRole(email: string, role: 'ADMIN' | 'REVIEWER' | 'OPERATOR' | 'CUSTOMER'): void {
  // Importer auth-modulen for å sette rollen
  import('../src/auth.ts').then(({ setUserRole }) => {
    setUserRole(email, role);
  });
}

/**
 * Assert at respons har forventet status.
 */
export function assertStatus(status: number, expected: number, context?: string): void {
  assert.equal(
    status,
    expected,
    context ? `${context}: forventet status ${expected}, fikk ${status}` : `Forventet status ${expected}, fikk ${status}`
  );
}

/**
 * Assert at respons har ok=true.
 */
export function assertOk(body: unknown, context?: string): void {
  const b = body as { ok?: boolean };
  assert.equal(b.ok, true, context ? `${context}: forventet ok=true` : 'Forventet ok=true');
}

/**
 * Assert at respons har ok=false og en feilmelding.
 */
export function assertError(body: unknown, errorCode?: string, context?: string): void {
  const b = body as { ok?: boolean; error?: string };
  assert.equal(b.ok, false, context ? `${context}: forventet ok=false` : 'Forventet ok=false');
  if (errorCode) {
    assert.equal(b.error, errorCode, context ? `${context}: forventet feil '${errorCode}'` : `Forventet feil '${errorCode}'`);
  }
}

/**
 * Assert at cookie har HttpOnly-attributt.
 */
export function assertHttpOnlyCookie(headers: Headers, context?: string): void {
  const setCookie = headers.get('set-cookie') ?? '';
  assert.ok(setCookie.includes('HttpOnly'), context ? `${context}: Cookie mangler HttpOnly` : 'Cookie mangler HttpOnly');
}

/**
 * Assert at cookie har Secure-attributt.
 */
export function assertSecureCookie(headers: Headers, context?: string): void {
  const setCookie = headers.get('set-cookie') ?? '';
  assert.ok(setCookie.includes('Secure'), context ? `${context}: Cookie mangler Secure` : 'Cookie mangler Secure');
}

/**
 * Assert at cookie har SameSite-attributt.
 */
export function assertSameSiteCookie(headers: Headers, context?: string): void {
  const setCookie = headers.get('set-cookie') ?? '';
  assert.ok(setCookie.includes('SameSite'), context ? `${context}: Cookie mangler SameSite` : 'Cookie mangler SameSite');
}
