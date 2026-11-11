import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { requireCandidateSha, verifyStagingToml, STAGING } from '../scripts/maintenance/ops-staging-preflight.mjs';

const original = readFileSync(new URL('../wrangler.staging.toml', import.meta.url), 'utf8');
const change = (oldValue, newValue) => {
  assert.equal(original.split(oldValue).length, 2, 'Unique staging fixture expected');
  return original.replace(oldValue, newValue);
};

test('approved staging config has explicit production-safe bindings', () => {
  assert.equal(verifyStagingToml(original).worker, STAGING.worker);
  assert.equal(verifyStagingToml(original).d1, STAGING.d1);
});

test('strict candidate SHA pin rejects any other commit', () => {
  const commit = '49a23a9f8936177d5ab2cf931dbd19453e015fd8';
  assert.doesNotThrow(() => requireCandidateSha(commit, commit));
  assert.throws(() => requireCandidateSha(commit, 'a'.repeat(40)), /CHECKED_OUT_SHA_NOT_APPROVED/);
  assert.throws(() => requireCandidateSha(commit, 'HEAD'), /EXPECTED_SHA_MUST_BE_EXACT/);
});

test('refuses accidental production service and disabled workers.dev', () => {
  assert.throws(() => verifyStagingToml(change('name = "finnbilglass-frontrute-staging"',
    'name = "finnbilglass-frontrute"')), /STAGING_CONFIG_MISMATCH/);
  assert.throws(() => verifyStagingToml(change('workers_dev = true',
    'workers_dev = false')), /STAGING_CONFIG_MISMATCH/);
});

test('refuses D1 account, UUID, and database substitution', () => {
  assert.throws(() => verifyStagingToml(change('account_id = "80d5b1d56a3e907150ba7348b6182894"',
    'account_id = "another-account"')), /STAGING_CONFIG_MISMATCH/);
  assert.throws(() => verifyStagingToml(change('database_id = "78842e17-ab0b-47c1-acde-244044073466"',
    'database_id = "ac35018c-0d43-4742-adf8-d881b7274684"')), /STAGING_CONFIG_MISMATCH/);
  assert.throws(() => verifyStagingToml(change('database_name = "finnbilglass-db-staging"',
    'database_name = "finnbilglass-db"')), /STAGING_CONFIG_MISMATCH/);
});

test('refuses wrong R2 or unexpected extra D1 bindings', () => {
  assert.throws(() => verifyStagingToml(change('bucket_name = "finnbilglass-opplaering-staging"',
    'bucket_name = "finnbilglass-opplaering"')), /STAGING_CONFIG_MISMATCH/);
  assert.throws(() => verifyStagingToml(original + '\n[[d1_databases]]\ndatabase_name = "other"\n'),
    /UNEXPECTED_BINDING_COUNT|DUPLICATE_STAGING_CONFIG/);
});

test('refuses production routes, custom domains or environment sections', () => {
  for (const override of [
    '\n[[routes]]\npattern = "finnbilglass.no/*"\n',
    '\nroute = "finnbilglass.no/*"\n',
    '\n[env.production]\nname = "finnbilglass-frontrute"\n',
    '\ncustom_domain = true\n'
  ]) {
    assert.throws(() => verifyStagingToml(original + override),
      /STAGING_ROUTE_OR_PROD_ENV_FORBIDDEN|PRODUCTION_ROUTE_OR_DOMAIN_FORBIDDEN/);
  }
});

test('refuses enabled Gmail sync and disabled OPS', () => {
  assert.throws(() => verifyStagingToml(change('GMAIL_SYNC_ENABLED = "false"',
    'GMAIL_SYNC_ENABLED = "true"')), /STAGING_CONFIG_MISMATCH/);
  assert.throws(() => verifyStagingToml(change('OPS_MANUAL_ORDERS_ENABLED = "true"',
    'OPS_MANUAL_ORDERS_ENABLED = "false"')), /STAGING_CONFIG_MISMATCH/);
});

test('refuses absence of OPS worker-first asset routing', () => {
  assert.throws(() => verifyStagingToml(change('run_worker_first = ["/support/evidence", "/ops"]',
    'run_worker_first = ["/support/evidence"]')), /OPS_NOT_WORKER_FIRST/);
});
