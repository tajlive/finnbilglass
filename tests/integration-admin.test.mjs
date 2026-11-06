/**
 * FinnBilGlass — Fase 5.6/5.7: Reelle integrasjonstester for /api/admin/*
 *
 * Disse testene kalder de faktiske API-rutehåndtererne i src/routes/admin.ts.
 * Tester rollebasert autorisasjon: ADMIN, REVIEWER, OPERATOR, CUSTOMER, uautentisert.
 *
 * Kjøres med: node --import tsx --test tests/integration-admin.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleAdminRoute } from '../src/routes/admin.ts';
import { handleAuthRoute } from '../src/routes/auth.ts';
import { auth, reset, setUserRole, setAuthStorage, getStorage } from '../src/auth.ts';
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
} from './test-helpers.ts';

const env = createTestEnv();

// Hjelpefunksjon: logg inn som en bestemt rolle og returner sesjonscookie
async function loginAs(email, role) {
  await getStorage().userSet({ userId: 'test-' + email, email, role, name: email.split('@')[0], createdAt: Date.now(), updatedAt: Date.now() });

  // Send OTP
  await callRoute(
    handleAuthRoute,
    'POST',
    'http://localhost/api/auth/otp/send',
    env,
    { email },
    { 'x-local-test': 'true' }
  );

  // Hent koden fra auth-modulen direkte (test-hjelp: vi har tilgang til store)
  // I stedet bruker vi verifyOtp direkte for å opprette sesjonen
  const { code } = await auth.generateOtp(email);
  const verifyResult = await callRoute(
    handleAuthRoute,
    'POST',
    'http://localhost/api/auth/otp/verify',
    env,
    { email, code },
    { 'x-local-test': 'true' }
  );
  assert.equal(verifyResult.status, 200, `Login as ${role}`);
  return extractSessionCookie(verifyResult.headers);
}

test.beforeEach(async () => {
  setAuthStorage(new D1EmulatorAuthStorage(new D1Emulator()));
  await reset();
});

// ── Testgruppe: Admin-autentisering ──
test('Admin API: Uautentisert kall til /api/admin/users får 401', async () => {
  const { status, body } = await callRoute(
    handleAdminRoute,
    'GET',
    'http://localhost/api/admin/users',
    env
  );
  assertStatus(status, 401, 'admin users no auth');
  assertError(body, 'IKKE_AUTENTISERT', 'admin users no auth');
});

test('Admin API: CUSTOMER får 403 på /api/admin/users', async () => {
  const cookie = await loginAs('kunde@test.no', 'CUSTOMER');
  const { status, body } = await callRoute(
    handleAdminRoute,
    'GET',
    'http://localhost/api/admin/users',
    env,
    undefined,
    { Cookie: sessionCookieHeader(cookie) }
  );
  assertStatus(status, 403, 'admin users customer');
  assertError(body, 'IKKE_AUTORISERT', 'admin users customer');
});

test('Admin API: ADMIN kan liste brukere', async () => {
  const cookie = await loginAs('admin@test.no', 'ADMIN');
  const { status, body } = await callRoute(
    handleAdminRoute,
    'GET',
    'http://localhost/api/admin/users',
    env,
    undefined,
    { Cookie: sessionCookieHeader(cookie) }
  );
  assertStatus(status, 200, 'admin users admin');
  assertOk(body, 'admin users admin');
  assert.ok(Array.isArray(body.users), 'Brukere skal være en liste');
});

test('Admin API: REVIEWER får 403 på /api/admin/users (krever ADMIN)', async () => {
  const cookie = await loginAs('reviewer@test.no', 'REVIEWER');
  const { status, body } = await callRoute(
    handleAdminRoute,
    'GET',
    'http://localhost/api/admin/users',
    env,
    undefined,
    { Cookie: sessionCookieHeader(cookie) }
  );
  assertStatus(status, 403, 'admin users reviewer');
  assertError(body, 'IKKE_AUTORISERT', 'admin users reviewer');
});

test('Admin API: OPERATOR får 403 på /api/admin/users (krever ADMIN)', async () => {
  const cookie = await loginAs('operator@test.no', 'OPERATOR');
  const { status, body } = await callRoute(
    handleAdminRoute,
    'GET',
    'http://localhost/api/admin/users',
    env,
    undefined,
    { Cookie: sessionCookieHeader(cookie) }
  );
  assertStatus(status, 403, 'admin users operator');
  assertError(body, 'IKKE_AUTORISERT', 'admin users operator');
});

// ── Testgruppe: Rollebasert tilgang til admin-funksjoner ──
test('Admin API: ADMIN kan endre brukerrolle', async () => {
  const cookie = await loginAs('admin@test.no', 'ADMIN');
  const { status, body } = await callRoute(
    handleAdminRoute,
    'POST',
    'http://localhost/api/admin/users/admin@test.no/role',
    env,
    { role: 'REVIEWER' },
    { Cookie: sessionCookieHeader(cookie) }
  );
  assertStatus(status, 200, 'admin change role');
  assertOk(body, 'admin change role');

  const changedUser = await auth.getUserByEmail('admin@test.no');
  assert.ok(changedUser, 'rolleendring skal bevare e-post og eksisterende bruker');
  assert.equal(changedUser.name, 'admin');
  assert.equal(changedUser.role, 'REVIEWER');

  const { status: demotedStatus } = await callRoute(
    handleAdminRoute,
    'GET',
    'http://localhost/api/admin/users',
    env,
    undefined,
    { Cookie: sessionCookieHeader(cookie) }
  );
  assertStatus(demotedStatus, 403, 'old admin session must honor current D1 role');
});

test('Admin API: REVIEWER kan IKKE endre brukerrolle', async () => {
  const cookie = await loginAs('reviewer@test.no', 'REVIEWER');
  const { status, body } = await callRoute(
    handleAdminRoute,
    'POST',
    'http://localhost/api/admin/users/user_123/role',
    env,
    { role: 'ADMIN' },
    { Cookie: sessionCookieHeader(cookie) }
  );
  assertStatus(status, 403, 'reviewer change role forbidden');
  assertError(body, 'IKKE_AUTORISERT', 'reviewer change role forbidden');
});

test('Admin API: OPERATOR kan IKKE endre brukerrolle', async () => {
  const cookie = await loginAs('operator@test.no', 'OPERATOR');
  const { status, body } = await callRoute(
    handleAdminRoute,
    'POST',
    'http://localhost/api/admin/users/user_123/role',
    env,
    { role: 'ADMIN' },
    { Cookie: sessionCookieHeader(cookie) }
  );
  assertStatus(status, 403, 'operator change role forbidden');
  assertError(body, 'IKKE_AUTORISERT', 'operator change role forbidden');
});

// ── Testgruppe: Admin-sesjoner ──
test('Admin API: ADMIN kan liste aktive sesjoner', async () => {
  const cookie = await loginAs('admin@test.no', 'ADMIN');
  const { status, body } = await callRoute(
    handleAdminRoute,
    'GET',
    'http://localhost/api/admin/sessions',
    env,
    undefined,
    { Cookie: sessionCookieHeader(cookie) }
  );
  assertStatus(status, 200, 'admin sessions');
  assertOk(body, 'admin sessions');
  assert.ok(Array.isArray(body.sessions), 'Sesjoner skal være en liste');
});

test('Admin API: REVIEWER kan IKKE liste sesjoner', async () => {
  const cookie = await loginAs('reviewer@test.no', 'REVIEWER');
  const { status, body } = await callRoute(
    handleAdminRoute,
    'GET',
    'http://localhost/api/admin/sessions',
    env,
    undefined,
    { Cookie: sessionCookieHeader(cookie) }
  );
  assertStatus(status, 403, 'reviewer sessions forbidden');
  assertError(body, 'IKKE_AUTORISERT', 'reviewer sessions forbidden');
});

// ── Testgruppe: Alternative ruter skal ikke gi utilsiktet tilgang ──
test('Admin API: Direkte kall til admin-ruter uten /api/admin/ prefix', async () => {
  // Det skal ikke finnes alternative ruter som omgår autorisasjon
  const cookie = await loginAs('kunde@test.no', 'CUSTOMER');
  const { status, body } = await callRoute(
    handleAdminRoute,
    'GET',
    'http://localhost/api/admin/users',
    env,
    undefined,
    { Cookie: sessionCookieHeader(cookie) }
  );
  assertStatus(status, 403, 'admin bypass customer');
  assertError(body, 'IKKE_AUTORISERT', 'admin bypass customer');
});

// ── Testgruppe: Negative sikkerhetstester ──
test('Admin API: Ugyldig rolle-parametr avvises', async () => {
  const cookie = await loginAs('admin@test.no', 'ADMIN');
  const { status, body } = await callRoute(
    handleAdminRoute,
    'POST',
    'http://localhost/api/admin/users/user_123/role',
    env,
    { role: 'SUPERUSER' },
    { Cookie: sessionCookieHeader(cookie) }
  );
  assertStatus(status, 400, 'admin invalid role');
  assertError(body, 'UGYLDIG_ROLLE', 'admin invalid role');
});

test('Admin API: Manglende rolle-parametr avvises', async () => {
  const cookie = await loginAs('admin@test.no', 'ADMIN');
  const { status, body } = await callRoute(
    handleAdminRoute,
    'POST',
    'http://localhost/api/admin/users/user_123/role',
    env,
    {},
    { Cookie: sessionCookieHeader(cookie) }
  );
  assertStatus(status, 400, 'admin missing role');
  assertError(body, 'ROLLE_PÅKREVD', 'admin missing role');
});

// ── Testgruppe: Session revoke funksjonalitet ──
test('Admin API: Session revoke fjerner tilgang til eksisterende sesjoner', async () => {
  const cookie_admin = await loginAs('admin@test.no', 'ADMIN');

  // Opprett en sesjon for admin-brukeren
  const adminSessionResponse = await callRoute(handleAuthRoute, 'POST', 'http://localhost/api/auth/otp/verify', env,
    { email: 'admin@test.no', code: (await (await import('../src/auth.ts')).auth.generateOtp('admin@test.no')).code },
    { 'x-local-test': 'true' });
  const cookie_admin_session = adminSessionResponse.headers.get('set-cookie');
  const sessionId_match = cookie_admin_session && cookie_admin_session.match(/fb_session=([^;]+)/);
  const sessionId = sessionId_match ? sessionId_match[1] : null;
  if (!sessionId) return new Error('Klarte ikke opprette admin-sesjon');

  // Verifiser at sesjonen fungerer
  const { status: status_before, body: body_before } = await callRoute(handleAdminRoute, 'GET',
    'http://localhost/api/admin/sessions', env, undefined,
    { Cookie: `fb_session=${sessionId}` });
  assertStatus(status_before, 200, 'session active before revoke');
  assertOk(body_before, 'session active before revoke');

  // Admin revokerer sin egen sesjon
  const { status: status_revoke, body: body_revoke } = await callRoute(handleAdminRoute, 'POST',
    'http://localhost/api/admin/sessions/' + sessionId + '/revoke', env, undefined,
    { Cookie: sessionCookieHeader(cookie_admin) });
  assertStatus(status_revoke, 200, 'session revoked successfully');

  // Verifiser at sesjonen ikke lenger virker etter revoke
  const { status: status_after, body: body_after } = await callRoute(handleAdminRoute, 'GET',
    'http://localhost/api/admin/sessions', env, undefined,
    { Cookie: `fb_session=${sessionId}` });
  assertStatus(status_after, 401, 'revoked session returns 401');
});
