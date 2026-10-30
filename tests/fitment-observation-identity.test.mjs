import test from 'node:test';
import assert from 'node:assert/strict';
import { EvidenceKernel } from '../src/fitment-v1/policy/kernel.ts';

const kernel = new EvidenceKernel();
const vehicle = {
  registrationNumber: 'SU18018',
  vin: 'WV1ZZZ7HZ5H060934',
  make: 'VW',
  model: 'Transporter T5 2005',
  modelYear: 2005,
};
const oe = [{ type: 'OE', value: '7H0845101H', reliable: true }];

test('P0.1.2: missing VIN cannot auto-confirm OE glass', () => {
  const r = kernel.resolveWithObservation({ ...vehicle, vin: null }, oe);
  assert.notEqual(r.fitmentStatus, 'EXACT');
  assert.equal(r.selectedGlass, null);
  assert.ok(r.reasonCodes.includes('VEHICLE_IDENTITY_NOT_VERIFIED'));
});

test('P0.1.2: malformed VIN cannot auto-confirm OE glass', () => {
  const r = kernel.resolveWithObservation({ ...vehicle, vin: 'INVALID' }, oe);
  assert.notEqual(r.fitmentStatus, 'EXACT');
  assert.equal(r.selectedGlass, null);
});

test('P0.1.2: OE without any vehicle candidate cannot auto-confirm', () => {
  const emptyCatalogKernel = new EvidenceKernel({ catalog: () => [] });
  const r = emptyCatalogKernel.resolveWithObservation(vehicle, oe);
  assert.notEqual(r.fitmentStatus, 'EXACT');
  assert.equal(r.selectedGlass, null);
});

test('P0.1.2: known vehicle and supported OE can remain EXACT', () => {
  const r = kernel.resolveWithObservation(vehicle, oe);
  assert.equal(r.fitmentStatus, 'EXACT');
  assert.ok(r.selectedGlass);
});
