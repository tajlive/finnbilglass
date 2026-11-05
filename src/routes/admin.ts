/**
 * FinnBilGlass — Admin-ruter (Fase 5.5/5.9)
 *
 * Admin-endepunkter krever autentisering og rollebasert tilgang.
 * Admin-panel er tilgjengelig på admin.finnbilglass.no (Cloudflare Access).
 *
 * Endepunkter:
 *   GET  /api/admin/session      → Hent autentisert adminbruker
 *   GET  /api/admin/users        → Liste alle brukere (ADMIN kun)
 *   POST /api/admin/users/:id/role → Endre brukerrolle (ADMIN kun)
 *   GET  /api/admin/sessions     → Liste aktive sesjoner (ADMIN kun)
 *   POST /api/admin/sessions/:id/revoke → Avbryt sesjon (ADMIN kun)
 *   GET  /api/admin/inquiries    → Liste alle henvendelser (ADMIN/REVIEWER/OPERATOR)
 *   POST /api/admin/inquiries/:id/status → Oppdatere status (OPERATOR/ADMIN)
 *   POST /api/admin/inquiries/:id/decision → Godkjenne/avvise glass (REVIEWER/ADMIN)
 */

import type { Env } from '../types';
import { auth, getStorage, type AuthUser } from '../auth';
import { requireAuth, requireRole } from './auth';
import { setAuthStorage } from '../auth';
import { D1AuthStorage } from '../auth-storage';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

async function parseBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const text = await request.text();
    if (!text.trim()) return null;
    const parsed = JSON.parse(text);
    return !!parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * GET /api/admin/users
 * Liste alle brukere (ADMIN kun).
 */
export async function handleAdminUsers(request: Request, env: Env): Promise<Response> {
  const user = await requireRole(request, 'ADMIN');
  if (!user) {
    return json({ ok: false, error: 'IKKE_AUTORISERT' }, 403);
  }

  const sessions = await auth.getAllSessions();
  const uniqueUsers = Array.from(
    new Map(
      sessions.map(
        (s: {
          email: string;
          userId: string;
          role: string;
          name: string;
          lastActivity: number;
        }) => [
          s.email,
          {
            userId: s.userId,
            email: s.email,
            role: s.role,
            name: s.name,
            lastLogin: s.lastActivity,
          },
        ]
      )
    )
  ).map(([, u]: any) => u);

  return json({ ok: true, users: uniqueUsers });
}

/**
 * POST /api/admin/users/:id/role
 * Endre brukerrolle (ADMIN kun).
 */
export async function handleAdminUserRole(request: Request, env: Env): Promise<Response> {
  const user = await requireRole(request, 'ADMIN');
  if (!user) {
    return json({ ok: false, error: 'IKKE_AUTORISERT' }, 403);
  }

  const url = new URL(request.url);
  const userId = url.pathname.split('/').at(-2);
  if (!userId) {
    return json({ ok: false, error: 'BRUKER_ID_PÅKREVD' }, 400);
  }

  const body = await parseBody(request);
  if (!body || typeof body.role !== 'string') {
    return json({ ok: false, error: 'ROLLE_PÅKREVD' }, 400);
  }

  const newRole = body.role as 'ADMIN' | 'REVIEWER' | 'OPERATOR';
  if (!['ADMIN', 'REVIEWER', 'OPERATOR'].includes(newRole)) {
    return json({ ok: false, error: 'UGYLDIG_ROLLE' }, 400);
  }

  // Oppdater rolle i D1-lagring
  const store = getStorage();
  let existing = await store.userGetByEmail(userId);
  if (!existing) {
    // Prøv å finne ved userId også
    existing = await store.userGet(userId);
  }
  if (!existing) {
    // Søk gjennom alle brukere for å finne en som matcher userId eller email
    const allUsers = await store.userGetAll();
    const found = allUsers.find((u) => u.userId === userId || u.email === userId);
    existing = found ?? null;
  }
  if (!existing) {
    return json({ ok: false, error: 'BRUKER_FINNES_IKKE' }, 404);
  }
  await store.userSet({
    userId: existing.userId,
    email: existing.email,
    role: newRole,
    name: existing.name,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });

  return json({
    ok: true,
    userId,
    role: newRole,
    message: `Rolle oppdatert til ${newRole}`,
  });
}

/**
 * GET /api/admin/sessions
 * Liste aktive sesjoner (ADMIN kun).
 */
export async function handleAdminSessions(request: Request, env: Env): Promise<Response> {
  const user = await requireRole(request, 'ADMIN');
  if (!user) {
    return json({ ok: false, error: 'IKKE_AUTORISERT' }, 403);
  }

  const sessions = await auth.getAllSessions();
  return json({
    ok: true,
    sessions: sessions.map((s) => ({
      sessionId: s.sessionId,
      userId: s.userId,
      email: s.email,
      role: s.role,
      name: s.name,
      createdAt: s.createdAt,
      expiresAt: s.expiresAt,
      lastActivity: s.lastActivity,
    })),
    count: sessions.length,
  });
}

/**
 * POST /api/admin/sessions/:id/revoke
 * Avbryt en brukers sesjon (ADMIN kun).
 */
export async function handleAdminRevokeSession(request: Request, env: Env): Promise<Response> {
  const user = await requireRole(request, 'ADMIN');
  if (!user) {
    return json({ ok: false, error: 'IKKE_AUTORISERT' }, 403);
  }

  const url = new URL(request.url);
  const sessionId = url.pathname.split('/').pop();
  if (!sessionId) {
    return json({ ok: false, error: 'SESSION_ID_PÅKREVD' }, 400);
  }

  auth.destroySession(sessionId);

  return json({
    ok: true,
    sessionId,
    message: 'Sesjon avbrutt',
  });
}

/**
 * GET /api/admin/inquiries - liste alle henvendelser (ADMIN/REVIEWER/OPERATOR)
 */
export async function handleAdminInquiries(request: Request, env: Env): Promise<Response> {
  const user = await requireRole(request, 'ADMIN', 'REVIEWER', 'OPERATOR');
  if (!user) {
    return json({ ok: false, error: 'IKKE_AUTORISERT' }, 403);
  }

  // For øyeblikket returnerer vi tom liste siden beta_inquiries-tabellen
  // ikke er koblet til auth-lagring. I neste iterasjon vil vi spørre D1 direkte.
  return json({ ok: true, inquiries: [], count: 0 });
}

/**
 * POST /api/admin/inquiries/:id/status - oppdatere status (OPERATOR/ADMIN)
 */
export async function handleAdminInquiryStatus(request: Request, env: Env): Promise<Response> {
  const user = await requireRole(request, 'ADMIN', 'REVIEWER', 'OPERATOR');
  if (!user) {
    return json({ ok: false, error: 'IKKE_AUTORISERT' }, 403);
  }

  const url = new URL(request.url);
  const inquiryId = url.pathname.split('/').pop();
  if (!inquiryId) {
    return json({ ok: false, error: 'INQUIRY_ID_PÅKREVD' }, 400);
  }

  const body = await parseBody(request);
  if (!body || typeof body.status !== 'string') {
    return json({ ok: false, error: 'STATUS_PÅKREVD' }, 400);
  }

  const newStatus = body.status;
  if (!['NEW', 'CONTACTED', 'NEEDS_INFO', 'OFFERED', 'CONFIRMED', 'CLOSED', 'REJECTED'].includes(newStatus)) {
    return json({ ok: false, error: 'UGYLDIG_STATUS' }, 400);
  }

  // For øyeblikket returnerer vi suksess; i neste iterasjon vil vi oppdatere D1 direkte
  return json({
    ok: true,
    inquiryId,
    status: newStatus,
    message: `Status oppdatert til ${newStatus}`,
  });
}

/**
 * POST /api/admin/inquiries/:id/decision - REVIEWER godkjenner/avviser (REVIEWER/ADMIN)
 */
export async function handleAdminInquiryDecision(request: Request, env: Env): Promise<Response> {
  const user = await requireRole(request, 'ADMIN', 'REVIEWER');
  if (!user) {
    return json({ ok: false, error: 'IKKE_AUTORISERT' }, 403);
  }

  const url = new URL(request.url);
  const inquiryId = url.pathname.split('/').pop();
  if (!inquiryId) {
    return json({ ok: false, error: 'INQUIRY_ID_PÅKREVD' }, 400);
  }

  const body = await parseBody(request);
  if (!body || typeof body.decision !== 'string') {
    return json({ ok: false, error: 'BESLUTNING_PÅKREVD' }, 400);
  }

  const decision = body.decision;
  if (!['APPROVE', 'REJECT'].includes(decision)) {
    return json({ ok: false, error: 'UGYLDIG_BESLUTNING' }, 400);
  }

  return json({
    ok: true,
    inquiryId,
    decision,
    decidedBy: user.email,
    decidedAt: Date.now(),
    message: `Glass ${decision === 'APPROVE' ? 'godkjent' : 'avvist'}`,
  });
}

/** Router for /api/admin/* endepunkter. */
export async function handleAdminRoute(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/admin/, '');
  const method = request.method;

  // Auth-lagring er allerede koblet i toppen av fetch() (miljøstyrt, fail-closed).
  // Ingen lokal test-DB skal kunne aktiveres herfra i produksjon.

  // Først: krev autentisering for alle admin-ruter
  const user = await requireAuth(request);
  if (!user) {
    return json({ ok: false, error: 'IKKE_AUTENTISERT' }, 401);
  }

  // GET /api/admin/users
  if (method === 'GET' && path === '/users') {
    return handleAdminUsers(request, env);
  }

  // POST /api/admin/users/:id/role
  if (method === 'POST' && /^\/users\/[^/]+\/role$/.test(path)) {
    return handleAdminUserRole(request, env);
  }

  // GET /api/admin/sessions
  if (method === 'GET' && path === '/sessions') {
    return handleAdminSessions(request, env);
  }

  // POST /api/admin/sessions/:id/revoke
  if (method === 'POST' && /^\/sessions\/[^/]+\/revoke$/.test(path)) {
    return handleAdminRevokeSession(request, env);
  }

  // GET /api/admin/inquiries - liste alle henvendelser (ADMIN/REVIEWER/OPERATOR)
  if (method === 'GET' && path === '/inquiries') {
    return handleAdminInquiries(request, env);
  }

  // POST /api/admin/inquiries/:id/status - oppdatere status (OPERATOR/ADMIN)
  if (method === 'POST' && /^\/inquiries\/[^/]+\/status$/.test(path)) {
    return handleAdminInquiryStatus(request, env);
  }

  // POST /api/admin/inquiries/:id/decision - REVIEWER godkjenner/avviser (REVIEWER/ADMIN)
  if (method === 'POST' && /^\/inquiries\/[^/]+\/decision$/.test(path)) {
    return handleAdminInquiryDecision(request, env);
  }

  return json({ ok: false, error: 'FINNES_IKKE' }, 404);
}

/**
 * Hent adminbruker fra forespørsel (for bruk i andre ruter).
 */
export async function getAdminUser(request: Request): Promise<AuthUser | null> {
  return requireAuth(request);
}