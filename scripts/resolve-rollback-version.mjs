import { readFile } from 'node:fs/promises';

const file = process.argv[2];
if (!file) throw new Error('Usage: node scripts/resolve-rollback-version.mjs <wrangler-deployments-json>');
const payload = JSON.parse(await readFile(file, 'utf8'));
const deployments = Array.isArray(payload) ? payload : payload.deployments;
if (!Array.isArray(deployments) || deployments.length === 0) {
  throw new Error('Cannot identify current production deployment; refusing to deploy without a rollback target.');
}
const active = [...deployments].sort((a, b) => String(b?.created_on ?? '').localeCompare(String(a?.created_on ?? '')))[0];
const versions = active?.versions;
if (!Array.isArray(versions) || versions.length !== 1 || versions[0].percentage !== 100 || typeof versions[0].version_id !== 'string') {
  throw new Error('Current deployment is missing or split; refusing automatic rollback target selection.');
}
process.stdout.write(versions[0].version_id);
