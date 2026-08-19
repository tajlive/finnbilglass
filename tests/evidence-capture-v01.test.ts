import test from 'node:test';
import assert from 'node:assert/strict';
import { analyseEvidenceImage, createCaseId, isEvidenceImageType, normaliseRegistration, registrationHash } from '../src/evidence-capture-v01.js';

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

test('Evidence Capture kvalitetsgate godtar normale foto-dimensjoner', () => {
  const quality = analyseEvidenceImage(pngBytes(1600, 1200, 20_000), 'image/png');
  assert.equal(quality.qualityClass, 'PASS');
  assert.equal(quality.width, 1600);
  assert.equal(quality.height, 1200);
});

test('Evidence Capture kvalitetsgate avviser for lav oppløsning før sak opprettes', () => {
  const quality = analyseEvidenceImage(pngBytes(320, 240, 20_000), 'image/png');
  assert.equal(quality.qualityClass, 'REJECT');
  assert.ok(quality.reasonCodes.includes('REJECT_LOW_RESOLUTION'));
});

test('Evidence Capture kvalitetsgate flagger sannsynlige skjermbilder for manuell review', () => {
  const quality = analyseEvidenceImage(pngBytes(1170, 2532, 40_000), 'image/png');
  assert.equal(quality.qualityClass, 'REVIEW');
  assert.ok(quality.reasonCodes.includes('REVIEW_POSSIBLE_SCREENSHOT'));
});

function pngBytes(width: number, height: number, totalBytes: number): Uint8Array {
  const bytes = new Uint8Array(Math.max(24, totalBytes));
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  writeUint32(bytes, 16, width);
  writeUint32(bytes, 20, height);
  return bytes;
}

function writeUint32(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = (value >>> 24) & 0xff;
  bytes[offset + 1] = (value >>> 16) & 0xff;
  bytes[offset + 2] = (value >>> 8) & 0xff;
  bytes[offset + 3] = value & 0xff;
}
