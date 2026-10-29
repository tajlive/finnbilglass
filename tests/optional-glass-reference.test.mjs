import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveFrontrute } from '../src/vin-resolver.ts';

function environment(referenceError) {
  return { FINNBILGLASS_DB: { prepare(sql) {
    return { bind() { return this; }, async all() {
      if (sql.includes('vin_glass_overrides')) return { results: [{ eurokode: '8579AGSGYAVZ1B' }] };
      if (sql.includes('glass_prisliste') && sql.includes('eurokode = ?')) return { results: [{ varenr: '2525GYA', varenavn: 'VW TRANSPORTER T5 FRONTRUTE', eurokode: '8579AGSGYAVZ1B', pris: 9980 }] };
      if (sql.includes('glass_prisliste')) return { results: [] };
      throw new Error(`Unexpected query: ${sql}`);
    }, async first() {
      if (sql.includes('glass_prisliste')) return { varenr: '2525GYA', varenavn: 'VW TRANSPORTER T5 FRONTRUTE', eurokode: '8579AGSGYAVZ1B', pris: 9980 };
      if (sql.includes('glass_reference')) throw referenceError;
      if (sql.includes('glass_catalog')) return null;
      throw new Error(`Unexpected query: ${sql}`);
    } };
  } } };
}

const vehicle = { merke: 'VW', modell: 'TRANSPORTER', aar: 2005, vin: 'WV1ZZZ7HZ5H060934' };
test('verified VIN remains usable when optional reference table is absent', async () => {
  const result = await resolveFrontrute(environment(new Error('D1_ERROR: no such table: glass_reference: SQLITE_ERROR')), vehicle);
  assert.equal(result.utfall, 'PINPOINT');
  assert.equal(result.eurokode, '8579AGSGYAVZ1B');
});
test('reference lookup does not hide unrelated database failures', async () => {
  await assert.rejects(resolveFrontrute(environment(new Error('D1_ERROR: database unavailable')), vehicle), /database unavailable/);
});
