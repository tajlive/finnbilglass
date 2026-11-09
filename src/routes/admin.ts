/** FinnBilGlass — Admin-ruter (Fase 5.5/5.9)

Admin-endepunkter krever autentisering og rollebasert tilgang.
Admin-panel er tilgjengelig på admin.finnbilglass.no (Cloudflare Access).

Endepunkter:
   GET  /api/admin/session      → Hent autentisert adminbruker
   GET  /api/admin/users        → Liste alle brukere (ADMIN kun)
   POST /api/admin/users/:id/role → Endre brukerrolle (ADMIN kun)
   GET  /api/admin/sessions     → Liste aktive sesjoner (ADMIN kun)
   POST /api/admin/sessions/:id/revoke → Avbryt sesjon (ADMIN kun)
   GET  /api/admin/inquiries    → Liste alle henvendelser (ADMIN/REVIEWER/OPERATOR)
   POST /api/admin/inquiries/:id/status → Oppdatere status (OPERATOR/ADMIN)
   POST /api/admin/inquiries/:id/decision → Godkjenne/avvise glass (REVIEWER/ADMIN)
   POST /api/admin/invite — inviter ny medarbeider
   GET  /api/admin/invites    — Liste alle invitasjoner
   POST /api/admin/invites/:email/revoke — Kanseller invitasjon
*/

import type { Env } from '../types';
import { auth, getStorage, type AuthUser } from '../auth';
import { requireAuth, requireRole } from './auth';
import { setAuthStorage } from '../auth';
import { D1AuthStorage } from '../auth-storage';
import { handleStaffInvite, handleStaffInvites, handleStaffInviteRevoke } from './staff-invites';

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

export async function handleAdminSession(request: Request, env: Env): Promise<Response> {
  const user = await requireAuth(request);
  if (!user) return json({ ok: false, error: 'IKKE_AUTENTISERT' }, 401);
  return json({ ok: true, user });
}

export async function handleAdminUsers(request: Request, env: Env): Promise<Response> {
  const user = await requireRole(request, 'ADMIN');
  if (!user) return json({ ok: false, error: 'IKKE_AUTORISERT' }, 403);
  const storage = getStorage();
  const users = await storage.userGetAll();
  return json({ ok: true, users, count: users.length });
}

export async function handleAdminUserRole(request: Request, env: Env): Promise<Response> {
  const user = await requireRole(request, 'ADMIN');
  if (!user) return json({ ok: false, error: 'IKKE_AUTORISERT' }, 403);
  const url = new URL(request.url);
  const userId = url.pathname.split('/').at(-2);
  if (!userId) return json({ ok: false, error: 'USER_ID_PÅKREVD' }, 400);
  const body = await parseBody(request);
  if (!body || typeof body.role !== 'string') return json({ ok: false, error: 'ROLLE_PÅKREVD' }, 400);
  const newRole = body.role as 'ADMIN' | 'REVIEWER' | 'OPERATOR';
  if (!['ADMIN', 'REVIEWER', 'OPERATOR'].includes(newRole)) return json({ ok: false, error: 'UGYLDIG_ROLLE' }, 400);
  const storage = getStorage();
  const existing = await storage.userGet(userId) ?? await storage.userGetByEmail(userId);
  if (!existing) return json({ ok: false, error: 'BRUKER_FINNES_IKKE' }, 404);
  await storage.userSet({
    ...existing,
    role: newRole,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  return json({ ok: true, userId, role: newRole });
}

export async function handleAdminSessions(request: Request, env: Env): Promise<Response> {
  const user = await requireRole(request, 'ADMIN');
  if (!user) return json({ ok: false, error: 'IKKE_AUTORISERT' }, 403);
  const storage = getStorage();
  const sessions = await storage.sessionGetAll();
  return json({ ok: true, sessions, count: sessions.length });
}

export async function handleAdminRevokeSession(request: Request, env: Env): Promise<Response> {
  const user = await requireRole(request, 'ADMIN');
  if (!user) return json({ ok: false, error: 'IKKE_AUTORISERT' }, 403);
  const url = new URL(request.url);
  const pathParts = url.pathname.split('/');
  const sessionId = pathParts.at(-2);
  if (!sessionId) return json({ ok: false, error: 'SESSION_ID_PÅKREVD' }, 400);
  
  // Sjekk om sesjonen eksisterer før revoking - 404 hvis ikke
  const existingSession = await auth.getSession(sessionId);
  if (!existingSession) {
    return json({ ok: false, error: 'SESJON_FINNES_IKKE' }, 404);
  }
  
  await auth.destroySession(sessionId);
  return json({ ok: true, sessionId, message: 'Sesjon avbrutt' });
}

export async function handleAdminInquiries(request: Request, env: Env): Promise<Response> {
  const user = await requireRole(request, 'ADMIN', 'REVIEWER', 'OPERATOR');
  if (!user) return json({ ok: false, error: 'IKKE_AUTORISERT' }, 403);
  return json({ ok: true, inquiries: [], count: 0 });
}

export async function handleAdminInquiryStatus(request: Request, env: Env): Promise<Response> {
  const user = await requireRole(request, 'ADMIN', 'REVIEWER', 'OPERATOR');
  if (!user) return json({ ok: false, error: 'IKKE_AUTORISERT' }, 403);
  const url = new URL(request.url);
  const inquiryId = url.pathname.split('/').pop();
  if (!inquiryId) return json({ ok: false, error: 'INQUIRY_ID_PÅKREVD' }, 400);
  const body = await parseBody(request);
  if (!body || typeof body.status !== 'string') return json({ ok: false, error: 'STATUS_PÅKREVD' }, 400);
  const newStatus = body.status;
  if (!['NEW', 'CONTACTED', 'NEEDS_INFO', 'OFFERED', 'CONFIRMED', 'CLOSED', 'REJECTED'].includes(newStatus)) return json({ ok: false, error: 'UGYLDIG_STATUS' }, 400);
  return json({ ok: true, inquiryId, status: newStatus, message: `Status oppdatert til ${newStatus}` });
}

export async function handleAdminInquiryDecision(request: Request, env: Env): Promise<Response> {
  const user = await requireRole(request, 'ADMIN', 'REVIEWER');
  if (!user) return json({ ok: false, error: 'IKKE_AUTORISERT' }, 403);
  const url = new URL(request.url);
  const inquiryId = url.pathname.split('/').pop();
  if (!inquiryId) return json({ ok: false, error: 'INQUIRY_ID_PÅKREVD' }, 400);
  const body = await parseBody(request);
  if (!body || typeof body.decision !== 'string') return json({ ok: false, error: 'BESLUTNING_PÅKREVD' }, 400);
  const decision = body.decision;
  if (!['APPROVE', 'REJECT'].includes(decision)) return json({ ok: false, error: 'UGYLDIG_BESLUTNING' }, 400);
  return json({ ok: true, inquiryId, decision, decidedBy: user.email, decidedAt: Date.now(), message: `Glass ${decision === 'APPROVE' ? 'godkjent' : 'avvist'}` });
}

export async function handleAdminRoute(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/admin/, '');
  const method = request.method;

  const user = await requireAuth(request);
  if (!user) return json({ ok: false, error: 'IKKE_AUTENTISERT' }, 401);

  if (method === 'GET' && path === '/session') return handleAdminSession(request, env);
  if (method === 'GET' && path === '/users') return handleAdminUsers(request, env);
  if (method === 'POST' && /^\/users\/[^/]+\/role$/.test(path)) return handleAdminUserRole(request, env);
  if (method === 'GET' && path === '/sessions') return handleAdminSessions(request, env);
  if (method === 'POST' && /^\/sessions\/[^/]+\/revoke$/.test(path)) return handleAdminRevokeSession(request, env);
  if (method === 'GET' && path === '/inquiries') return handleAdminInquiries(request, env);
  if (method === 'POST' && /^\/inquiries\/[^/]+\/status$/.test(path)) return handleAdminInquiryStatus(request, env);
  if (method === 'POST' && /^\/inquiries\/[^/]+\/decision$/.test(path)) return handleAdminInquiryDecision(request, env);
  if (method === 'POST' && path === '/invite') return handleStaffInvite(request, env);
  if (method === 'GET' && path === '/invites') return handleStaffInvites(request, env);
  if (method === 'POST' && /^\/invites\/[^\/]+\/revoke$/.test(path)) return handleStaffInviteRevoke(request, env);

  return json({ ok: false, error: 'FINNES_IKKE' }, 404);
}

export async function getAdminUser(request: Request): Promise<AuthUser | null> {
  return requireAuth(request);
}

export async function getUserRoleFromD1(email: string): Promise<'ADMIN' | 'REVIEWER' | 'OPERATOR' | 'CUSTOMER'> {
  const storage = getStorage();
  const u = await storage.userGetByEmail(email);
  if (!u) return 'CUSTOMER';
  return u.role as 'ADMIN' | 'REVIEWER' | 'OPERATOR' | 'CUSTOMER';
}
