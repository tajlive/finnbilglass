// Godkjenningspolicy (Oppgave 2) — harde regler: approved KUN ved
// én kandidat + verifisert regel + ingen attributkonflikt.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { approvalPolicy, skillendeAttributter, attributkonflikter } from '../src/approval/policy.ts';
import { overrideMatcherBil, overrideAttributter } from '../src/approval/overrides.ts';

function sku(varenr, attrs) {
  return {
    sku: `AUTOGLASS:${varenr}`,
    varenr,
    supplier: 'AUTOGLASS',
    supplierPartNumbers: [varenr],
    oemPartNumbers: [],
    eurocodes: [],
    vehicleRules: [],
    attributes: {
      windshield: true, hud: null, cameraBracket: null, rainLightSensor: null,
      heating: null, acoustic: null, antenna: null, tint: null, ...attrs,
    },
    evidence: [],
    status: 'candidate',
  };
}

function override(over) {
  return {
    id: 1, vinPrefix: null, make: 'VW', modelSeries: null, validFrom: null, validTo: null,
    attributesJson: null, approvedSku: '2525GYA', eurocode: '8579AGSGYAVZ1B',
    approvedBy: 'operator@finnbilglass.no', approvedAt: '2026-08-19T00:00:00Z', ...over,
  };
}

// ── Testkrav a): 2+ kandidater ALDRI approved automatisk ──
test('a1: 2 kandidater + verifisert regel → needs_verification (aldri approved)', () => {
  const to = [sku('2525GYA', { rainLightSensor: true }), sku('2525GYM', { rainLightSensor: false })];
  const v = approvalPolicy(to, true);
  assert.equal(v.status, 'needs_verification');
  assert.ok(v.grunn.some((g) => g.includes('candidateSkus.length=2')));
});

test('a2: 3 kandidater, ingen regel → needs_verification med begge grunner', () => {
  const tre = [sku('A', {}), sku('B', {}), sku('C', {})];
  const v = approvalPolicy(tre, false);
  assert.equal(v.status, 'needs_verification');
  assert.equal(v.grunn.length, 2);
});

test('a3: 0 kandidater → needs_verification (approved er aldri default)', () => {
  const v = approvalPolicy([], true);
  assert.equal(v.status, 'needs_verification');
});

// ── Testkrav c): attributkonflikt tvinger needs_verification uansett tidligere status ──
test('c1: katalog sier HUD=true, bevis sier false → needs_verification', () => {
  const en = [sku('HUDG', { hud: true })];
  const konflikt = attributkonflikter(en, { hud: false });
  assert.equal(konflikt.length, 1);
  const v = approvalPolicy(en, true, konflikt);
  assert.equal(v.status, 'needs_verification');
  assert.ok(v.grunn.some((g) => g.includes('attributkonflikt')));
});

test('c2: katalog sier kamera=true, bilde viser ingen kamera-sone → needs_verification', () => {
  const en = [sku('CAM', { cameraBracket: true })];
  const v = approvalPolicy(en, true, attributkonflikter(en, { cameraBracket: false }));
  assert.equal(v.status, 'needs_verification');
});

test('c3: bekreftet attributt som MATCHER katalog → ingen konflikt, kan godkjennes', () => {
  const en = [sku('OK', { rainLightSensor: true })];
  const konflikt = attributkonflikter(en, { rainLightSensor: true });
  assert.deepEqual(konflikt, []);
  const v = approvalPolicy(en, true, konflikt);
  assert.equal(v.status, 'approved');
});

test('c4: ukjent attributt (null) i katalog → ingen konflikt uansett bevis', () => {
  const en = [sku('UKJENT', { hud: null })];
  assert.deepEqual(attributkonflikter(en, { hud: true }), []);
});

// ── missingAttributes: hvilke attributter forhindrer entydighet ──
test('d1: sensor/antenne skiller to kandidater → missingAttributes [sensor, antenne]', () => {
  const to = [
    sku('2525GYA', { rainLightSensor: true, antenna: true }),
    sku('2525GYM', { rainLightSensor: false, antenna: false }),
  ];
  const missing = skillendeAttributter(to);
  assert.deepEqual(missing.sort(), ['antenna', 'rainLightSensor']);
});

test('d2: kun én skillende attributt → missingAttributes har ett element', () => {
  const to = [sku('A', { heating: true }), sku('B', { heating: false })];
  assert.deepEqual(skillendeAttributter(to), ['heating']);
});

test('d3: identiske attributter → ingen missing (annet bevis enn attributter trengs)', () => {
  const to = [sku('A', { antenna: true }), sku('B', { antenna: true })];
  assert.deepEqual(skillendeAttributter(to), []);
});

// ── Override-matching (grunnlag for testkrav b i oppgave 4) ──
test('e1: VIN-prefiks + merke matcher → true', () => {
  const o = override({ vinPrefix: 'WV1ZZZ' });
  assert.equal(overrideMatcherBil(o, { merke: 'VW', vin: 'WV1ZZZ7HZGH132076' }, '2026-08-19'), true);
});

test('e2: VIN-regel uten VIN → false (aldri anta)', () => {
  const o = override({ vinPrefix: 'WV1ZZZ' });
  assert.equal(overrideMatcherBil(o, { merke: 'VW', vin: null }, '2026-08-19'), false);
});

test('e3: feil merke → false', () => {
  const o = override({ make: 'BMW' });
  assert.equal(overrideMatcherBil(o, { merke: 'VW' }, '2026-08-19'), false);
});

test('e4: gyldighetsperiode — år utenfor → false, innenfor → true', () => {
  const o = override({ validFrom: '2015-01-01', validTo: '2019-12-31' });
  assert.equal(overrideMatcherBil(o, { merke: 'VW', aar: 2016 }, '2026-08-19'), true);
  assert.equal(overrideMatcherBil(o, { merke: 'VW', aar: 2022 }, '2026-08-19'), false);
});

test('e5: modellserie-treff (token-basert)', () => {
  const o = override({ modelSeries: 'TRANSPORTER T5' });
  assert.equal(overrideMatcherBil(o, { merke: 'VW', modell: 'TRANSPORTER' }, '2026-08-19'), true);
  assert.equal(overrideMatcherBil(o, { merke: 'VW', modell: 'GOLF' }, '2026-08-19'), false);
});

test('e6: overrideAttributter parser trygt (ugyldig JSON → {})', () => {
  assert.deepEqual(overrideAttributter(override({ attributesJson: '{"hud":false}' })), { hud: false });
  assert.deepEqual(overrideAttributter(override({ attributesJson: 'ikke-json' })), {});
});
