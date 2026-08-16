/**
 * Regresjonstester: evidence fusion (KLA-301, FASE 6/7).
 * Kjøres: node --import tsx --test tests/evidence-fusion.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fuseEvidence, normalizeEurocode, makeSignal, WEIGHTS, normalizeR43 } from '../src/evidence-fusion.ts';

function selgbar(overrides = {}) {
  return {
    glassId: 'g1',
    eurocode: '2525ACSGYAVZ1B', // 14 tegn, faktisk fasitformat
    oemNumbers: ['5G0845011ANVB'],
    r43Numbers: [],
    features: { camera: null, hud: null, heated: null, rain_sensor: null },
    sellable: true,
    priceTier: 5490,
    ...overrides,
  };
}

test('PINPOINT: én salgbar kandidat + høyvektsbevis (OCR eurocode)', () => {
  const c = selgbar();
  const r = fuseEvidence([c], [makeSignal('ocr_eurocode', '2525 ACSGYAVZ1B', 0.95)]);
  assert.equal(r.outcome, 'PINPOINT');
  assert.equal(r.winner?.glassId, 'g1');
  assert.ok(r.confidence > 0.8);
});

test('PINPOINT: OEM-build-bevis med høyest vekt', () => {
  const c = selgbar();
  const r = fuseEvidence([c], [makeSignal('oem_build', '5G0845011ANVB', 0.9)]);
  assert.equal(r.outcome, 'PINPOINT');
  assert.equal(r.winner?.glassId, 'g1');
});

test('VERIFY: kandidat uten høyvektsbevis — AI-bestemmelse alene gir aldri PINPOINT', () => {
  const c = selgbar();
  const r = fuseEvidence([c], [makeSignal('image_feature', 'camera:true', 0.9)]);
  assert.equal(r.outcome, 'VERIFY');
  assert.equal(r.winner, null);
});

test('VERIFY: to kandidater innenfor margin', () => {
  const a = selgbar({ glassId: 'gA', eurocode: '2525ACSGYAVZ1B' });
  const b = selgbar({ glassId: 'gB', eurocode: '2525ACSGYAVZ2B' });
  const r = fuseEvidence([a, b], [makeSignal('ocr_eurocode', '2525ACSGYAVZ1B', 0.6)]);
  assert.equal(r.outcome, 'VERIFY');
});

test('MANUAL_REVIEW: motstridende OCR-eurocode-signaler', () => {
  const a = selgbar();
  const r = fuseEvidence([a], [
    makeSignal('ocr_eurocode', '2525ACSGYAVZ1B', 0.8),
    makeSignal('ocr_eurocode', '2525ACSGYAVZ2B', 0.8),
  ]);
  assert.equal(r.outcome, 'MANUAL_REVIEW');
});

test('Hard stop: motstridende kamera-status eliminerer kandidat', () => {
  const medKamera = selgbar({ glassId: 'gCam', features: { camera: true, hud: null, heated: null, rain_sensor: null } });
  const utenKamera = selgbar({ glassId: 'gNoCam', features: { camera: false, hud: null, heated: null, rain_sensor: null } });
  const r = fuseEvidence([medKamera, utenKamera], [
    makeSignal('feature_data', 'camera:false', 0.9),
    makeSignal('ocr_eurocode', '2525ACSGYAVZ1B', 0.9),
  ]);
  assert.equal(r.outcome, 'PINPOINT');
  assert.equal(r.winner?.glassId, 'gNoCam');
  assert.ok(r.eliminated.some((e) => e.glassId === 'gCam' && e.reason.startsWith('hard stop')));
});

test('Hard stop: siste kandidat motstridende → MANUAL_REVIEW, aldri gjetning', () => {
  const medHud = selgbar({ features: { camera: null, hud: true, heated: null, rain_sensor: null } });
  const r = fuseEvidence([medHud], [makeSignal('feature_data', 'hud:false', 0.8)]);
  assert.equal(r.outcome, 'MANUAL_REVIEW');
});

test('FALLBACK: ingen kandidater', () => {
  const r = fuseEvidence([], [makeSignal('ocr_eurocode', '2525ACSGYAVZ1B', 0.9)]);
  assert.equal(r.outcome, 'FALLBACK');
});

test('Ikke-salgbart glass elimineres — manglende varenr er alltid VERIFY/FALLBACK', () => {
  const ikkeSalgbar = selgbar({ sellable: false });
  const r = fuseEvidence([ikkeSalgbar], [makeSignal('ocr_eurocode', '2525ACSGYAVZ1B', 0.99)]);
  assert.equal(r.outcome, 'FALLBACK');
  assert.ok(r.eliminated.some((e) => e.reason.includes('salgbart')));
});

test('normalizeEurocode: faktisk format 6-17 tegn, separatorer fjernes, avvik gir null', () => {
  assert.equal(normalizeEurocode('2525-ACSGY-AVZ1B'), '2525ACSGYAVZ1B'); // 14 tegn (fasit-format)
  assert.equal(normalizeEurocode('8579ACSGYAVZ1B'), '8579ACSGYAVZ1B'); // 14
  assert.equal(normalizeEurocode('2525CSGYA'), '2525CSGYA'); // 9
  assert.equal(normalizeEurocode('12345'), null); // for kort
  assert.equal(normalizeEurocode('123456789012345678'), null); // >17
  assert.equal(normalizeEurocode('1234567'), null); // ingen bokstaver
});

test('Feature-signal uten feature-verdi påvirker ikke beslutningen negativt', () => {
  const c = selgbar();
  const r = fuseEvidence([c], [
    makeSignal('feature_data', 'camera:unknown', 0.1),
    makeSignal('ocr_eurocode', '2525ACSGYAVZ1B', 0.9),
  ]);
  assert.equal(r.outcome, 'PINPOINT');
});

test('Vekter: oem_build > visual_similarity (oppdragsgitte prioriteringer)', () => {
  assert.ok(WEIGHTS.oem_build > WEIGHTS.visual_similarity);
  assert.ok(WEIGHTS.ocr_eurocode > WEIGHTS.image_feature);
  assert.ok(WEIGHTS.manual_verification === 1.0);
});

test('normalizeR43: ulike skriveformer normaliseres til siffer', () => {
  assert.equal(normalizeR43('43R-004592'), '004592');
  assert.equal(normalizeR43('43R 004592'), '004592');
  assert.equal(normalizeR43('E1 43R004592'), '004592');
  assert.equal(normalizeR43('43R—003635'), '003635');
  assert.equal(normalizeR43('ikke et nummer'), null);
  assert.equal(normalizeR43('43R-123'), null); // for få siffer
});

test('PINPOINT via ocr_r43: fysisk bevis på glasset matcher kandidatens familie', () => {
  const c = selgbar({ r43Numbers: ['004592'] });
  const r = fuseEvidence([c], [makeSignal('ocr_r43', '43R-004592', 0.95)]);
  assert.equal(r.outcome, 'PINPOINT');
  assert.equal(r.winner?.glassId, 'g1');
  assert.ok(r.confidence > 0.8);
});

test('Negativt 43R-bevis eliminerer kandidat som ikke er i godkjenningsfamilien', () => {
  const c = selgbar({ r43Numbers: ['004592'] });
  const r = fuseEvidence([c], [
    makeSignal('ocr_r43', '43R-004592', 0.95, 'negative'),
  ]);
  assert.equal(r.outcome, 'FALLBACK');
  assert.ok(r.eliminated.some((e) => e.reason.includes('negativt bevis')));
});

test('MANUAL_REVIEW: motstridende 43R-numre (AI usikker / feil glass fotografert)', () => {
  const c = selgbar({ r43Numbers: ['004592'] });
  const r = fuseEvidence([c], [
    makeSignal('ocr_r43', '43R-004592', 0.8),
    makeSignal('ocr_r43', '43R-008177', 0.8),
  ]);
  assert.equal(r.outcome, 'MANUAL_REVIEW');
});
