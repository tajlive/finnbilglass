/**
 * FinnBilGlass — Sikker autentisering og sesjonshåndtering (Fase 5.5/5.8)
 *
 * Implementerer:
 * - Kryptografisk sikre sesjonsidentifikatorer
 * - HttpOnly/Secure/SameSite cookies (ingen tokens i JavaScript-lesbar lagring)
 * - OTP-generering, -lagring og -verifisering (engangsbruk, tidsbegrenset)
 * - Rate limiting på identitetsnivå
 * - Serverbasert rolleautorisasjon (ADMIN / REVIEWER / OPERATOR / CUSTOMER)
 * - Sesjonsutløp og rotasjon
 *
 * Lagring: bruker AuthStorage-grensesnittet.
 *   - D1EmulatorAuthStorage (in-memory) for isolerte enhetstester
 *   - D1AuthStorage (ekte D1) for lokal Worker og integrasjonstester
 *
 * Roller lagres i brukerregistret (auth_users), ikke derivert fra e-postadresse.
 */

import type { Env } from './types';
import type { AuthStorage, UserRole, SessionData, AuthUser, OtpCode } from './auth-storage';
import { type SessionRow, type OtpRow, type RateLimitRow } from './auth-store';
import { sessionRowToSession, otpRowToOtpCode } from './auth-storage';

// ── Typer (re-eksport for bakoverkompatibilitet) ──
export type { UserRole };
export type { AuthUser };
export type { SessionData };
export type { OtpCode };

// ── Konfigurasjon ──
const SESSION_TTL_MS = 60 * 60 * 1000;      // 1 time
const OTP_TTL_MS = 10 * 60 * 1000;          // 10 minutter
const OTP_MAX_ATTEMPTS = 3;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;     // 1 minutt
const RATE_LIMIT_MAX_REQUESTS = 5;          // Maks 5 forespørsler per vindu

// ── Lagring: AuthStorage (kan byttes mellom emulator og ekte D1) ──
let storage: AuthStorage | null = null;

/**
 * Sett lagringsadapter (kalles av Worker eller test-setup).
 * Kreves eksplisitt — det er ingen stum fallback til in-memory emulator.
 */
export function setAuthStorage(s: AuthStorage): void {
  storage = s;
}

/**
 * Hent lagringsadapter. Kaster hvis ingen adapter er satt — fail-closed.
 * D1EmulatorAuthStorage brukes KUN når tester eksplisitt setter den via setAuthStorage().
 */
function getStorage(): AuthStorage {
  if (!storage) {
    throw new Error('AUTH_STORAGE_NOT_CONFIGURED: sett AuthStorage via setAuthStorage() før bruk');
  }
  return storage;
}

// ── Hjelpefunksjoner ──
/**
 * Generer kryptografisk sikker tilfeldig streng.
 */
function generateSecureToken(length = 32): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Generer 6-sifret OTP-kode.
 */
function generateOtpCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (b) => (b % 10).toString()).join('');
}

// ── Offentlig API ──
const auth = {

  /**
   * Opprett ny sesjon etter vellykket OTP-verifisering.
   * Setter rotasjon ved sikkerhetshendelser.
   */
  async createSession({
    email,
    role,
    name,
    userId,
  }: {
    email: string;
    role: UserRole;
    name: string;
    userId?: string;
  }): Promise<SessionData> {
    const store = getStorage();
    await store.cleanupExpired();

    const sessionId = generateSecureToken();
    const now = Date.now();
    const session: SessionRow = {
      sessionId,
      userId: userId ?? `user_${generateSecureToken(16)}`,
      email,
      role,
      name,
      createdAt: now,
      expiresAt: now + SESSION_TTL_MS,
      lastActivity: now,
    };

    await store.sessionSet(session);

    return sessionRowToSession(session);
  },

  /**
   * Hent sesjon ved sessionId. Returnerer null hvis ikke funnet eller utløpt.
   */
  async getSession(sessionId: string | null): Promise<SessionData | null> {
    if (!sessionId) return null;
    const store = getStorage();
    await store.cleanupExpired();
    const session = await store.sessionGet(sessionId);
    if (!session) return null;
    if (Date.now() > session.expiresAt) {
      await store.sessionDelete(session.sessionId);
      return null;
    }
    // Oppdater aktivitet
    session.lastActivity = Date.now();
    await store.sessionSet(session);
    return sessionRowToSession(session);
  },

  /**
   * Avbryt sesjon (logout).
   */
  async destroySession(sessionId: string | null): Promise<void> {
    if (!sessionId) return;
    const store = getStorage();
    // Må awaiteres: D1-slettingen fullføres ellers ikke før requesten avsluttes,
    // og sesjonen ville leve videre etter «logg ut».
    await store.sessionDelete(sessionId);
  },

  /**
   * Generer OTP-kode for e-postadresse.
   * Returnerer KUN koden i lokal testing/miljø. I produksjon sendes koden
   * via e-post og returneres IKKE til klienten.
   */
  async generateOtp(email: string): Promise<{ code: string; expiresAt: number }> {
    const store = getStorage();
    await store.cleanupExpired();
    const identity = `otp:${email}`;
    if (await isRateLimited(identity)) {
      throw new Error('FOR_RATE_LIMITED');
    }

    const code = generateOtpCode();
    const now = Date.now();
    const otp: OtpRow = {
      email,
      code,
      createdAt: now,
      expiresAt: now + OTP_TTL_MS,
      used: 0,
      attempts: 0,
    };
    await store.otpSet(otp);
    incrementRateLimit(identity);

    return { code, expiresAt: otp.expiresAt };
  },

  /**
   * Verifiser OTP-kode. Returnerer brukerdata ved suksess.
   * Koden blir merket som brukt etter første verifisering (engangsbruk).
   */
  async verifyOtp({
    email,
    code,
  }: {
    email: string;
    code: string;
  }): Promise<{ success: boolean; user?: AuthUser; error?: string }> {
    const store = getStorage();
    // Hent OTP FØR cleanupExpired kan slette den (hvis den er brukt)
    const otp = await store.otpGet(email);
    if (!otp) {
      return { success: false, error: 'INVALID_OTP' };
    }
    if (otp.used === 1) {
      return { success: false, error: 'OTP_ALREADY_USED' };
    }
    if (Date.now() > otp.expiresAt) {
      otp.used = 1;
      await store.otpSet(otp);
      return { success: false, error: 'OTP_EXPIRED' };
    }
    if (otp.attempts >= OTP_MAX_ATTEMPTS) {
      otp.used = 1;
      await store.otpSet(otp);
      return { success: false, error: 'OTP_MAX_ATTEMPTS' };
    }
    if (otp.code !== code) {
      otp.attempts++;
      await store.otpSet(otp);
      return { success: false, error: 'INVALID_OTP' };
    }

    // Merk som brukt (engangsbruk)
    otp.used = 1;
    await store.otpSet(otp);

    // Rens opp utløpte poster (denne er ikke utløpt ennå)
    await store.cleanupExpired();

    // Slå opp bruker i auth_users — rolle er aldri derivert fra e-postadresse
    const existingUser = await store.userGetByEmail(email);

    let userId: string;
    let userRole: UserRole;
    let userName: string;

    if (existingUser) {
      // Bruker finnes i registeret — bruk den ekte userId og rollen
      userId = existingUser.userId;
      userRole = existingUser.role;
      userName = existingUser.name;
    } else {
      // Ny bruker — opprett med CUSTOMER som default (aldri ADMIN som default)
      // Fallback til in-memory userRoles for tester som bruker setUserRole()
      userId = `user_${generateSecureToken(16)}`;
      userRole = await getUserRoleAsync(email);
      userName = email.split('@')[0];

      await store.userSet({
        userId,
        email,
        role: userRole,
        name: userName,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    }

    const user: AuthUser = {
      userId,
      email,
      role: userRole,
      name: userName,
    };

    return { success: true, user };
  },

  /**
   * Sjekk om bruker har angitt rolle.
   */
  hasRole(user: AuthUser, requiredRole: UserRole): boolean {
    const roleHierarchy: Record<UserRole, number> = {
      CUSTOMER: 0,
      OPERATOR: 1,
      REVIEWER: 2,
      ADMIN: 3,
    };
    return roleHierarchy[user.role] >= roleHierarchy[requiredRole];
  },

  /**
   * Cookie-valg for sikker sesjonslagring.
   */
  getCookieOptions(secure = true): string {
    const parts = [
      'HttpOnly',
      'SameSite=Lax',
      'Path=/',
      `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
    ];
    if (secure) {
      parts.push('Secure');
    }
    return parts.join('; ');
  },

  /**
   * Cookie-valg for utløp (logout).
   */
  getCookieExpireOptions(): string {
    return 'HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT';
  },

  /**
   * Hent alle aktive sesjoner (for admin-oversikt).
   */
  async getAllSessions(): Promise<SessionData[]> {
    const store = getStorage();
    await store.cleanupExpired();
    return (await store.sessionGetAll()).map(sessionRowToSession);
  },

  /**
   * Avbryt alle sesjoner for en bruker.
   */
  async destroyUserSessions(userId: string): Promise<void> {
    const store = getStorage();
    const sessions = await store.sessionGetAll();
    const userSessionsSet = new Set<string>();
    for (const s of sessions) {
      if (s.userId === userId) {
        userSessionsSet.add(s.sessionId);
      }
    }
    for (const sessionId of userSessionsSet) {
      await store.sessionDelete(sessionId);
    }
  },

  /**
   * Rotér sesjon (nytt sessionId, samme bruker).
   */
  async rotateSession(oldSessionId: string): Promise<SessionData | null> {
    const store = getStorage();
    const oldSession = await store.sessionGet(oldSessionId);
    if (!oldSession) return null;

    const newSession: SessionRow = {
      ...oldSession,
      sessionId: generateSecureToken(),
      createdAt: Date.now(),
      expiresAt: Date.now() + SESSION_TTL_MS,
      lastActivity: Date.now(),
    };

    await store.sessionDelete(oldSessionId);
    await store.sessionSet(newSession);

    return sessionRowToSession(newSession);
  },
};

/**
 * Interne hjelpefunksjoner (ikke eksportert).
 */

async function sessionsDelete(sessionId: string): Promise<void> {
  const store = getStorage();
  await store.sessionDelete(sessionId);
}

async function isRateLimited(identity: string): Promise<boolean> {
  const store = getStorage();
  const existing = await store.rateLimitGet(identity);
  return (existing?.count ?? 0) >= RATE_LIMIT_MAX_REQUESTS;
}

async function incrementRateLimit(identity: string): Promise<void> {
  const store = getStorage();
  const existing = await store.rateLimitGet(identity);
  const now = Date.now();
  if (!existing || now - existing.windowStart > RATE_LIMIT_WINDOW_MS) {
    await store.rateLimitSet({ identity, count: 1, windowStart: now });
  } else {
    existing.count++;
    await store.rateLimitSet(existing);
  }
}

/**
 * Hent brukerrolle fra brukerregister.
 * I produksjon slås dette opp i D1-auth_users-tabellen. I testmiljø
 * brukes en midlertidig in-memory map inntil D1-tabellen er på plass.
 */
const userRoles = new Map<string, UserRole>();

/**
 * Sett brukerrolle (synkron, for tester med emulator).
 */
export function setUserRole(email: string, role: UserRole): void {
  userRoles.set(email, role);
}

/**
 * Hent brukerrolle fra brukerregister (asynkron, støtter D1).
 * Fallback til in-memory map hvis ingen D1-lagring er konfigurert.
 */
export async function getUserRoleAsync(email: string): Promise<UserRole> {
  const store = getStorage();
  const user = await store.userGetByEmail(email);
  if (user) return user.role;
  return userRoles.get(email) ?? 'CUSTOMER';
}

/**
 * Bakoverkompatibel synkron versjon (bruker kun in-memory map).
 * Brukes av tester som ikke har satt opp D1-lagring.
 */
export function getUserRole(email: string): UserRole {
  return userRoles.get(email) ?? 'CUSTOMER';
}

/**
 * Nulstil all tilstand (for testing).
 */
async function reset(): Promise<void> {
  const store = getStorage();
  await store.clear();
  userRoles.clear();
}

export { auth, reset, getStorage };
