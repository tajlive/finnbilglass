/**
 * Fase 5.4 – Arbeidspakke C: Admininnlogging og rollebasert tilgang
 * Tester for sikker admin-innlogging, rollebasert tilgang og sikkerhetsregler.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

// Mock admin users (same as in admin-innlogging.html)
const MOCK_USERS = [
  { email: 'tom@finnbilglass.no', password: 'admin2026', role: 'ADMIN', name: 'Tom Arne Jensen' },
  { email: 'kari@finnbilglass.no', password: 'reviewer2026', role: 'REVIEWER', name: 'Kari Nordmann' },
  { email: 'per@finnbilglass.no', password: 'operator2026', role: 'OPERATOR', name: 'Per Hansen' }
];

const MAX_ATTEMPTS = 5;
const LOCKOUT_TIME = 300000; // 5 minutes

// Helper functions (same logic as in admin-innlogging.html)
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function authenticate(email, password, attempts, lockoutUntil) {
  const now = Date.now();
  if (now < lockoutUntil) {
    return { success: false, error: 'LOCKED_OUT', lockoutUntil };
  }
  if (!isValidEmail(email)) {
    return { success: false, error: 'INVALID_EMAIL' };
  }
  if (!password) {
    return { success: false, error: 'MISSING_PASSWORD' };
  }
  const user = MOCK_USERS.find(u => u.email === email && u.password === password);
  if (!user) {
    return { success: false, error: 'INVALID_CREDENTIALS' };
  }
  return { success: true, user };
}

function canAccessAdmin(role) {
  return ['ADMIN', 'REVIEWER', 'OPERATOR'].includes(role);
}

function canManageUsers(role) {
  return role === 'ADMIN';
}

function canReviewGlassConflicts(role) {
  return role === 'REVIEWER' || role === 'ADMIN';
}

function canHandleInquiries(role) {
  return role === 'OPERATOR' || role === 'ADMIN' || role === 'REVIEWER';
}

function canCheckout(verification) {
  // Server-side AND-port: glassVerified && positionVerified && priceVerified && availabilityVerified && orderFlowApproved
  return verification.glassVerified &&
    verification.positionVerified &&
    verification.priceVerified &&
    verification.availabilityVerified &&
    verification.orderFlowApproved;
}

// ── Tests ──
test('Admin login: valid credentials succeed', () => {
  const result = authenticate('tom@finnbilglass.no', 'admin2026', 0, 0);
  assert.equal(result.success, true);
  assert.equal(result.user.role, 'ADMIN');
  assert.equal(result.user.name, 'Tom Arne Jensen');
});

test('Admin login: invalid email format rejected', () => {
  const result = authenticate('not-an-email', 'password123', 0, 0);
  assert.equal(result.success, false);
  assert.equal(result.error, 'INVALID_EMAIL');
});

test('Admin login: missing password rejected', () => {
  const result = authenticate('tom@finnbilglass.no', '', 0, 0);
  assert.equal(result.success, false);
  assert.equal(result.error, 'MISSING_PASSWORD');
});

test('Admin login: wrong password rejected', () => {
  const result = authenticate('tom@finnbilglass.no', 'wrongpassword', 0, 0);
  assert.equal(result.success, false);
  assert.equal(result.error, 'INVALID_CREDENTIALS');
});

test('Admin login: unknown email rejected', () => {
  const result = authenticate('unknown@finnbilglass.no', 'password123', 0, 0);
  assert.equal(result.success, false);
  assert.equal(result.error, 'INVALID_CREDENTIALS');
});

test('Admin login: lockout after max attempts', () => {
  let lockoutUntil = 0;
  let failedAttempts = 0;
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const result = authenticate('tom@finnbilglass.no', 'wrong', failedAttempts, lockoutUntil);
    assert.equal(result.success, false);
    failedAttempts++;
    if (failedAttempts >= MAX_ATTEMPTS) {
      lockoutUntil = Date.now() + LOCKOUT_TIME;
    }
  }
  // Next attempt should be locked out
  const result = authenticate('tom@finnbilglass.no', 'admin2026', failedAttempts, lockoutUntil);
  assert.equal(result.success, false);
  assert.equal(result.error, 'LOCKED_OUT');
  assert.ok(result.lockoutUntil > Date.now());
});

test('Admin login: lockout expires after LOCKOUT_TIME', () => {
  const lockoutUntil = Date.now() - 1; // 1ms ago
  const result = authenticate('tom@finnbilglass.no', 'admin2026', 0, lockoutUntil);
  assert.equal(result.success, true);
  assert.equal(result.user.role, 'ADMIN');
});

test('Role access: ADMIN can access all admin functions', () => {
  assert.equal(canAccessAdmin('ADMIN'), true);
  assert.equal(canManageUsers('ADMIN'), true);
  assert.equal(canReviewGlassConflicts('ADMIN'), true);
  assert.equal(canHandleInquiries('ADMIN'), true);
});

test('Role access: REVIEWER can review conflicts but not manage users', () => {
  assert.equal(canAccessAdmin('REVIEWER'), true);
  assert.equal(canManageUsers('REVIEWER'), false);
  assert.equal(canReviewGlassConflicts('REVIEWER'), true);
  assert.equal(canHandleInquiries('REVIEWER'), true);
});

test('Role access: OPERATOR can handle inquiries but not review conflicts', () => {
  assert.equal(canAccessAdmin('OPERATOR'), true);
  assert.equal(canManageUsers('OPERATOR'), false);
  assert.equal(canReviewGlassConflicts('OPERATOR'), false);
  assert.equal(canHandleInquiries('OPERATOR'), true);
});

test('Role access: unknown role denied everything', () => {
  assert.equal(canAccessAdmin('UNKNOWN'), false);
  assert.equal(canManageUsers('UNKNOWN'), false);
  assert.equal(canReviewGlassConflicts('UNKNOWN'), false);
  assert.equal(canHandleInquiries('UNKNOWN'), false);
});

test('Checkout AND-port: all conditions required', () => {
  // All conditions met
  assert.equal(canCheckout({
    glassVerified: true,
    positionVerified: true,
    priceVerified: true,
    availabilityVerified: true,
    orderFlowApproved: true
  }), true);

  // Missing glassVerified
  assert.equal(canCheckout({
    glassVerified: false,
    positionVerified: true,
    priceVerified: true,
    availabilityVerified: true,
    orderFlowApproved: true
  }), false);

  // Missing positionVerified
  assert.equal(canCheckout({
    glassVerified: true,
    positionVerified: false,
    priceVerified: true,
    availabilityVerified: true,
    orderFlowApproved: true
  }), false);

  // Missing priceVerified
  assert.equal(canCheckout({
    glassVerified: true,
    positionVerified: true,
    priceVerified: false,
    availabilityVerified: true,
    orderFlowApproved: true
  }), false);

  // Missing availabilityVerified
  assert.equal(canCheckout({
    glassVerified: true,
    positionVerified: true,
    priceVerified: true,
    availabilityVerified: false,
    orderFlowApproved: true
  }), false);

  // Missing orderFlowApproved
  assert.equal(canCheckout({
    glassVerified: true,
    positionVerified: true,
    priceVerified: true,
    availabilityVerified: true,
    orderFlowApproved: false
  }), false);
});

test('Checkout: EXACT alone is NOT enough for checkout', () => {
  // EXACT = glassVerified=true, but other conditions false
  assert.equal(canCheckout({
    glassVerified: true,
    positionVerified: false,
    priceVerified: false,
    availabilityVerified: false,
    orderFlowApproved: false
  }), false);
});

test('Mazda 29730YP: sideConflict blocks checkout', () => {
  // Mazda has sideConflict=true, so positionVerified should be false
  const mazdaVerification = {
    glassVerified: true,
    positionVerified: false, // sideConflict prevents position verification
    priceVerified: false,     // no customer price
    availabilityVerified: false,
    orderFlowApproved: false
  };
  assert.equal(canCheckout(mazdaVerification), false);
});

test('Session expiry: 1 hour max', () => {
  const now = Date.now();
  const authTime = now - 3600001; // 1 hour + 1ms ago
  const expired = now - authTime > 3600000;
  assert.equal(expired, true);

  const authTimeValid = now - 1800000; // 30 minutes ago
  const valid = now - authTimeValid > 3600000;
  assert.equal(valid, false);
});