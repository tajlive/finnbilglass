#!/usr/bin/env node
/**
 * Eksport av canonical glass master → systemnøytralt snapshot (KLA-311 F1B).
 *
 * Leser de versjonerte canonical-tabellene fra finnbilglass D1 (staging) og
 * skriver ett idempotent SQL-dump + manifest til data/canonical-master/.
 * Samme artefakt importeres deretter i Autoglassgrossisten B2B
 * (glass-catalog-db, konto 2266e975) via CI — slik at begge resolverne deler
 * samme source_id + raw_fingerprint + canonical-rader.
 *
 * Regler (runbook tecdoc-integration-runbook.md):
 *  - systemnøytralt format, ingen runtime-avhengighet mellom kontoene
 *  - idempotent (INSERT OR IGNORE) — kan kjøres på nytt uten duplikater
 *  - pris/lager/ordre eksporteres ALDRI — canonical master linker kun
 *  - fingerprint = sha256 av selve dumpet (reproduserbar verifisering)
 *
 * Bruk:
 *   node scripts/export-canonical-master.mjs            # staging (default)
 *   node scripts/export-canonical-master.mjs --db navn  # annen DB
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT = join(ROOT, 'data', 'canonical-master');
const DB = process.argv.includes('--db')
  ? process.argv[process.argv.indexOf('--db') + 1]
  : 'finnbilglass-db-staging';

// Canonical-tabeller i eksport-rekkefølge (FK-rekkefølge: master før avhengige).
const TABLES = ['source_katalog', 'glass_master', 'glass_identifiers', 'glass_features', 'glass_vehicle_links'];

loadDotEnvLocal();

function loadDotEnvLocal() {
  // FinnBilGlass har ingen egen .env.local — token hentes fra klarpakke/.env.local
  // (samme CF-konto 80d5b1d5). Fallback til egen .env.local om den finnes.
  const candidates = [join(ROOT, '.env.local'), '/Users/taj/klarpakke/.env.local'];
  for (const envPath of candidates) {
    if (!existsSync(envPath)) continue;
    for (const line of readFileSync(envPath, 'utf8').split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(t);
      if (!m || process.env[m[1]] != null) continue;
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      process.env[m[1]] = v;
    }
  }
  if (!process.env.CLOUDFLARE_API_TOKEN || !process.env.CLOUDFLARE_ACCOUNT_ID) {
    console.error('CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID mangler (sjekk klarpakke/.env.local).');
    process.exit(2);
  }
}

function run(args) {
  try {
    return execFileSync('npx', args, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', env: process.env });
  } catch (e) {
    const msg = (e.stderr || e.message || '').replace(/\u001b\[[0-9;]*m/g, '').split('\n').filter(Boolean).slice(-6).join(' | ');
    console.error(`  FEIL i: npx ${args.join(' ')}\n  → ${msg}`);
    process.exit(1);
  }
}

function d1Json(command) {
  const out = run(['wrangler', 'd1', 'execute', DB, '--remote', '--json', '--command', command]);
  return JSON.parse(out);
}

function sha256(s) { return createHash('sha256').update(s).digest('hex'); }
/** Skriv gzip-komprimert (SQL komprimerer ~35x; git-vennlig). */
function writeGzip(path, content) { writeFileSync(path, gzipSync(content, { level: 9 })); }

async function main() {
  // Rens gammel eksport (idempotent output-katalog).
  if (existsSync(OUT)) rmSync(OUT, { recursive: true });
  mkdirSync(OUT, { recursive: true });

  console.log(`Eksporterer canonical master fra ${DB} …`);

  // 1) Eksporter hver tabell (med eksplisitt id — bevarer glass_id-referanser).
  const counts = {};
  const dumpParts = [];
  for (const table of TABLES) {
    const rawFile = join(OUT, `${table}.sql`);
    run(['wrangler', 'd1', 'export', DB, '--remote', '--no-schema', '--table', table, '--output', rawFile]);
    let sql = readFileSync(rawFile, 'utf8');
    // Idempotent: INSERT → INSERT OR IGNORE (unngår duplikater ved re-import).
    sql = sql.replace(/\bINSERT INTO\b/g, 'INSERT OR IGNORE INTO');
    writeGzip(`${rawFile}.gz`, sql);
    rmSync(rawFile); // behold kun .gz
    counts[table] = 0; // fylles under
    dumpParts.push(sql.trim());
  }

  // 2) Radtall per tabell (fasit for manifest + CI-verifisering).
  const countQ = TABLES.map((t) => `SELECT '${t}' AS t, COUNT(*) AS n FROM ${t}`).join(' UNION ALL ');
  try {
    const res = d1Json(countQ);
    for (const r of res[0]?.results ?? []) counts[r.t] = r.n;
  } catch (e) {
    console.warn('  Kunne ikke lese radtall — manifest får radtall=0:', e.message);
    for (const t of TABLES) counts[t] = 0;
  }

  // 3) Samlet dump (ett fil, gzip) + manifest.
  const combined = dumpParts.join('\n\n');
  const fingerprint = sha256(combined);
  writeGzip(join(OUT, 'canonical-master.sql.gz'), combined + '\n');

  // Hent source_id + license_ref fra source_katalog (provenance-fasit).
  const srcQ = 'SELECT DISTINCT source_id, license_ref FROM source_katalog ORDER BY source_id';
  const srcRes = d1Json(srcQ);
  const sources = (srcRes[0]?.results ?? []).map((r) => ({
    source_id: r.source_id,
    license_ref: r.license_ref,
  }));

  const manifest = {
    schema: 'finnbilglass-canonical-master/v1',
    target: 'autoglassgrossisten-b2b/glass-catalog-db',
    source_db: DB,
    source_ids: sources.map((s) => s.source_id),
    license_refs: [...new Set(sources.map((s) => s.license_ref))],
    raw_fingerprint: `sha256:${fingerprint}`,
    exported_at: new Date().toISOString(),
    counts,
    notes: 'Systemnøytralt, idempotent snapshot. Pris/lager/ordre er IKKE inkludert — B2B beholder egen autoritet.',
  };
  writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

  console.log('\nEksport ferdig:');
  console.log(`  mål: ${OUT}`);
  console.log(`  fingerprint: ${manifest.raw_fingerprint}`);
  console.log('  radtall:', JSON.stringify(counts));
  console.log('  kilder:', sources.map((s) => `${s.source_id} (${s.license_ref})`).join(', '));
}

main().catch((e) => { console.error('FEIL:', e.message); process.exit(1); });
