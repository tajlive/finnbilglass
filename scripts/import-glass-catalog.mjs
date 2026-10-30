#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = new Map();
for (let i = 2; i < process.argv.length; i++) {
  const key = process.argv[i];
  if (key.startsWith('--')) args.set(key, process.argv[i + 1]?.startsWith('--') ? true : process.argv[++i]);
}
const inputDir = args.get('--snapshot');
if (!inputDir) throw new Error('Usage: node scripts/import-glass-catalog.mjs --snapshot <folder> [--apply --db <local-sqlite-file>]');
const manifest = JSON.parse(await readFile(join(inputDir, 'manifest.json'), 'utf8'));
if (manifest.schema !== 'finnbilglass-glass-catalog/v1') throw new Error('Unsupported snapshot schema');
for (const key of ['source_id', 'supplier', 'source_version', 'license_ref', 'license_evidence_ref']) {
  if (typeof manifest[key] !== 'string' || !manifest[key].trim()) throw new Error(`Missing manifest.${key}`);
}
if (manifest.license_ref.toLowerCase() === 'none' || manifest.license_ref === 'internal-autoglass') {
  throw new Error('Source rights are not documented for this importer; provide a current license reference and evidence.');
}
if (manifest.public_use_allowed === true && !manifest.license_evidence_ref) throw new Error('Public use requires explicit license evidence');

async function readJsonl(file) {
  const content = await readFile(join(inputDir, file), 'utf8');
  return content.split(/\r?\n/).filter(Boolean).map((line, i) => {
    try { return JSON.parse(line); } catch { throw new Error(`${file}:${i + 1}: invalid JSON`); }
  });
}
const items = await readJsonl('items.jsonl');
const applications = await readJsonl('applications.jsonl');
const validKinds = new Set(['windshield', 'door', 'side', 'rear', 'roof']);
const classification = new Set(['verified', 'proposed', 'unknown', 'rejected']);
function validSelection(s, kind) {
  const keys = Object.keys(s).sort().join(',');
  if (kind === 'windshield') return keys === 'kind';
  if (kind === 'door') return keys === 'door,kind,side' && ['left','right','unknown'].includes(s.side) && ['front','rear','sliding','unknown'].includes(s.door);
  if (kind === 'side') return keys === 'kind,mounting,section,side' && ['left','right','unknown'].includes(s.side) && ['front_quarter','rear_quarter','cargo','unknown'].includes(s.section) && ['body','door','unknown'].includes(s.mounting);
  if (kind === 'rear') return (keys === 'kind,layout' && ['single','unknown'].includes(s.layout)) || (keys === 'kind,layout,splitSide' && s.layout === 'split' && ['left','right','unknown'].includes(s.splitSide));
  if (kind === 'roof') return keys === 'kind,panel,system' && ['fixed','opening','unknown'].includes(s.system) && ['whole','front','middle','rear','unknown'].includes(s.panel);
  return false;
}
const norm = value => String(value ?? '').trim().normalize('NFKC').toLocaleUpperCase('en-US');
const id = (...parts) => createHash('sha256').update(parts.join('\0')).digest('hex').slice(0, 32);
const itemByKey = new Map();
function verificationFields(row, label) {
  if (!classification.has(row.classification)) throw new Error(`${label}: invalid classification`);
  if (row.classification === 'verified' && (!row.verified_by || !row.verified_at || !row.evidence_ref)) {
    throw new Error(`${label}: verified data requires verified_by, verified_at, and evidence_ref`);
  }
  if (!row.source_record_ref) throw new Error(`${label}: source_record_ref is required`);
}
for (const [i, row] of items.entries()) {
  const label = `items.jsonl:${i + 1}`;
  if (!row.supplier_item_key || !row.part_number || !validKinds.has(row.kind)) throw new Error(`${label}: item identity and explicit kind are required`);
  if (!row.selection || row.selection.kind !== row.kind || !validSelection(row.selection, row.kind)) throw new Error(`${label}: invalid, mismatched, or extra selection fields`);
  if (!row.attributes || Array.isArray(row.attributes) || typeof row.attributes !== 'object') throw new Error(`${label}: attributes must be an object`);
  verificationFields(row, label);
  const key = String(row.supplier_item_key);
  if (itemByKey.has(key)) throw new Error(`${label}: duplicate supplier_item_key ${key}`);
  itemByKey.set(key, row);
}
for (const [i, row] of applications.entries()) {
  const label = `applications.jsonl:${i + 1}`;
  if (!itemByKey.has(String(row.supplier_item_key))) throw new Error(`${label}: unknown supplier_item_key`);
  if (!row.make || !row.model || !row.source_record_ref) throw new Error(`${label}: explicit make/model/source required`);
  if (!row.year_from || !row.year_to) throw new Error(`${label}: bounded model-year fitment is required for search eligibility`);
  if (row.year_from != null && (!Number.isInteger(row.year_from) || row.year_from < 1885)) throw new Error(`${label}: invalid year_from`);
  if (row.year_to != null && (!Number.isInteger(row.year_to) || row.year_to < 1885)) throw new Error(`${label}: invalid year_to`);
  if (row.year_from != null && row.year_to != null && row.year_from > row.year_to) throw new Error(`${label}: inverted year range`);
  if (!row.generation || !row.body_variant) throw new Error(`${label}: explicit generation and body_variant are required for verified fitment`);
  if (!['NO', 'EU', 'GLOBAL'].includes(row.market ?? 'NO')) throw new Error(`${label}: unsupported market`);
  verificationFields(row, label);
}
for (const row of items) {
  if (row.classification !== 'verified') continue;
  if (manifest.public_use_allowed !== true) throw new Error('Verified public catalogue data requires manifest.public_use_allowed=true and license evidence');
  if (!applications.some(app => String(app.supplier_item_key) === String(row.supplier_item_key) && app.classification === 'verified')) {
    throw new Error(`Verified item ${row.supplier_item_key} requires a verified vehicle application`);
  }
}
const report = {
  source: { id: manifest.source_id, version: manifest.source_version, license: manifest.license_ref, publicUseAllowed: manifest.public_use_allowed === true },
  input: { items: items.length, applications: applications.length },
  classifications: Object.fromEntries([...classification].map(c => [c, {
    items: items.filter(x => x.classification === c).length,
    applications: applications.filter(x => x.classification === c).length,
  }])),
  byKind: Object.fromEntries([...validKinds].map(k => [k, items.filter(x => x.kind === k).length])),
  byApplicationKind: Object.fromEntries([...validKinds].map(k => [k, applications.filter(a => itemByKey.get(String(a.supplier_item_key))?.kind === k).length])),
  eligiblePublicApplications: applications.filter(a => itemByKey.get(String(a.supplier_item_key))?.classification === 'verified' && a.classification === 'verified' && manifest.public_use_allowed === true).length,
  dryRun: args.has('--apply') !== true,
};
if (!args.has('--apply')) {
  console.log(JSON.stringify(report, null, 2));
} else {
  const dbFile = args.get('--db');
  if (typeof dbFile !== 'string' || !dbFile) throw new Error('--apply requires --db pointing to a local SQLite file; remote D1 is unsupported');
  if (args.has('--confirm-local-only') !== true) throw new Error('--apply requires --confirm-local-only');
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(dbFile);
  const root = fileURLToPath(new URL('../', import.meta.url));
  db.exec(await readFile(join(root, 'migrations/0034_glass_catalog_multi.sql'), 'utf8'));
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('UPDATE glass_catalog_items SET is_current = 0 WHERE source_id = ?').run(manifest.source_id);
    db.prepare('UPDATE glass_vehicle_applications SET is_current = 0 WHERE source_id = ?').run(manifest.source_id);
    const insertItem = db.prepare(`INSERT INTO glass_catalog_items
      (item_id,supplier,supplier_item_key,part_number,manufacturer,glass_kind,position_json,attributes_json,source_id,source_version,source_record_ref,license_ref,public_use_allowed,classification,verified_by,verified_at,evidence_ref,is_current)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1) ON CONFLICT(supplier,supplier_item_key) DO UPDATE SET
      part_number=excluded.part_number,manufacturer=excluded.manufacturer,glass_kind=excluded.glass_kind,position_json=excluded.position_json,
      attributes_json=excluded.attributes_json,source_id=excluded.source_id,source_version=excluded.source_version,source_record_ref=excluded.source_record_ref,
      license_ref=excluded.license_ref,public_use_allowed=excluded.public_use_allowed,classification=excluded.classification,verified_by=excluded.verified_by,
      verified_at=excluded.verified_at,evidence_ref=excluded.evidence_ref,is_current=1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')`);
    const insertApp = db.prepare(`INSERT INTO glass_vehicle_applications
      (application_id,item_id,make_key,model_key,generation_key,year_from,year_to,body_variant,door_count,market,source_id,source_version,source_record_ref,classification,verified_by,verified_at,evidence_ref,is_current)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1) ON CONFLICT(application_id) DO UPDATE SET
      make_key=excluded.make_key,model_key=excluded.model_key,generation_key=excluded.generation_key,year_from=excluded.year_from,year_to=excluded.year_to,
      body_variant=excluded.body_variant,door_count=excluded.door_count,market=excluded.market,source_id=excluded.source_id,source_version=excluded.source_version,
      source_record_ref=excluded.source_record_ref,classification=excluded.classification,verified_by=excluded.verified_by,verified_at=excluded.verified_at,
      evidence_ref=excluded.evidence_ref,is_current=1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')`);
    for (const row of items) {
      insertItem.run(id(manifest.supplier, row.supplier_item_key), manifest.supplier, row.supplier_item_key,
        row.part_number, row.manufacturer ?? null, row.kind, JSON.stringify(row.selection), JSON.stringify(row.attributes), manifest.source_id,
        manifest.source_version, row.source_record_ref, manifest.license_ref, manifest.public_use_allowed === true ? 1 : 0,
        row.classification, row.verified_by ?? null, row.verified_at ?? null, row.evidence_ref ?? null);
    }
    for (const row of applications) {
      const itemId = id(manifest.supplier, row.supplier_item_key);
      insertApp.run(id(itemId, row.make, row.model, row.generation ?? '', row.year_from ?? '', row.year_to ?? '', row.source_record_ref), itemId,
        norm(row.make), norm(row.model), row.generation ? norm(row.generation) : null, row.year_from ?? null, row.year_to ?? null,
        row.body_variant ?? null, row.door_count ?? null, row.market ?? 'NO', manifest.source_id, manifest.source_version,
        row.source_record_ref, row.classification, row.verified_by ?? null, row.verified_at ?? null, row.evidence_ref ?? null);
    }
    db.exec('COMMIT');
    report.dryRun = false;
    report.appliedTo = dbFile;
    console.log(JSON.stringify(report, null, 2));
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  finally { db.close(); }
}
