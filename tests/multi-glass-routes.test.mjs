import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import worker from '../src/index.ts';

async function fixture({ includeMultiGlass = true } = {}) {
  const sqlite = new DatabaseSync(':memory:');
  for (const file of [
    'migrations/0017_beta_inquiries.sql', 'migrations/0018_beta_inquiries_ops.sql',
    ...(includeMultiGlass ? ['migrations/0035_inquiry_glass_request.sql', 'migrations/0036_glass_search_snapshots.sql'] : []),
  ]) sqlite.exec(await readFile(new URL(`../${file}`, import.meta.url), 'utf8'));
  sqlite.exec('CREATE TABLE regnr_logg(regnr TEXT, regnr_norm TEXT, ua TEXT); CREATE TABLE sok_logg(regnr TEXT, regnr_norm TEXT, ip TEXT, land TEXT, by TEXT, asn TEXT, ua TEXT);');
  sqlite.exec('CREATE TABLE case_sku_decisions(case_id TEXT, decision_type TEXT, sku TEXT, eurocode TEXT, reason TEXT, created_by TEXT, created_at TEXT);');
  const db = {
    prepare(sql) {
      return { bind(...args) {
        return {
          async first() { return sqlite.prepare(sql).get(...args) ?? null; },
          async all() { return { results: sqlite.prepare(sql).all(...args) }; },
          async run() { const result = sqlite.prepare(sql).run(...args); return { meta: { changes: result.changes, last_row_id: Number(result.lastInsertRowid) || 0 } }; },
        };
      } };
    },
    async batch(statements) {
      sqlite.exec('BEGIN IMMEDIATE');
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        try { sqlite.exec('ROLLBACK'); } catch {}
        throw error;
      }
    },
  };
  return { sqlite, db, env: { FINNBILGLASS_DB: db, ENVIRONMENT: 'staging', MULTI_GLASS_ENABLED: 'true', SUPPORT_EVIDENCE_TOKEN: 'test-token' } };
}
const post = (path, body, headers = {}) => new Request(`https://test.local${path}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
});

test('telefon og e-post lagres som to validerte kontaktmåter', async () => {
  const { sqlite, env } = await fixture();
  try {
    const body = { navn: 'Test Kunde', kontakt: 'qa@example.invalid', contactPreference: 'begge', contactPhone: '40408241', melding: 'Syntetisk test' };
    const response = await worker.fetch(post('/api/inquiry', body), env);
    assert.equal(response.status, 201);
    const stored = sqlite.prepare('SELECT kontakt, vehicle_json FROM beta_inquiries LIMIT 1').get();
    assert.equal(stored.kontakt, 'qa@example.invalid');
    assert.deepEqual(JSON.parse(stored.vehicle_json).customerContact, { preference: 'begge', phone: '40408241' });
    const invalid = await worker.fetch(post('/api/inquiry', { ...body, contactPhone: '' }), env);
    assert.equal(invalid.status, 400);
  } finally { sqlite.close(); }
});

test('lookupOnly skips resolver, returns no public prices, and rejects invalid lookupOnly values', async () => {
  const { sqlite, env } = await fixture();
  try {
    const prepared = [];
    const originalPrepare = env.FINNBILGLASS_DB.prepare;
    env.FINNBILGLASS_DB.prepare = function (sql) { prepared.push(sql); return originalPrepare.call(this, sql); };
    const response = await worker.fetch(post('/api/regnr', { regnr: 'AB12345', lookupOnly: true }), env);
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.ok, true);
    assert.equal(result.resolver, null);
    assert.equal(prepared.some(sql => sql.includes('feature_flags')), false);
    assert.equal(JSON.stringify(result).includes('pris'), false);
    const invalid = await worker.fetch(post('/api/regnr', { regnr: 'AB12345', lookupOnly: 'true' }), env);
    assert.equal(invalid.status, 400);
  } finally { sqlite.close(); }
});

test('new non-windshield inquiry persists selected position without front resolver and is idempotent', async () => {
  const { sqlite, env } = await fixture();
  try {
    let resolverReads = 0;
    const prepare = env.FINNBILGLASS_DB.prepare;
    env.FINNBILGLASS_DB.prepare = function (sql) { if (sql.includes('feature_flags')) resolverReads++; return prepare.call(this, sql); };
    const body = {
      regnr: 'AB12345', navn: 'Test Kunde', kontakt: 'test@example.no', melding: '',
      clientRequestId: 'client-request-0000001',
      glassRequest: { schemaVersion: 1, selection: { kind: 'door', side: 'left', door: 'rear' }, answers: {} },
    };
    const first = await worker.fetch(post('/api/inquiry', body), env);
    assert.equal(first.status, 201);
    const firstResult = await first.json();
    const second = await worker.fetch(post('/api/inquiry', body), env);
    assert.equal(second.status, 200);
    const secondResult = await second.json();
    assert.equal(secondResult.duplicate, true);
    assert.equal(secondResult.inquiryId, firstResult.inquiryId);
    assert.equal(resolverReads, 0);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM beta_inquiries').get().n, 1);
    const saved = JSON.parse(sqlite.prepare('SELECT glass_request_json FROM beta_inquiries').get().glass_request_json);
    assert.deepEqual(saved.selection, body.glassRequest.selection);
  } finally { sqlite.close(); }
});

test('windshield inquiry remains compatible with the deployed pre-multiglass D1 schema', async () => {
  const { sqlite, env } = await fixture({ includeMultiGlass: false });
  try {
    const response = await worker.fetch(post('/api/inquiry', {
      regnr: 'AB12345', navn: 'Frontrute kunde', kontakt: 'front@example.no', melding: 'Test',
    }), env);
    assert.equal(response.status, 201);
    const result = await response.json();
    assert.equal(result.ok, true);
    assert.equal(sqlite.prepare('SELECT regnr FROM beta_inquiries WHERE id = ?').get(result.inquiryId).regnr, 'AB12345');
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM beta_inquiry_events WHERE inquiry_id = ?').get(result.inquiryId).count, 1);
  } finally { sqlite.close(); }
});

test('front-only search and inquiry payload remain compatible with deployed D1 and operator reads', async () => {
  const { sqlite, env } = await fixture({ includeMultiGlass: false });
  try {
    env.MULTI_GLASS_ENABLED = 'false';
    const glassRequest = { schemaVersion: 1, selection: { kind: 'windshield' }, answers: {} };
    const search = await worker.fetch(post('/api/glass', { regnr: 'AB12345', glassRequest }), env);
    assert.equal(search.status, 200);
    const searchResult = await search.json();
    assert.equal(searchResult.canRequestQuote, true);
    assert.equal(searchResult.searchId, undefined);

    const response = await worker.fetch(post('/api/inquiry', {
      regnr: 'AB12345', navn: 'Frontrute kunde', kontakt: 'front@example.no', melding: 'Test',
      glassRequest, clientRequestId: 'front-only-request-0001',
    }), env);
    assert.equal(response.status, 201);
    const { inquiryId } = await response.json();
    assert.equal(sqlite.prepare('SELECT regnr FROM beta_inquiries WHERE id = ?').get(inquiryId).regnr, 'AB12345');

    const auth = { Authorization: 'Bearer test-token' };
    const list = await worker.fetch(new Request('https://test.local/api/ops/inquiries', { headers: auth }), env);
    assert.equal(list.status, 200);
    assert.equal((await list.json()).inquiries[0].id, inquiryId);
    const detail = await worker.fetch(new Request(`https://test.local/api/ops/inquiries/${inquiryId}`, { headers: auth }), env);
    assert.equal(detail.status, 200);
    assert.equal((await detail.json()).inquiry.glass_request_json, null);
    const caseDetail = await worker.fetch(new Request(`https://test.local/api/ops/saker/inquiry-${inquiryId}`, { headers: auth }), env);
    assert.equal(caseDetail.status, 200);
    const caseResult = await caseDetail.json();
    assert.equal(caseResult.sak.glassRequest.selection.kind, 'windshield');
  } finally { sqlite.close(); }
});

test('expired snapshot returns 409; non-windshield operator approval returns 409', async () => {
  const { sqlite, env } = await fixture();
  try {
    const glassRequest = { schemaVersion: 1, selection: { kind: 'rear', layout: 'single' }, answers: {}, searchId: '0123456789abcdef0123456789abcdef' };
    sqlite.prepare(`INSERT INTO glass_search_snapshots(search_id,regnr_norm,request_fingerprint,glass_request_json,vehicle_json,candidate_ids_json,catalog_version,created_at,expires_at)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(glassRequest.searchId, 'AB12345', 'bad-fingerprint', JSON.stringify(glassRequest), '{}', '[]', 'test', Date.now() - 60000, Date.now() - 1);
    const expired = await worker.fetch(post('/api/inquiry', { regnr: 'AB12345', navn: 'Test Kunde', kontakt: 'test@example.no', glassRequest }), env);
    assert.equal(expired.status, 409);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM beta_inquiries').get().n, 0);

    sqlite.prepare(`INSERT INTO beta_inquiries(navn,kontakt,regnr,status,glass_request_json) VALUES(?,?,?,?,?)`)
      .run('Test Kunde', 'test@example.no', 'AB12345', 'NEW', JSON.stringify({ kind: 'rear', selection: { kind: 'rear', layout: 'single' } }));
    const decision = await worker.fetch(post('/api/ops/decision', {
      inquiry_id: 1, decision: 'approve_sku', sku: 'SKU-1', actor: 'Tester', reason: 'Manuell kontroll utført',
    }, { Authorization: 'Bearer test-token' }), env);
    assert.equal(decision.status, 409);
  } finally { sqlite.close(); }
});

test('unknown vehicle/type uses the explicit manual search response without prices', async () => {
  const { sqlite, env } = await fixture();
  try {
    const response = await worker.fetch(post('/api/glass', {
      regnr: 'AB12345', glassRequest: { schemaVersion: 1, selection: { kind: 'roof', system: 'fixed', panel: 'front' }, answers: {} },
    }), env);
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.status, 'MANUAL_REVIEW');
    assert.equal(result.canRequestQuote, true);
    assert.deepEqual(result.candidates, []);
    assert.equal(JSON.stringify(result).includes('pris'), false);
  } finally { sqlite.close(); }
});


test('paused categories are rejected before database access by default and when disabled', async () => {
  const selections = [
    { kind: 'door', side: 'left', door: 'front' },
    { kind: 'side', side: 'left', section: 'rear_quarter', mounting: 'body' },
    { kind: 'rear', layout: 'single' },
    { kind: 'roof', system: 'fixed', panel: 'whole' },
    { kind: 'unknown' },
  ];
  for (const flag of [undefined, 'false']) {
    const env = { MULTI_GLASS_ENABLED: flag, FINNBILGLASS_DB: { prepare() { throw new Error('No database access expected'); } } };
    for (const selection of selections) {
      for (const path of ['/api/glass', '/api/inquiry']) {
        const response = await worker.fetch(post(path, {
          regnr: 'AB12345', glassRequest: { schemaVersion: 1, selection, answers: {} },
        }), env);
        assert.equal(response.status, 409);
        assert.equal((await response.json()).code, 'GLASS_TYPE_UNAVAILABLE');
      }
    }
  }
});
