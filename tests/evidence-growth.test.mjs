/**
 * C8 — Evidence Growth & Customer Learning Platform-tester.
 * Kunder som sensorer: observasjoner → korroborasjon → VERIFIED_INSTALLATION-evidence.
 * WRONG_GLASS eliminerer (aldri bare scorer). Læring ≠ automatisk sannhet.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ObservationStore, buildFeatureEvidence } from '../src/learning-v1/customer-evidence.js';
import { InstallationFixtureStore } from '../src/learning-v1/installation-fixture.js';
import { buildGrowthPlan } from '../src/learning-v1/growth.js';

const t5 = { regnrHash: 'abc', vinHash: 'def', make: 'VW', model: 'Transporter', year: 2005 };

test('C8-1: kundeobservasjon bygger feature-evidence (deterministisk, aldri LLM-tolket)', () => {
  const s = new ObservationStore();
  s.record({ vehicleRef: t5, feature: 'rainSensor', value: true, source: 'ECHO_CONFIRMED', reliability: 'ECHO_CONFIRMED', candidateVarenr: '2525GYA' });
  s.record({ vehicleRef: t5, feature: 'camera', value: false, source: 'CUSTOMER_OBSERVATION', reliability: 'PLAIN', candidateVarenr: '2525GYA' });
  const ev = buildFeatureEvidence(s.forVehicle(t5));
  assert.equal(ev.rainSensor, true);
  assert.equal(ev.camera, false);
  assert.equal(s.all().length, 2);
});

test('C8-2: korroborasjon — ≥3 uavhengige INSTALLED_SUCCESSFULLY blir høyeste evidens-fixture', () => {
  const st = new InstallationFixtureStore();
  for (let i = 0; i < 3; i++) {
    st.record({ vehicleRef: { ...t5, regnrHash: `h${i}`, vinHash: null }, candidateVarenr: '2525GYA', candidateEurokode: '8579AGSGYAVZ1B', observations: [], result: 'INSTALLED_SUCCESSFULLY' });
  }
  const corr = st.corroboratedFixtures();
  assert.equal(corr.length, 1);
  assert.equal(corr[0].varenr, '2525GYA');
  assert.equal(corr[0].installert, 3);
});

test('C8-3: WRONG_GLASS er NEGATIV evidens — eliminerer kandidaten (evidens eliminerer)', () => {
  const st = new InstallationFixtureStore();
  for (let i = 0; i < 4; i++) st.record({ vehicleRef: { ...t5, regnrHash: `w${i}`, vinHash: null }, candidateVarenr: '2525GYM', candidateEurokode: null, observations: [], result: 'WRONG_GLASS' });
  st.record({ vehicleRef: { ...t5, regnrHash: 'ok1', vinHash: null }, candidateVarenr: '2525GYM', candidateEurokode: null, observations: [], result: 'INSTALLED_SUCCESSFULLY' });
  const eliminated = st.eliminatedCandidates();
  assert.equal(eliminated.length, 1);
  assert.equal(eliminated[0].varenr, '2525GYM');
});

test('C8-4: læring ≠ automatisk sannhet — fixtures starter CAPTURED, krever Tom-gjennomgang for VERIFIED', () => {
  const st = new InstallationFixtureStore();
  const fx = st.record({ vehicleRef: t5, candidateVarenr: '2525GYA', candidateEurokode: '8579AGSGYAVZ1B', observations: [], result: 'INSTALLED_SUCCESSFULLY' });
  assert.equal(fx.lifecycle, 'CAPTURED');
  // ingen automatisk EXACT-promotion finnes i C8-laget — kun evidensgrafen styrkes
});

test('C8-5: vekstplan prioriterer der kundemengden er (Toms liste)', () => {
  const plan = buildGrowthPlan(
    [
      { familie: 'TRANSPORTER', make: 'VW', svvBiler: 79, markedsAnnonser: 89, roiScore: 43.6 },
      { familie: 'LEAF', make: 'NISSAN', svvBiler: 94, markedsAnnonser: 135, roiScore: 135 },
      { familie: 'GOLF', make: 'VW', svvBiler: 102, markedsAnnonser: 100, roiScore: 5 },
    ],
    [],
  );
  assert.equal(plan[0].familie, 'LEAF'); // flest annonser = først
  for (const p of plan) {
    assert.ok(p.fixturesForHalfCoverage > 0);
    assert.ok(p.dekningPerFixturePct > 0);
  }
});
