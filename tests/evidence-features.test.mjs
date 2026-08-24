// Regressjonstester for evidence-feature-flags (trinn 8).
// Dekker: flagg av/på, 403 feature_disabled (ikke 404), review-decision-validering.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { featureEnabled, featureDisabled, GYLDIGE_REVIEW_DECISIONS, erGyldigReviewDecision } from '../src/evidence-features.ts';

test('featureEnabled: kun eksplisitt "true" åpner', () => {
  assert.equal(featureEnabled({ EVIDENCE_UPLOAD_ENABLED: 'true' }, 'EVIDENCE_UPLOAD_ENABLED'), true);
  assert.equal(featureEnabled({ EVIDENCE_UPLOAD_ENABLED: 'false' }, 'EVIDENCE_UPLOAD_ENABLED'), false);
  assert.equal(featureEnabled({}, 'EVIDENCE_UPLOAD_ENABLED'), false);
  assert.equal(featureEnabled({ EVIDENCE_UPLOAD_ENABLED: 'TRUE' }, 'EVIDENCE_UPLOAD_ENABLED'), false);
  assert.equal(featureEnabled({ EVIDENCE_UPLOAD_ENABLED: '1' }, 'EVIDENCE_UPLOAD_ENABLED'), false);
});

test('featureDisabled: 403 med feature_disabled — aldri 404', async () => {
  for (const navn of ['EVIDENCE_UPLOAD_ENABLED', 'EVIDENCE_REVIEW_ENABLED', 'EVIDENCE_STATUS_CHANGE_ENABLED']) {
    const r = featureDisabled(navn);
    assert.equal(r.status, 403);
    const d = await r.json();
    assert.equal(d.ok, false);
    assert.equal(d.error, 'feature_disabled');
    assert.equal(d.feature, navn);
  }
});

test('erGyldigReviewDecision: godkjenn/avvis/request_image gyldige, annet ugyldig', () => {
  assert.equal(erGyldigReviewDecision('godkjenn'), true);
  assert.equal(erGyldigReviewDecision('avvis'), true);
  assert.equal(erGyldigReviewDecision('request_image'), true);
  assert.equal(erGyldigReviewDecision(''), false);
  assert.equal(erGyldigReviewDecision('approve'), false);
  assert.equal(erGyldigReviewDecision('GODKJENN'), false);
  assert.deepEqual([...GYLDIGE_REVIEW_DECISIONS].sort(), ['avvis', 'godkjenn', 'request_image']);
});

test('flagg-grense: alle tre flagg navngitt', () => {
  // Sørger for at fremtidige endringer i FeatureNavn reflekteres i testen.
  const navn = ['EVIDENCE_UPLOAD_ENABLED', 'EVIDENCE_REVIEW_ENABLED', 'EVIDENCE_STATUS_CHANGE_ENABLED'];
  for (const n of navn) {
    const env = {}; env[n] = 'true';
    assert.equal(featureEnabled(env, n), true);
  }
});
