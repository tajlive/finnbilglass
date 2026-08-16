/**
 * Regresjonstester: AI bilde-resolver (KLA-301).
 * Kjøres: node --import tsx --test tests/image-resolver.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveImageObservations } from '../src/image-resolver.ts';

function kandidat(overrides = {}) {
  return {
    glassId: 'g1',
    eurocode: '8579ACSGYAVZ1B',
    oemNumbers: [],
    features: { camera: true, rain_sensor: true, heated: null, hud: null },
    sellable: true,
    priceTier: 8490,
    ...overrides,
  };
}

test('OCR eurocode + bilde-feature kan gi PINPOINT via evidence-fusion', () => {
  const r = resolveImageObservations([kandidat()], [
    {
      imageId: 'corner-1',
      role: 'corner_marking',
      modelVersion: 'manual-test-1',
      eurocodes: [{ value: '8579 ACSGY AVZ1B', confidence: 0.95 }],
      oemNumbers: [],
      features: [],
      similarities: [],
      warnings: [],
    },
    {
      imageId: 'mirror-1',
      role: 'mirror_area',
      modelVersion: 'manual-test-1',
      eurocodes: [],
      oemNumbers: [],
      features: [{ name: 'camera', value: true, confidence: 0.9 }],
      similarities: [],
      warnings: [],
    },
  ]);

  assert.equal(r.outcome, 'PINPOINT');
  assert.equal(r.fusion.winner?.glassId, 'g1');
  assert.ok(r.imageSignals.some((s) => s.type === 'ocr_eurocode'));
  assert.ok(r.imageSignals.some((s) => s.type === 'image_feature'));
});

test('Visuell likhet alene gir aldri PINPOINT', () => {
  const r = resolveImageObservations([kandidat()], [
    {
      imageId: 'full-1',
      role: 'full_glass',
      modelVersion: 'manual-test-1',
      eurocodes: [],
      oemNumbers: [],
      features: [],
      similarities: [{ glassId: 'g1', confidence: 0.99 }],
      warnings: [],
    },
  ]);

  assert.equal(r.outcome, 'VERIFY');
  assert.equal(r.fusion.winner, null);
});

