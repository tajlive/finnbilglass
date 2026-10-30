import assert from 'node:assert/strict';
import test from 'node:test';
import { publicFrontruteDto, publicResolverDto, publicVehicleLookupDto } from '../src/customer-price-gate';

const internal = { varenr: 'INTERNAL-123', eurokode: 'SECRET-CODE', partNumber: 'INTERNAL-123', pris: 9000, listepris: 12000, supplierPrice: 5000, supplier: 'INTERNAL-SUPPLIER' };
for (const count of [0, 1, 3]) {
  test(`Release A public frontrute response hides ${count} internal candidate(s)`, () => {
    const result = publicFrontruteDto({ ok: true, pinpoint: true, anbefaling: internal, kandidater: Array.from({ length: count }, () => internal), sporsmaal: ['internt spørsmål'] });
    assert.deepEqual(result.kandidater, []);
    assert.equal(result.anbefaling, null);
    assert.equal(result.pinpoint, false);
    assert.equal(JSON.stringify(result).includes('INTERNAL-123'), false);
    assert.equal(JSON.stringify(result).includes('SECRET-CODE'), false);
    assert.equal(JSON.stringify(result).includes('5000'), false);
  });
}
test('registration, VIN and plate-photo DTO keeps vehicle facts but no product reference', () => {
  const result = publicVehicleLookupDto({ ok: true, bil: { merke: 'VW', modell: 'Golf', aar: 2020 }, resolver: { utfall: 'PINPOINT', varenr: internal.varenr, kandidater: [internal] } });
  assert.deepEqual(result.bil, { merke: 'VW', modell: 'Golf', aar: 2020 });
  assert.deepEqual(result.resolver, { utfall: 'MANUAL_REVIEW' });
  assert.equal(JSON.stringify(result).includes('INTERNAL-123'), false);
  assert.deepEqual(publicResolverDto({ varenr: internal.varenr }), { utfall: 'MANUAL_REVIEW' });
});
