/**
 * Fase 5.5 – P0: Sikker autentisering og sesjonshåndtering
 * Tester for auth.ts-modulen: sesjoner, OTP, rollebasert tilgang, rate limiting.
 * Alle tester kjører mot den faktiske auth-modulen (ikke mock).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { auth, reset, setAuthStorage } from '../src/auth.ts';
import { D1EmulatorAuthStorage } from '../src/auth-storage.ts';
import { D1Emulator } from '../src/auth-store.ts';

// ── Hjelpefunksjoner ──
async function resetState() {
  setAuthStorage(new D1EmulatorAuthStorage(new D1Emulator()));
  await reset();
}

// ── Testgruppe: Sesjonsopprettelse ──
test('Auth: Opprett sesjon gir gyldig sessionId', async () => {
  await resetState();
  const session = await auth.createSession({
    email: 'bruker@test.no',
    role: 'CUSTOMER',
    name: 'Test Bruker',
  });
  assert.ok(session.sessionId);
  assert.ok(session.sessionId.length > 20);
  assert.equal(session.email, 'bruker@test.no');
  assert.equal(session.role, 'CUSTOMER');
  assert.equal(session.name, 'Test Bruker');
  assert.ok(session.expiresAt > session.createdAt);
  assert.ok(session.expiresAt - session.createdAt <= 60 * 60 * 1000); // Max 1 time
});

test('Auth: Hent eksisterende sesjon', async () => {
  await resetState();
  const session = await auth.createSession({
    email: 'bruker@test.no',
    role: 'ADMIN',
    name: 'Admin Bruker',
  });
  const retrieved = await auth.getSession(session.sessionId);
  assert.ok(retrieved);
  assert.equal(retrieved.sessionId, session.sessionId);
  assert.equal(retrieved.email, 'bruker@test.no');
  assert.equal(retrieved.role, 'ADMIN');
});

test('Auth: Ugyldig sessionId returnerer null', async () => {
  await resetState();
  assert.equal(await auth.getSession('ikkesidde'), null);
  assert.equal(await auth.getSession(''), null);
  assert.equal(await auth.getSession(null), null);
});

test('Auth: Ødelegg sesjon (logout)', async () => {
  await resetState();
  const session = await auth.createSession({
    email: 'bruker@test.no',
    role: 'CUSTOMER',
    name: 'Test',
  });
  assert.equal(await auth.getSession(session.sessionId) !== null, true);
  auth.destroySession(session.sessionId);
  assert.equal(await auth.getSession(session.sessionId), null);
});

test('Auth: Cookie-valg inneholder sikkerhetsattributter', () => {
  const options = auth.getCookieOptions();
  assert.ok(options.includes('HttpOnly'));
  assert.ok(options.includes('SameSite=Lax'));
  assert.ok(options.includes('Path=/'));
  assert.ok(options.includes('Max-Age='));
});

test('Auth: Cookie-utløpsvalg for logout', () => {
  const options = auth.getCookieExpireOptions();
  assert.ok(options.includes('HttpOnly'));
  assert.ok(options.includes('Max-Age=0'));
});

// ── Testgruppe: OTP ──
test('Auth: Generer OTP-kode', async () => {
  await resetState();
  const result = await auth.generateOtp('otp-gen@test.no');
  assert.ok(result.code);
  assert.equal(result.code.length, 6);
  assert.ok(/^\d{6}$/.test(result.code));
  assert.ok(result.expiresAt > Date.now());
  assert.ok(result.expiresAt - Date.now() <= 10 * 60 * 1000); // Max 10 min
});

test('Auth: Verifiser gyldig OTP-kode', async () => {
  await resetState();
  const email = 'otp-verify@test.no';
  const { code } = await auth.generateOtp(email);
  const result = await auth.verifyOtp({ email, code });
  assert.equal(result.success, true);
  assert.ok(result.user);
  assert.equal(result.user.email, email);
});

test('Auth: Verifiser feil OTP-kode', async () => {
  await resetState();
  const email = 'otp-fail@test.no';
  await auth.generateOtp(email);
  const result = await auth.verifyOtp({ email, code: '000000' });
  assert.equal(result.success, false);
  assert.equal(result.error, 'INVALID_OTP');
});

test('Auth: OTP er engangsbruk (kan bare brukes én gang)', async () => {
  await resetState();
  const email = 'otp-once@test.no';
  const { code } = await auth.generateOtp(email);
  const first = await auth.verifyOtp({ email, code });
  assert.equal(first.success, true);
  const second = await auth.verifyOtp({ email, code });
  assert.equal(second.success, false);
  assert.equal(second.error, 'OTP_ALREADY_USED');
});

test('Auth: For mange OTP-forsøk låser koden', async () => {
  await resetState();
  const email = 'otp-lock@test.no';
  await auth.generateOtp(email);
  for (let i = 0; i < 3; i++) {
    const result = await auth.verifyOtp({ email, code: '000000' });
    assert.equal(result.success, false);
  }
  const final = await auth.verifyOtp({ email, code: '000000' });
  assert.equal(final.success, false);
  assert.equal(final.error, 'OTP_MAX_ATTEMPTS');
});

// ── Testgruppe: Rollebasert tilgang ──
test('Auth: Rolle-hierarki - ADMIN har høyest prioritet', () => {
  const admin = { role: 'ADMIN' };
  const reviewer = { role: 'REVIEWER' };
  const operator = { role: 'OPERATOR' };
  const customer = { role: 'CUSTOMER' };

  // ADMIN kan alt
  assert.equal(auth.hasRole(admin, 'ADMIN'), true);
  assert.equal(auth.hasRole(admin, 'REVIEWER'), true);
  assert.equal(auth.hasRole(admin, 'OPERATOR'), true);
  assert.equal(auth.hasRole(admin, 'CUSTOMER'), true);

  // REVIEWER kan ikke ADMIN
  assert.equal(auth.hasRole(reviewer, 'ADMIN'), false);
  assert.equal(auth.hasRole(reviewer, 'REVIEWER'), true);
  assert.equal(auth.hasRole(reviewer, 'OPERATOR'), true);
  assert.equal(auth.hasRole(reviewer, 'CUSTOMER'), true);

  // OPERATOR kan ikke REVIEWER eller ADMIN
  assert.equal(auth.hasRole(operator, 'ADMIN'), false);
  assert.equal(auth.hasRole(operator, 'REVIEWER'), false);
  assert.equal(auth.hasRole(operator, 'OPERATOR'), true);
  assert.equal(auth.hasRole(operator, 'CUSTOMER'), true);

  // CUSTOMER kan ikke noe annet
  assert.equal(auth.hasRole(customer, 'ADMIN'), false);
  assert.equal(auth.hasRole(customer, 'REVIEWER'), false);
  assert.equal(auth.hasRole(customer, 'OPERATOR'), false);
  assert.equal(auth.hasRole(customer, 'CUSTOMER'), true);
});

// ── Testgruppe: Rate limiting ──
test('Auth: Rate limiting på OTP-generering', async () => {
  await resetState();
  const email = 'otp-ratelimit@test.no';
  // Generer maks antall (maks 5 per 60 sekunder)
  for (let i = 0; i < 5; i++) {
    await auth.generateOtp(email);
  }
  // Neste skal bli rate-limited
  await assert.rejects(() => auth.generateOtp(email), /FOR_RATE_LIMITED/);
});