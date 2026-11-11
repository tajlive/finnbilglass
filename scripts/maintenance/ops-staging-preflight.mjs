/**
 * FinnBilGlass exact-commit, NO-CLOUDFLARE-WRITES staging preflight.
 *
 * This program NEVER deploys, migrates, queries customers or reads credentials.
 * It validates the checked-out candidate, then optionally runs Wrangler --dry-run.
 */
import { readFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import crypto from 'node:crypto';

export const STAGING = Object.freeze({
  worker: 'finnbilglass-frontrute-staging',
  account: '80d5b1d56a3e907150ba7348b6182894',
  d1: '78842e17-ab0b-47c1-acde-244044073466',
  dbName: 'finnbilglass-db-staging',
  r2: 'finnbilglass-opplaering-staging',
});

export function requireCandidateSha(actual, expected) {
  if (!/^[a-f0-9]{40}$/.test(expected || '')) {
    throw Error('EXPECTED_SHA_MUST_BE_EXACT_40_CHAR_COMMIT');
  }
  if (actual !== expected) throw Error('CHECKED_OUT_SHA_NOT_APPROVED_CANDIDATE');
}

export function verifyStagingToml(source) {
  const values = new Map();
  const sections = new Map();
  let section = 'root';
  const forbiddenKey = /^(?:route|routes|zone_id|zone_name|custom_domain)$/;
  for (const original of source.split(/\r?\n/)) {
    const line = original.trim();
    if (!line || line.startsWith('#')) continue;
    const header = line.match(/^\[+(.*?)\]+$/);
    if (header) {
      section = header[1];
      if (/^(?:env\.|routes$|triggers$)/.test(section)) throw Error('STAGING_ROUTE_OR_PROD_ENV_FORBIDDEN');
      sections.set(section, (sections.get(section) || 0) + 1);
      continue;
    }
    const assign = line.match(/^([a-zA-Z_][\w-]*)\s*=\s*(.+)$/);
    if (!assign) continue;
    const [, key, raw] = assign;
    if (forbiddenKey.test(key)) throw Error('PRODUCTION_ROUTE_OR_DOMAIN_FORBIDDEN_' + key);
    const full = section + '.' + key;
    if (values.has(full)) throw Error('DUPLICATE_STAGING_CONFIG_' + full);
    let value = raw;
    const quoted = raw.match(/^"([^"]*)"$/);
    if (quoted) value = quoted[1];
    values.set(full, value);
  }

  const requireValue = (key, expected) => {
    if (values.get(key) !== expected) throw Error('STAGING_CONFIG_MISMATCH_' + key);
  };
  requireValue('root.name', STAGING.worker);
  requireValue('root.main', 'src/index.ts');
  requireValue('root.account_id', STAGING.account);
  requireValue('root.workers_dev', 'true');
  requireValue('d1_databases.binding', 'FINNBILGLASS_DB');
  requireValue('d1_databases.database_id', STAGING.d1);
  requireValue('d1_databases.database_name', STAGING.dbName);
  requireValue('r2_buckets.binding', 'OPPLAERING_BUCKET');
  requireValue('r2_buckets.bucket_name', STAGING.r2);
  requireValue('vars.ENVIRONMENT', 'staging');
  for (const flag of ['OPS_STAFF_PORTAL_ENABLED', 'OPS_MANUAL_ORDERS_ENABLED', 'OPS_WORKBENCH_ENABLED']) {
    requireValue('vars.' + flag, 'true');
  }
  requireValue('vars.GMAIL_SYNC_ENABLED', 'false');

  for (const sectionName of ['d1_databases', 'r2_buckets', 'vars', 'assets']) {
    if (sections.get(sectionName) !== 1) throw Error('UNEXPECTED_BINDING_COUNT_' + sectionName);
  }
  const workerFirst = values.get('assets.run_worker_first') || '';
  if (!workerFirst.includes('"/ops"')) throw Error('OPS_NOT_WORKER_FIRST');
  return STAGING;
}

function argsFromCli(argv) {
  let expectedSha;
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--expected-sha' && argv[i + 1]) {
      expectedSha = argv[++i];
    } else if (arg === '--dry-run') {
      dryRun = true;
    } else {
      throw Error('UNRECOGNIZED_PRE_FLIGHT_ARGUMENT');
    }
  }
  return { expectedSha, dryRun };
}

export function runPreflight(expectedSha, dryRun, root = process.cwd()) {
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  requireCandidateSha(head, expectedSha);
  const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' });
  if (dirty.trim()) throw Error('WORKTREE_DIRTY_NO_EXACT_COMMIT_BUILD');

  const config = readFileSync(path.join(root, 'wrangler.staging.toml'), 'utf8');
  verifyStagingToml(config);
  const migration = readFileSync(path.join(root, 'migrations/proposed/0046_ops_reply_attempts.sql.proposed'), 'utf8');
  if (!migration.includes('CREATE TABLE IF NOT EXISTS ops_reply_attempts') ||
      !migration.includes('ops_reply_attempts_no_status_regression')) {
    throw Error('REVIEWED_REPLY_SCHEMA_FILE_NOT_PRESENT');
  }
  const digest = crypto.createHash('sha256').update(config).digest('hex');
  console.log(JSON.stringify({
    status: 'STAGING_PRE_FLIGHT_PASS',
    candidate_sha: head,
    worker: STAGING.worker,
    account: STAGING.account,
    database_id: STAGING.d1,
    r2: STAGING.r2,
    config_sha256: digest,
    database_writes: false,
    deployment: false
  }, null, 2));

  if (dryRun) {
    const outdir = '/tmp/fbg-ops-staging-dryrun';
    const result = spawnSync('npx', ['--no-install', 'wrangler', 'deploy',
      '--config', 'wrangler.staging.toml', '--dry-run', '--outdir', outdir],
      { cwd: root, stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) throw Error('STAGING_WRANGLER_DRY_RUN_FAILED');
  }
  return true;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { expectedSha, dryRun } = argsFromCli(process.argv.slice(2));
    runPreflight(expectedSha, dryRun);
  } catch (error) {
    console.error('STOP: ' + error.message);
    process.exitCode = 1;
  }
}
