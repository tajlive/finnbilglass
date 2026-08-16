#!/usr/bin/env node
/**
 * Imports a licensed TecAlliance snapshot into FinnBilGlass staging only.
 *
 * Snapshot layout:
 *   manifest.json   -- provenance and commercial permission
 *   parts.jsonl     -- canonical crosswalk records accepted by crosswalk-pipeline
 *   vehicles.jsonl  -- VIN -> kType records from Vehicle Identification
 *
 * This program intentionally has no live TecAlliance HTTP client. A vendor
 * export is stored and fingerprinted first, then imported locally. That makes
 * replay, audit and rollback possible and keeps vendor credentials out of the
 * public Worker.
 */
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const DB = 'finnbilglass-db-staging';
const CONFIG = 'wrangler.staging.toml';
const MIN_VIN_CONFIDENCE = 0.9;

function die(message) { console.error(`FEIL: ${message}`); process.exit(2); }
function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
function sql(value) { return `'${String(value).replace(/'/g, "''")}'`; }
function sqlOrNull(value) { return value == null || value === '' ? 'NULL' : sql(value); }
function command(args) { return execFileSync('npx', ['wrangler', ...args], { cwd: ROOT, encoding: 'utf8' }); }
function node(args) { return execFileSync('node', args, { cwd: ROOT, encoding: 'utf8' }); }
function parseArgs(argv) {
  const out = { apply: false, confirmLicensed: false, snapshot: null, out: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--apply') out.apply = true;
    else if (a === '--confirm-licensed') out.confirmLicensed = true;
    else if (a === '--snapshot') out.snapshot = argv[++i];
    else if (a === '--out') out.out = argv[++i];
    else if (a === '--help') {
      console.log('Bruk: node scripts/import-tecdoc-snapshot.mjs --snapshot DIR [--out DIR] [--apply --confirm-licensed]');
      process.exit(0);
    } else die(`ukjent argument: ${a}`);
  }
  if (!out.snapshot) die('--snapshot DIR er påkrevd');
  if (out.apply && !out.confirmLicensed) die('--apply krever eksplisitt --confirm-licensed');
  return out;
}
function readJsonl(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split('\n').filter(Boolean).map((line, index) => {
    try { return JSON.parse(line); } catch { die(`ugyldig JSONL i ${path}, linje ${index + 1}`); }
  });
}
function isVin(value) { return /^[A-HJ-NPR-Z0-9]{17}$/.test(String(value ?? '').toUpperCase()); }
function normalizeVehicle(row) {
  const vin = String(row.vin ?? '').toUpperCase().trim();
  const ktype = String(row.ktype ?? row.kType ?? '').trim();
  const confidence = Number(row.confidence);
  if (!isVin(vin) || !/^\d+$/.test(ktype) || !Number.isFinite(confidence) || confidence < MIN_VIN_CONFIDENCE) return null;
  return {
    vin, ktype,
    make: String(row.make ?? row.brand ?? '').toUpperCase().trim() || null,
    model: String(row.model ?? '').trim() || null,
    year: Number.isInteger(row.year) ? row.year : null,
    confidence,
  };
}

const options = parseArgs(process.argv.slice(2));
const snapshot = resolve(options.snapshot);
const manifestPath = join(snapshot, 'manifest.json');
if (!existsSync(manifestPath)) die('manifest.json mangler');
const manifestRaw = readFileSync(manifestPath, 'utf8');
let manifest;
try { manifest = JSON.parse(manifestRaw); } catch { die('manifest.json er ikke gyldig JSON'); }
if (manifest.schema !== 'finnbilglass-tecdoc-snapshot/v1') die('ukjent snapshot-skjema');
if (typeof manifest.license_ref !== 'string' || !/^tecdoc[-:]/i.test(manifest.license_ref)) die('manifest.license_ref må være en TecDoc-lisensreferanse');
if (manifest.redistribution_permitted !== true) die('manifest må eksplisitt tillate lokal lagring for FinnBilGlass/B2B');
if (typeof manifest.source_version !== 'string' || !manifest.source_version.trim()) die('manifest.source_version mangler');

const partsPath = join(snapshot, 'parts.jsonl');
const vehiclesPath = join(snapshot, 'vehicles.jsonl');
if (!existsSync(partsPath) && !existsSync(vehiclesPath)) die('snapshot må inneholde parts.jsonl eller vehicles.jsonl');
const partsRaw = existsSync(partsPath) ? readFileSync(partsPath, 'utf8') : '';
const vehiclesRaw = existsSync(vehiclesPath) ? readFileSync(vehiclesPath, 'utf8') : '';
const parts = readJsonl(partsPath);
const vehicleRows = readJsonl(vehiclesPath);
const vehicles = [...new Map(vehicleRows.map(normalizeVehicle).filter(Boolean).map((row) => [row.vin, row])).values()];
const rejectedVehicles = vehicleRows.length - vehicles.length;
const rawFingerprint = sha256(`${manifestRaw}\n${partsRaw}\n${vehiclesRaw}`);
const sourceId = `tecdoc-${manifest.source_version.replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 80)}`;
const importId = `tecdoc-${randomUUID()}`;
const out = resolve(options.out ?? join(snapshot, '.finnbilglass-import'));
mkdirSync(out, { recursive: true });

const sourceSql = [
  'INSERT OR IGNORE INTO source_katalog (source_id, source, source_url, source_version, fetched_at, source_updated_at, license_ref, raw_fingerprint, confidence, notes)',
  `VALUES (${sql(sourceId)}, 'tecdoc', ${sql(manifest.source_url ?? 'licensed-export')}, ${sql(manifest.source_version)}, ${sql(manifest.fetched_at ?? new Date().toISOString())}, ${sqlOrNull(manifest.source_updated_at)}, ${sql(manifest.license_ref)}, ${sql(rawFingerprint)}, 0.95, 'Licensed TecAlliance snapshot; imported staging-only.');`,
].join('\n');
writeFileSync(join(out, '01_source.sql'), sourceSql);

const normalizedParts = parts.map((row) => ({ ...row, source: sourceId }));
writeFileSync(join(out, 'parts.normalized.jsonl'), normalizedParts.map((row) => JSON.stringify(row)).join('\n') + (normalizedParts.length ? '\n' : ''));
if (normalizedParts.length) {
  node(['scripts/crosswalk-pipeline.mjs', '--input', join(out, 'parts.normalized.jsonl'), '--out', join(out, 'crosswalk'), '--fresh']);
}

// Generate VIN writes separately. No source record is accepted below 0.90.
const vehicleValues = vehicles.map((row) => `(${sql(row.vin)}, ${sql(row.ktype)}, NULL, ${sql(row.make)}, ${sql(row.model)}, ${row.year ?? 'NULL'}, ${row.confidence}, ${sql(`tecdoc:${manifest.source_version}`)})`);
const vehicleSql = [
  '-- Licensed TecDoc Vehicle Identification data; high-confidence VIN->kType only.',
  ...vehicleValues.length ? ['INSERT INTO vin_ktype_map (vin, ktype, regnr_hash, make, model, year, confidence, source) VALUES', vehicleValues.join(',\n'), 'ON CONFLICT(vin) DO UPDATE SET ktype=excluded.ktype, make=excluded.make, model=excluded.model, year=excluded.year, confidence=excluded.confidence, source=excluded.source;'] : ['-- No VIN rows accepted.'],
].flat().join('\n');
writeFileSync(join(out, '02_vehicles.sql'), vehicleSql);

const runSql = [
  'INSERT OR IGNORE INTO tecdoc_import_runs (import_id, source_id, source_version, license_ref, raw_fingerprint, manifest_json, parts_received, vehicles_received, records_rejected, mode)',
  `VALUES (${sql(importId)}, ${sql(sourceId)}, ${sql(manifest.source_version)}, ${sql(manifest.license_ref)}, ${sql(rawFingerprint)}, ${sql(manifestRaw)}, ${parts.length}, ${vehicles.length}, ${rejectedVehicles}, ${sql(options.apply ? 'staging' : 'dry_run')});`,
].join('\n');
writeFileSync(join(out, '03_import_run.sql'), runSql);

const report = { importId, sourceId, sourceVersion: manifest.source_version, rawFingerprint, partsReceived: parts.length, vehiclesAccepted: vehicles.length, vehiclesRejected: rejectedVehicles, mode: options.apply ? 'staging' : 'dry_run', output: out };
writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));

if (!options.apply) process.exit(0);

// Staging is the only destination hard-coded by this importer.
for (const file of ['01_source.sql']) {
  command(['d1', 'execute', DB, '--remote', '--config', CONFIG, '--file', join(out, file)]);
}
if (normalizedParts.length) {
  command(['d1', 'execute', DB, '--remote', '--config', CONFIG, '--file', join(out, 'crosswalk', 'emit.sql')]);
}
for (const file of ['02_vehicles.sql', '03_import_run.sql']) {
  command(['d1', 'execute', DB, '--remote', '--config', CONFIG, '--file', join(out, file)]);
}
console.log('Staging import complete. Canonical part links and high-confidence VIN→kType records are imported.');
