import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import worker from '../src/index.ts';
import { resolveFrontrute } from '../src/vin-resolver.ts';

async function fixture({ includeMultiGlass = true } = {}) {
  const sqlite = new DatabaseSync(':memory:');
  for (const file of [
    'migrations/0001_resolver_tables.sql', 'migrations/0005_feature_flags.sql',
    'migrations/0017_beta_inquiries.sql', 'migrations/0018_beta_inquiries_ops.sql',
    ...(includeMultiGlass ? ['migrations/0035_inquiry_glass_request.sql', 'migrations/0036_glass_search_snapshots.sql'] : []),
  ]) sqlite.exec(await readFile(new URL(`../${file}`, import.meta.url), 'utf8'));
  sqlite.exec('CREATE TABLE glass_prisliste(varenr TEXT, varenavn TEXT, pris REAL, eurokode TEXT, rad_type TEXT);');
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

test('manual windshield inquiry without plate or VIN stores customer vehicle unverified and unchanged message', async () => {
  const { sqlite, env } = await fixture({ includeMultiGlass: false });
  try {
    const message = '  Uten skilt/VIN – frontrute. Bilmerke: Volvo; modell: V70; anslått årsmodell: 2008; detaljer: kamera  \n';
    const response = await worker.fetch(post('/api/inquiry', {
      regnr: '', navn: 'Manuell Kunde', kontakt: 'manual@example.no', melding: message,
      manualVehicle: { make: 'Volvo', model: 'V70', year: '2008' },
    }), env);
    assert.equal(response.status, 201);
    const { inquiryId } = await response.json();
    const saved = sqlite.prepare('SELECT regnr, melding, vehicle_json FROM beta_inquiries WHERE id = ?').get(inquiryId);
    assert.equal(saved.regnr, null);
    assert.equal(saved.melding, message);
    assert.deepEqual(JSON.parse(saved.vehicle_json), {
      customerVehicle: { make: 'Volvo', model: 'V70', year: '2008', source: 'customer', verified: false },
      requiresManualReview: true,
    });
    assert.equal(JSON.stringify(JSON.parse(saved.vehicle_json)).includes('resolver'), false);
    const unauthorised = await worker.fetch(new Request(`https://test.local/api/ops/inquiries/${inquiryId}`), env);
    assert.equal(unauthorised.status, 401);
    const auth = { Authorization: 'Bearer test-token' };
    const detail = await worker.fetch(new Request(`https://test.local/api/ops/inquiries/${inquiryId}`, { headers: auth }), env);
    assert.equal(detail.status, 200);
    assert.deepEqual((await detail.json()).inquiry.vehicle.customerVehicle, JSON.parse(saved.vehicle_json).customerVehicle);
    const list = await worker.fetch(new Request('https://test.local/api/ops/inquiries', { headers: auth }), env);
    assert.equal(list.status, 200);
    assert.equal(JSON.parse((await list.json()).inquiries[0].vehicle_json).requiresManualReview, true);
  } finally { sqlite.close(); }
});

test('manual vehicle inquiry rejects malformed fields and retains registration lookup', async () => {
  const { sqlite, env } = await fixture({ includeMultiGlass: false });
  try {
    const base = { regnr: '', navn: 'Manuell Kunde', kontakt: 'manual@example.no', melding: 'Forespørsel', manualVehicle: { make: 'Volvo', model: 'V70', year: '2008' } };
    for (const manualVehicle of [
      { make: 'V', model: 'V70', year: '2008' },
      { make: 'Volvo', model: '', year: '2008' },
      { make: 'Volvo', model: 'V70', year: '1899' },
      { make: 'Volvo', model: 'V70', year: String(new Date().getFullYear() + 2) },
      { make: 'Volvo', model: 'V70', year: '2008', vin: 'WVWZZZ' },
      { make: 'Volvo\u0000', model: 'V70', year: '2008' },
    ]) {
      const response = await worker.fetch(post('/api/inquiry', { ...base, manualVehicle }), env);
      assert.equal(response.status, 400, JSON.stringify(manualVehicle));
    }
    const glassChoice = await worker.fetch(post('/api/inquiry', {
      ...base,
      glassRequest: { schemaVersion: 1, selection: { kind: 'windshield' }, answers: {} },
    }), env);
    assert.equal(glassChoice.status, 400);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM beta_inquiries').get().n, 0);
    const lookup = await worker.fetch(post('/api/regnr', { regnr: 'AB12345', lookupOnly: true }), env);
    assert.equal(lookup.status, 200);
    assert.equal((await lookup.json()).ok, true);
    assert.equal(sqlite.prepare('SELECT regnr_norm FROM regnr_logg').get().regnr_norm, 'AB12345');
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

// Release A HTTP contract: route responses, not only DTO projections.
const forbidden = /INTERNAL-SKU-TEST|INTERNAL-EURO-TEST|supplierPrice|purchasePrice|partNumber|candidateId|varenr|eurokode/i;
async function publicBody(response) {
  const body = await response.json();
  assert.doesNotMatch(JSON.stringify(body), forbidden);
  return body;
}
test('Release A /api/glass returns manual inquiry with no product for a synthetic plate', async () => {
  const { sqlite, env } = await fixture({ includeMultiGlass: false });
  try {
    env.MULTI_GLASS_ENABLED = 'false';
    const response = await worker.fetch(post('/api/glass', { regnr: 'AB12345', glassRequest: { schemaVersion: 1, selection: { kind: 'windshield' }, answers: {} } }), env);
    assert.equal(response.status, 200);
    const body = await publicBody(response);
    assert.equal(body.status, 'MANUAL_REVIEW');
    assert.deepEqual(body.candidates, []);
    assert.equal(body.canRequestQuote, true);
  } finally { sqlite.close(); }
});
test('Release A registration and VIN routes return no product without external lookup', async () => {
  const { sqlite, env } = await fixture({ includeMultiGlass: false });
  try {
    env.MULTI_GLASS_ENABLED = 'false';
    for (const [path, body] of [['/api/regnr', { regnr: 'AB12345' }], ['/api/vin', { vin: 'WVWZZZ1JZXW000001' }]]) {
      const response = await worker.fetch(post(path, body), env);
      assert.equal(response.status, 200);
      const data = await publicBody(response);
      assert.equal(data.resolver, null);
    }
  } finally { sqlite.close(); }
});
test('Release A inquiry ignores forged product preferences and keeps manual vehicle unverified', async () => {
  const { sqlite, env } = await fixture({ includeMultiGlass: false });
  try {
    env.MULTI_GLASS_ENABLED = 'false';
    for (const extra of [{}, { preferredCandidate: { partNumber: 'INTERNAL-SKU-TEST', eurocode: 'INTERNAL-EURO-TEST' }, partNumber: 'INTERNAL-SKU-TEST' }]) {
      const response = await worker.fetch(post('/api/inquiry', { regnr: '', navn: 'Syntetisk Kunde', kontakt: 'synthetic@example.invalid', manualVehicle: { make: 'Volvo', model: 'V70', year: '2008' }, ...extra }), env);
      assert.equal(response.status, 201);
      await publicBody(response);
    }
    const rows = sqlite.prepare('SELECT vehicle_json FROM beta_inquiries ORDER BY id').all();
    assert.equal(rows.length, 2);
    for (const row of rows) {
      const vehicle = JSON.parse(row.vehicle_json);
      assert.equal(vehicle.customerVehicle.verified, false);
      assert.equal(vehicle.requiresManualReview, true);
      assert.equal(vehicle.customerPreference, undefined);
      assert.doesNotMatch(row.vehicle_json, /INTERNAL-SKU-TEST|INTERNAL-EURO-TEST/);
    }
  } finally { sqlite.close(); }
});
test('Release A malformed photo and search requests return no internal reference', async () => {
  const { sqlite, env } = await fixture({ includeMultiGlass: false });
  try {
    env.MULTI_GLASS_ENABLED = 'false';
    for (const [path, body] of [['/api/les-skilt', { image: 'invalid' }], ['/api/glass', { regnr: 'invalid' }], ['/api/frontrute', {}]]) {
      const response = await worker.fetch(post(path, body), env);
      assert.ok(response.status >= 400);
      await publicBody(response);
    }
  } finally { sqlite.close(); }
});
test('Release A valid frontrute route hides zero, one and multiple internal candidates', async () => {
  for (const count of [0, 1, 2]) {
    const { sqlite, env } = await fixture({ includeMultiGlass: false });
    try {
      for (let i = 0; i < count; i++) {
        const sku = `INTERNAL-SKU-TEST-${i}`;
        const euro = `1234GN${i}`;
        sqlite.prepare('INSERT INTO ground_truth(make,model,year,frontrute_eurocode) VALUES(?,?,?,?)').run('SYNTHETIC', 'MODEL', 2020, sku);
        sqlite.prepare('INSERT INTO glass_prisliste(varenr,varenavn,pris,eurokode,rad_type) VALUES(?,?,?,?,?)').run(sku, 'SYNTHETIC MODEL FRONTRUTE', 9000, euro, 'glass');
      }
      const internal = await resolveFrontrute(env, { merke: 'SYNTHETIC', modell: 'MODEL', aar: 2020 });
      assert.equal((internal.kandidater ?? []).length, count, 'resolver must see seeded internal candidates');
      const response = await worker.fetch(post('/api/frontrute', { merke: 'SYNTHETIC', modell: 'MODEL', aar: 2020 }), env);
      assert.equal(response.status, 200);
      const body = await publicBody(response);
      assert.deepEqual(body.kandidater, []);
      assert.equal(body.pinpoint, false);
      assert.equal(body.anbefaling, null);
      assert.doesNotMatch(JSON.stringify(body), /INTERNAL-SKU-TEST|1234GN/);
    } finally { sqlite.close(); }
  }
});
const syntheticPlatePng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAPAAAABBCAIAAABgob4VAAABHUlEQVR42u3byRHEIAwAQfJPGsfgQkgCet5efNAvFTuGJKl1Uzo8oAW0BLQEtAS0gAZaQEtAS0BLQAtoCWgJaKkl6MDTfFXnBFeW2vfMaSvvu7hkQ4EGGmiggQYaaKCBBhpooIEGGmigHwUduP1pK//67jUT09D7Bn7nfRd3mUMDDTTQQAMNNNBAAw000EADDTTQQF8JOnDWeOIceuUVqla+bweBBhpooIEGGmiggQYaaKCBBhpooIG+YQ7d5LdHTLjTXtDxUaCBBhpooIEGGmiggQYaaKCBBhroM0Cb6ZbPdGfiv763PDDQQAMNNNBAAw000EADDTTQQAMN9Dugpc4BLaAloCWgJaAFNNACWgJaAloCWkBLN4GWJLXrA53e5T6Tr2X6AAAAAElFTkSuQmCC';

test('Release A recognized plate photo hides 0, 1 and 2 internal candidates', async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const count of [0, 1, 2]) {
      const { sqlite, env } = await fixture({ includeMultiGlass: false });
      try {
        env.MULTI_GLASS_ENABLED = 'false';
        env.SVV_API_KEY = 'synthetic-key';
        let ocrCalls = 0, svvCalls = 0, resolverReads = 0;

        env.AI = {
          async run() {
            ocrCalls++;
            return { response: 'AB12345' };
          }
        };

        for (let i = 0; i < count; i++) {
          const sku = `INTERNAL-SKU-TEST-${i}`;
          sqlite.prepare(
            'INSERT INTO ground_truth(make,model,year,frontrute_eurocode) VALUES(?,?,?,?)'
          ).run('SYNTHETIC','MODEL',2020,sku);
          sqlite.prepare(
            'INSERT INTO glass_prisliste(varenr,varenavn,pris,eurokode,rad_type) VALUES(?,?,?,?,?)'
          ).run(sku,'SYNTHETIC MODEL FRONTRUTE',9000,`1234GN${i}`,'glass');
        }

        const internal = await resolveFrontrute(env, {
          merke:'SYNTHETIC', modell:'MODEL', aar:2020
        });
        assert.equal((internal.kandidater ?? []).length, count);

        const prepare = env.FINNBILGLASS_DB.prepare;
        env.FINNBILGLASS_DB.prepare = function (sql) {
          if (/ground_truth|glass_prisliste/i.test(sql)) resolverReads++;
          return prepare.call(this, sql);
        };

        globalThis.fetch = async (input, options) => {
          const url = new URL(typeof input === 'string' ? input : input.url);
          assert.equal(url.origin, 'https://akfell-datautlevering.atlas.vegvesen.no');
          assert.equal(url.searchParams.get('kjennemerke'), 'AB12345');
          assert.equal(options?.headers?.['SVV-Authorization'], 'Apikey synthetic-key');
          svvCalls++;
          return new Response(JSON.stringify({
            kjoretoydataListe: [{
              forstegangsregistrering: {
                registrertForstegangNorgeDato:'2020-06-15'
              },
              registrering: {
                registreringsstatus:{kodeVerdi:'REGISTRERT'}
              },
              godkjenning: {
                tekniskGodkjenning: {
                  tekniskeData: {
                    generelt: {
                      merke:[{merke:'SYNTHETIC'}],
                      handelsbetegnelse:['MODEL']
                    }
                  }
                },
                forstegangsGodkjenning: {
                  forstegangRegistrertDato:'2020-06-15'
                }
              }
            }]
          }), {
            status:200,
            headers:{'Content-Type':'application/json'}
          });
        };

        const response = await worker.fetch(
          post('/api/les-skilt',{image:syntheticPlatePng}),env
        );
        assert.equal(response.status,200);
        const body = await publicBody(response);

        assert.equal(ocrCalls,1);
        assert.equal(svvCalls,1);
        assert.ok(resolverReads > 0,'internal resolver must run');
        assert.equal(body.funnet,true);
        assert.equal(body.regnr,'AB12345');
        assert.equal(body.bil?.merke,'SYNTHETIC');
        assert.deepEqual(body.resolver?.kandidater ?? [],[]);
        assert.notEqual(body.resolver?.utfall,'EXACT');
        assert.doesNotMatch(
          JSON.stringify(body),
          /INTERNAL-SKU-TEST|1234GN|9000|ORDER_CONFIRMED/
        );
      } finally {
        sqlite.close();
      }
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});
test('Release A unresolved plate-photo OCR returns conservative error', async () => {
  const { sqlite, env } = await fixture({ includeMultiGlass: false });
  try {
    env.AI = { async run() { return { response: 'NONE' }; } };
    const image = syntheticPlatePng;
    const response = await worker.fetch(post('/api/les-skilt', { image }), env);
    assert.equal(response.status, 422);
    const body = await publicBody(response);
    assert.equal(body.ok, false);
  } finally { sqlite.close(); }
});
test('Release A resolver failure is an actual HTTP 500 without product data', async () => {
  const { sqlite, env } = await fixture({ includeMultiGlass: false });
  try {
    env.FINNBILGLASS_DB.prepare = () => { throw new Error('synthetic resolver database failure'); };
    const response = await worker.fetch(post('/api/frontrute', { merke: 'SYNTHETIC', modell: 'MODEL', aar: 2020 }), env);
    assert.equal(response.status, 500);
    const body = await publicBody(response);
    assert.equal(body.ok, false);
  } finally { sqlite.close(); }
});

// Release A P0.5: positive registration and VIN HTTP privacy regression.
test('Release A recognized registration and VIN hide 0/1/2 internal candidates over HTTP', async () => {
  const originalFetch = globalThis.fetch;
  const vin = 'WVWZZZ1JZXW000001';
  try {
    for (const path of ['/api/regnr', '/api/vin']) {
      for (const count of [0, 1, 2]) {
        const { sqlite, env } = await fixture({ includeMultiGlass: false });
        // P0.5 override schema loaded from migrations/0003_vin_glass_overrides.sql
        sqlite.exec("CREATE TABLE IF NOT EXISTS vin_glass_overrides (\n  vin TEXT NOT NULL,\n  eurocode TEXT NOT NULL,\n  make TEXT,\n  model TEXT,\n  year INTEGER,\n  verified_by TEXT,\n  confidence REAL DEFAULT 0.95,\n  source TEXT,\n  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,\n  PRIMARY KEY (vin, eurocode)\n);");
        try {
          env.MULTI_GLASS_ENABLED = 'false';
          env.SVV_API_KEY = 'synthetic-svv-test-key';

          for (let i = 0; i < count; i++) {
            const sku = `INTERNAL-SKU-TEST-${i}`;
            sqlite.prepare(
              'INSERT INTO ground_truth(make,model,year,frontrute_eurocode) VALUES(?,?,?,?)'
            ).run('SYNTHETIC', 'MODEL', 2020, sku);
            sqlite.prepare(
              'INSERT INTO glass_prisliste(varenr,varenavn,pris,eurokode,rad_type) VALUES(?,?,?,?,?)'
            ).run(sku, 'SYNTHETIC MODEL FRONTRUTE', 9000, `1234GN${i}`, 'glass');
          }

          const resolverInput = {
            merke: 'SYNTHETIC', modell: 'MODEL', aar: 2020,
            ...(path === '/api/vin' ? { vin } : {}),
          };
          const internal = await resolveFrontrute(env, resolverInput);
          assert.equal(
            (internal.kandidater ?? []).length, count,
            `Internal resolver precondition: ${path} (${count})`
          );

          let svvCalls = 0, resolverReads = 0;
          const prepare = env.FINNBILGLASS_DB.prepare;
          env.FINNBILGLASS_DB.prepare = function (sql) {
            if (/ground_truth|glass_prisliste/i.test(sql)) resolverReads++;
            return prepare.call(this, sql);
          };

          globalThis.fetch = async (input, options) => {
            const url = new URL(typeof input === 'string' ? input : input.url);
            assert.equal(
              url.origin,
              'https://akfell-datautlevering.atlas.vegvesen.no'
            );
            assert.equal(url.pathname, '/enkeltoppslag/kjoretoydata');
            assert.equal(
              url.searchParams.get(
                path === '/api/vin' ? 'understellsnummer' : 'kjennemerke'
              ),
              path === '/api/vin' ? vin : 'AB12345'
            );
            assert.equal(
              options?.headers?.['SVV-Authorization'],
              'Apikey synthetic-svv-test-key'
            );
            svvCalls++;
            return new Response(JSON.stringify({
              kjoretoydataListe: [{
                kjoretoyId: { understellsnummer: vin },
                forstegangsregistrering: {
                  registrertForstegangNorgeDato: '2020-06-15'
                },
                registrering: {
                  registreringsstatus: { kodeVerdi: 'REGISTRERT' }
                },
                godkjenning: {
                  tekniskGodkjenning: {
                    tekniskeData: {
                      generelt: {
                        merke: [{ merke: 'SYNTHETIC' }],
                        handelsbetegnelse: ['MODEL']
                      }
                    }
                  },
                  forstegangsGodkjenning: {
                    forstegangRegistrertDato: '2020-06-15'
                  }
                }
              }]
            }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' }
            });
          };

          const response = await worker.fetch(
            post(path, path === '/api/vin' ? { vin } : { regnr: 'AB12345' }),
            env
          );
          assert.equal(response.status, 200, `${path} (${count})`);
          const body = await publicBody(response);

          assert.equal(svvCalls, 1);
          assert.ok(resolverReads > 0);
          assert.equal(body.ok, true);
          assert.equal(body.bil?.merke, 'SYNTHETIC');
          assert.equal(body.bil?.modell, 'MODEL');
          assert.equal(body.bil?.aar, 2020);
          assert.deepEqual(body.resolver?.kandidater ?? [], []);
          assert.notEqual(body.resolver?.utfall, 'EXACT');
          assert.doesNotMatch(
            JSON.stringify(body),
            /INTERNAL-SKU-TEST|1234GN|9000|ORDER_CONFIRMED/
          );
        } finally {
          sqlite.close();
        }
      }
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});
