/**
 * C8.1 — Evidence Ledger Persistence-tester (5/5 akseptkriterier).
 * 1. observasjon overlever restart · 2. fixture overlever restart · 3. audit trail finnes
 * 4. rejected evidence beholdes · 5. decision kan forklares
 * + migrasjonsvalidering, Evidence Decay, Evidence Monotonicity, ingen auto-EXACT uten gate.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MemoryLedgerStore } from '../src/learning-v1/d1-ledger.js';
import { identityHash, evidenceStrength, hasActiveEvidence, explainDecision } from '../src/learning-v1/evidence-ledger.js';

const DAG = 24 * 3600 * 1000;
const AR = 365.25 * DAG;
const now = Date.now();

function ev(overrides = {}) {
  return {
    id: `ev-${Math.random().toString(36).slice(2, 10)}`, vehicleIdentityHash: 'h-t5', registrationHash: null,
    createdAt: now - DAG, sourceType: 'CUSTOMER', evidenceType: 'RAIN_SENSOR', value: 'true', confidence: 100,
    status: 'CONFIRMED', createdBy: 'customer', sessionId: null, candidateVarenr: null, supersedes: null, notes: null,
    ...overrides,
  };
}
function fx(overrides = {}) {
  return {
    fixtureId: `fx-${Math.random().toString(36).slice(2, 10)}`, vehicleIdentityHash: 'h-t5', candidateVarenr: '2525GYA', eurokode: '2525GYA',
    outcome: 'INSTALLED_SUCCESSFULLY', installerId: 'montor-1', confirmedAt: now - DAG, status: 'CAPTURED', sourceOrderId: null, notes: null,
    ...overrides,
  };
}

test('C8.1-1: observasjon overlever restart (ny ledger-instans, samme store)', async () => {
  const store = new MemoryLedgerStore();
  const l1 = { store, append: (e) => store.appendEvent(e) };
  const evt = ev({ evidenceType: 'CAMERA', value: 'true' });
  await l1.append(evt);
  // «Restart»: helt ny adapter-lesing fra samme store
  const events = await store.eventsForVehicle('h-t5');
  assert.equal(events.length, 1);
  assert.equal(events[0].evidenceType, 'CAMERA');
  assert.equal(events[0].value, 'true');
  assert.equal(events[0].id, evt.id);
});

test('C8.1-2: fixture overlever restart (ny ledger-instans, samme store)', async () => {
  const store = new MemoryLedgerStore();
  await store.upsertFixture(fx({ outcome: 'INSTALLED_SUCCESSFULLY' }));
  const fixtures = await store.fixturesForVehicle('h-t5');
  assert.equal(fixtures.length, 1);
  assert.equal(fixtures[0].candidateVarenr, '2525GYA');
  assert.equal(fixtures[0].outcome, 'INSTALLED_SUCCESSFULLY');
});

test('C8.1-3: audit trail finnes — append-only, full historikk, aldri slettet', async () => {
  const store = new MemoryLedgerStore();
  await store.appendEvent(ev({ evidenceType: 'RAIN_SENSOR', value: 'true' }));
  await store.appendEvent(ev({ evidenceType: 'RAIN_SENSOR', value: 'false', supersedes: 'første' }));
  await store.appendEvent(ev({ evidenceType: 'OE', value: '7H0845101H', status: 'VERIFIED' }));
  const all = await store.allEvents();
  assert.equal(all.length, 3, 'alle hendelser beholdes — superseding er en ny rad, ikke en sletting');
  const superseder = all.find((e) => e.evidenceType === 'RAIN_SENSOR' && e.value === 'false');
  assert.ok(superseder && superseder.supersedes === 'første');
});

test('C8.1-4: rejected evidence beholdes (REJECTED er en status, aldri en sletting)', async () => {
  const store = new MemoryLedgerStore();
  await store.appendEvent(ev({ evidenceType: 'CAMERA', value: 'true', status: 'REJECTED', createdBy: 'ai' }));
  const events = await store.eventsForVehicle('h-t5');
  assert.equal(events.length, 1);
  assert.equal(events[0].status, 'REJECTED');
  // Rejected-evidence har styrke 0 (ai = 0 %) og monoticity ser den IKKE som aktiv
  assert.equal(evidenceStrength(events[0], now), 0);
  assert.equal(hasActiveEvidence(events, 'CAMERA', now), false);
});

test('C8.1-5: decision kan forklares — full forklaringskjede for 2525GYA', async () => {
  const events = [
    ev({ evidenceType: 'CAMERA', value: 'true', status: 'CONFIRMED' }),
    ev({ evidenceType: 'RAIN_SENSOR', value: 'true', status: 'CONFIRMED' }),
    ev({ evidenceType: 'OE', value: '7H0845101H', status: 'VERIFIED', sourceType: 'OE_IMAGE', candidateVarenr: '2525GYA' }),
  ];
  const fixtures = [fx({ installerId: 'm1' }), fx({ installerId: 'm2' }), fx({ installerId: 'm3' }), fx({ outcome: 'WRONG_GLASS', candidateVarenr: '2525GYM' })];
  const forklaring = explainDecision(events, fixtures, now);
  assert.equal(forklaring.konklusjon, 'EXACT');
  const oe = forklaring.evidens.find((e) => e.type === 'OE');
  assert.ok(oe && oe.value === '7H0845101H');
  assert.ok(oe.styrke > 0.9, 'OE-bilde må ha høyest styrke (Evidence Priority 1)');
  const gya = forklaring.installasjoner.find((i) => i.varenr === '2525GYA');
  assert.equal(gya.installed, 3);
  const gym = forklaring.installasjoner.find((i) => i.varenr === '2525GYM');
  assert.equal(gym.wrong, 1);
  assert.match(forklaring.beslutningsgrunnlag, /7H0845101H/);
});

test('C8.1-6: ingen automatisk EXACT uten evidence gate — UNKNOWN når evidens mangler', () => {
  const f = explainDecision([ev({ evidenceType: 'CAMERA', value: 'true', status: 'CONFIRMED' })], [], now);
  assert.equal(f.konklusjon, 'UNKNOWN');
  assert.match(f.beslutningsgrunnlag, /UNKNOWN er korrekt/);
});

test('C8.1-7: Evidence Decay — montør i går 100 %, 5 år siden 90 %, kunde 70 %, AI 0 %', () => {
  const montorIdag = evidenceStrength(ev({ sourceType: 'MONTOR', createdBy: 'installer', createdAt: now - DAG }), now);
  const montor5ar = evidenceStrength(ev({ sourceType: 'MONTOR', createdBy: 'installer', createdAt: now - 5 * AR }), now);
  const kunde = evidenceStrength(ev({ createdAt: now - DAG }), now);
  const ai = evidenceStrength(ev({ sourceType: 'SYSTEM', createdBy: 'ai', createdAt: now }), now);
  assert.equal(montorIdag, 1.0);
  assert.equal(montor5ar, 0.9, '5 år siden = 90 % (Toms eksempel)');
  assert.equal(kunde, 0.7);
  assert.equal(ai, 0, 'AI-antakelse er aldri evidens');
});

test('C8.1-8: Evidence Monotonicity — aldri spør om det samme igjen når aktiv evidens finnes', () => {
  const events = [ev({ evidenceType: 'RAIN_SENSOR', value: 'true', status: 'CONFIRMED' })];
  assert.equal(hasActiveEvidence(events, 'RAIN_SENSOR', now), true, 'bekreftet evidens → aldri spør igjen');
  assert.equal(hasActiveEvidence(events, 'CAMERA', now), false, 'annen evidens-type kan fortsatt spørres');
  const rejected = [ev({ evidenceType: 'RAIN_SENSOR', value: 'true', status: 'REJECTED' })];
  assert.equal(hasActiveEvidence(rejected, 'RAIN_SENSOR', now), false, 'avvist evidens blokkerer ikke nye spørsmål');
});

test('C8.1-9: migrasjon 0012 — ledgerskjemaet har Toms modell (source_type/evidence_type/confidence/status/created_by)', () => {
  const sql = readFileSync(fileURLToPath(new URL('../migrations/0012_evidence_ledger.sql', import.meta.url)), 'utf8');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS evidence_events/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS installation_fixtures/);
  for (const col of ['vehicle_identity_hash', 'registration_hash', 'source_type', 'evidence_type', 'value', 'confidence', 'status', 'created_by', 'created_at']) {
    assert.ok(sql.includes(col), `kolonne ${col} må finnes`);
  }
  for (const src of ['CUSTOMER', 'OE_IMAGE', 'INSTALLATION', 'MONTOR', 'SYSTEM']) assert.ok(sql.includes(src), `source_type-verdi ${src}`);
  for (const sb of ['customer', 'installer', 'ai', 'system']) assert.ok(sql.includes(sb), `created_by-verdi ${sb}`);
  assert.match(sql, /REJECTED/, 'REJECTED beholdes (audit trail)');
  assert.ok(!/UPDATE evidence_events|DELETE FROM evidence_events/.test(sql), 'append-only: ingen UPDATE/DELETE på events');
});

test('C8.1-10: personvern — identityHash lagrer aldri rå kjennemerke (sha256, saltet)', async () => {
  const h1 = await identityHash('SU18018');
  const h2 = await identityHash('su18018');
  const h3 = await identityHash('AB12345');
  assert.equal(h1, h2, 'hash er deterministisk og case-insensitiv');
  assert.notEqual(h1, h3);
  assert.match(h1, /^[0-9a-f]{64}$/, 'sha256-hex');
  assert.ok(!h1.includes('SU18018'), 'rå kjennemerke finnes aldri i hashen');
});
