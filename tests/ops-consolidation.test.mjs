import test from 'node:test';
import assert from 'node:assert';
import { konsoliderSaker, normaliserRegnr } from '../src/ops-consolidation';

/** @type {import('../src/ops-consolidation').InquiryRow} */
function inquiry(overrides = {}) {
  return {
    id: 1, regnr: 'AB12345', navn: 'Kari', kontakt: 'kari@eks.no', melding: null,
    status: 'NEW', assigned_to: null, vehicle_json: null, session_id: 's1',
    created_at: 1000, updated_at: null, ...overrides,
  };
}

/** @type {import('../src/ops-consolidation').EvidenceCaseRow} */
function evidence(overrides = {}) {
  return { case_id: 'FBG-1', registration_hash: 'h1', session_id: 'sess-1', status: 'NEW', created_at: 2000, image_count: 3, ...overrides };
}

test('normaliserRegnr fjerner mellomrom, bindestrek og normaliserer store bokstaver', () => {
  assert.equal(normaliserRegnr('ab 12345'), 'AB12345');
  assert.equal(normaliserRegnr('ab-12345'), 'AB12345');
  assert.equal(normaliserRegnr('  AB 12345  '), 'AB12345');
  assert.equal(normaliserRegnr('AB12345'), 'AB12345');
  assert.equal(normaliserRegnr(null), '');
  assert.equal(normaliserRegnr(undefined), '');
  assert.equal(normaliserRegnr(''), '');
});

test('konsoliderSaker: inquiry uten evidens → én sak, 0 bilder', () => {
  const saker = konsoliderSaker([inquiry()], []);
  assert.equal(saker.length, 1);
  assert.equal(saker[0].kind, 'inquiry');
  assert.equal(saker[0].inquiryId, 1);
  assert.equal(saker[0].imageCount, 0);
  assert.equal(saker[0].evidenceCaseIds.length, 0);
});

test('konsoliderSaker: evidence med session_id-match knyttes til inquiry og summerer bilder', () => {
  const inquiries = [inquiry({ id: 7, session_id: 'sess-1' })];
  const ev = [evidence({ case_id: 'FBG-1', session_id: 'sess-1', image_count: 3 })];
  const saker = konsoliderSaker(inquiries, ev);
  assert.equal(saker.length, 1, 'evidence skal smeltes inn i inquiry-saken');
  assert.equal(saker[0].inquiryId, 7);
  assert.equal(saker[0].evidenceCaseIds.length, 1);
  assert.equal(saker[0].evidenceCaseIds[0], 'FBG-1');
  assert.equal(saker[0].imageCount, 3);
  assert.equal(saker[0].kind, 'inquiry');
});

test('konsoliderSaker: evidence uten match → egen evidenssak', () => {
  const inquiries = [inquiry({ session_id: 's1' })];
  const ev = [evidence({ case_id: 'FBG-9', session_id: 'ukjent', created_at: 500, image_count: 2 })];
  const saker = konsoliderSaker(inquiries, ev);
  assert.equal(saker.length, 2);
  const evidensSak = saker.find((s) => s.kind === 'evidence');
  assert.ok(evidensSak, 'skal finnes en evidence-sak');
  assert.equal(evidensSak.key, 'evidence-FBG-9');
  assert.equal(evidensSak.imageCount, 2);
  assert.equal(evidensSak.inquiryId, null);
});

test('konsoliderSaker: evidence med null session_id blir aldri feilaktig matchet', () => {
  const inquiries = [inquiry({ session_id: null })];
  const ev = [evidence({ case_id: 'FBG-null', session_id: null, created_at: 900, image_count: 1 })];
  const saker = konsoliderSaker(inquiries, ev);
  assert.equal(saker.length, 2, 'null session_id skal ikke matche');
});

test('konsoliderSaker: sorterer nyest-først', () => {
  const inquiries = [
    inquiry({ id: 1, regnr: 'A', session_id: 's1', created_at: 1000 }),
    inquiry({ id: 2, regnr: 'B', session_id: 's2', created_at: 3000, status: 'CONFIRMED' }),
  ];
  const saker = konsoliderSaker(inquiries, []);
  assert.equal(saker[0].inquiryId, 2, 'nyeste først');
  assert.equal(saker[1].inquiryId, 1);
});

test('konsoliderSaker: tom input gir tom liste', () => {
  assert.deepEqual(konsoliderSaker([], []), []);
});
