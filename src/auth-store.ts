/**
 * FinnBilGlass — D1-emulator for autentiseringslagring (Fase 5.5)
 *
 * Dette er et lokalt lagringslag som simulerer D1-atferd for utvikling og testing.
 * I produksjon erstattes dette av ekte D1-tabeller med samme SQL-grensesnitt.
 */

interface SessionRow {
  sessionId: string;
  userId: string;
  email: string;
  role: 'ADMIN' | 'REVIEWER' | 'OPERATOR' | 'CUSTOMER';
  name: string;
  createdAt: number;
  expiresAt: number;
  lastActivity: number;
}

interface OtpRow {
  email: string;
  code: string;
  createdAt: number;
  expiresAt: number;
  used: number; // 0 = false, 1 = true
  attempts: number;
}

interface RateLimitRow {
  identity: string;
  count: number;
  windowStart: number;
}

interface UserRow {
  userId: string;
  email: string;
  role: 'ADMIN' | 'REVIEWER' | 'OPERATOR' | 'CUSTOMER';
  name: string;
  createdAt: number;
  updatedAt: number;
}

export interface StaffInviteRow {
  email: string;
  role: 'ADMIN' | 'REVIEWER' | 'OPERATOR' | 'CUSTOMER';
  status: 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'INVITED' | 'EMAIL_FAILED';
  invitedBy: string;
  createdAt: number;
  updatedAt: number;
  providerMessageId: string | null;
  lastErrorCode: string | null;
}

interface StaffInviteLockRow {
  lockKey: string;
  owner: string;
  expiresAt: number;
}

/**
 * In-memory D1-emulator. I produksjon erstattes dette av ekte D1-spørringer.
 * Samme API-konvensjon som D1: prepare(...).bind(...).run()/first()/all().
 */
class D1Emulator {
  private sessions = new Map<string, SessionRow>();
  private otpCodes = new Map<string, OtpRow>();
  private rateLimits = new Map<string, RateLimitRow>();
  private users = new Map<string, UserRow>();
  private staffInvites = new Map<string, StaffInviteRow>();
  private inviteLocks = new Map<string, StaffInviteLockRow>();

  // ── Sessions ──
  async sessionGet(sessionId: string): Promise<SessionRow | null> {
    return this.sessions.get(sessionId) ?? null;
  }

  async sessionSet(session: SessionRow): Promise<void> {
    this.sessions.set(session.sessionId, session);
  }

  async sessionDelete(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
  }

  async sessionGetAll(): Promise<SessionRow[]> {
    return Array.from(this.sessions.values());
  }

  // ── OTP codes ──
  async otpGet(email: string): Promise<OtpRow | null> {
    return this.otpCodes.get(email) ?? null;
  }

  async otpSet(otp: OtpRow): Promise<void> {
    this.otpCodes.set(otp.email, otp);
  }

  async otpDelete(email: string): Promise<void> {
    this.otpCodes.delete(email);
  }

  // ── Rate limits ──
  async rateLimitGet(identity: string): Promise<RateLimitRow | null> {
    return this.rateLimits.get(identity) ?? null;
  }

  async rateLimitSet(row: RateLimitRow): Promise<void> {
    this.rateLimits.set(row.identity, row);
  }

  async rateLimitDelete(identity: string): Promise<void> {
    this.rateLimits.delete(identity);
  }

  // ── Users ──
  async userGet(userId: string): Promise<UserRow | null> {
    return this.users.get(userId) ?? null;
  }

  async userGetByEmail(email: string): Promise<UserRow | null> {
    return Array.from(this.users.values()).find(u => u.email === email) ?? null;
  }

  async userSet(user: UserRow): Promise<void> {
    this.users.set(user.userId, user);
  }

  async userGetAll(): Promise<UserRow[]> {
    return Array.from(this.users.values());
  }

  // ── Staff invites ──
  async staffInviteGet(email: string): Promise<StaffInviteRow | null> {
    return this.staffInvites.get(email) ?? null;
  }

  async staffInviteGetAll(): Promise<StaffInviteRow[]> {
    return Array.from(this.staffInvites.values());
  }

  async staffInviteSet(invite: StaffInviteRow): Promise<void> {
    this.staffInvites.set(invite.email, invite);
  }

  async staffInviteDelete(email: string): Promise<void> {
    this.staffInvites.delete(email);
  }

  async staffInviteLock(lockKey: string, owner: string, ttlMs: number): Promise<boolean> {
    const now = Date.now();
    const existing = this.inviteLocks.get(lockKey);
    if (existing && now < existing.expiresAt) return false;
    this.inviteLocks.set(lockKey, { lockKey, owner, expiresAt: now + ttlMs });
    return true;
  }

  async staffInviteUnlock(lockKey: string): Promise<void> {
    this.inviteLocks.delete(lockKey);
  }

  async cleanupExpired(now: number = Date.now()): Promise<void> {
    for (const [id, session] of this.sessions.entries()) {
      if (now > session.expiresAt) {
        this.sessions.delete(id);
      }
    }
    for (const [email, otp] of this.otpCodes.entries()) {
      if (now > otp.expiresAt && !otp.used) {
        this.otpCodes.delete(email);
      }
    }
  }

  /** Nulstil all lagring (for testing). */
  async clear(): Promise<void> {
    this.sessions.clear();
    this.otpCodes.clear();
    this.rateLimits.clear();
    this.users.clear();
  }

  /** Nulstil rate limits (for testing). */
  async clearRateLimits(): Promise<void> {
    this.rateLimits.clear();
  }
}

export { D1Emulator };
export type { SessionRow, OtpRow, RateLimitRow };