/**
 * FinnBilGlass — Felles lagringsadapter for autentisering (Fase 5.8)
 *
 * Definerer grensesnittet for sesjoner, OTP, rate limiting og rolleoppslag.
 * To implementasjoner finnes:
 *   1. D1EmulatorAuthStorage — in-memory, for isolerte enhetstester
 *   2. D1AuthStorage         — ekte D1, for lokal Worker og integrasjonstester
 *
 * auth.ts bruker dette grensesnittet, ikke D1Emulator direkte.
 */

import type { D1Database } from '@cloudflare/workers-types';
import { D1Emulator, type SessionRow, type OtpRow, type RateLimitRow, type StaffInviteRow } from './auth-store';

// ── SQL-radetyper (snake_case fra D1) ──
interface D1SessionRow {
  session_id: string;
  user_id: string;
  email: string;
  role: string;
  name: string;
  created_at: number;
  expires_at: number;
  last_activity: number;
}

interface D1OtpRow {
  email: string;
  code: string;
  created_at: number;
  expires_at: number;
  used: number;   // 0 = false, 1 = true
  attempts: number;
}

interface D1RateLimitRow {
  identity: string;
  count: number;
  window_start: number;
}

interface D1UserRow {
  user_id: string;
  email: string;
  role: string;
  name: string;
}

// ── Typer ──
export type UserRole = 'ADMIN' | 'REVIEWER' | 'OPERATOR' | 'CUSTOMER';

export interface AuthUser {
  userId: string;
  email: string;
  role: UserRole;
  name: string;
}

export interface SessionData {
  sessionId: string;
  userId: string;
  email: string;
  role: UserRole;
  name: string;
  createdAt: number;
  expiresAt: number;
  lastActivity: number;
}

export interface OtpCode {
  code: string;
  email: string;
  createdAt: number;
  expiresAt: number;
  used: boolean;
  attempts: number;
}

/**
 * Grensesnitt for auth-lagring. Samme metoder uavhengig av backend.
 */
export interface AuthStorage {
  // ── Sessions ──
  sessionGet(sessionId: string): Promise<SessionRow | null>;
  sessionSet(session: SessionRow): Promise<void>;
  sessionDelete(sessionId: string): Promise<void>;
  sessionGetAll(): Promise<SessionRow[]>;

  // ── OTP codes ──
  otpGet(email: string): Promise<OtpRow | null>;
  otpSet(otp: OtpRow): Promise<void>;
  otpDelete(email: string): Promise<void>;

  // ── Rate limits ──
  rateLimitGet(identity: string): Promise<RateLimitRow | null>;
  rateLimitSet(row: RateLimitRow): Promise<void>;
  rateLimitDelete(identity: string): Promise<void>;

  // ── Users ──
  userGetByEmail(email: string): Promise<AuthUser | null>;
  userGet(userId: string): Promise<AuthUser | null>;
  userGetAll(): Promise<AuthUser[]>;
  userSet(user: AuthUser & { createdAt: number; updatedAt: number }): Promise<void>;

  // ── Staff invites ──
  staffInviteGet(email: string): Promise<StaffInviteRow | null>;
  staffInviteGetAll(): Promise<StaffInviteRow[]>;
  staffInviteSet(invite: StaffInviteRow): Promise<void>;
  staffInviteDelete(email: string): Promise<void>;
  staffInviteLock(lockKey: string, owner: string, ttlMs: number): Promise<boolean>;
  staffInviteUnlock(lockKey: string): Promise<void>;

  // ── Cleanup ──
  cleanupExpired(now?: number): Promise<void>;
  clear(): Promise<void>;
}

/**
 * Konverter D1SessionRow (snake_case) til SessionRow (camelCase).
 */
function toSessionRow(row: D1SessionRow): SessionRow {
  return {
    sessionId: row.session_id,
    userId: row.user_id,
    email: row.email,
    role: row.role as UserRole,
    name: row.name,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    lastActivity: row.last_activity,
  };
}

/**
 * Konverter D1OtpRow (snake_case) til OtpRow (camelCase).
 */
function toOtpRow(row: D1OtpRow): OtpRow {
  return {
    email: row.email,
    code: row.code,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    used: row.used,
    attempts: row.attempts,
  };
}

/**
 * Konverter D1RateLimitRow (snake_case) til RateLimitRow (camelCase).
 */
function toRateLimitRow(row: D1RateLimitRow): RateLimitRow {
  return {
    identity: row.identity,
    count: row.count,
    windowStart: row.window_start,
  };
}

/**
 * Implementasjon som omgir D1Emulator (for tester).
 */
export class D1EmulatorAuthStorage implements AuthStorage {
  private store: D1Emulator;

  constructor(store: D1Emulator) {
    this.store = store;
  }

  async sessionGet(sessionId: string) { return this.store.sessionGet(sessionId); }
  async sessionSet(session: SessionRow) { await this.store.sessionSet(session); }
  async sessionDelete(sessionId: string) { await this.store.sessionDelete(sessionId); }
  async sessionGetAll() { return this.store.sessionGetAll(); }

  async otpGet(email: string) { return this.store.otpGet(email); }
  async otpSet(otp: OtpRow) { await this.store.otpSet(otp); }
  async otpDelete(email: string) { await this.store.otpDelete(email); }

  async rateLimitGet(identity: string) { return this.store.rateLimitGet(identity); }
  async rateLimitSet(row: RateLimitRow) { await this.store.rateLimitSet(row); }
  async rateLimitDelete(identity: string) { await this.store.rateLimitDelete(identity); }

  async userGetByEmail(email: string): Promise<AuthUser | null> {
    const user = await this.store.userGetByEmail(email);
    if (!user) return null;
    return {
      userId: user.userId,
      email: user.email,
      role: user.role as UserRole,
      name: user.name,
    };
  }

  async userGet(userId: string): Promise<AuthUser | null> {
    const user = await this.store.userGet(userId);
    if (!user) return null;
    return {
      userId: user.userId,
      email: user.email,
      role: user.role as UserRole,
      name: user.name,
    };
  }

  async userGetAll(): Promise<AuthUser[]> {
    return (await this.store.userGetAll()).map((u) => ({
      userId: u.userId,
      email: u.email,
      role: u.role as UserRole,
      name: u.name,
    }));
  }

  // ── Staff invites ──
  async staffInviteGet(email: string): Promise<StaffInviteRow | null> {
    return this.store.staffInviteGet(email);
  }

  async staffInviteGetAll(): Promise<StaffInviteRow[]> {
    return (await this.store.staffInviteGetAll()).map((i) => ({
      email: i.email,
      role: i.role as UserRole,
      status: i.status,
      invitedBy: i.invitedBy,
      createdAt: i.createdAt,
      updatedAt: i.updatedAt,
      providerMessageId: i.providerMessageId,
      lastErrorCode: i.lastErrorCode,
    }));
  }

  async staffInviteSet(invite: StaffInviteRow): Promise<void> {
    await this.store.staffInviteSet(invite);
  }

  async staffInviteDelete(email: string): Promise<void> {
    await this.store.staffInviteDelete(email);
  }

  async staffInviteLock(lockKey: string, owner: string, ttlMs: number): Promise<boolean> {
    return await this.store.staffInviteLock(lockKey, owner, ttlMs);
  }

  async staffInviteUnlock(lockKey: string): Promise<void> {
    await this.store.staffInviteUnlock(lockKey);
  }

  async userSet(user: AuthUser & { createdAt: number; updatedAt: number }): Promise<void> {
    await this.store.userSet({
      userId: user.userId,
      email: user.email,
      role: user.role as UserRole,
      name: user.name,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    });
  }

  async cleanupExpired(now?: number) { await this.store.cleanupExpired(now); }
  async clear() { await this.store.clear(); }
}

/**
 * Implementasjon som bruker ekte D1Database (lokal Worker via --local).
 * Alle SQL-spørringer er parameteriserte for å unngå SQL-injekasjon.
 */
export class D1AuthStorage implements AuthStorage {
  private db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  // ── Sessions ──
  async sessionGet(sessionId: string) {
    const row = await this.db.prepare(
      'SELECT session_id, user_id, email, role, name, created_at, expires_at, last_activity FROM auth_sessions WHERE session_id = ?'
    ).bind(sessionId).first<D1SessionRow>();
    return row ? toSessionRow(row) : null;
  }

  async sessionSet(session: SessionRow) {
    await this.db.prepare(
      'INSERT OR REPLACE INTO auth_sessions (session_id, user_id, email, role, name, created_at, expires_at, last_activity) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(
      session.sessionId, session.userId, session.email, session.role,
      session.name, session.createdAt, session.expiresAt, session.lastActivity
    ).run();
  }

  async sessionDelete(sessionId: string) {
    await this.db.prepare('DELETE FROM auth_sessions WHERE session_id = ?').bind(sessionId).run();
  }

  async sessionGetAll() {
    const rows = await this.db.prepare(
      'SELECT session_id, user_id, email, role, name, created_at, expires_at, last_activity FROM auth_sessions'
    ).all<D1SessionRow>();
    return (rows.results ?? []).map(toSessionRow);
  }

  // ── OTP codes ──
  async otpGet(email: string) {
    const row = await this.db.prepare(
      'SELECT email, code, created_at, expires_at, used, attempts FROM auth_otp_codes WHERE email = ?'
    ).bind(email).first<D1OtpRow>();
    return row ? toOtpRow(row) : null;
  }

  async otpSet(otp: OtpRow) {
    await this.db.prepare(
      'INSERT OR REPLACE INTO auth_otp_codes (email, code, created_at, expires_at, used, attempts) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(otp.email, otp.code, otp.createdAt, otp.expiresAt, otp.used, otp.attempts).run();
  }

  async otpDelete(email: string) {
    await this.db.prepare('DELETE FROM auth_otp_codes WHERE email = ?').bind(email).run();
  }

  // ── Rate limits ──
  async rateLimitGet(identity: string) {
    const row = await this.db.prepare(
      'SELECT identity, count, window_start FROM auth_rate_limits WHERE identity = ?'
    ).bind(identity).first<D1RateLimitRow>();
    return row ? toRateLimitRow(row) : null;
  }

  async rateLimitSet(row: RateLimitRow) {
    await this.db.prepare(
      'INSERT OR REPLACE INTO auth_rate_limits (identity, count, window_start) VALUES (?, ?, ?)'
    ).bind(row.identity, row.count, row.windowStart).run();
  }

  async rateLimitDelete(identity: string) {
    await this.db.prepare('DELETE FROM auth_rate_limits WHERE identity = ?').bind(identity).run();
  }

  // ── Users ──
  async userGetByEmail(email: string): Promise<AuthUser | null> {
    const row = await this.db.prepare(
      'SELECT user_id, email, role, name FROM auth_users WHERE email = ?'
    ).bind(email).first<D1UserRow>();
    if (!row) return null;
    return {
      userId: row.user_id,
      email: row.email,
      role: row.role as UserRole,
      name: row.name,
    };
  }

  async userGet(userId: string): Promise<AuthUser | null> {
    const row = await this.db.prepare(
      'SELECT user_id, email, role, name FROM auth_users WHERE user_id = ?'
    ).bind(userId).first<D1UserRow>();
    if (!row) return null;
    return {
      userId: row.user_id,
      email: row.email,
      role: row.role as UserRole,
      name: row.name,
    };
  }

  async userGetAll(): Promise<AuthUser[]> {
    const rows = await this.db.prepare(
      'SELECT user_id, email, role, name FROM auth_users'
    ).all<D1UserRow>();
    return (rows.results ?? []).map((r) => ({
      userId: r.user_id,
      email: r.email,
      role: r.role as UserRole,
      name: r.name,
    }));
  }

  async userSet(user: AuthUser & { createdAt: number; updatedAt: number }) {
    await this.db.prepare(
      'INSERT OR REPLACE INTO auth_users (user_id, email, role, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(user.userId, user.email, user.role, user.name, user.createdAt, user.updatedAt).run();
  }

  // ── Staff invites ──
  async staffInviteGet(email: string): Promise<StaffInviteRow | null> {
    const row = await this.db.prepare(
      'SELECT email, role, status, invited_by, created_at, updated_at, provider_message_id, last_error_code FROM staff_invites WHERE email = ?'
    ).bind(email).first<{ email: string; role: string; status: string; invited_by: string; created_at: number; updated_at: number; provider_message_id: string | null; last_error_code: string | null }>();
    if (!row) return null;
    return {
      email: row.email,
      role: row.role as 'ADMIN' | 'REVIEWER' | 'OPERATOR' | 'CUSTOMER',
      status: row.status as 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'INVITED',
      invitedBy: row.invited_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      providerMessageId: row.provider_message_id,
      lastErrorCode: row.last_error_code,
    };
  }

  async staffInviteGetAll(): Promise<StaffInviteRow[]> {
    const rows = await this.db.prepare(
      'SELECT email, role, status, invited_by, created_at, updated_at, provider_message_id, last_error_code FROM staff_invites'
    ).all<{ email: string; role: string; status: string; invited_by: string; created_at: number; updated_at: number; provider_message_id: string | null; last_error_code: string | null }>();
    return (rows.results ?? []).map((r) => ({
      email: r.email,
      role: r.role as 'ADMIN' | 'REVIEWER' | 'OPERATOR' | 'CUSTOMER',
      status: r.status as 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'INVITED',
      invitedBy: r.invited_by,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      providerMessageId: r.provider_message_id,
      lastErrorCode: r.last_error_code,
    }));
  }

  async staffInviteSet(invite: StaffInviteRow): Promise<void> {
    await this.db.prepare(
      'INSERT OR REPLACE INTO staff_invites (email, role, status, invited_by, created_at, updated_at, provider_message_id, last_error_code) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(invite.email, invite.role, invite.status, invite.invitedBy, invite.createdAt, invite.updatedAt, invite.providerMessageId, invite.lastErrorCode).run();
  }

  async staffInviteDelete(email: string): Promise<void> {
    await this.db.prepare('DELETE FROM staff_invites WHERE email = ?').bind(email).run();
  }

  async staffInviteLock(lockKey: string, owner: string, ttlMs: number): Promise<boolean> {
    const now = Date.now();
    const acquired = await this.db.prepare(
      `INSERT INTO staff_invite_locks (lock_key, owner, expires_at) VALUES (?, ?, ?)
       ON CONFLICT(lock_key) DO UPDATE SET owner = excluded.owner, expires_at = excluded.expires_at
       WHERE staff_invite_locks.expires_at <= ? RETURNING lock_key`
    ).bind(lockKey, owner, now + ttlMs, now).first<{ lock_key: string }>();
    return acquired?.lock_key === lockKey;
  }

  async staffInviteUnlock(lockKey: string): Promise<void> {
    await this.db.prepare('DELETE FROM staff_invite_locks WHERE lock_key = ?').bind(lockKey).run();
  }

  // ── Cleanup ──
  async cleanupExpired(now: number = Date.now()) {
    await this.db.prepare('DELETE FROM auth_sessions WHERE expires_at <= ?').bind(now).run();
    await this.db.prepare('DELETE FROM auth_otp_codes WHERE expires_at <= ? AND used = 0').bind(now).run();
  }

  async clear() {
    await this.db.prepare('DELETE FROM auth_sessions').run();
    await this.db.prepare('DELETE FROM auth_otp_codes').run();
    await this.db.prepare('DELETE FROM auth_rate_limits').run();
    await this.db.prepare('DELETE FROM auth_users').run();
  }
}

/**
 * Konverter D1 SessionRow til internt SessionData-objekt.
 */
export function sessionRowToSession(row: SessionRow): SessionData {
  return {
    sessionId: row.sessionId,
    userId: row.userId,
    email: row.email,
    role: row.role,
    name: row.name,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    lastActivity: row.lastActivity,
  };
}

/**
 * Konverter D1 OtpRow til internt OtpCode-objekt.
 */
export function otpRowToOtpCode(row: OtpRow): OtpCode {
  return {
    code: row.code,
    email: row.email,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    used: row.used === 1,
    attempts: row.attempts,
  };
}
