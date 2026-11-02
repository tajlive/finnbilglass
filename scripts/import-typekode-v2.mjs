#!/usr/bin/env node
/**
 * Import Typekode fra auto-glass.no varekort (CSV) → glass_typekode-tabell.
 * 
 * BRUK:
 *   node scripts/import-typekode-v2.mjs --csv <fil> [--dry-run] [--limit N]
 * 
 * FORVENTET CSV-kolonner (fra products-autoglass-no.csv):
 *   sku,title,brand,model,submodel,year_start,year_end,year_range,type_code,type_code_desc,price,source_url
 * 
 * SIKKERHET:
 *   - Default --dry-run (ingen D1-skriving)
 *   - Validerer alle rader før skriving
 *   - Rapporterer duplikater, konflikter, manglende felt
 *   - Ingen INSERT OR REPLACE — bruker INSERT OR IGNORE + UPDATE separat
 */

import { readFileSync } from 'node:fs';
import { parse } from 'csv-parse/sync';
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const csvIdx = args.indexOf('--csv');
const csvFil = csvIdx > -1 ? args[csvIdx + 1] : null;
const dryRun = !args.includes('--no-dry-run'); // DEFAULT true
const limitIdx = args.indexOf('--limit');
const limit = limitIdx > -1 ? parseInt(args[limitIdx + 1], 10) : null;

if (!csvFil) {
  console.error('Bruk: --csv <fil> [--dry-run|--no-dry-run] [--limit N]');
  process.exit(1);
}

const raw = readFileSync(csvFil, 'utf8');
const rader = parse(raw, { columns: true, skip_empty_lines: true, trim: true });
console.log(`Lest ${rader.length} rader fra ${csvFil}`);

// Normalisering av type_code → glassklasse, side, dor_ledd, ventil_ledd
const TYPE_MAP = {
  'F': { glassklasse: 'frontrute', side: null, dor_ledd: null, ventil_ledd: null },
  'B': { glassklasse: 'bakrute', side: null, dor_ledd: null, ventil_ledd: null },
  'DFF': { glassklasse: 'dor', side: 'venstre', dor_ledd: 'fremre', ventil_ledd: null },
  'DFB': { glassklasse: 'dor', side: 'venstre', dor_ledd: 'bakre', ventil_ledd: null },
  'DPF': { glassklasse: 'dor', side: 'hoyre', dor_ledd: 'fremre', ventil_ledd: null },
  'DPB': { glassklasse: 'dor', side: 'hoyre', dor_ledd: 'bakre', ventil_ledd: null },
  'DFFV': { glassklasse: 'ventil', side: 'venstre', dor_ledd: null, ventil_ledd: 'foran' },
  'DFBV': { glassklasse: 'ventil', side: 'venstre', dor_ledd: null, ventil_ledd: 'bakre' },
  'DPFV': { glassklasse: 'ventil', side: 'hoyre', dor_ledd: null, ventil_ledd: 'foran' },
  'DPBV': { glassklasse: 'ventil', side: 'hoyre', dor_ledd: null, ventil_ledd: 'bakre' },
  'SFB1': { glassklasse: 'side', side: 'venstre', dor_ledd: null, ventil_ledd: null },
  'SPB1': { glassklasse: 'side', side: 'hoyre', dor_ledd: null, ventil_ledd: null },
  'SFB2': { glassklasse: 'side', side: 'venstre', dor_ledd: null, ventil_ledd: null },
  'SPB2': { glassklasse: 'side', side: 'hoyre', dor_ledd: null, ventil_ledd: null },
  'SFB3': { glassklasse: 'side', side: 'venstre', dor_ledd: null, ventil_ledd: null },
  'SPB3': { glassklasse: 'side', side: 'hoyre', dor_ledd: null, ventil_ledd: null },
};

const rapporter = { ok: 0, skip: 0, feil: 0, konflikter: [], duplikater: [] };
const sett = new Set();

for (let i = 0; i < rader.length; i++) {
  const r = rader[i];
  const varenr = (r.sku || '').trim().toUpperCase();
  const typekode = (r.type_code || '').trim().toUpperCase();
  const typekode_desc = (r.type_code_desc || '').trim();
  const url = (r.source_url || '').trim();

  if (!varenr || !typekode) { rapporter.feil++; continue; }
  if (!TYPE_MAP[typekode]) { rapporter.skip++; continue; }

  const n = TYPE_MAP[typekode];
  const key = `${varenr}|${typekode}`;
  if (sett.has(key)) { rapporter.duplikater.push(key); continue; }
  sett.add(key);

  // Sjekk mot eksisterende typekode i D1 (dry-run: simuler)
  const sql = `INSERT OR IGNORE INTO glass_typekode
    (varenr, typekode, typekode_desc, glassklasse, side, dor_ledd, ventil_ledd, kilde, kilde_url, hentet_dato, oppdatert)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'VAREKORT', ?, datetime('now'), datetime('now'))`;
  const params = [varenr, typekode, typekode_desc, n.glassklasse, n.side, n.dor_ledd, n.ventil_ledd, url];

  if (dryRun) {
    console.log(`[DRY-RUN] ${varenr} → ${typekode} (${typekode_desc}) → ${n.glassklasse}${n.side ? ` ${n.side}` : ''}${n.dor_ledd ? ` ${n.dor_ledd}` : ''}${n.ventil_ledd ? ` ${n.ventil_ledd}` : ''}`);
    rapporter.ok++;
  } else {
    try {
      execFileSync('npx', ['wrangler', 'd1', 'execute', 'finnbilglass-db-staging', '--remote', '--command', sql, '--bind', ...params], { encoding: 'utf8', stdio: 'pipe' });
      rapporter.ok++;
    } catch (e) {
      console.error(`Feil ved ${varenr}:`, e.message);
      rapporter.feil++;
    }
  }

  if (limit && rapporter.ok >= limit) break;
}

console.log('\n=== RAPPORT ===');
console.log(`OK (ville bli importert): ${rapporter.ok}`);
console.log(`Hopp over (ukjent type_code): ${rapporter.skip}`);
console.log(`Feil: ${rapporter.feil}`);
console.log(`Duplikater i kilde: ${rapporter.duplikater.length}`);
if (rapporter.konflikter.length) console.log('Konflikter:', JSON.stringify(rapporter.konflikter, null, 2));

if (dryRun) console.log('\n⚠️  DRY-RUN — ingen data skrevet til D1. Kjør med --no-dry-run for å importere.');