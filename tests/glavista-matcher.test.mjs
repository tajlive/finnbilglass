// Oppgave 6a-2: matcher leser glavista-attributter (glass_sku_attributes).
// Bevis-case: challenge B-01 (T5 SU18018) — 2525GYA vs 2525GYM skilles av
// glavista-data når bilens profil er kjent; uten profil forblir
// needs_verification med riktig missingAttributes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { matchFrontrute } from '../src/matcher.ts';

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
    CREATE TABLE glass_sku_attributes (
      eurocode TEXT PRIMARY KEY, attributes_json TEXT NOT NULL,
      source TEXT DEFAULT 'glavista-index', updated_at TEXT
    );
    -- EKTE glavista-props (data/glavista-index.json):
    -- 8579AGSGYAVZ1B: "Mirror boss, Antenna, VIN notch" → cameraBracket+antenna, INGEN regnsensor
    -- 8579AGSGYAMVZ1B: "Mirror boss, Rain sensor, Antenna, 3rd sunvisor" → cameraBracket+rainLightSensor+antenna
    INSERT INTO glass_sku_attributes VALUES
      ('8579AGSGYAVZ1B', '{"cameraBracket":true,"antenna":true}', 'glavista-index', '2026-08-19T00:00:00Z'),
      ('8579AGSGYAMVZ1B', '{"cameraBracket":true,"rainLightSensor":true,"antenna":true}', 'glavista-index', '2026-08-19T00:00:00Z');
  `);
  return db;
}

test('B-01: uten profil → 2 kandidater, missingAttributes=[rainLightSensor] (true+null skiller)', async () => {
  const res = await matchFrontrute(d1Env(opprettDb()), { merke: 'VW', modell: 'TRANSPORTER', aar: 2005 });
  assert.equal(res.candidateCount, 2);
  assert.deepEqual(res.missingAttributes, ['rainLightSensor']); // Toms presisering: true+null = gyldig skillelinje
  assert.equal(res.approval.status, 'needs_verification');
  // Berikelse: cameraBracket kjent på begge (fra glavista)
  assert.equal(res.candidateSkus[0].attributes.cameraBracket, true);
  assert.equal(res.candidateSkus[1].attributes.cameraBracket, true);
});

test('B-01: profil {sensor:false} → 2525GYM elimineres (kjent motsigelse), 2525GYA beholdes → candidateCount=1', async () => {
  const res = await matchFrontrute(d1Env(opprettDb()), { merke: 'VW', modell: 'TRANSPORTER', aar: 2005, profil: { sensor: false } });
  assert.equal(res.candidateCount, 1);
  assert.equal(res.candidateSkus[0].varenr, '2525GYA'); // fasit SU18018
  assert.deepEqual(res.missingAttributes, []);
  // Katalog alene gir aldri approved (hasVerifiedCatalogRule=false) — policy urørt
  assert.equal(res.hasVerifiedCatalogRule, false);
  assert.equal(res.approval.status, 'needs_verification');
});

test('B-01: profil {sensor:true} → null-kandidat beholdes konservativt → fortsatt 2 kandidater', async () => {
  const res = await matchFrontrute(d1Env(opprettDb()), { merke: 'VW', modell: 'TRANSPORTER', aar: 2005, profil: { sensor: true } });
  assert.equal(res.candidateCount, 2); // 2525GYA (null=ukjent) elimineres ALDRI
  assert.deepEqual(res.missingAttributes, ['rainLightSensor']);
  assert.equal(res.approval.status, 'needs_verification');
});

test('B-01: profil {antenne:false} → begge har antenne=true (glavista) → 0 kandidater → fallback til original (aldri 0)', async () => {
  // Begge kandidatene har antenne=true; bil sier false → alle elimineres.
  // Guard: aldri 0-kandidat — fallback til ufiltrert liste, needs_verification.
  const res = await matchFrontrute(d1Env(opprettDb()), { merke: 'VW', modell: 'TRANSPORTER', aar: 2005, profil: { antenne: false } });
  assert.equal(res.candidateCount, 2);
  assert.equal(res.approval.status, 'needs_verification');
});

test('glavista-tabell mangler → defensiv, uendret oppførsel (ingen krasj)', async () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE glass_prisliste (
    varenr TEXT, varenavn TEXT, kommentar TEXT, pris REAL, eurokode TEXT, alias_av TEXT, rad_type TEXT
  ); INSERT INTO glass_prisliste VALUES
    ('2525GYA','VW TRANSP+T5 2003- FRONTRUTE',NULL,9980,'8579AGSGYAVZ1B',NULL,'glass'),
    ('2525GYM','VW TRANSP+T5 2003- FRONTRUTE',NULL,9980,'8579AGSGYAMVZ1B',NULL,'glass');`);
  const res = await matchFrontrute(d1Env(db), { merke: 'VW', modell: 'TRANSPORTER', aar: 2005 });
  assert.equal(res.candidateCount, 2);
  assert.equal(res.approval.status, 'needs_verification');
});
