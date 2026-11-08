import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPageQuery,
  buildWranglerArgs,
  parseReadOnlyD1Result,
} from '../scripts/lib/staging-catalog-fixtures.mjs';

test('fixture export is fixed to FinnBilGlass staging and remote mode', () => {
  assert.deepEqual(buildWranglerArgs('SELECT 1'), [
    'd1', 'execute', 'finnbilglass-staging-catalog',
    '--config', 'wrangler.staging.toml', '--remote', '--json',
    '--command', 'SELECT 1',
  ]);
});

test('fixture export only selects the approved catalog columns with stable paging', () => {
  assert.equal(
    buildPageQuery('ground_truth', 1000, 2000),
    'SELECT make, model, year, frontrute_eurocode, confidence FROM ground_truth ORDER BY make, model, year, frontrute_eurocode, confidence LIMIT 1000 OFFSET 2000',
  );
  assert.equal(
    buildPageQuery('glass_prisliste', 1000, 0),
    'SELECT varenr, varenavn, kommentar, pris, eurokode, rad_type FROM glass_prisliste ORDER BY varenr, eurokode, rad_type, varenavn, pris, kommentar LIMIT 1000 OFFSET 0',
  );
  assert.throws(() => buildPageQuery('ops_users', 100, 0), /unsupported fixture table/);
  assert.throws(() => buildPageQuery('ground_truth', -1, 0), /invalid page/);
});

test('fixture export rejects malformed output and any write side effect', () => {
  const ok = JSON.stringify([{
    success: true,
    results: [{ n: 2 }],
    meta: { changed_db: false, changes: 0, rows_written: 0 },
  }]);
  assert.deepEqual(parseReadOnlyD1Result(ok), [{ n: 2 }]);
  assert.throws(() => parseReadOnlyD1Result('not-json'), /invalid wrangler JSON/);
  assert.throws(() => parseReadOnlyD1Result(JSON.stringify([{
    success: true, results: [], meta: { changed_db: true, changes: 1, rows_written: 1 },
  }])), /read-only D1 assertion failed/);
});
