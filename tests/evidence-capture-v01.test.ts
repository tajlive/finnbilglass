import test from 'node:test';
import assert from 'node:assert/strict';
import { createCaseId, isEvidenceImageType, normaliseRegistration, registrationHash } from '../src/evidence-capture-v01.js';

test('Evidence Capture normaliserer og hasher kjennemerke uten å beholde råverdi', async () => {
  assert.equal(normaliseRegistration('su 18-018'), 'SU18018');
  const hash = await registrationHash('SU 18018');
  assert.match(hash, /^[a-f0-9]{64}$/);
  assert.notEqual(hash, 'SU18018');
});

test('Evidence Capture tillater bare de fire avtalte bildetypene', () => {
  assert.equal(isEvidenceImageType('plate'), true);
  assert.equal(isEvidenceImageType('windshield'), true);
  assert.equal(isEvidenceImageType('mirror_sensor'), true);
  assert.equal(isEvidenceImageType('interior_optional'), true);
  assert.equal(isEvidenceImageType('oe_number'), false);
});

test('Case ID er tidsmerket og kan ikke inneholde registreringsnummer', () => {
  const id = createCaseId(new Date('2026-08-18T10:00:00.000Z'), 123456);
  assert.equal(id, 'FBG-20260818-002N9C');
  assert.doesNotMatch(id, /SU18018/);
});
