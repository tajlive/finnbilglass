/**
 * Regresjonstester: AI bilde-resolver (KLA-301).
 * Kjøres: node --import tsx --test tests/image-resolver.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveImageObservations } from '../src/image-resolver.ts';
import { WorkersAIVisionProvider } from '../src/vision-provider.ts';

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

// ── Hallusinasjonsvern (2026-08-17): bilde av HELE bilen «leste» 43R-004592 ──
// Modellen må klassifisere bildet først; «annet» (hel bil/verksted/rom) →
// r43/eurocode/OEM forkastes. Regex-fallback får LAV confidence (0.55).

function obsFraRaw(rawText) {
  // Kjør parseObservation via observe med mock AI som returnerer råteksten.
  const ai = { run: async () => rawText };
  const p = new WorkersAIVisionProvider(ai);
  return p.observe({ image: { id: 'x', role: 'corner_marking', imageRef: 'data:image/jpeg;base64,AAAA', mime: 'image/jpeg', source: 'customer' }, candidateImages: [], prompt: '' });
}

test('hallusinasjonsvern: bildetType=annet → r43 forkastes selv om teksten nevner nummer', async () => {
  const obs = await obsFraRaw(JSON.stringify({
    bildetType: 'annet',
    r43: { value: '43R-004592', confidence: 0.95, explanation: 'påstått' },
    eurocodes: [{ value: '8579ACSGYAVZ1B', confidence: 0.9 }],
    oemNumbers: [],
    features: [],
    warnings: ['bildet er ikke et nærbilde av merkingen'],
  }));
  assert.equal(obs.r43Numbers.length, 0); // hallusinert nummer forkastet
  assert.equal(obs.eurocodes.length, 0);
  assert.ok(obs.warnings.some((w) => /ikke et nærbilde/i.test(w)));
});

test('hallusinasjonsvern: råtekst med nummer + bildetType=annet → ingen r43', async () => {
  const obs = await obsFraRaw('{"response":"The approval mark on the car glass in the image is 43R-004592.","bildetType":"annet"}');
  assert.equal(obs.r43Numbers.length, 0); // regex-fallback blokkert av «annet»
});

test('hallusinasjonsvern: regex-fallback får 0.55 (aldri alene PINPOINT)', async () => {
  const obs = await obsFraRaw('{"response":"The approval mark is 43R-004592."}');
  // Uten bildetType-felt: tolkes som nærbilde (kompatibilitet) → fallback gir lav tillit.
  assert.equal(obs.r43Numbers.length, 1);
  assert.ok(obs.r43Numbers[0].confidence <= 0.6);
});

