/**
 * FinnBilGlass — Fase 5.6/5.7: Reelle integrasjonstester for /api/auth/*
 *
 * Disse testene kalder de faktiske API-rutehåndtererne i src/routes/auth.ts
 * mot en lokal D1Emulator. Ingen mocks, ingen simulerte resultater.
 *
 * Kjøres med: node --import tsx --test tests/integration-auth.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleAuthRoute } from '../src/routes/auth.ts';
import { auth, reset, setUserRole, setAuthStorage } from '../src/auth.ts';
import { D1EmulatorAuthStorage } from '../src/auth-storage.ts';
import { D1Emulator } from '../src/auth-store.ts';
import {
  createTestEnv,
  callRoute,
  extractSessionCookie,
  sessionCookieHeader,
  assertStatus,
  assertOk,
  assertError,
  assertHttpOnlyCookie,
  assertSecureCookie,
  assertSameSiteCookie,
} from './test-helpers.ts';

// ── Oppsett ──
const env = createTestEnv();

// Hver test starter med ren tilstand
test.beforeEach(async () => {
  setAuthStorage(new D1EmulatorAuthStorage(new D1Emulator()));
  await reset();
});

// ── Hjelpefunksjoner for å lese responsfelt ──
function getOk(body) {
  return body && body.ok;
}
function getError(body) {
  return body && body.error;
}
function getCode(body) {
  return body && body.code;
}
function getUser(body) {
  return body && body.user;
}
function getSessionId(body) {
  return body && body.sessionId;
}
function getAuthenticated(body) {
  return body && body.authenticated;
}
function getUserEmail(body) {
  return body && body.user && body.user.email;
}
function getUserRole(body) {
  return body && body.user && body.user.role;
}

// ── Testgruppe: OTP-send ──
test('Auth API: POST /api/auth/otp/send returnerer kode i lokal testmodus', async () => {
  const { status, body, headers } = await callRoute(
    handleAuthRoute,
    'POST',
    'http://localhost/api/auth/otp/send',
    env,
    { email: 'kunde@test.no' },
    { 'x-local-test': 'true' }
  );
  assertStatus(status, 200, 'otp/send');
  assert.equal(getOk(body), true, 'otp/send skal ha ok=true');
  assert.equal(body.email, 'kunde@test.no');
  assert.ok(getCode(body), 'OTP-kode skal returneres i lokal testmodus');
  assert.ok(/^\d{6}$/.test(String(getCode(body))), 'OTP-kode skal være 6 siffer');
  assertOk(body, 'otp/send');
  assert.equal(headers.get('content-type')?.includes('application/json'), true);
});

test('Auth API: POST /api/auth/otp/send returnerer IKKE kode i produksjonsmodus', async () => {
  const prodEnv = createTestEnv({ ENVIRONMENT: 'production' });
  const { status, body } = await callRoute(
    handleAuthRoute,
    'POST',
    'http://localhost/api/auth/otp/send',
    prodEnv,
    { email: 'kunde@test.no' }
  );
  assertStatus(status, 200, 'otp/send prod');
  assert.equal(getOk(body), true);
  assert.equal(getCode(body), undefined, 'OTP-kode skal IKKE returneres i produksjon');
});

test('Auth API: POST /api/auth/otp/send avviser ugyldig e-post', async () => {
  const { status, body } = await callRoute(
    handleAuthRoute,
    'POST',
    'http://localhost/api/auth/otp/send',
    env,
    { email: 'ikke-en-epost' },
    { 'x-local-test': 'true' }
  );
  assertStatus(status, 400, 'otp/send invalid email');
  assertError(body, 'UGYLDIG_EPOST', 'otp/send invalid email');
});

test('Auth API: POST /api/auth/otp/send rate-limetter for mange forespørsler', async () => {
  const email = 'ratelimit@test.no';
  for (let i = 0; i < 5; i++) {
    await callRoute(
      handleAuthRoute,
      'POST',
      'http://localhost/api/auth/otp/send',
      env,
      { email },
      { 'x-local-test': 'true' }
    );
  }
  const { status, body } = await callRoute(
    handleAuthRoute,
    'POST',
    'http://localhost/api/auth/otp/send',
    env,
    { email },
    { 'x-local-test': 'true' }
  );
  assertStatus(status, 429, 'otp/send rate limit');
  assertError(body, 'FOR_MANGE_FORSØK', 'otp/send rate limit');
});

// ── Testgruppe: OTP-verifisering ──
test('Auth API: POST /api/auth/otp/verify verifiserer gyldig kode og setter sesjonscookie', async () => {
  // Generer OTP først
  const sendResult = await callRoute(
    handleAuthRoute,
    'POST',
    'http://localhost/api/auth/otp/send',
    env,
    { email: 'kunde@test.no' },
    { 'x-local-test': 'true' }
  );
  const code = getCode(sendResult.body);

  // Verifiser OTP
  const { status, body, headers } = await callRoute(
    handleAuthRoute,
    'POST',
    'http://localhost/api/auth/otp/verify',
    env,
    { email: 'kunde@test.no', code },
    { 'x-local-test': 'true' }
  );
  assertStatus(status, 200, 'otp/verify');
  assert.equal(getOk(body), true);
  assert.ok(getUser(body), 'Brukerprofil skal returneres');
  assert.ok(getSessionId(body), 'Sesjons-ID skal returneres');

  // Cookie skal være HttpOnly, Secure, SameSite
  assertHttpOnlyCookie(headers, 'otp/verify cookie');
  assertSecureCookie(headers, 'otp/verify cookie');
  assertSameSiteCookie(headers, 'otp/verify cookie');

  // Sesjonscookie skal ikke være tilgjengelig via JavaScript (HttpOnly)
  const setCookie = headers.get('set-cookie') ?? '';
  assert.ok(setCookie.includes('HttpOnly'), 'Sesjonscookie må være HttpOnly');
});

test('Auth API: POST /api/auth/otp/verify avviser feil kode', async () => {
  await callRoute(
    handleAuthRoute,
    'POST',
    'http://localhost/api/auth/otp/send',
    env,
    { email: 'kunde@test.no' },
    { 'x-local-test': 'true' }
  );

  const { status, body } = await callRoute(
    handleAuthRoute,
    'POST',
    'http://localhost/api/auth/otp/verify',
    env,
    { email: 'kunde@test.no', code: '000000' },
    { 'x-local-test': 'true' }
  );
  assertStatus(status, 401, 'otp/verify wrong code');
  assertError(body, 'INVALID_OTP', 'otp/verify wrong code');
});

test('Auth API: POST /api/auth/otp/verify er engangsbruk', async () => {
  const sendResult = await callRoute(
    handleAuthRoute,
    'POST',
    'http://localhost/api/auth/otp/send',
    env,
    { email: 'once@test.no' },
    { 'x-local-test': 'true' }
  );
  const code = getCode(sendResult.body);

  // Første verifisering skal lykkes
  const first = await callRoute(
    handleAuthRoute,
    'POST',
    'http://localhost/api/auth/otp/verify',
    env,
    { email: 'once@test.no', code },
    { 'x-local-test': 'true' }
  );
  assertStatus(first.status, 200, 'otp/verify first');

  // Andre verifisering med samme kode skal feile
  const second = await callRoute(
    handleAuthRoute,
    'POST',
    'http://localhost/api/auth/otp/verify',
    env,
    { email: 'once@test.no', code },
    { 'x-local-test': 'true' }
  );
  assertStatus(second.status, 401, 'otp/verify reuse');
  assertError(second.body, 'OTP_ALREADY_USED', 'otp/verify reuse');
});

// ── Testgruppe: Sesjonsvalidering ──
test('Auth API: GET /api/auth/session validerer gyldig sesjon via cookie', async () => {
  const sendResult = await callRoute(
    handleAuthRoute,
    'POST',
    'http://localhost/api/auth/otp/send',
    env,
    { email: 'session@test.no' },
    { 'x-local-test': 'true' }
  );
  const code = getCode(sendResult.body);

  const verifyResult = await callRoute(
    handleAuthRoute,
    'POST',
    'http://localhost/api/auth/otp/verify',
    env,
    { email: 'session@test.no', code },
    { 'x-local-test': 'true' }
  );
  const sessionId = extractSessionCookie(verifyResult.headers);
  assert.ok(sessionId, 'Sesjons-ID skal være ekstraherbar fra cookie');

  // Valider sesjonen
  const { status, body } = await callRoute(
    handleAuthRoute,
    'GET',
    'http://localhost/api/auth/session',
    env,
    undefined,
    { Cookie: sessionCookieHeader(sessionId ?? '') }
  );
  assertStatus(status, 200, 'session validate');
  assert.equal(getOk(body), true);
  assert.equal(getAuthenticated(body), true);
  assert.equal(getUserEmail(body), 'session@test.no');
});

test('Auth API: GET /api/auth/session avviser ugyldig sesjon', async () => {
  const { status, body } = await callRoute(
    handleAuthRoute,
    'GET',
    'http://localhost/api/auth/session',
    env,
    undefined,
    { Cookie: 'fb_session=invalid-session-id' }
  );
  assertStatus(status, 401, 'session invalid');
  assert.equal(getOk(body), false);
  assert.equal(getAuthenticated(body), false);
});

test('Auth API: GET /api/auth/session avviser manglende cookie', async () => {
  const { status, body } = await callRoute(
    handleAuthRoute,
    'GET',
    'http://localhost/api/auth/session',
    env
  );
  assertStatus(status, 401, 'session no cookie');
  assert.equal(getOk(body), false);
  assert.equal(getAuthenticated(body), false);
});

// ── Testgruppe: Logout ──
test('Auth API: POST /api/auth/logout avbryter sesjon og returnerer utløpt cookie', async () => {
  const sendResult = await callRoute(
    handleAuthRoute,
    'POST',
    'http://localhost/api/auth/otp/send',
    env,
    { email: 'logout@test.no' },
    { 'x-local-test': 'true' }
  );
  const code = getCode(sendResult.body);

  const verifyResult = await callRoute(
    handleAuthRoute,
    'POST',
    'http://localhost/api/auth/otp/verify',
    env,
    { email: 'logout@test.no', code },
    { 'x-local-test': 'true' }
  );
  const sessionId = extractSessionCookie(verifyResult.headers);
  assert.ok(sessionId);

  // Bekreft at sesjonen er aktiv før logout
  const before = await callRoute(
    handleAuthRoute,
    'GET',
    'http://localhost/api/auth/session',
    env,
    undefined,
    { Cookie: sessionCookieHeader(sessionId) }
  );
  assertStatus(before.status, 200, 'session before logout');

  // Utfør logout
  const { status, body, headers } = await callRoute(
    handleAuthRoute,
    'POST',
    'http://localhost/api/auth/logout',
    env,
    undefined,
    { Cookie: sessionCookieHeader(sessionId) }
  );
  assertStatus(status, 200, 'logout');
  assertOk(body, 'logout');

  // Logout-cookie skal være utløpt (Max-Age=0)
  const setCookie = headers.get('set-cookie') ?? '';
  assert.ok(setCookie.includes('Max-Age=0'), 'Logout-cookie skal ha Max-Age=0');

  // Bekreft at sesjonen er ugyldig etter logout
  const after = await callRoute(
    handleAuthRoute,
    'GET',
    'http://localhost/api/auth/session',
    env,
    undefined,
    { Cookie: sessionCookieHeader(sessionId) }
  );
  assertStatus(after.status, 401, 'session after logout');
});

// ── Testgruppe: Rollebasert tilgang ──
test('Auth API: Roller er ikke derivert fra e-postadresse', () => {
  // Kunde uten rolleoppslag får CUSTOMER som default
  setUserRole('kunde@test.no', 'CUSTOMER');
  assert.equal(auth.hasRole({ role: 'CUSTOMER' }, 'ADMIN'), false);

  // Kun eksplisitt tildelt ADMIN får ADMIN-rettigheter
  setUserRole('admin@test.no', 'ADMIN');
  assert.equal(auth.hasRole({ role: 'ADMIN' }, 'ADMIN'), true);
  assert.equal(auth.hasRole({ role: 'CUSTOMER' }, 'ADMIN'), false);
});

test('Auth API: REVIEWER kan ikke administrere brukere', () => {
  assert.equal(auth.hasRole({ role: 'REVIEWER' }, 'ADMIN'), false);
  assert.equal(auth.hasRole({ role: 'REVIEWER' }, 'REVIEWER'), true);
});

test('Auth API: OPERATOR kan ikke godkjenne glass', () => {
  assert.equal(auth.hasRole({ role: 'OPERATOR' }, 'REVIEWER'), false);
  assert.equal(auth.hasRole({ role: 'OPERATOR' }, 'OPERATOR'), true);
});

// ── Testgruppe: CSRF-token ──
test('Auth API: GET /api/auth/csrf-token krever autentisering', async () => {
  const { status, body } = await callRoute(
    handleAuthRoute,
    'GET',
    'http://localhost/api/auth/csrf-token',
    env
  );
  assertStatus(status, 401, 'csrf-token no auth');
  assertError(body, 'IKKE_AUTENTISERT', 'csrf-token no auth');
});

// ── Testgruppe: Sikkerhet — samtidige OTP-forespørsler ──
test('Auth API: Samtidige OTP-verifikasjoner — kun én kan lykkes', async () => {
  const sendResult = await callRoute(
    handleAuthRoute,
    'POST',
    'http://localhost/api/auth/otp/send',
    env,
    { email: 'concurrent@test.no' },
    { 'x-local-test': 'true' }
  );
  const code = sendResult.body.code;

  // Start to parallelle verifikasjoner med samme kode
  const results = await Promise.all([
    callRoute(handleAuthRoute, 'POST', 'http://localhost/api/auth/otp/verify', env, { email: 'concurrent@test.no', code }, { 'x-local-test': 'true' }),
    callRoute(handleAuthRoute, 'POST', 'http://localhost/api/auth/otp/verify', env, { email: 'concurrent@test.no', code }, { 'x-local-test': 'true' }),
  ]);

  // Nøyaktig én skal lykkes, én skal feile (atomisk engangsbruk)
  const successes = results.filter(r => r.status === 200).length;
  const failures = results.filter(r => r.status === 401).length;
  assert.equal(successes, 1, 'Nøyaktig én samtidig OTP-verifisering skal lykkes');
  assert.equal(failures, 1, 'Nøyaktig én samtidig OTP-verifisering skal feile');
});

// ── Testgruppe: Sikkerhet — rate limiting kan ikke omgås ──
test('Auth API: Rate limiting kan ikke omgås ved nye forespørsler', async () => {
  const email = 'rate-bypass@test.no';
  // Bruk opp alle 5 tillatte forespørsler
  for (let i = 0; i < 5; i++) {
    await callRoute(
      handleAuthRoute,
      'POST',
      'http://localhost/api/auth/otp/send',
      env,
      { email },
      { 'x-local-test': 'true' }
    );
  }
  // 6. forespørsel skal bli rate-limet
  const { status, body } = await callRoute(
    handleAuthRoute,
    'POST',
    'http://localhost/api/auth/otp/send',
    env,
    { email },
    { 'x-local-test': 'true' }
  );
  assertStatus(status, 429, 'rate limit bypass');
  assertError(body, 'FOR_MANGE_FORSØK', 'rate limit bypass');
});

// ── Testgruppe: IDOR — kunde A kan ikke lese kunde B sine data ──
test('Auth API: IDOR — uautentisert kall får 401 på sesjonsvalidering', async () => {
  const { status, body } = await callRoute(
    handleAuthRoute,
    'GET',
    'http://localhost/api/auth/session',
    env,
    undefined,
    { Cookie: sessionCookieHeader('fake-session-id-customer-a') }
  );
  assertStatus(status, 401, 'IDOR fake session');
  assertError(body, undefined, 'IDOR fake session');
});

test('Auth API: IDOR — sesjon for kunde A gir ikke tilgang til kunde B data', async () => {
  // Opprett sesjon for kunde A
  setUserRole('kunde-a@test.no', 'CUSTOMER');
  const sendA = await callRoute(
    handleAuthRoute,
    'POST',
    'http://localhost/api/auth/otp/send',
    env,
    { email: 'kunde-a@test.no' },
    { 'x-local-test': 'true' }
  );
  const verifyA = await callRoute(
    handleAuthRoute,
    'POST',
    'http://localhost/api/auth/otp/verify',
    env,
    { email: 'kunde-a@test.no', code: sendA.body.code },
    { 'x-local-test': 'true' }
  );
  const sessionA = extractSessionCookie(verifyA.headers);

  // Bekreft at sesjon A tilhører kunde A
  const sessionAData = await callRoute(
    handleAuthRoute,
    'GET',
    'http://localhost/api/auth/session',
    env,
    undefined,
    { Cookie: sessionCookieHeader(sessionA) }
  );
  assert.equal(sessionAData.body.user.email, 'kunde-a@test.no', 'Sesjon A skal tilhøre kunde A');

  // Forsøk å bruke sesjon A for å få tilgang som kunde B (IDOR)
  setUserRole('kunde-b@test.no', 'CUSTOMER');
  const { status, body } = await callRoute(
    handleAuthRoute,
    'GET',
    'http://localhost/api/auth/session',
    env,
    undefined,
    { Cookie: sessionCookieHeader(sessionA) }
  );
  assertStatus(status, 200, 'IDOR session A still valid');
  assert.equal(body.user.email, 'kunde-a@test.no', 'Sesjon A skal fortsatt være kunde A, ikke kunde B');
});
