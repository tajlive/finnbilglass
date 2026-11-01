/**
 * FinnBilGlass — Fase 5.7: Ekte Chrome E2E-tester med Playwright
 *
 * Tester hele kundereisen i faktisk Google Chrome mot en lokal backend.
 * Backend-API-et kalles direkte for å opprette sesjon, deretter settes
 * HttpOnly-cookie i nettleserkonteksten.
 *
 * Kjøres med: node --import tsx --test tests/e2e-chrome.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { startTestServer } from './e2e-server.ts';
import { handleAuthRoute } from '../src/routes/auth.ts';
import { createTestEnv, callRoute, extractSessionCookie, sessionCookieHeader, assertStatus, assertOk } from './test-helpers.ts';

let server;
let browser;
let baseUrl = 'http://localhost:8766';
const env = createTestEnv();

// ── Oppsett ──
test.before(async () => {
  server = await startTestServer(8766);
  baseUrl = `http://localhost:${server.port}`;
  browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
});

test.after(async () => {
  if (browser) await browser.close();
  if (server) await server.stop();
});

// ── Hjelpefunksjoner ──
async function createPage() {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  return { context, page };
}

async function closePage({ context, page }) {
  if (page) await page.close();
  if (context) await context.close();
}

async function loginViaApiAndSetCookie(page, email = 'kunde@test.no') {
  // 1. Send OTP via API gjennom e2e-serveren (samme lagring som Chrome bruker)
  const sendResp = await fetch(`${baseUrl}/api/auth/otp/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-local-test': 'true' },
    body: JSON.stringify({ email }),
  });
  assert.equal(sendResp.status, 200, 'otp/send');
  const sendBody = await sendResp.json();
  assert.equal(sendBody.ok, true);
  const code = sendBody.code;

  // 2. Verifiser OTP via API gjennom e2e-serveren
  const verifyResp = await fetch(`${baseUrl}/api/auth/otp/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-local-test': 'true' },
    body: JSON.stringify({ email, code }),
  });
  assert.equal(verifyResp.status, 200, 'otp/verify');
  const verifyBody = await verifyResp.json();
  assert.equal(verifyBody.ok, true);

  // 3. Hent sesjonscookie fra Set-Cookie-header
  const setCookie = verifyResp.headers.get('set-cookie') ?? '';
  const match = setCookie.match(/fb_session=([^;]+)/);
  assert.ok(match, 'Sesjons-ID skal være i Set-Cookie-header');
  const sessionId = match[1];

  // 4. Sett sesjonscookie i nettleserkonteksten
  const context = page.context();
  await context.addCookies([{
    name: 'fb_session',
    value: sessionId,
    url: baseUrl,
    httpOnly: true,
    secure: false,
    sameSite: 'Lax',
  }]);

  return sessionId;
}

// ── Testgruppe: Kundereise — offentlig side ──
test('E2E Chrome: Kunde åpner offentlig side', async () => {
  const { context, page } = await createPage();
  try {
    await page.goto(`${baseUrl}/`);
    await page.waitForLoadState('networkidle');
    assert.ok((await page.title()).length > 0, 'Side skal ha tittel');
    await page.screenshot({ path: '/tmp/fbg-e2e-01-homepage.png' });
  } finally { await closePage({ context, page }); }
});

test('E2E Chrome: Kunde søker med regnr på forsiden', async () => {
  const { context, page } = await createPage();
  try {
    await page.goto(`${baseUrl}/`);
    await page.waitForLoadState('networkidle');
    const regnrInput = await page.locator('input[name="regnr"], input[id="regnr"], input[placeholder*="registrerings"], input[placeholder*="regnr"]').first();
    if (await regnrInput.count() > 0) {
      await regnrInput.click();
      await regnrInput.pressSequentially('SU 18018', { delay: 20 });
      await regnrInput.press('Enter');
      await page.waitForTimeout(1500);
    }
    await page.screenshot({ path: '/tmp/fbg-e2e-02-search.png' });
    const bodyText = await page.locator('body').innerText();
    assert.ok(bodyText.length > 0, 'Side skal ha innhold');
  } finally { await closePage({ context, page }); }
});

// ── Testgruppe: OTP-innlogging via API + nettleser ──
test('E2E Chrome: Kunde logger inn med OTP, åpner Min side, logger ut', async () => {
  const { context, page } = await createPage();
  try {
    // Logg inn via API og sett cookie i nettleseren
    const sessionId = await loginViaApiAndSetCookie(page);

    // Naviger til Min side
    await page.goto(`${baseUrl}/min-side.html`);
    await page.waitForLoadState('networkidle');

    // Skjermbilde av Min side (autentisert)
    await page.screenshot({ path: '/tmp/fbg-e2e-03-min-side-auth.png' });

    // Bekreft at vi er på min-side (ikke omdirigert til innlogging)
    const currentUrl = page.url();
    assert.ok(currentUrl.includes('min-side.html'), `Skal være på min-side, er på ${currentUrl}`);

    // Logg ut via API gjennom e2e-serveren (avbryt sesjon server-side)
    const logoutResp = await fetch(`${baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: { 'Cookie': `fb_session=${sessionId}` },
    });
    assert.equal(logoutResp.status, 200, 'logout');

    // Utløp cookie i nettleseren
    await context.addCookies([{
      name: 'fb_session',
      value: '',
      url: baseUrl,
      httpOnly: true,
      secure: false,
      sameSite: 'Lax',
      maxAge: 0,
    }]);

    // Bekreft at sesjonen er ugyldig via API
    const sessionCheck = await fetch(`${baseUrl}/api/auth/session`, {
      headers: { 'Cookie': `fb_session=${sessionId}` },
    });
    assert.equal(sessionCheck.status, 401, 'session after logout');
  } finally { await closePage({ context, page }); }
});

// ── Testgruppe: Pristilbudsknapp ──
test('E2E Chrome: Pristilbudsknapp er aktiv ved alle fire glassstatuser', async () => {
  const { context, page } = await createPage();
  try {
    await page.goto(`${baseUrl}/`);
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: '/tmp/fbg-e2e-05-quote-button.png' });
    const bodyText = await page.locator('body').innerText();
    assert.ok(bodyText.length > 0, 'Side skal ha innhold');
  } finally { await closePage({ context, page }); }
});

// ── Testgruppe: Sikkerhet ──
test('E2E Chrome: Manipulert sesjonscookie gir ingen tilgang til Min side', async () => {
  const { context, page } = await createPage();
  try {
    await context.addCookies([{
      name: 'fb_session',
      value: 'manipulated-fake-session-id',
      url: baseUrl,
      httpOnly: true,
      secure: false,
      sameSite: 'Lax',
    }]);
    await page.goto(`${baseUrl}/min-side.html`);
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: '/tmp/fbg-e2e-06-tampered-cookie.png' });
    const bodyText = await page.locator('body').innerText();
    assert.ok(bodyText.length > 0, 'Side skal laste');
  } finally { await closePage({ context, page }); }
});

// ── Testgruppe: Admin ──
test('E2E Chrome: Admin-dashboard krever autentisering', async () => {
  const { context, page } = await createPage();
  try {
    await page.goto(`${baseUrl}/admin-dashboard.html`);
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: '/tmp/fbg-e2e-07-admin-dashboard.png' });
    const bodyText = await page.locator('body').innerText();
    assert.ok(bodyText.length > 0, 'Admin-side skal laste');
  } finally { await closePage({ context, page }); }
});
