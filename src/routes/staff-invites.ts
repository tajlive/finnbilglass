import type { Env } from '../types';
import { auth, type AuthUser } from '../auth';
import { requireRole } from './auth';
import { getStorage } from '../auth';
import type { StaffInviteRow } from '../auth-store';
import { sendMail } from '../mail';

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
 * POST /api/admin/staff/invite
 * Inviter en ny medarbeider til FinnBilGlass.
 * Påkrevd: ADMIN-rolle (via Cloudflare Access-JWT).
 */
export async function handleStaffInvite(request: Request, env: Env): Promise<Response> {
  const user = await requireRole(request, 'ADMIN');
  if (!user) {
    return json({ ok: false, error: 'IKKE_AUTORISERT' }, 403);
  }

  const body = await parseBody(request);
  if (!body || typeof body.email !== 'string' || typeof body.role !== 'string') {
    return json({ ok: false, error: 'EPOST_OG_ROLLE_PÅKREVD' }, 400);
  }

  const email = body.email.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ ok: false, error: 'UGYLDIG_EPOST' }, 400);
  }

  const role = body.role as 'ADMIN' | 'REVIEWER' | 'OPERATOR';
  if (!['ADMIN', 'REVIEWER', 'OPERATOR'].includes(role)) {
    return json({ ok: false, error: 'UGYLDIG_ROLLE' }, 400);
  }

  const storage = getStorage();

  const existingUser = await storage.userGetByEmail(email);
  if (existingUser) {
    return json({
      ok: true,
      email: existingUser.email,
      name: existingUser.name,
      role: existingUser.role,
      alreadyHasAccount: true,
      message: `Bruker ${existingUser.name} har allerede en konto med rolle ${existingUser.role}`,
    });
  }

  const existingInvite = await storage.staffInviteGet(email);
  if (existingInvite && existingInvite.status !== 'REJECTED') {
    return json({
      ok: false,
      error: 'INVITASJON_EKSISTERER',
      invite: {
        email: existingInvite.email,
        role: existingInvite.role,
        status: existingInvite.status,
        invitedBy: existingInvite.invitedBy,
        createdAt: existingInvite.createdAt,
        updatedAt: existingInvite.updatedAt,
        providerMessageId: existingInvite.providerMessageId,
        lastErrorCode: existingInvite.lastErrorCode,
      },
      message: `En invitasjon allerede eksisterer for ${email} (status: ${existingInvite.status})`,
    });
  }

  const lockKey = `invite:${email}`;
  const canLock = await storage.staffInviteLock(lockKey, user.email, 60 * 60 * 1000);
  if (!canLock) {
    return json({
      ok: false,
      error: 'INVITASJON_IS_BLOCKED',
      message: `Kan ikke invitere ${email} for øyeblikket (låst).`,
    });
  }

  try {
    const now = Date.now();
    const invite = {
      email: email,
      role: role,
      status: 'INVITED' as const,
      invitedBy: user.email,
      createdAt: now,
      updatedAt: now,
      providerMessageId: null,
      lastErrorCode: null,
    };

    await storage.staffInviteSet(invite);

    const { code, expiresAt } = await auth.generateOtp(email);
    const roleLabel = ({ ADMIN: 'administrator', REVIEWER: 'gjennomleser', OPERATOR: 'saksbehandler' } as const)[role];
    const loginUrl = 'https://finnbilglass.no/innlogging';
    const htmlBody = `<p>Hei,</p><p>Du er invitert til Finnbilglass som ${roleLabel}.</p><p>Bruk denne engangskoden når du åpner innloggingssiden:</p><p style="font-size:24px;font-weight:700;letter-spacing:4px;font-family:monospace">${code}</p><p>Koden utløper om 10 minutter og kan bare brukes én gang. Ikke del den med andre.</p><p><a href="${loginUrl}">Gå til innlogging</a></p><p>— Finnbilglass</p>`;
    const textBody = `Hei,\n\nDu er invitert til Finnbilglass som ${roleLabel}.\n\nBruk denne engangskoden når du logger inn: ${code}\nKoden utløper om 10 minutter og kan bare brukes én gang. Ikke del den med andre.\n\nGå til innlogging: ${loginUrl}\n\n— Finnbilglass`;
    const response = await sendMail(env, {
      to: email,
      subject: `Invitasjon til Finnbilglass – ${roleLabel}`,
      html: htmlBody,
      text: textBody,
    });

    if (!response.ok) {
      await storage.staffInviteUnlock(lockKey);
      await storage.staffInviteSet({ ...invite, status: 'EMAIL_FAILED', lastErrorCode: response.error || 'UKJENT' });
      return json({
        ok: false,
        error: 'EPOST_UTSENDELSE_FEILET',
        message: `Kunne ikke sende invitasjon til ${email}: ${response.error || 'ukjent'}`,
      }, 502);
    }

    await storage.staffInviteSet({ ...invite, providerMessageId: `msg_${crypto.randomUUID()}`, lastErrorCode: null });

    return json({
      ok: true,
      email: email,
      role: role,
      inviteId: `inv_${email}_${now}`,
      expiresAt,
      message: `Invitasjon sendt til ${email}. Bruk engangskoden til å godta invitasjonen og logge på.`,
    });
  } catch (error) {
    await storage.staffInviteUnlock(lockKey);
    const failedInvite: StaffInviteRow = {
      email: email,
      role: role,
      status: 'EMAIL_FAILED',
      invitedBy: user.email,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      providerMessageId: null,
      lastErrorCode: String(error),
    };
    await storage.staffInviteSet(failedInvite);
    return json({
      ok: false,
      error: 'INTERN_FEIL',
      message: `En feil oppstod ved opprettelse av invitasjon for ${email}: ${error}`,
    }, 500);
  }
}

/**
 * GET /api/admin/staff/invites
 * Liste alle ventende invitasjoner.
 * Påkrevd: ADMIN-rolle.
 */
export async function handleStaffInvites(request: Request, env: Env): Promise<Response> {
  const user = await requireRole(request, 'ADMIN');
  if (!user) {
    return json({ ok: false, error: 'IKKE_AUTORISERT' }, 403);
  }

  const storage = getStorage();
  const invites = await storage.staffInviteGetAll();

  return json({
    ok: true,
    invites: invites.map((invite) => ({
      email: invite.email,
      role: invite.role,
      status: invite.status,
      invitedBy: invite.invitedBy,
      createdAt: invite.createdAt,
      updatedAt: invite.updatedAt,
      providerMessageId: invite.providerMessageId,
      lastErrorCode: invite.lastErrorCode,
    })),
    count: invites.length,
  });
}

/**
 * POST /api/admin/staff/invites/:email/revoke
 * Avbryt en invitasjon.
 * Påkrevd: ADMIN-rolle.
 */
export async function handleStaffInviteRevoke(request: Request, env: Env): Promise<Response> {
  const user = await requireRole(request, 'ADMIN');
  if (!user) {
    return json({ ok: false, error: 'IKKE_AUTORISERT' }, 403);
  }

  const url = new URL(request.url);
  const pathParts = url.pathname.split('/');
  const email = pathParts.at(-2);
  if (!email) {
    return json({ ok: false, error: 'EPOST_PÅKREVD' }, 400);
  }

  const storage = getStorage();

  const lockKey = `invite:${email}`;
  const canLock = await storage.staffInviteLock(lockKey, user.email, 60 * 60 * 1000);
  if (!canLock) {
    return json({
      ok: false,
      error: 'INVITASJON_IS_BLOCKED',
      message: `Kan ikke kansellere invitasjon for ${email} (låst).`,
    }, 409);
  }

  const existingInvite = await storage.staffInviteGet(email);
  if (!existingInvite) {
    await storage.staffInviteUnlock(lockKey);
    return json({ ok: false, error: 'INIVITASJON_FINNES_IKKE' }, 404);
  }

  const now = Date.now();
  await storage.staffInviteSet({ ...existingInvite, status: 'REJECTED', updatedAt: now });

  await storage.staffInviteUnlock(lockKey);

  return json({
    ok: true,
    email: email,
    status: 'REJECTED',
    message: `Invitasjon kansellert for ${email}.`,
  });
}

/** Router for /api/admin/staff/* endepunkter. */
export async function handleStaffInvitesRoute(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/admin\/staff/, '');
  const method = request.method;

  if (method === 'POST' && path === '/invite') {
    return handleStaffInvite(request, env);
  }

  if (method === 'GET' && path === '/invites') {
    return handleStaffInvites(request, env);
  }

  if (method === 'POST' && /^\/invites\/[^\/]+\/revoke$/.test(path)) {
    return handleStaffInviteRevoke(request, env);
  }

  return json({ ok: false, error: 'FINNES_IKKE' }, 404);
}

/**
 * Hent gjeldende brukerrolle fra D1 (ikke bare fra sesjonen).
 * Brukes for å verifisere rolle på hvert beskyttet forespørsel.
 */
export async function getUserRoleFromD1(email: string): Promise<'ADMIN' | 'REVIEWER' | 'OPERATOR' | 'CUSTOMER'> {
  const storage = getStorage();
  const user = await storage.userGetByEmail(email);
  if (!user) return 'CUSTOMER';
  return user.role as 'ADMIN' | 'REVIEWER' | 'OPERATOR' | 'CUSTOMER';
}
