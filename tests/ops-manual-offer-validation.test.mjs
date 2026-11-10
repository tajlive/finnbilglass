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
  for (const label of ['Kontrollert SKU', 'Fitment-bevisreferanse', 'Totalpris i øre', 'Frakt og levering']) {
    assert.match(html, new RegExp(label));
  }
  assert.match(html, /id="offer-form-error" role="alert"/);
  assert.match(html, /offerFieldError\(d\.field,d\.message/);
  assert.match(html, /offerFieldError\('sku'/);
  assert.match(html, /offerFieldError\('totalMinor'/);
});
