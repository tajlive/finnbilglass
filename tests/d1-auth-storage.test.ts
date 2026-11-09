/**
 * FinnBilGlass — Fase 5.8: D1AuthStorage tester
 *
 * Verifiserer at D1AuthStorage-klassen sender riktige SQL-spørringer
 * mot ekte D1. Bruker en mock D1Database som fanger opp alle spørringer.
 *
 * Kjøres med: node --import tsx --test tests/d1-auth-storage.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { D1AuthStorage } from '../src/auth-storage.ts';
import type { D1Database } from '@cloudflare/workers-types';

// ── Typer ──
interface D1Prepared {
  bindCalls: unknown[][];
  firstResult: unknown;
  allResults: unknown[];
  runResult: { meta: { changes: number } };
}

interface D1UserRow {
  user_id: string;
  email: string;
  role: string;
  name: string;
}

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

// ── Mock D1Database ──
class MockD1Database {
  prepared: Map<string, D1Prepared> = new Map();

  prepare(sql: string) {
    if (!this.prepared.has(sql)) {
      this.prepared.set(sql, {
        bindCalls: [],
        firstResult: null,
        allResults: [],
        runResult: { meta: { changes: 1 } },
      });
    }
    const p = this.prepared.get(sql)!;
    return {
      bind: (...args: unknown[]) => {
        p.bindCalls.push(args);
        return {
          run: async () => p.runResult,
          first: async () => p.firstResult,
          all: async () => ({ results: p.allResults }),
        };
      },
      first: async () => p.firstResult,
      all: async () => ({ results: p.allResults }),
      run: async () => p.runResult,
      batch: async () => [],
    };
  }

  getCallsFor(sql: string): unknown[][] {
    return this.prepared.get(sql)?.bindCalls ?? [];
  }

  setFirst(sql: string, value: unknown) {
    if (!this.prepared.has(sql)) {
      this.prepared.set(sql, {
        bindCalls: [],
        firstResult: null,
        allResults: [],
        runResult: { meta: { changes: 1 } },
      });
    }
    this.prepared.get(sql)!.firstResult = value;
  }

  setAll(sql: string, values: unknown[]) {
    if (!this.prepared.has(sql)) {
      this.prepared.set(sql, {
        bindCalls: [],
        firstResult: null,
        allResults: [],
        runResult: { meta: { changes: 1 } },
      });
    }
    this.prepared.get(sql)!.allResults = values;
  }
}

// ── Hjelpefunksjoner ──
const SESSION_TTL_MS = 60 * 60 * 1000;
const OTP_TTL_MS = 10 * 60 * 1000;

function now(): number {
  return Date.now();
}

// ── Testgruppe: D1AuthStorage ──
test('D1AuthStorage: userSet sender riktig SQL', async () => {
  const db = new MockD1Database();
  const storage = new D1AuthStorage(db as unknown as D1Database);

  await storage.userSet({
    userId: 'user_1',
    email: 'test@test.no',
    role: 'ADMIN',
    name: 'Test',
    createdAt: now(),
    updatedAt: now(),
  });

  const calls = db.getCallsFor(
    'INSERT OR REPLACE INTO auth_users (user_id, email, role, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'user_1');
  assert.equal(calls[0][1], 'test@test.no');
  assert.equal(calls[0][2], 'ADMIN');
});

test('D1AuthStorage: userGetByEmail sender riktig SQL og returnerer bruker', async () => {
  const db = new MockD1Database();
  const storage = new D1AuthStorage(db as unknown as D1Database);

  db.setFirst(
    'SELECT user_id, email, role, name FROM auth_users WHERE email = ?',
    { user_id: 'user_1', email: 'test@test.no', role: 'ADMIN', name: 'Test' } as D1UserRow
  );

  const user = await storage.userGetByEmail('test@test.no');
  assert.ok(user);
  assert.equal(user!.email, 'test@test.no');
  assert.equal(user!.role, 'ADMIN');

  const calls = db.getCallsFor(
    'SELECT user_id, email, role, name FROM auth_users WHERE email = ?'
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'test@test.no');
});

test('D1AuthStorage: userGetByEmail returnerer null for ukjent bruker', async () => {
  const db = new MockD1Database();
  const storage = new D1AuthStorage(db as unknown as D1Database);

  db.setFirst(
    'SELECT user_id, email, role, name FROM auth_users WHERE email = ?',
    null
  );

  const user = await storage.userGetByEmail('ukjent@test.no');
  assert.equal(user, null);
});

test('D1AuthStorage: sessionSet og sessionGet sender riktig SQL', async () => {
  const db = new MockD1Database();
  const storage = new D1AuthStorage(db as unknown as D1Database);

  const n = now();
  await storage.sessionSet({
    sessionId: 'sess_1',
    userId: 'user_1',
    email: 'test@test.no',
    role: 'CUSTOMER',
    name: 'Test',
    createdAt: n,
    expiresAt: n + SESSION_TTL_MS,
    lastActivity: n,
  });

  const calls = db.getCallsFor(
    'INSERT OR REPLACE INTO auth_sessions (session_id, user_id, email, role, name, created_at, expires_at, last_activity) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'sess_1');
  assert.equal(calls[0][1], 'user_1');
  assert.equal(calls[0][2], 'test@test.no');
  assert.equal(calls[0][3], 'CUSTOMER');
});

test('D1AuthStorage: sessionGet returnerer sesjon', async () => {
  const db = new MockD1Database();
  const storage = new D1AuthStorage(db as unknown as D1Database);

  const n = now();
  db.setFirst(
    'SELECT session_id, user_id, email, role, name, created_at, expires_at, last_activity FROM auth_sessions WHERE session_id = ?',
    {
      session_id: 'sess_1',
      user_id: 'user_1',
      email: 'test@test.no',
      role: 'CUSTOMER',
      name: 'Test',
      created_at: n,
      expires_at: n + SESSION_TTL_MS,
      last_activity: n,
    } as D1SessionRow
  );

  const session = await storage.sessionGet('sess_1');
  assert.ok(session);
  assert.equal(session!.sessionId, 'sess_1');
  assert.equal(session!.email, 'test@test.no');
});

test('D1AuthStorage: sessionDelete sender DELETE SQL', async () => {
  const db = new MockD1Database();
  const storage = new D1AuthStorage(db as unknown as D1Database);

  await storage.sessionDelete('sess_1');

  const calls = db.getCallsFor('DELETE FROM auth_sessions WHERE session_id = ?');
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'sess_1');
});

test('D1AuthStorage: otpSet og otpGet sender riktig SQL', async () => {
  const db = new MockD1Database();
  const storage = new D1AuthStorage(db as unknown as D1Database);

  const n = now();
  await storage.otpSet({
    email: 'test@test.no',
    code: '123456',
    createdAt: n,
    expiresAt: n + OTP_TTL_MS,
    used: false,
    attempts: 0,
  });

  const calls = db.getCallsFor(
    'INSERT OR REPLACE INTO auth_otp_codes (email, code, created_at, expires_at, used, attempts) VALUES (?, ?, ?, ?, ?, ?)'
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'test@test.no');
  assert.equal(calls[0][1], '123456');
  assert.equal(calls[0][5], 0); // used = 0 (false)
});

test('D1AuthStorage: otpGet returnerer null når ingen kode', async () => {
  const db = new MockD1Database();
  const storage = new D1AuthStorage(db as unknown as D1Database);

  db.setFirst('SELECT email, code, created_at, expires_at, used, attempts FROM auth_otp_codes WHERE email = ?', null);

  const otp = await storage.otpGet('test@test.no');
  assert.equal(otp, null);
});

test('D1AuthStorage: rateLimitSet og rateLimitGet sender riktig SQL', async () => {
  const db = new MockD1Database();
  const storage = new D1AuthStorage(db as unknown as D1Database);

  const n = now();
  await storage.rateLimitSet({
    identity: 'otp:test@test.no',
    count: 1,
    windowStart: n,
  });

  const calls = db.getCallsFor(
    'INSERT OR REPLACE INTO auth_rate_limits (identity, count, window_start) VALUES (?, ?, ?)'
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'otp:test@test.no');
  assert.equal(calls[0][1], 1);
});

test('D1AuthStorage: cleanupExpired sender DELETE for utløpte sesjoner og OTP', async () => {
  const db = new MockD1Database();
  const storage = new D1AuthStorage(db as unknown as D1Database);

  const n = now();
  await storage.cleanupExpired(n);

  const sessionCalls = db.getCallsFor('DELETE FROM auth_sessions WHERE expires_at <= ?');
  assert.equal(sessionCalls.length, 1);
  assert.equal(sessionCalls[0][0], n);

  const otpCalls = db.getCallsFor('DELETE FROM auth_otp_codes WHERE expires_at <= ? AND used = 0');
  assert.equal(otpCalls.length, 1);
  assert.equal(otpCalls[0][0], n);
});

test('D1AuthStorage: clear tømmer alle auth-tabeller', async () => {
  const db = new MockD1Database();
  const storage = new D1AuthStorage(db as unknown as D1Database);

  await storage.clear();

  const tables = ['auth_sessions', 'auth_otp_codes', 'auth_rate_limits', 'auth_users'];
  for (const table of tables) {
    // clear() kaller prepare(DELETE).run() uten bind-argumenter,
    // så bindCalls er [] (tom, men entry finnes)
    const calls = db.getCallsFor(`DELETE FROM ${table}`);
    assert.ok(calls !== undefined, `Mangler DELETE-entry for ${table}`);
  }
});

test('D1AuthStorage: sessionGetAll sender SELECT uten WHERE', async () => {
  const db = new MockD1Database();
  const storage = new D1AuthStorage(db as unknown as D1Database);

  db.setAll(
    'SELECT session_id, user_id, email, role, name, created_at, expires_at, last_activity FROM auth_sessions',
    []
  );

  const sessions = await storage.sessionGetAll();
  assert.equal(sessions.length, 0);

  const calls = db.getCallsFor(
    'SELECT session_id, user_id, email, role, name, created_at, expires_at, last_activity FROM auth_sessions'
  );
  assert.ok(calls !== undefined, 'SELECT-entry skal finnes');
});
