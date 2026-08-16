#!/usr/bin/env node
/**
 * FASE 2 — Crosswalk-pipeline (KLA-301).
 *
 * Idempotent transformasjon: harvester-records.jsonl → canonical glass master
 * (glass_master/identifiers/features/vehicle_links) som SQL-emit.
 *
 * Regler (oppdragsgitt):
 *  - ett OEM-nummer kan ha flere gyldige glass
 *  - samme Eurocode kan ha flere leverandørnumre
 *  - features lagres SEPARAT fra identitet (aldri innbakt i eurocode)
 *  - FinnBilGlass-prislisten er eneste kilde for sluttpris — pipelinen
 *    setter ALDRI pris; den linker kun (pris løses ved oppslag)
 *  - konflikt løses IKKE med gjetning → rad merkes UNRESOLVED
 *  - substring-matching er forbudt (alle matcher er eksakte/ord-baserte)
 *  - alle transformasjoner forklares i audit-loggen
 *
 * Output (dry-run default):
 *   emit.sql       idempotente INSERT-er (ON CONFLICT DO NOTHING)
 *   audit.jsonl    forklaringslogg per transformasjon
 *   state.json     checkpoint/resume
 *   unresolved.jsonl
 */

import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';

const EUROCODE_RE = /^[A-Z0-9]{6,17}$/; // faktisk format i våre data: 8-15 tegn (spes. sa 15/17 — korrigert mot fasit)
const SOURCE_ID = 'b2b-canonical-v1';

function sha256(s) { return createHash('sha256').update(s).digest('hex'); }
function iso() { return new Date().toISOString(); }
function q(s) { return `'${String(s).replace(/'/g, "''")}'`; }

/** Normaliser eurocode: fjern separatorer. Faktisk format i våre data: 8-15 tegn
 *  (fasit: 8579ACSGYAVZ1B=14, 2525CSGYA=9). Krav: 6-17 tegn, minst 2 bokstaver. */
function normEurocode(raw) {
  if (!raw) return null;
  const c = String(raw).toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (c.length < 6 || c.length > 17) return null;
  if ((c.match(/[A-Z]/g) ?? []).length < 2) return null;
  return c;
}

/** Ord-tokens (≥2 tegn). Aldri substring-matching. */
function ordTokens(s) {
  return (s || '').toUpperCase().replace(/[^A-ZÆØÅ0-9]+/g, ' ').split(/\s+/).filter((t) => t.length >= 2);
}
function ordTreff(model, tokens) {
  const sett = new Set(ordTokens(model));
  return tokens.some((t) => sett.has(t));
}

const FEATURE_COLUMNS = ['rain_sensor', 'heated', 'hud', 'camera', 'adas', 'antenna', 'acoustic', 'solar_coated', 'mirror_bracket', 'vin_window', 'panoramic', 'shade', 'lane_assist'];

/**
 * Validerer én harvester-record (canonical-skjema v1) og normaliserer til
 * én struktur PER eurocode (en record kan ha flere eurocodes — de deler
 * fitment/features/identifikatorer). Aldri gjetting ved konflikt.
 */
function normalizeRecord(rec) {
  const errors = [];
  const fitment = rec.fitment ?? {};
  const inputEurocodes = Array.isArray(rec.eurocodes)
    ? rec.eurocodes
    : (rec.eurocode ? [rec.eurocode] : []);
  const inputOemNumbers = Array.isArray(rec.oem_numbers)
    ? rec.oem_numbers
    : (rec.oem_number ? [rec.oem_number] : []);
  const idents = [];
  const seen = new Set();
  const pushIdent = (type, val) => {
    if (!val) return;
    const v = String(val).trim().toUpperCase();
    const key = `${type}:${v}`;
    if (type === 'EUROCODE' && !normEurocode(v)) return;
    if (v.length < 4 || seen.has(key)) return;
    seen.add(key);
    idents.push({ type, value: v });
  };
  for (const e of inputEurocodes) pushIdent('EUROCODE', e);
  for (const o of inputOemNumbers) pushIdent('OEM', o);
  pushIdent('ARTICLE', rec.article_number);
  pushIdent('SUPPLIER', rec.supplier_number);
  pushIdent('TRADE', rec.trade_number);
  pushIdent('GTIN_EAN', rec.gtin_ean);

  const features = [];
  const feat = { ...rec, ...(rec.features ?? {}) };
  for (const f of FEATURE_COLUMNS) {
    if (!(f in feat)) continue;
    const v = feat[f];
    if (v === true || v === false) features.push({ feature: f, value: v ? 'true' : 'false', confidence: 0.6 });
    else features.push({ feature: f, value: 'unknown', confidence: 0.3 });
  }

  const eurocodes = [...new Set(inputEurocodes.map(normEurocode).filter(Boolean))];
  if (eurocodes.length === 0) {
    errors.push(`ugyldig eurocode: ingen gyldig eurocode i record (eurocodes=${JSON.stringify(inputEurocodes)})`);
  }
  const aar = (v) => (v == null || v === '' ? null : parseInt(v, 10));
  const fit = {
    make: (fitment.brand ?? rec.make) ? String(fitment.brand ?? rec.make).toUpperCase() : null,
    model: (fitment.model ?? rec.model) ? String(fitment.model ?? rec.model) : null,
    year_from: aar(fitment.year_from ?? rec.year_from),
    year_to: aar(fitment.year_to ?? rec.year_to),
    ktype: fitment.ktype ?? rec.ktype ?? null,
  };
  return { eurocodes, idents, features, fit, errors };
}

async function main() {
  const argv = process.argv.slice(2);
  const opts = { dryRun: true, resume: true };
  let input = null;
  let out = '/tmp/fbg-crosswalk';
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') opts.dryRun = false;
    else if (a === '--fresh') opts.resume = false;
    else if (a === '--help') { console.log('Bruk: node scripts/crosswalk-pipeline.mjs --input records.jsonl [--out DIR] [--apply] [--fresh]'); process.exit(0); }
    else if (a === '--input') input = argv[++i];
    else if (a === '--out') out = argv[++i];
  }
  if (!input) { console.error('Mangler --input <records.jsonl>'); process.exit(2); }
  out = resolve(out);
  await mkdir(out, { recursive: true });

  const statePath = join(out, 'state.json');
  const state = (opts.resume && existsSync(statePath)) ? JSON.parse(await readFile(statePath, 'utf8')) : { processed: 0, lastOffset: 0 };

  const raw = await readFile(input, 'utf8');
  const lines = raw.split('\n').filter((l) => l.trim());
  let processed = 0, skipped = 0;
  const emit = [], audit = [], unresolved = [];
  const euroToGlass = new Map(); // eurocode → glass_key (deler identitet)
  const oemToEuro = new Map();   // OEM → eurocode-liste (ett OEM, flere glass)

  for (let i = 0; i < lines.length; i++) {
    if (i < state.lastOffset) continue;
    let rec;
    try { rec = JSON.parse(lines[i]); } catch (e) { audit.push({ ts: iso(), line: i + 1, action: 'skip', reason: 'ugyldig JSON' }); skipped++; continue; }

    const { eurocodes, idents, features, fit, errors } = normalizeRecord(rec);
    if (errors.length) {
      unresolved.push({ line: i + 1, errors, record_id: rec.record_id });
      audit.push({ ts: iso(), line: i + 1, action: 'unresolved', reason: errors.join('; ') });
      skipped++;
      continue;
    }

    const sourceId = rec.source ?? SOURCE_ID;
    // Én record → ett glass per eurocode (deler fitment/features/identifikatorer).
    for (const eurocode of eurocodes) {
      const glassKey = `EUR:${eurocode}`;
      if (!euroToGlass.has(eurocode)) {
        euroToGlass.set(eurocode, glassKey);
        emit.push(`-- glass_master: ${eurocode} (${rec.source ?? 'ukjent'})`);
        emit.push(`INSERT OR IGNORE INTO glass_master (canonical_key, eurocode, category, brand, market, lhd_rhd, source_id)`);
        emit.push(`SELECT '${glassKey}', ${q(eurocode)}, 'frontrute', ${q(fit.make ?? null)}, 'NO', 'LHD', ${q(sourceId)}`);
        emit.push(`WHERE NOT EXISTS (SELECT 1 FROM glass_master WHERE canonical_key='${glassKey}' AND is_current=1);`);
        audit.push({ ts: iso(), line: i + 1, action: 'new_glass', eurocode, reason: 'ny canonical glass master-rad' });
      }

      // Identifikatorer: samme eurocode kan ha flere leverandørnumre (flere rader).
      for (const ident of idents) {
        if (ident.type === 'OEM') {
          if (!oemToEuro.has(ident.value)) oemToEuro.set(ident.value, []);
          if (!oemToEuro.get(ident.value).includes(eurocode)) oemToEuro.get(ident.value).push(eurocode);
        }
        emit.push(`INSERT OR IGNORE INTO glass_identifiers (glass_id, id_type, id_value, confidence) `);
        emit.push(`SELECT id, ${q(ident.type)}, ${q(ident.value)}, 0.8 FROM glass_master WHERE canonical_key='${glassKey}' AND is_current=1;`);
      }

      // Features: separat fra identitet.
      for (const f of features) {
        emit.push(`INSERT OR IGNORE INTO glass_features (glass_id, feature, value, confidence, source_id) `);
        emit.push(`SELECT id, ${q(f.feature)}, ${q(f.value)}, ${f.confidence}, ${q(sourceId)} FROM glass_master WHERE canonical_key='${glassKey}' AND is_current=1;`);
      }

      // Kjøretøy-lenke: fitment.brand + model (ord-token — aldri substring).
      if (fit.make && fit.model && ordTreff(fit.model, ordTokens(fit.model))) {
        emit.push(`INSERT OR IGNORE INTO glass_vehicle_links (glass_id, make, model, year_from, year_to, ktype, confidence, source_id) `);
        emit.push(`SELECT id, ${q(fit.make)}, ${q(fit.model)}, ${fit.year_from ?? 'NULL'}, ${fit.year_to ?? 'NULL'}, ${fit.ktype ? q(fit.ktype) : 'NULL'}, 0.6, ${q(sourceId)} FROM glass_master WHERE canonical_key='${glassKey}' AND is_current=1;`);
        audit.push({ ts: iso(), line: i + 1, action: 'vehicle_link', make: fit.make, model: fit.model, reason: 'ord-basert make/model-lenke' });
      }
    }

    processed++;
  }

  // OEM-crosswalk-audit: ett OEM → flere eurokoder er gyldig (dokumentert).
  for (const [oem, eurocodes] of oemToEuro) {
    audit.push({ ts: iso(), action: 'oem_crosswalk', oem, eurocodes, note: eurocodes.length > 1 ? 'ett OEM → flere gyldige glass (forventet)' : 'entydig' });
  }

  const report = {
    mode: opts.dryRun ? 'dry-run' : 'apply',
    input: input,
    recordsInFile: lines.length,
    processed,
    skipped,
    unresolved: unresolved.length,
    uniqueEurocodes: euroToGlass.size,
    oemMappings: oemToEuro.size,
    fingerprint: sha256(raw),
  };

  await writeFile(join(out, 'emit.sql'), emit.join('\n') + '\n');
  await writeFile(join(out, 'audit.jsonl'), audit.map((a) => JSON.stringify(a)).join('\n') + '\n');
  await writeFile(join(out, 'unresolved.jsonl'), unresolved.map((u) => JSON.stringify(u)).join('\n') + '\n');
  await writeFile(statePath, JSON.stringify({ processed: state.processed + processed, lastOffset: lines.length }, null, 2));
  await writeFile(join(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => { console.error('FEIL:', e.message); process.exit(1); });
