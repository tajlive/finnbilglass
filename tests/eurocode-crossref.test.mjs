import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compareEurocodeCandidates, plausibleCompleteEurocode } from '../src/fitment-v1/crossref/offline.ts';

const SOURCE = 'https://steklo-lux.com/our-products/laminated-glass-for-foreign-passenger-cars/';
const WHEN = '2026-11-15';
const vehicle = (make, model, year, extra = {}) => ({ make, model, year, ...extra });
const item = (id, eurocode, make, model, extra = {}) => ({ id, eurocode, make, model, ...extra });
const ref = (id, eurocode, make, model, extra = {}) => ({
  ...item(id, eurocode, make, model, extra),
  sourceId: 'steklo-lux-public-research',
  sourceUrl: SOURCE,
  observedAt: WHEN,
  licenseState: 'RESEARCH_ONLY',
});

test('ASX: identical public catalogue Eurocode is a research overlap, never exact fitment', () => {
  const result = compareEurocodeCandidates(
    vehicle('MITSUBISHI', 'ASX', 2011),
    [item('asx', '5689AGNV', 'MITSUBISHI', 'ASX', { yearFrom: 2010 })],
    [ref('steklo-asx', '5689AGNV', 'MITSUBISHI', 'ASX', { yearFrom: 2010 })],
  );
  assert.equal(result.candidates[0].catalogueOverlap, 'IDENTICAL_CODE');
  assert.equal(result.metrics.exactCatalogueOverlaps, 1);
  assert.equal(result.autoApproved, false);
  assert.equal(result.fitmentVerificationState, 'UNVERIFIED');
  assert.ok(result.candidates[0].warnings.includes('REFERENCE_RESEARCH_ONLY_OR_UNLICENSED'));
});

test('T5 SU18018: matching 8579 prefix is NOT the exact golden Eurocode', () => {
  const golden = JSON.parse(readFileSync(new URL('../data/fitment-golden.json', import.meta.url), 'utf8'));
  const t5 = golden.fixtures.find((x) => x.id === 'SU18018');
  const result = compareEurocodeCandidates(
    vehicle('VW', 'TRANSPORTER', 2005, { generation: 'T5' }),
    [item('local-t5', t5.expectedEurocode, 'VW', 'TRANSPORTER', { generation: 'T5', yearFrom: 2003 })],
    [ref('steklo-t5', '8579AGNGYAV', 'VW', 'TRANSPORTER', { generation: 'T5', yearFrom: 2003 })],
    t5.verificationState,
  );
  assert.equal(result.candidates[0].catalogueOverlap, 'SAME_FAMILY_ONLY');
  assert.deepEqual(result.candidates[0].exactCodeReferences, []);
  assert.equal(result.fitmentVerificationState, 'PROVISIONAL');
  assert.equal(result.autoApproved, false);
});

test('CLA AJ95429: 1B and 1T variants must never be collapsed', () => {
  const golden = JSON.parse(readFileSync(new URL('../data/fitment-golden.json', import.meta.url), 'utf8'));
  const cla = golden.fixtures.find((x) => x.id === 'AJ95429');
  const result = compareEurocodeCandidates(
    vehicle('MERCEDES', 'CLA', 2016, { generation: 'C117' }),
    [item('cla-1b', '5381AGACMVW1B', 'MERCEDES', 'CLA', { generation: 'C117' })],
    [ref('cla-1t', '5381AGACMVW1T', 'MERCEDES', 'CLA', { generation: 'C117' })],
    cla.verificationState,
  );
  assert.equal(result.candidates[0].catalogueOverlap, 'SAME_FAMILY_ONLY');
  assert.equal(result.fitmentVerificationState, 'AMBIGUOUS');
});

test('up! 2018: 2019-on reference is not evidence for earlier production year', () => {
  const result = compareEurocodeCandidates(
    vehicle('VW', 'UP', 2018),
    [item('up-2018', '8613AGSCMVZ1L', 'VW', 'UP', { yearFrom: 2011 })],
    [ref('up-2019', '8613AGSCMVZ1L', 'VW', 'UP', { yearFrom: 2019 })],
  );
  assert.equal(result.candidates[0].catalogueOverlap, 'NONE');
  assert.equal(result.rejectedReferenceIds[0].reason, 'BEFORE_PRODUCTION_RANGE');
});

test('Fiat 500 Electric: combustion glass reference cannot be assumed compatible', () => {
  const result = compareEurocodeCandidates(
    vehicle('FIAT', '500', 2021, { powertrain: 'EV' }),
    [item('fiat-electric', '3366AGNGY1B', 'FIAT', '500', { powertrain: 'EV' })],
    [ref('fiat-ice', '3366AGNGY1B', 'FIAT', '500', { powertrain: 'ICE', yearFrom: 2007 })],
  );
  assert.equal(result.candidates[0].catalogueOverlap, 'NONE');
  assert.equal(result.rejectedReferenceIds[0].reason, 'POWERTRAIN_MISMATCH');
});

test('Vito W447: two candidate variants remain unapproved despite one matching research reference', () => {
  const result = compareEurocodeCandidates(
    vehicle('MERCEDES', 'VITO', 2015, { generation: 'W447' }),
    [
      item('vito-antenna', '5382AGNGYA', 'MERCEDES', 'VITO', { generation: 'W447' }),
      item('vito-camera', '5382AGNGYCP', 'MERCEDES', 'VITO', { generation: 'W447' }),
    ],
    [ref('vito-ant', '5382AGNGYA', 'MERCEDES', 'VITO', { generation: 'W447', yearFrom: 2015 })],
  );
  assert.equal(result.candidates.length, 2);
  assert.equal(result.candidates[0].catalogueOverlap, 'IDENTICAL_CODE');
  assert.equal(result.candidates[1].catalogueOverlap, 'SAME_FAMILY_ONLY');
  assert.equal(result.metrics.autoApproved, 0);
});

test('CX-5 2017: both generations remain possible until the car generation is established', () => {
  const result = compareEurocodeCandidates(
    vehicle('MAZDA', 'CX-5', 2017),
    [
      item('cx5-I', '5179AGNGY', 'MAZDA', 'CX-5', { generation: 'I', yearFrom: 2012 }),
      item('cx5-II', '5187AGNPV', 'MAZDA', 'CX-5', { generation: 'II', yearFrom: 2017 }),
    ],
    [
      ref('steklo-I', '5179AGNGY', 'MAZDA', 'CX-5', { generation: 'I', yearFrom: 2012 }),
      ref('steklo-II', '5187AGNPV', 'MAZDA', 'CX-5', { generation: 'II', yearFrom: 2017 }),
    ],
  );
  assert.equal(result.metrics.exactCatalogueOverlaps, 2);
  assert.ok(result.candidates.every((x) => x.needsStaffReview));
  assert.ok(result.candidates.every((x) => x.warnings.includes('GENERATION_UNCONFIRMED')));
  assert.equal(result.autoApproved, false);
});

test('Transporter 2015: T5 and T6 generation overlap is not an auto-selection', () => {
  const result = compareEurocodeCandidates(
    vehicle('VW', 'TRANSPORTER', 2015),
    [
      item('t5', '8579AGSGYAVZ1B', 'VW', 'TRANSPORTER', { generation: 'T5', yearFrom: 2003, yearTo: 2015 }),
      item('t6', '8579AGNPVZ15', 'VW', 'TRANSPORTER', { generation: 'T6', yearFrom: 2015 }),
    ],
    [ref('steklo-t5', '8579AGNGYAV', 'VW', 'TRANSPORTER', { generation: 'T5', yearFrom: 2003 })],
  );
  assert.equal(result.candidates.length, 2);
  assert.ok(result.candidates.every((x) => x.needsStaffReview));
  assert.ok(result.candidates.every((x) => x.warnings.includes('GENERATION_UNCONFIRMED')));
});

test('Incomplete code AGNGYV is flagged, never used as a full-code overlap', () => {
  assert.equal(plausibleCompleteEurocode('AGNGYV'), false);
  assert.equal(plausibleCompleteEurocode('5689AGNV'), true);
  const result = compareEurocodeCandidates(
    vehicle('HYUNDAI', 'ELANTRA', 2016),
    [item('hyundai', '4149AGNGYV', 'HYUNDAI', 'ELANTRA')],
    [ref('incomplete', 'AGNGYV', 'HYUNDAI', 'ELANTRA')],
  );
  assert.equal(result.candidates[0].catalogueOverlap, 'NONE');
  assert.equal(result.rejectedReferenceIds[0].reason, 'CODE_REQUIRES_MANUAL_VALIDATION');
});

test('No Glavista or external sources: local candidates stay available, no network access required', () => {
  const local = [item('local-only', '5689AGNV', 'MITSUBISHI', 'ASX')];
  const result = compareEurocodeCandidates(vehicle('MITSUBISHI', 'ASX', 2011), local, []);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].catalogueOverlap, 'NONE');
  assert.equal(result.autoApproved, false);
  assert.equal(result.fitmentVerificationState, 'UNVERIFIED');
});

test('Explicit generation mismatch excludes research references', () => {
  const result = compareEurocodeCandidates(
    vehicle('MAZDA', 'CX-5', 2017, { generation: 'II' }),
    [item('cx5-II', '5187AGNPV', 'MAZDA', 'CX-5', { generation: 'II' })],
    [ref('wrong-gen', '5187AGNPV', 'MAZDA', 'CX-5', { generation: 'I' })],
  );
  assert.equal(result.candidates[0].catalogueOverlap, 'NONE');
  assert.equal(result.rejectedReferenceIds[0].reason, 'GENERATION_MISMATCH');
});

test('Missing feature does not become false, and one candidate is never auto-approved', () => {
  const result = compareEurocodeCandidates(
    vehicle('MITSUBISHI', 'ASX', 2011),
    [item('one', '5689AGNV', 'MITSUBISHI', 'ASX', { features: { camera: null } })],
    [ref('one-ref', '5689AGNV', 'MITSUBISHI', 'ASX', { features: { camera: true } })],
  );
  assert.equal(result.candidates[0].catalogueOverlap, 'IDENTICAL_CODE');
  assert.equal(result.autoApproved, false);
});

test('Explicit feature conflicts are flagged while null does not become false', () => {
  const result = compareEurocodeCandidates(
    vehicle('MITSUBISHI', 'ASX', 2011),
    [item('one', '5689AGNV', 'MITSUBISHI', 'ASX', {
      features: { camera: true, rainSensor: null },
    })],
    [ref('one-ref', '5689AGNV', 'MITSUBISHI', 'ASX', {
      features: { camera: false, rainSensor: true },
    })],
  );
  assert.equal(result.candidates[0].catalogueOverlap, 'IDENTICAL_CODE');
  assert.ok(result.candidates[0].warnings.includes('FEATURE_CONFLICT:camera'));
  assert.ok(!result.candidates[0].warnings.includes('FEATURE_CONFLICT:rainSensor'));
  assert.equal(result.autoApproved, false);
});
