// Oppgave 3+4: beslutningsmodul + override → candidateCount-reduksjon.
// Bruker node:sqlite (ekte SQLite) som D1-mock — ingen mocks som jukser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { godkjenningsGate, skrivOverride, skrivBeslutning, snapshotKandidatTilSku } from '../src/approval/decisions.ts';
import { matchFrontrute } from '../src/matcher.ts';

/** Bygg D1-lignende env fra en node:sqlite-database. */
function d1Env(db) {
  function stmt(sql) {
    const base = {
      async all(...params) { const rows = db.prepare(sql).all(...params); return { results: rows }; },
      async first(...params) { const r = db.prepare(sql).get(...params); return r ?? null; },
      async run(...params) { const info = db.prepare(sql).run(...params); return { meta: { last_row_id: Number(info.lastInsertRowid) } }; },
    };
    return {
      bind(...params) { return { all: () => base.all(...params), first: () => base.first(...params), run: () => base.run(...params) }; },
      all: () => base.all(), first: () => base.first(), run: () => base.run(),
    };
  }
  return { FINNBILGLASS_DB: { prepare: stmt, async batch(stmts) { for (const s of stmts) await s.run(); } } };
}

function opprettDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE glass_prisliste (
      varenr TEXT, varenavn TEXT, kommentar TEXT, pris REAL, eurokode TEXT,
      alias_av TEXT, rad_type TEXT
    );
    INSERT INTO glass_prisliste VALUES
      ('2525GYA','VW TRANSP+T5 2003- FRONTRUTE',NULL,9980,'8579AGSGYAVZ1B',NULL,'glass'),
      ('2525GYM','VW TRANSP+T5 2003- FRONTRUTE',NULL,9980,'8579AGSGYAMVZ1B',NULL,'glass');
    CREATE TABLE manual_review_overrides (
      id INTEGER PRIMARY KEY AUTOINCREMENT, vin_prefix TEXT, make TEXT, model_series TEXT,
      valid_from TEXT, valid_to TEXT, attributes_json TEXT, approved_sku TEXT, eurocode TEXT,
      source TEXT DEFAULT 'manual_review', approved_by TEXT,
      approved_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), notes TEXT
    );
    CREATE TABLE case_sku_decisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, case_id TEXT, decision_type TEXT,
      sku TEXT, eurocode TEXT, reason TEXT, created_by TEXT,
      created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), meta_json TEXT DEFAULT '{}'
    );
    CREATE TABLE evidence_events (
      id TEXT PRIMARY KEY, vehicle_identity_hash TEXT, created_at INTEGER, source_type TEXT,
      evidence_type TEXT, value TEXT, confidence INTEGER, status TEXT, created_by TEXT,
      candidate_varenr TEXT, notes TEXT
    );
  `);
  return db;
}

// ── Testkrav a, ops-nivå: gate blokkerer 2+ kandidater ──
test('a4: godkjenningsGate blokkerer 2 kandidater (approve_sku kan ikke godkjenne)', () => {
  const to = [
    snapshotKandidatTilSku({ varenr: '2525GYA', eurokode: '8579AGSGYAVZ1B', attributter: { sensor: true } }),
    snapshotKandidatTilSku({ varenr: '2525GYM', eurokode: '8579AGSGYAMVZ1B', attributter: { sensor: false } }),
  ];
  const v = godkjenningsGate(to, {});
  assert.equal(v.status, 'needs_verification');
  assert.ok(v.grunn.some((g) => g.includes('candidateSkus.length=2')));
});

test('a5: godkjenningsGate godkjenner ÉN kandidat uten konflikt', () => {
  const en = [snapshotKandidatTilSku({ varenr: '2525GYA', eurokode: '8579AGSGYAVZ1B', attributter: { sensor: true } })];
  const v = godkjenningsGate(en, { rainLightSensor: true });
  assert.equal(v.status, 'approved');
});

test('a6: snapshotKandidatTilSku mapper resolver-attributter korrekt', () => {
  const sku = snapshotKandidatTilSku({ varenr: 'X', eurokode: 'E', attributter: { sensor: true, kamera: false, hud: true } });
  assert.equal(sku.attributes.rainLightSensor, true);
  assert.equal(sku.attributes.cameraBracket, false);
  assert.equal(sku.attributes.hud, true);
});

// ── Oppgave 4: skrivOverride skriver rad + evidence_events (hard regel 5) ──
test('d4: skrivOverride lager override + evidence_events-rad med godkjent_av', async () => {
  const db = opprettDb();
  const env = d1Env(db);
  const { overrideId } = await skrivOverride(env, {
    vin: 'WV1ZZZ7HZGH132076', make: 'VW', modelSeries: 'TRANSPORTER',
    sku: '2525GYA', eurocode: '8579AGSGYAVZ1B', actor: 'Tom',
    attrs: { rainLightSensor: true },
  });
  const rad = db.prepare('SELECT * FROM manual_review_overrides WHERE id = ?').get(overrideId);
  assert.equal(rad.approved_sku, '2525GYA');
  assert.equal(rad.make, 'VW');
  assert.equal(rad.vin_prefix, 'WV1ZZZ');
  assert.equal(rad.source, 'manual_review');
  assert.equal(rad.approved_by, 'Tom');
  const evt = db.prepare('SELECT * FROM evidence_events').all();
  assert.equal(evt.length, 1);
  assert.equal(evt[0].source_type, 'MONTOR');
  assert.ok(evt[0].notes.includes('godkjent_av=Tom'));
});

test('d5: skrivBeslutning er append-only og sporbart', async () => {
  const db = opprettDb();
  const env = d1Env(db);
  await skrivBeslutning(env, { caseId: '7', decision: 'reject', reason: 'Feil bil', actor: 'Tom' });
  await skrivBeslutning(env, { caseId: '7', decision: 'approve_sku', sku: '2525GYA', actor: 'Tom' });
  const rader = db.prepare('SELECT decision_type, created_by FROM case_sku_decisions ORDER BY id').all();
  assert.equal(rader.length, 2);
  assert.deepEqual(rader.map((r) => r.decision_type), ['reject', 'approve_sku']);
});

// ── Testkrav b: godkjent override reduserer candidateCount i neste identiske case ──
test('b1: uten override → 2 kandidater, needs_verification', async () => {
  const db = opprettDb();
  const env = d1Env(db);
  const res = await matchFrontrute(env, { merke: 'VW', modell: 'TRANSPORTER', aar: 2005 });
  assert.equal(res.candidateCount, 2);
  assert.equal(res.hasVerifiedCatalogRule, false);
  assert.equal(res.approval.status, 'needs_verification');
});

test('b2: MED override → candidateCount=1, hasVerifiedCatalogRule=true, approved', async () => {
  const db = opprettDb();
  db.prepare(`INSERT INTO manual_review_overrides
    (vin_prefix, make, model_series, attributes_json, approved_sku, eurocode, source, approved_by)
    VALUES (NULL, 'VW', 'TRANSPORTER', '{"rainLightSensor":true}', '2525GYA', '8579AGSGYAVZ1B', 'manual_review', 'Tom')`).run();
  const env = d1Env(db);
  const res = await matchFrontrute(env, { merke: 'VW', modell: 'TRANSPORTER', aar: 2005 });
  assert.equal(res.hasVerifiedCatalogRule, true);
  assert.equal(res.candidateCount, 1);
  assert.equal(res.candidateSkus[0].varenr, '2525GYA');
  assert.equal(res.candidateSkus[0].status, 'verified');
  assert.equal(res.approval.status, 'approved');
});

test('b3: override med feil merke påvirker ikke andre biler', async () => {
  const db = opprettDb();
  db.prepare(`INSERT INTO manual_review_overrides
    (make, model_series, approved_sku, eurocode, source, approved_by)
    VALUES ('BMW', '3ER', 'X', 'Y', 'manual_review', 'Tom')`).run();
  const env = d1Env(db);
  const res = await matchFrontrute(env, { merke: 'VW', modell: 'TRANSPORTER', aar: 2005 });
  assert.equal(res.hasVerifiedCatalogRule, false);
  assert.equal(res.candidateCount, 2);
});
