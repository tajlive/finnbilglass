/**
 * Autentisering og tilgangsstyring (P0).
 *
 * Passordfri innlogging for kunder (magic link via e-post) + sikker økt,
 * samt roller og revisjonslogg for Operations Center (ansatte).
 *
 * Sikkerhetsmodell:
 *  - Magic-link-token: 32 tilfeldige byte → URL-safe base64; kun SHA-256-hashen
 *    lagres. Én gangs bruk (atomisk), 15 minutters utløp → replay/brute-force-sikker.
 *  - Økt: tilfeldig 32-byte session_id i HttpOnly+Secure+SameSite=Lax cookie.
 *  - Invitasjon knyttes til e-post på serversiden (én kunde per invitasjon).
 *  - Admin: roller (administrator/saksbehandler/lesetilgang) + append-only audit.
 */

import { forbrukInvitasjon } from './invitation';

export interface AuthDb {
  prepare(sql: string): {
    bind(...v: unknown[]): {
      run(): Promise<{ meta?: { changes?: number } }>;
      first<T>(): Promise<T | null>;
      all<T>(): Promise<{ results: T[] }>;
    };
  };
}

export const MAGIC_LINK_TTL_MS = 15 * 60 * 1000; // 15 min
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 dager

/** Generer en sikker, tilfeldig token (URL-safe base64 av 32 byte). */
export function genererToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

/** SHA-256 som hex (samme innhold → samme hash på tvers av kjøringer). */
export async function hashToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Opprett en magic-link-token: lagrer hashen (+ ev. invitasjon), returnerer rå token. */
export async function opprettLoginToken(db: AuthDb, email: string, inviteCode: string | null, naa: number = Date.now()): Promise<string> {
  const raw = genererToken();
  const hash = await hashToken(raw);
  await db
    .prepare('INSERT INTO login_tokens (token_hash, email, invite_code, created_at, expires_at) VALUES (?, ?, ?, ?, ?)')
    .bind(hash, email, inviteCode, naa, naa + MAGIC_LINK_TTL_MS)
    .run();
  return raw;
}

/** Verifiser magic-link-token (atomisk én gangs bruk). Returnerer {email, inviteCode} eller null. */
export async function verifiserLoginToken(db: AuthDb, raw: string, naa: number = Date.now()): Promise<{ email: string; inviteCode: string | null } | null> {
  const hash = await hashToken(raw);
  const r = await db
    .prepare("UPDATE login_tokens SET used_at = ? WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?")
    .bind(naa, hash, naa)
    .run();
  if ((r.meta?.changes ?? 0) > 0) {
    const row = await db.prepare('SELECT email, invite_code FROM login_tokens WHERE token_hash = ?').bind(hash).first<{ email: string; invite_code: string | null }>();
    return row ? { email: row.email, inviteCode: row.invite_code ?? null } : null;
  }
  return null;
}

/** Finn eller opprett kunde (e-post er identitet). Returnerer id. */
export async function finnEllerOpprettKunde(db: AuthDb, email: string, naa: number = Date.now()): Promise<number> {
  const eksisterende = await db.prepare('SELECT id FROM customers WHERE email = ?').bind(email).first<{ id: number }>();
  if (eksisterende) return eksisterende.id;
  const r = await db.prepare('INSERT INTO customers (email, created_at) VALUES (?, ?)').bind(email, naa).run();
  const ny = await db.prepare('SELECT id FROM customers WHERE email = ?').bind(email).first<{ id: number }>();
  return ny?.id ?? 0;
}

/** Opprett økt: returnerer session_id. */
export async function opprettSesjon(db: AuthDb, customerId: number, naa: number = Date.now()): Promise<string> {
  const sid = genererToken();
  await db
    .prepare('INSERT INTO sessions (session_id, customer_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .bind(sid, customerId, naa, naa + SESSION_TTL_MS)
    .run();
  return sid;
}

/** Hent kunde-id for en gyldig (uutløpt) økt. null hvis ugyldig. */
export async function sesjonKunde(db: AuthDb, sessionId: string, naa: number = Date.now()): Promise<number | null> {
  const row = await db
    .prepare('SELECT customer_id FROM sessions WHERE session_id = ? AND expires_at > ?')
    .bind(sessionId, naa)
    .first<{ customer_id: number }>();
  return row?.customer_id ?? null;
}

/** Slett økt (logg ut). */
export async function slettSesjon(db: AuthDb, sessionId: string): Promise<void> {
  await db.prepare('DELETE FROM sessions WHERE session_id = ?').bind(sessionId).run();
}

/**
 * Knytt invitasjon til kundeidentitet (e-post) på serversiden.
 * Forbruket skjer atomisk i pilot_invitations (unused → used + used_by_email).
 * Returnerer false hvis invitasjonen allerede er brukt/tilbakekalt/utløpt/ukjent.
 */
export async function bindInvitasjon(db: AuthDb, email: string, inviteCode: string, naa: number = Date.now()): Promise<boolean> {
  const status = await forbrukInvitasjon(db as never, inviteCode, email, naa);
  return status === 'OK';
}

export type Rolle = 'administrator' | 'saksbehandler' | 'lesetilgang';

/** Hent ansattrolle for e-post (null hvis ingen rolle). */
export async function adminRolle(db: AuthDb, email: string): Promise<Rolle | null> {
  const row = await db.prepare('SELECT role FROM admin_roles WHERE email = ?').bind(email).first<{ role: Rolle }>();
  return row?.role ?? null;
}

/** Kan rolle utføre en skriveoperasjon? (lesetilgang = kun lesing.) */
export function kanSkrive(rolle: Rolle | null): boolean {
  return rolle === 'administrator' || rolle === 'saksbehandler';
}

/** Revisjonslogg (append-only). */
export async function loggAdmin(db: AuthDb, adminEmail: string, action: string, target: string | null, naa: number = Date.now()): Promise<void> {
  await db
    .prepare('INSERT INTO admin_audit_log (admin_email, action, target, created_at) VALUES (?, ?, ?, ?)')
    .bind(adminEmail, action, target, naa)
    .run();
}
