import assert from 'node:assert/strict';
import test from 'node:test';
import { publicFrontruteDto, publicResolverDto, publicVehicleLookupDto, withoutCustomerPrices } from '../src/customer-price-gate';

test('customer lookup removes prices at every level but keeps fitment facts', () => {
  const result = withoutCustomerPrices({
    pris: 5990,
    anbefaling: { varenr: '1234ABC', pris: 5990, listepris: 8490 },
    kandidater: [{ varenr: '1234ABC', pris: 5990 }, { varenr: '1234ABD', pris: 6490 }],
  });
  assert.deepEqual(result, {
    anbefaling: { varenr: '1234ABC' },
    kandidater: [{ varenr: '1234ABC' }, { varenr: '1234ABD' }],
  });
});

test('public DTOs expose only approved resolver and vehicle fields at every candidate depth', () => {
  const resolver = publicResolverDto({
    utfall: 'VERIFY', internalTrace: 'secret', pris: 123, kandidater: [{ varenr: 'A1', pris: 99, databaseId: 7, attributter: { heating: true } }],
  });
  assert.deepEqual(resolver, { utfall: 'VERIFY', kundeprisInklMva: 123, kandidater: [{ candidateId: 'A1', kundeprisInklMva: 99, attributter: { heating: true } }] });
  const front = publicFrontruteDto({ ok: true, pinpoint: false, internal: 'x', anbefaling: { varenr: 'A1', pris: 99, supplierCost: 8 }, kandidater: [{ varenr: 'A1', lista: 123, score: 0.9 }] });
  assert.deepEqual(front, { ok: true, pinpoint: false, anbefaling: { candidateId: 'A1', kundeprisInklMva: 99 }, kandidater: [{ candidateId: 'A1', score: 0.9 }], meta: { resolver: false } });
  const vehicle = publicVehicleLookupDto({ ok: true, vin: 'not-allowed-top-level', bil: { merke: 'VW', modell: 'Golf', internal: 'x' }, resolver: { utfall: 'PINPOINT', pris: 99 } });
  assert.deepEqual(vehicle, { ok: true, bil: { merke: 'VW', modell: 'Golf' }, resolver: { utfall: 'PINPOINT', kundeprisInklMva: 99 } });
});
