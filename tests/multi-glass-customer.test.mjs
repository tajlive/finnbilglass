import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { persistInquiry } from '../src/inquiry-glass-request.ts';
import { glassRequestFingerprint } from '../src/glass-search.ts';
import { parseGlassRequest } from '../src/glass-selection.ts';

const root = new URL('../', import.meta.url);
async function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  for (const file of ['migrations/0017_beta_inquiries.sql', 'migrations/0018_beta_inquiries_ops.sql', 'migrations/0035_inquiry_glass_request.sql', 'migrations/0036_glass_search_snapshots.sql']) {
    sqlite.exec(await readFile(new URL(file, root), 'utf8'));
  }
  const db = {
    prepare(sql) {
      return { bind(...args) { return {
        async first() { return sqlite.prepare(sql).get(...args) ?? null; },
        async all() { return { results: sqlite.prepare(sql).all(...args) }; },
        async run() { const r = sqlite.prepare(sql).run(...args); return { meta: { changes: r.changes, last_row_id: Number(r.lastInsertRowid) || 0 } }; },
      }; } };
    },
    async batch(statements) {
      sqlite.exec('BEGIN IMMEDIATE');
      try { const out = []; for (const s of statements) out.push(await s.run()); sqlite.exec('COMMIT'); return out; }
      catch (e) { try { sqlite.exec('ROLLBACK'); } catch {} throw e; }
    },
  };
  return { sqlite, db };
}
const selection = parseGlassRequest({ schemaVersion: 1, selection: { kind: 'door', side: 'left', door: 'rear' }, answers: {} });

test('SQLite migration and idempotent inquiry retry preserve exact glass request', async () => {
  const { sqlite, db } = await fixture();
  try {
    const input = { regnr: 'AB12345', name: 'Test Kunde', contact: 'kunde@example.no', message: '', sessionId: 'session', glassRequest: selection, clientRequestId: 'request-id-0000001', vehicleJson: '{"glassSearch":{"manual":true}}' };
    const first = await persistInquiry(db, input);
    const duplicate = await persistInquiry(db, input);
    assert.equal(first.created, true);
    assert.equal(duplicate.id, first.id);
    assert.equal(duplicate.created, false);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM beta_inquiries').get().n, 1);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM beta_inquiry_events').get().n, 1);
    assert.equal(JSON.parse(sqlite.prepare('SELECT glass_request_json FROM beta_inquiries').get().glass_request_json).selection.door, 'rear');
    assert.equal((await persistInquiry(db, { ...input, message: 'changed' })).conflict, true);
  } finally { sqlite.close(); }
});

test('snapshot request fingerprint binds regnr, location, and answers and expiry is explicit', async () => {
  const { sqlite, db } = await fixture();
  try {
    const fingerprint = await glassRequestFingerprint('AB12345', selection);
    const searchId = '0123456789abcdef0123456789abcdef';
    sqlite.prepare(`INSERT INTO glass_search_snapshots(search_id,regnr_norm,request_fingerprint,glass_request_json,vehicle_json,candidate_ids_json,catalog_version,created_at,expires_at) VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(searchId, 'AB12345', fingerprint, JSON.stringify(selection), '{}', '[]', 'test-v1', Date.now(), Date.now() - 1);
    const snapshot = sqlite.prepare('SELECT expires_at,request_fingerprint FROM glass_search_snapshots WHERE search_id=?').get(searchId);
    assert.ok(snapshot.expires_at <= Date.now());
    assert.equal(snapshot.request_fingerprint, fingerprint);
    assert.notEqual(await glassRequestFingerprint('AB99999', selection), fingerprint);
    assert.notEqual(await glassRequestFingerprint('AB12345', { ...selection, selection: { kind: 'door', side: 'right', door: 'rear' } }), fingerprint);
  } finally { sqlite.close(); }
});
