/**
 * Ekte SQLite-verifisering av rolleoppdatering og transaksjonell session-revoke.
 * Kjør: node --import tsx --test tests/auth-role-sqlite.test.mjs
 * Ingen nettverk, ingen endringer i staging eller produksjon.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { D1AuthStorage } from '../src/auth-storage.ts';

function fixture({ failDelete = false } = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(readFileSync(new URL('../migrations/pending/0039_auth_tables.sql', import.meta.url), 'utf8'));
  db.exec(readFileSync(new URL('../migrations/0043_auth_google_sub.sql', import.meta.url), 'utf8'));
  db.exec(readFileSync(new URL('../migrations/0044_social_login.sql', import.meta.url), 'utf8'));

  const insertUser = db.prepare(`INSERT INTO auth_users
    (user_id,email,role,name,created_at,updated_at,google_sub,microsoft_sub,facebook_sub)
    VALUES (?,?,?,?,?,?,?,?,?)`);
  insertUser.run('u_target', 'ansatt@example.test', 'OPERATOR', 'Faste Navn', 101, 102, 'google-123', 'ms-456', 'fb-789');
  insertUser.run('u_other', 'annen@example.test', 'REVIEWER', 'Annen Bruker', 111, 112, null, null, null);
  const insertSession = db.prepare(`INSERT INTO auth_sessions
    (session_id,user_id,email,role,name,created_at,expires_at,last_activity)
    VALUES (?,?,?,?,?,?,?,?)`);
  insertSession.run('ses-1', 'u_target', 'ansatt@example.test', 'OPERATOR', 'Faste Navn', 1000, 9999999999999, 1000);
  insertSession.run('ses-2', 'u_target', 'ansatt@example.test', 'OPERATOR', 'Faste Navn', 1000, 9999999999999, 1000);
  insertSession.run('ses-other', 'u_other', 'annen@example.test', 'REVIEWER', 'Annen Bruker', 1000, 9999999999999, 1000);

  const prepared = (sql, args = []) => ({
    bind(...values) { return prepared(sql, values); },
    async first() { return db.prepare(sql).get(...args) ?? null; },
    async run() { return this.execute(); },
    execute() {
      if (failDelete && /^DELETE FROM auth_sessions WHERE user_id = \?$/i.test(sql)) {
        throw new Error('SIMULATED_SESSION_DELETE_FAILURE');
      }
      const result = db.prepare(sql).run(...args);
      return { success: true, meta: { changes: Number(result.changes) }, results: [] };
    }
  });
  const d1 = {
    prepare(sql) { return prepared(sql); },
    async batch(statements) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const results = statements.map((stmt) => stmt.execute());
        db.exec('COMMIT');
        return results;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    }
  };
  return { db, storage: new D1AuthStorage(d1) };
}

test('SQLITE: oppdater rolle uten å slette identitet, sosiale koblinger eller andre brukeres sesjoner', async () => {
  const { db, storage } = fixture();
  try {
    assert.equal(await storage.userUpdateRoleAndRevoke('u_target', 'ADMIN', 999), true);
    const updated = db.prepare('SELECT * FROM auth_users WHERE user_id = ?').get('u_target');
    assert.equal(updated.email, 'ansatt@example.test');
    assert.equal(updated.name, 'Faste Navn');
    assert.equal(updated.created_at, 101);
    assert.equal(updated.updated_at, 999);
    assert.equal(updated.role, 'ADMIN');
    assert.equal(updated.google_sub, 'google-123');
    assert.equal(updated.microsoft_sub, 'ms-456');
    assert.equal(updated.facebook_sub, 'fb-789');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM auth_users').get().n, 2);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM auth_sessions WHERE user_id = ?').get('u_target').n, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM auth_sessions WHERE user_id = ?').get('u_other').n, 1);
    assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);
  } finally { db.close(); }
});

test('SQLITE: ukjent bruker endres ikke, opprettes ikke og kan ikke få ny rolle', async () => {
  const { db, storage } = fixture();
  try {
    assert.equal(await storage.userUpdateRoleAndRevoke('missing', 'ADMIN', 999), false);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM auth_users').get().n, 2);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM auth_sessions').get().n, 3);
  } finally { db.close(); }
});

test('SQLITE: feil ved sesjonssletting ruller hele rolleendringen tilbake', async () => {
  const { db, storage } = fixture({ failDelete: true });
  try {
    await assert.rejects(
      storage.userUpdateRoleAndRevoke('u_target', 'ADMIN', 999),
      /SIMULATED_SESSION_DELETE_FAILURE/
    );
    const row = db.prepare('SELECT role,updated_at FROM auth_users WHERE user_id = ?').get('u_target');
    assert.equal(row.role, 'OPERATOR');
    assert.equal(row.updated_at, 102);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM auth_sessions WHERE user_id = ?').get('u_target').n, 2);
    assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);
  } finally { db.close(); }
});
