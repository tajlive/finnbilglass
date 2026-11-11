import test from 'node:test';
import assert from 'node:assert/strict';
import { validateManualOfferPayload } from '../src/ops-offer-validation.ts';
import { operationsCenterUi } from '../src/ops-center-ui.ts';

const complete = {
  sku: 'QA-ONLY-NO-GLASS',
  fitmentEvidenceRef: 'QA-SYNTHETIC-NO-FITMENT',
  totalMinor: 100,
  deliveryNote: 'QA – ingen faktisk levering',
  equipment: {},
};

test('exact four QA form values are valid and stay a draft until explicitly sent', () => {
  assert.deepEqual(validateManualOfferPayload(complete), {
    ok: true,
    sku: complete.sku,
    evidence: complete.fitmentEvidenceRef,
    total: 100,
    delivery: complete.deliveryNote,
    equipment: '{}',
  });
});

test('blank offer fields return the exact first field, before any database write', () => {
  const bad = validateManualOfferPayload({ sku: '', fitmentEvidenceRef: '', totalMinor: 0, deliveryNote: '', equipment: {} });
  assert.equal(bad.ok, false);
  assert.equal(bad.field, 'sku');
  assert.match(bad.message, /SKU/);
});

test('field-by-field errors are actionable in Norwegian', () => {
  const cases = [
    [{ ...complete, sku: '  ' }, 'sku'],
    [{ ...complete, productName: 'x'.repeat(161) }, 'productName'],
    [{ ...complete, productDescription: 'x'.repeat(501) }, 'productDescription'],
    [{ ...complete, fitmentEvidenceRef: 'short' }, 'fitmentEvidenceRef'],
    [{ ...complete, totalMinor: '' }, 'totalMinor'],
    [{ ...complete, totalMinor: 10.5 }, 'totalMinor'],
    [{ ...complete, deliveryNote: '' }, 'deliveryNote'],
    [{ ...complete, equipment: { x: 'a'.repeat(5001) } }, 'equipment'],
  ];
  for (const [input, field] of cases) {
    const result = validateManualOfferPayload(input);
    assert.equal(result.ok, false);
    assert.equal(result.field, field);
    assert.ok(result.message.length > 8);
  }
});

test('staging offer form has visible labels and an inline, accessible error', async () => {
  const response = operationsCenterUi();
  const html = await response.text();
  for (const label of ['Varenummer (valgfritt)', 'Varenavn (valgfritt)', 'Beskrivelse (valgfritt)', 'Totalpris i kroner', 'Grunnlag for glassvalg', 'Frakt og levering']) {
    assert.match(html, new RegExp(label));
  }
  assert.match(html, /id="offer-form-error" role="alert"/);
  assert.match(html, /offerFieldError\(d\.field,d\.message/);
  assert.match(html, /offerFieldError\('sku'/);
  assert.match(html, /offerFieldError\('totalMinor'/);
});

test('manual name-only product creates a clear non-catalogue reference and keeps real product details', () => {
  const result = validateManualOfferPayload({
    sku: '',
    productName: 'Frontrute VW Transporter T6',
    productDescription: 'Med regnsensor, uten kamerafeste',
    fitmentEvidenceRef: 'Manuell kontroll ved bestilling',
    totalMinor: 249000,
    deliveryNote: 'Frakt etter avtale',
    equipment: { mounting: 'clamps' },
  });
  assert.equal(result.ok, true);
  assert.equal(result.sku, 'UTEN-VARENUMMER');
  const saved = JSON.parse(result.equipment);
  assert.equal(saved.offerProduct.name, 'Frontrute VW Transporter T6');
  assert.equal(saved.offerProduct.partNumber, null);
  assert.equal(saved.offerProduct.description, 'Med regnsensor, uten kamerafeste');
  assert.equal(saved.mounting, 'clamps');
});

test('number-only and name+number products can be entered without requiring a catalogue match', () => {
  const number = validateManualOfferPayload({...complete, sku:'GL-1234'});
  assert.equal(number.ok, true);
  assert.equal(number.sku, 'GL-1234');
  assert.equal(number.equipment, '{}');
  const both = validateManualOfferPayload({...complete, sku:'GL-1234', productName:'Frontrute'});
  assert.equal(both.ok,true);
  assert.equal(JSON.parse(both.equipment).offerProduct.partNumber,'GL-1234');
  assert.equal(JSON.parse(both.equipment).offerProduct.name,'Frontrute');
});

test('offer form requests NOK price, not an amount in øre, and supports both product fields', async () => {
  const html = await operationsCenterUi().text();
  assert.match(html, /id="offer-name"/);
  assert.match(html, /id="offer-description"/);
  assert.match(html, /price=Math\\.round\\(Number\\(normalisedPrice\\)\\*100\\)/);
  assert.match(html, /productName:productName,productDescription:productDescription/);
});
