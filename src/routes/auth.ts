/**
 * FinnBilGlass — Apify-ruter for autentisering (Fase 5.5)
 *
 * Endepunkter:
 *   POST /api/auth/otp/send     → Send engangskode til e-post
 *   POST /api/auth/otp/verify   → Verifiser OTP og opprett sesjon
 *   POST /api/auth/logout       → Avbryt sesjon
 *   GET  /api/auth/session      → Hent gjeldende sesjonsstatus
 *   GET  /api/auth/me           → Hent autentisert brukerprofil
 *
 * Alle svar er JSON. Ingen sensitive data sendes til klienten (tokens i HttpOnly-cookie).
 */

import type { Env } from '../types';
import { sendMail } from '../mail';
import { auth, type AuthUser } from '../auth';
import { fullforKobling } from './oauth';

// ── Lokale hjelpefunksjoner (isolerert fra index.ts for modulærhet) ──
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function json(data: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS, ...extraHeaders },
  });
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return !!x && typeof x === 'object' && !Array.isArray(x);
}

/**
 * Send OTP-koden på e-post via Resend (src/mail.ts).
 * Returnerer { ok } — kunden skal aldri få «sendt» når utsendingen feilet.
 */
async function sendOtpEmail(env: Env, to: string, code: string): Promise<{ ok: boolean; error?: string }> {
  const esc = (s: string) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
  const svar = await sendMail(env, {
    to,
    subject: `Din engangskode: ${code}`,
    html:
      `<p>Hei,</p><p>Engangskoden din er:</p>` +
      `<p style="font-size:28px;font-weight:700;letter-spacing:6px;font-family:monospace">${esc(code)}</p>` +
      `<p>Koden gjelder i 10 minutter og kan bare brukes én gang.</p>` +
      `<p style="color:#637286;font-size:12px">Har du ikke bedt om koden, kan du se bort fra denne e-posten.</p>` +
      `<p>— Finnbilglass</p>`,
    text: `Engangskoden din er ${code}. Den gjelder i 10 minutter og kan bare brukes én gang.`,
  });
  return svar.ok ? { ok: true } : { ok: false, error: svar.error || 'EPOST_IKKE_KONFIGURERT' };
}

/**
 * POST /api/auth/otp/send
 * Generer og send OTP-kode til e-postadresse.
 * Utenfor produksjon: koden returneres i respons (test).
 * I produksjon: koden sendes på e-post via Resend og returneres ALDRI.
 */
export async function handleOtpSend(request: Request, env: Env): Promise<Response> {
  const body = await parseBody(request);
  if (!body || typeof body.email !== 'string') {
    return json({ ok: false, error: 'EPOST_PÅKREVD' }, 400);
  }

  const email = body.email.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ ok: false, error: 'UGYLDIG_EPOST' }, 400);
  }

  try {
    const { code, expiresAt } = await auth.generateOtp(email);

    // Testmodus KUN utenfor produksjon (lokal + staging). Produksjon returnerer
    // aldri koden — ingen header kan slå på testmodus i prod (auth-bypass).
    const isLocal = env.ENVIRONMENT !== 'production';

    if (!isLocal) {
      // Produksjon: faktisk e-postutsending. Feiler den, sier vi det ærlig.
      const sendt = await sendOtpEmail(env, email, code);
      if (!sendt.ok) {
        console.error('OTP-e-post feilet:', sendt.error);
        return json({ ok: false, error: 'KUNNE_IKKE_SENDE_EPOST' }, 502);
      }
    }

    return json({
      ok: true,
      email,
      expiresAt,
      ...(isLocal ? { code, _mock: true } : {}),
      message: isLocal
        ? 'Kode generert (lokal test)'
        : 'Kode sendt til e-post',
    });
  } catch (error) {
    if ((error as Error).message === 'FOR_RATE_LIMITED') {
      return json(
        { ok: false, error: 'FOR_MANGE_FORSØK', retryAfter: 60 },
        429
      );
    }
    // Auth-lagring finnes ikke i dette miljøet (produksjon uten kundelogin).
    if (String((error as Error).message || '').startsWith('AUTH_STORAGE_NOT_CONFIGURED')) {
      return json({ ok: false, error: 'INNLOGGING_IKKE_AKTIVERT' }, 503);
    }
    return json({ ok: false, error: 'INTERN_FEIL' }, 500);
  }
}

/**
 * POST /api/auth/otp/verify
 * Verifiser OTP-kode og opprett sesjon.
 * Returnerer brukerprofil og setter HttpOnly-sesjonscookie.
 */
/**
 * Henter kundenavnet fra kundens siste forespørsel, slik at Min side viser
 * navnet kunden selv oppga — ikke bare delen foran @ i e-postadressen.
 */
async function kundeNavnFraSaker(env: Env, email: string): Promise<string | null> {
  const db = env.ENVIRONMENT === 'staging' ? env.FINNBILGLASS_STAGING_AUTH : env.FINNBILGLASS_DB;
  if (!db) return null;
  try {
    const rad = await db
      .prepare('SELECT navn FROM beta_inquiries WHERE lower(kontakt) LIKE ? ORDER BY created_at DESC LIMIT 1')
      .bind(`%${email.toLowerCase()}%`)
      .first<{ navn: string | null }>();
    const navn = (rad?.navn || '').trim();
    if (!navn || navn.includes('@') || navn.length > 80) return null;
    return navn;
  } catch {
    return null;
  }
}

/**
 * true når requesten har en gyldig kundesesjon. Brukes for server-side
 * omdirigering til innlogging i stedet for å vise Min side først.
 */
export async function kundeInnlogget(request: Request): Promise<boolean> {
  const cookie = request.headers.get('Cookie') ?? '';
  const match = cookie.match(/fb_session=([^;]+)/);
  if (!match) return false;
  try {
    const session = await auth.getSession(match[1]);
    return !!session;
  } catch {
    return false; // fail-closed: uten auth-lagring er ingen innlogget
  }
}

export async function handleOtpVerify(request: Request, env: Env): Promise<Response> {
  const body = await parseBody(request);
  if (!body || typeof body.email !== 'string' || typeof body.code !== 'string') {
    return json({ ok: false, error: 'EPOST_OG_KODE_PÅKREVD' }, 400);
  }

  const { email, code } = body;
  const linkToken = typeof body.linkToken === 'string' ? body.linkToken.trim() : '';
  let result;
  try {
    result = await auth.verifyOtp({ email, code });
  } catch (error) {
    if (String((error as Error).message || '').startsWith('AUTH_STORAGE_NOT_CONFIGURED')) {
      return json({ ok: false, error: 'INNLOGGING_IKKE_AKTIVERT' }, 503);
    }
    return json({ ok: false, error: 'INTERN_FEIL' }, 500);
  }

  if (!result.success) {
    return json({ ok: false, error: result.error || 'FEIL_KODE' }, 401);
  }

  const user = result.user!;
  // Bekreftet engangskode kan fullføre en ventende kobling av sosial identitet.
  if (linkToken) {
    try {
      await fullforKobling(env, linkToken, user.email);
    } catch { /* kobling er valgfri; innloggingen skal uansett lykkes */ }
  }
  // Vis kundens eget navn fra saken når det finnes; ellers det auth-laget har.
  const navnFraSak = await kundeNavnFraSaker(env, user.email);
  const visningsnavn = navnFraSak || user.name;
  const session = await auth.createSession({
    email: user.email,
    role: user.role,
    name: visningsnavn,
    userId: user.userId,
  });

  // Sett HttpOnly-sesjonscookie
  const cookie = `fb_session=${session.sessionId}; ${auth.getCookieOptions()}`;

  return json(
    {
      ok: true,
      user: {
        userId: user.userId,
        email: user.email,
        role: user.role,
        name: visningsnavn,
      },
      sessionId: session.sessionId,
      expiresAt: session.expiresAt,
    },
    200,
    { 'Set-Cookie': cookie }
  );
}

/**
 * POST /api/auth/logout
 * Avbryt sesjon og fjern cookie.
 */
export async function handleLogout(request: Request, env: Env): Promise<Response> {
  const cookie = request.headers.get('Cookie') ?? '';
  const match = cookie.match(/fb_session=([^;]+)/);
  const sessionId = match ? match[1] : null;

  if (sessionId) {
    await auth.destroySession(sessionId);
  }

  return json(
    { ok: true },
    200,
    { 'Set-Cookie': auth.getCookieExpireOptions() }
  );
}

/**
 * GET /api/auth/session
 * Hent gjeldende sesjonsstatus (basert på cookie).
 */
export async function handleSession(request: Request, env: Env): Promise<Response> {
  const cookie = request.headers.get('Cookie') ?? '';
  const match = cookie.match(/fb_session=([^;]+)/);
  const sessionId = match ? match[1] : null;

  let session;
  try {
    session = await auth.getSession(sessionId);
  } catch {
    // Ingen auth-lagring i dette miljøet = ingen innlogget sesjon (fail-closed).
    return json({ ok: false, authenticated: false, error: 'AUTH_IKKE_AKTIVERT' }, 401);
  }
  if (!session) {
    return json({ ok: false, authenticated: false }, 401);
  }

  return json({
    ok: true,
    authenticated: true,
    user: {
      userId: session.userId,
      email: session.email,
      role: session.role,
      name: session.name,
    },
    expiresAt: session.expiresAt,
  });
}

/**
 * GET /api/auth/me
 * Alias for /api/auth/session.
 */
export async function handleMe(request: Request, env: Env): Promise<Response> {
  return handleSession(request, env);
}

/**
 * GET /api/auth/csrf-token
 * Returner CSRF-token for klientbaserte skjema (valgfritt, for ekstra beskyttelse).
 */
export async function handleCsrfToken(request: Request, env: Env): Promise<Response> {
  const cookie = request.headers.get('Cookie') ?? '';
  const match = cookie.match(/fb_session=([^;]+)/);
  const sessionId = match ? match[1] : null;

  let session;
  try {
    session = await auth.getSession(sessionId);
  } catch {
    return json({ ok: false, error: 'IKKE_AUTENTISERT' }, 401);
  }
  if (!session) {
    return json({ ok: false, error: 'IKKE_AUTENTISERT' }, 401);
  }

  // CSRF-token = hash av sessionId + secret
  const csrfToken = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`csrf:${session.sessionId}:${env.ENVIRONMENT || 'local'}`)
  );
  const hash = Array.from(new Uint8Array(csrfToken))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  return json({ ok: true, csrfToken });
}

/**
 * Les JSON-body fra request.
 */
async function parseBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const text = await request.text();
    if (!text.trim()) return null;
    const parsed = JSON.parse(text);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Router for /api/auth/* endepunkter.
 */
export async function handleAuthRoute(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/auth/, '');
  const method = request.method;

  // POST /api/auth/otp/send
  if (method === 'POST' && path === '/otp/send') {
    return handleOtpSend(request, env);
  }

  // POST /api/auth/otp/verify
  if (method === 'POST' && path === '/otp/verify') {
    return handleOtpVerify(request, env);
  }

  // POST /api/auth/logout
  if (method === 'POST' && path === '/logout') {
    return handleLogout(request, env);
  }

  // GET /api/auth/session
  if (method === 'GET' && path === '/session') {
    return handleSession(request, env);
  }

  // GET /api/auth/me
  if (method === 'GET' && path === '/me') {
    return handleMe(request, env);
  }

  // GET /api/auth/csrf-token
  if (method === 'GET' && path === '/csrf-token') {
    return handleCsrfToken(request, env);
  }

  return json({ ok: false, error: 'FINNES_IKKE' }, 404);
}

/**
 * Middleware: krev autentisering for admin- og ops-ruter.
 * Returnerer brukeren hvis autentisert, ellers null.
 */
export async function requireAuth(request: Request): Promise<AuthUser | null> {
  const cookie = request.headers.get('Cookie') ?? '';
  const match = cookie.match(/fb_session=([^;]+)/);
  const sessionId = match ? match[1] : null;
  let session;
  try {
    session = await auth.getSession(sessionId);
  } catch {
    // Auth-lagring ikke konfigurert i dette miljøet (produksjon uten kundelogin):
    // fail-closed — ingen sesjon, ingen tilgang.
    return null;
  }
  if (!session) return null;

  return {
    userId: session.userId,
    email: session.email,
    role: session.role,
    name: session.name,
  };
}

/**
 * Middleware: krev bestemt rolle for admin-handlinger.
 * Accepterer flere roller (f.eks. requireRole(request, 'ADMIN', 'REVIEWER')).
 */
export async function requireRole(
  request: Request,
  ...requiredRoles: ('ADMIN' | 'REVIEWER' | 'OPERATOR')[]
): Promise<AuthUser | null> {
  const user = await requireAuth(request);
  if (!user) return null;

  const roleHierarchy: Record<string, number> = {
    CUSTOMER: 0,
    OPERATOR: 1,
    REVIEWER: 2,
    ADMIN: 3,
  };
  const userLevel = roleHierarchy[user.role];
  const minRequired = Math.min(...requiredRoles.map((r) => roleHierarchy[r]));
  if (userLevel < minRequired) {
    return null;
  }
  return user;
}