#!/usr/bin/env node
/**
 * Import av resolver-data til finnbilglass D1 (staging som standard).
 *
 * Kilder (lokale filer fra B2B-repoet /Users/taj/bilglass):
 *   - data/ground-truth-seed.sql        → ground_truth (verifiserte kjøretøy → frontrute)
 *   - api/cf-worker/generated-inserts.sql → glass_catalog (Pilkington, 33 215 rader)
 *   - api/cf-worker/scripts/ground_truth_rows.json → ktype_registry (make/model/år → ktype)
 *
 * B2B-LIVE-modus (krever B2B_CLOUDFLARE_API_TOKEN + B2B_CLOUDFLARE_ACCOUNT_ID):
 *   eksporterer vin_ktype_map / ground_truth / glass_catalog / oe_eurocode_mapping
 *   direkte fra glass-catalog-db (konto 2266e975) og importerer enriched data.
 *
 * Repeterbar: sletter resolver-tabeller, importerer, skriver metadata i
 * resolver_meta (source_version / source_updated_at / imported_at + radtall).
 *
 * Bruk:
 *   node scripts/import-resolver-data.mjs            # staging (default)
 *   node scripts/import-resolver-data.mjs --db navn  # annen DB
 *   node scripts/import-resolver-data.mjs --require-live
 *   B2B_CLOUDFLARE_API_TOKEN=... node scripts/import-resolver-data.mjs
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const B2B = '/Users/taj/bilglass';
const OUT = '/tmp/resolver-import';
const DB = process.argv.includes('--db')
  ? process.argv[process.argv.indexOf('--db') + 1]
  : 'finnbilglass-db-staging';
const REQUIRE_LIVE = process.argv.includes('--require-live');

loadDotEnvLocal();

const LIVE = !!(process.env.B2B_CLOUDFLARE_API_TOKEN && process.env.B2B_CLOUDFLARE_ACCOUNT_ID);
if (REQUIRE_LIVE && !LIVE) {
  console.error([
    'B2B-live import er påkrevd, men token mangler.',
    'Sett i miljøet eller .env.local:',
    '  B2B_CLOUDFLARE_API_TOKEN=<token for B2B-konto med D1 read/export>',
    '  B2B_CLOUDFLARE_ACCOUNT_ID=<B2B account id>',
    '',
    'Ingen staging-tabeller er endret.',
  ].join('\n'));
  process.exit(2);
}

mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------------------
// SQL-tuple-parser (tolerant: strings, NULL, tall, JSON i quotes, escaped '')
// ---------------------------------------------------------------------------
function parseInsertLines(sql) {
  const rows = [];
  const header = sql.match(/INSERT INTO[^(]*\(([^)]+)\) VALUES/i);
  const cols = header ? header[1].split(',').map((c) => c.trim().replace(/^"|"$/g, '')) : null;
  for (const line of sql.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('(')) continue;
    let pos = 0;
    while (pos < t.length) {
      if (t[pos] !== '(') { pos++; continue; }
      // parse én tuple fra pos
      let cur = '', vals = [], inStr = false, i = pos + 1;
      while (i < t.length) {
        const ch = t[i];
        if (inStr) {
          if (ch === "'" && t[i + 1] === "'") { cur += "'"; i += 2; continue; }
          if (ch === "'") { inStr = false; cur += ch; }
          else cur += ch;
          i++; continue;
        }
        if (ch === "'") { inStr = true; cur += ch; i++; continue; }
        if (ch === ',') { vals.push(cur.trim()); cur = ''; i++; continue; }
        if (ch === ')') { vals.push(cur.trim()); break; }
        cur += ch; i++;
      }
      if (vals.length) rows.push(vals);
      pos = i + 1;
    }
  }
  return { cols, rows };
}
function v(raw) {
  const s = raw.trim();
  if (s === 'NULL') return null;
  if (s.startsWith("'") && s.endsWith("'")) return s.slice(1, -1);
  return s;
}
function vn(raw) {
  const s = v(raw);
  if (s === null) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------
// Hjelpere
// ---------------------------------------------------------------------------
function loadDotEnvLocal() {
  const envPath = join(ROOT, '.env.local');
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(trimmed);
    if (!m || process.env[m[1]] != null) continue;
    let value = m[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[m[1]] = value;
  }
}

function run(args, env = {}) {
  try {
    execFileSync('npx', args, { stdio: 'pipe', env: { ...process.env, ...env } });
  } catch (e) {
    const msg = (e.stderr?.toString() || e.message || '').replace(/\u001b\[[0-9;]*m/g, '').split('\n').filter(Boolean).slice(-6).join(' | ');
    console.error(`  FEIL i: npx ${args.join(' ')}\n  → ${msg}`);
    process.exit(1);
  }
}
function d1(file) {
  run(['wrangler', 'd1', 'execute', DB, '--remote', '--file', file]);
  console.log(`  → ${file} (${DB})`);
}
function metaSql(rows) {
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const lines = rows.map(([k, val]) =>
    `INSERT OR REPLACE INTO resolver_meta (key, value, updated_at) VALUES ('${k}', '${String(val).replace(/'/g, "''")}', '${now}');`);
  return lines.join('\n');
}
// Batchet INSERT (200 rader per statement — D1-størrelsesgrense, SQLITE_TOOBIG)
function batch(rows, into, colsTxt) {
  const parts = [];
  for (let i = 0; i < rows.length; i += 200) {
    parts.push(`INSERT INTO ${into} ${colsTxt} VALUES\n${rows.slice(i, i + 200).join(',\n')};`);
  }
  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// 1) ground_truth fra B2B-seed (lokale filer)
// ---------------------------------------------------------------------------
const gtSql = readFileSync(join(B2B, 'data/ground-truth-seed.sql'), 'utf8');
const gt = parseInsertLines(gtSql);
const gtOut = [];
const seenGt = new Set();
for (const r of gt.rows) {
  const make = v(r[1])?.toUpperCase(), model = v(r[2])?.toUpperCase(), year = vn(r[3]);
  const front = v(r[5])?.toUpperCase();
  if (!make || !model || !year || !front || front === 'NULL') continue;
  const key = `${make}|${model}|${year}|${front}`;
  if (seenGt.has(key)) continue;
  seenGt.add(key);
  gtOut.push(`('${make.replace(/'/g, "''")}','${model.replace(/'/g, "''")}',${year},'${front}','auto-glass.no',0.85,'b2b-seed')`);
}
const gtFile = join(OUT, '01_ground_truth.sql');
writeFileSync(gtFile, 'DELETE FROM ground_truth;\n' + batch(gtOut, 'ground_truth', '(make, model, year, frontrute_eurocode, verified_by, confidence, source)'));
d1(gtFile);
console.log(`  ground_truth: ${gtOut.length} rader`);

// ---------------------------------------------------------------------------
// 2) glass_catalog fra Pilkington-dump (lokale filer)
// ---------------------------------------------------------------------------
const pilkSql = readFileSync(join(B2B, 'api/cf-worker/generated-inserts.sql'), 'utf8');
const pilk = parseInsertLines(pilkSql);
const gcOut = [], oeOut = [];
const seenGc = new Set();
const col = (name) => pilk.cols.indexOf(name);
const C = {
  eurocode: col('eurocode'), category: col('category'), supplier: col('supplier'),
  brand: col('brand'), model: col('model'), yf: col('year_from'), yt: col('year_to'),
  adas: col('adas'), rain: col('rain_sensor'), heated: col('heated'), acoustic: col('acoustic'),
  antenna: col('antenna'), hud: col('hud'), shade: col('shade'), camera: col('camera'),
  lane: col('lane_assist'), price: col('price'), stock: col('stock_status'),
  oem: col('oem_numbers'), dim: col('dimensions'), desc: col('description'),
  prefix: col('prefix4'), src: col('source'), brandOrig: col('brand_original'),
};
for (const r of pilk.rows) {
  const eurocode = v(r[C.eurocode])?.toUpperCase();
  if (!eurocode) continue;
  const key = `${eurocode}|${v(r[C.brand])?.toUpperCase()}|${v(r[C.model])?.toUpperCase()}|${v(r[C.src])}`;
  if (seenGc.has(key)) continue;
  seenGc.add(key);
  const s = (x) => (x === null ? 'NULL' : `'${String(x).replace(/'/g, "''")}'`);
  const n = (x) => (x === null || x === undefined || x === '' ? 'NULL' : Number(x));
  gcOut.push(`(${s(eurocode)},${s(v(r[C.category]))},${s(v(r[C.supplier]))},${s(v(r[C.brand])?.toUpperCase())},${s(v(r[C.model]))},${n(vn(r[C.yf]))},${n(vn(r[C.yt]))},${n(vn(r[C.adas]))},${n(vn(r[C.rain]))},${n(vn(r[C.heated]))},${n(vn(r[C.acoustic]))},${n(vn(r[C.antenna]))},${n(vn(r[C.hud]))},${n(vn(r[C.shade]))},${n(vn(r[C.camera]))},${n(vn(r[C.lane]))},${n(vn(r[C.price]))},${n(vn(r[C.stock]))},${s(v(r[C.oem]))},${s(v(r[C.dim]))},${s(v(r[C.desc]))},${s(v(r[C.prefix]))},${s(v(r[C.src]))},${s(v(r[C.brandOrig]))})`);
  // OE-nummer → eurocode
  const oem = v(r[C.oem]);
  if (oem && oem !== '[]') {
    try {
      const arr = JSON.parse(oem);
      for (const oe of arr) {
        const oeKey = `${String(oe).toUpperCase()}|${eurocode}`;
        if (!oe || seenGc.has('OE' + oeKey)) continue;
        seenGc.add('OE' + oeKey);
        oeOut.push(`('${String(oe).replace(/'/g, "''")}','${eurocode}','${v(r[C.brand])?.toUpperCase() ?? ''}','${v(r[C.model])?.replace(/'/g, "''") ?? ''}','${v(r[C.category]) ?? ''}','b2b-pilkington')`);
      }
    } catch { /* ignorér ugyldig JSON */ }
  }
}
// Batchet INSERT (500 rader per statement — D1-størrelsesgrense) — definert i hjelpere
const gcFile = join(OUT, '02_glass_catalog.sql');
writeFileSync(gcFile, 'DELETE FROM glass_catalog;\n' + batch(gcOut, 'glass_catalog', '(eurocode, category, supplier, brand, model, year_from, year_to, adas, rain_sensor, heated, acoustic, antenna, hud, shade, camera, lane_assist, price, stock_status, oem_numbers, dimensions, description, prefix4, source, brand_original)'));
d1(gcFile);
console.log(`  glass_catalog: ${gcOut.length} rader`);
if (oeOut.length) {
  const oeFile = join(OUT, '03_oe_eurocode_mapping.sql');
  writeFileSync(oeFile, 'DELETE FROM oe_eurocode_mapping;\n' + batch(oeOut, 'oe_eurocode_mapping', '(oe_number, eurocode, brand, model, category, source)'));
  d1(oeFile);
  console.log(`  oe_eurocode_mapping: ${oeOut.length} rader`);
}

// ---------------------------------------------------------------------------
// 3) ktype_registry fra ground_truth_rows.json (lokal)
// ---------------------------------------------------------------------------
const gtRowsPath = join(B2B, 'api/cf-worker/scripts/ground_truth_rows.json');
const ktOut = [];
if (existsSync(gtRowsPath)) {
  const gj = JSON.parse(readFileSync(gtRowsPath, 'utf8'));
  const arr = Array.isArray(gj) ? gj : (gj.rows ?? Object.values(gj));
  const seenKt = new Set();
  for (const e of arr) {
    const make = (e.make ?? e.brand ?? e.merke ?? '').toString().toUpperCase();
    const model = (e.model ?? e.modell ?? '').toString().toUpperCase();
    const ktype = (e.k_type ?? e.ktype ?? e.kType ?? e.type_code ?? '').toString();
    const yf = e.year_from ?? e.year ?? e.aar ?? null;
    const yt = e.year_to ?? null;
    if (!make || !model || !ktype) continue;
    if (seenKt.has(ktype)) continue;
    seenKt.add(ktype);
    const s = (x) => (x === null || x === undefined || x === '' ? 'NULL' : `'${String(x).replace(/'/g, "''")}'`);
    const n = (x) => (x === null || x === undefined || x === '' ? 'NULL' : Number(x));
    ktOut.push(`(${s(ktype)},${s(make)},${s(model)},${n(yf)},${n(yt)},'b2b-ground-truth-rows')`);
  }
}
if (ktOut.length) {
  const ktFile = join(OUT, '04_ktype_registry.sql');
  writeFileSync(ktFile, 'DELETE FROM ktype_registry;\n' + batch(ktOut, 'ktype_registry', '(ktype, brand, model, year_from, year_to, source)'));
  d1(ktFile);
  console.log(`  ktype_registry: ${ktOut.length} rader`);
} else {
  console.log('  ktype_registry: 0 rader (kilde mangler/ugyldig)');
}

// ---------------------------------------------------------------------------
// 4) B2B-LIVE-modus: vin_ktype_map + enriched ground_truth/glass_catalog/oe
// ---------------------------------------------------------------------------
if (LIVE) {
  console.log('  B2B-live-modus: eksporterer fra glass-catalog-db …');
  const b2bEnv = { CLOUDFLARE_API_TOKEN: process.env.B2B_CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID: process.env.B2B_CLOUDFLARE_ACCOUNT_ID };
  run(['wrangler', 'd1', 'execute', 'glass-catalog-db', '--remote', '--json', '--command', 'SELECT COUNT(*) AS n FROM vin_ktype_map LIMIT 1'], b2bEnv);
  for (const [table, outFile] of [['vin_ktype_map', 'b2b_vin_ktype_map.sql'], ['ground_truth', 'b2b_ground_truth.sql'], ['glass_catalog', 'b2b_glass_catalog.sql'], ['oe_eurocode_mapping', 'b2b_oe.sql']]) {
    try {
      run(['wrangler', 'd1', 'export', 'glass-catalog-db', '--remote', '--no-schema', '--table', table, '--output', join(OUT, outFile)], b2bEnv);
      console.log(`  eksportert ${table}`);
    } catch (e) {
      console.error(`  EKSPORT FIKLET for ${table}:`, e.stderr?.toString().slice(0, 300) ?? e.message);
    }
  }
  // vin_ktype_map — mapping etter kolonnenavn
  const vkFile = join(OUT, 'b2b_vin_ktype_map.sql');
  if (existsSync(vkFile)) {
    const vk = parseInsertLines(readFileSync(vkFile, 'utf8'));
    const vkOut = [];
    const seen = new Set();
    for (const r of vk.rows) {
      const get = (name) => v(r[vk.cols.indexOf(name)]);
      const vin = get('vin')?.toUpperCase(), ktype = get('k_type') ?? get('ktype');
      if (!vin || !ktype || seen.has(vin)) continue;
      seen.add(vin);
      const s = (x) => (x === null || x === undefined || x === '' ? 'NULL' : `'${String(x).replace(/'/g, "''")}'`);
      const n = (x) => (x === null || x === undefined || x === '' ? 'NULL' : Number(x));
      vkOut.push(`(${s(vin)},${s(ktype)},${s(get('regnr_hash'))},${s(get('make')?.toUpperCase())},${s(get('model')?.toUpperCase())},${n(get('year'))},${n(get('confidence'))},'b2b-live')`);
    }
    if (vkOut.length) {
      const out2 = join(OUT, '05_vin_ktype_map.sql');
      writeFileSync(out2, 'DELETE FROM vin_ktype_map;\n' + batch(vkOut, 'vin_ktype_map', '(vin, ktype, regnr_hash, make, model, year, confidence, source)'));
      d1(out2);
      console.log(`  vin_ktype_map: ${vkOut.length} rader`);
    }
  }
} else {
  console.log('  vin_ktype_map: hoppet over (lokal modus — krever B2B-token)');
}

// ---------------------------------------------------------------------------
// 4b) Eksakte VIN-fasitoverstyringer (smal lokal datakilde)
// ---------------------------------------------------------------------------
const vinOverridePath = join(ROOT, 'data/vin-glass-overrides.sql');
if (existsSync(vinOverridePath)) {
  d1(vinOverridePath);
  console.log('  vin_glass_overrides: importert fra data/vin-glass-overrides.sql');
}

// ---------------------------------------------------------------------------
// 5) Metadata (versjonert, repeterbar)
// ---------------------------------------------------------------------------
let sourceVersion = 'lokal-filer';
let sourceUpdatedAt = '';
try {
  sourceVersion = execFileSync('git', ['-C', B2B, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim().slice(0, 12);
  const seedMtime = statSync(join(B2B, 'data/ground-truth-seed.sql')).mtime.toISOString();
  const dumpMtime = statSync(join(B2B, 'api/cf-worker/generated-inserts.sql')).mtime.toISOString();
  sourceUpdatedAt = seedMtime > dumpMtime ? seedMtime : dumpMtime;
} catch { /* beholder default */ }
const counts = {};
for (const t of ['ground_truth', 'glass_catalog', 'ktype_registry', 'vin_ktype_map', 'oe_eurocode_mapping', 'vin_glass_overrides']) {
  try {
    const out = execFileSync('npx', ['wrangler', 'd1', 'execute', DB, '--remote', '--json', '--command', `SELECT COUNT(*) AS n FROM ${t};`], { encoding: 'utf8', env: process.env });
    counts[t] = JSON.parse(out)[0]?.results?.[0]?.results?.[0]?.n ?? JSON.parse(out)[0]?.results?.[0]?.n ?? '?';
  } catch { counts[t] = '?'; }
}
const metaFile = join(OUT, '06_meta.sql');
writeFileSync(metaFile, metaSql([
  ['resolver_data_mode', LIVE ? 'b2b-live' : 'b2b-local-files'],
  ['source_version', `${sourceVersion} (${LIVE ? 'live-eksport' : 'lokal-filer'})`],
  ['source_updated_at', sourceUpdatedAt],
  ['imported_at', new Date().toISOString()],
  ...Object.entries(counts).map(([k, v]) => [`count_${k}`, String(v)]),
]));
d1(metaFile);
console.log('\nFerdig. Radtall:', JSON.stringify(counts));
