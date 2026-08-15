#!/usr/bin/env node
/**
 * GT-validering: simulerer lagGroundTruth-matchen (make + EKSAKT år + ordTreff)
 * for hull-kartets 2 335 biler — med GAMMEL GT (2 008 rader, b2b-seed) vs NY GT
 * (generert fra prislisten). Gir før/etter-PINPOINT uten å røre prod-DB.
 *
 * Usage: node scripts/gt-valider.mjs
 * Output: data/gt-ekspansjon/gt-validering.json + stdout-rapport
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { serieKey, normaliserKatalogModell } from '../src/serie-mapping.ts';

const DIR = '/Users/taj/finnbilglass/data';
const GT_GAMMEL = `${DIR}/gt-ekspansjon/gt-gammel.json`; // dumpes fra D1 om finnes
const GT_NY = `${DIR}/gt-ekspansjon/gt-generert.sql`;
const HULL = `${DIR}/hull-kart-resultater.ndjson`;

// ── Samme normalisering som resolveren ──
const BRAND_ALIAS = {
  VOLKSWAGEN: 'VW', 'VW TRUCKS': 'VW',
  'MERCEDES-BENZ': 'MERCEDES', 'MERCEDES BENZ': 'MERCEDES', 'MERCEDES TRUCKS': 'MERCEDES',
  'OPEL VAUXHALL': 'OPEL', 'FIAT TRUCKS': 'FIAT', 'FORD TRUCKS': 'FORD',
  'IVECO TRUCKS': 'IVECO', 'RENAULT TRUCKS': 'RENAULT', 'PEUGEOT TRUCKS': 'PEUGEOT',
  'CITROEN TRUCKS': 'CITROEN', 'NISSAN COMMERCIAL': 'NISSAN', 'TOYOTA COMMERCIAL': 'TOYOTA',
  'SCANIA TRUCKS': 'SCANIA', 'MAN TRUCKS': 'MAN', 'VOLVO TRUCKS': 'VOLVO',
  'DAF TRUCKS': 'DAF', 'MG MOTOR': 'MG',
};
const normBrand = (m) => BRAND_ALIAS[(m || '').trim().toUpperCase()] ?? (m || '').trim().toUpperCase();
const STOPP_TOKENS = new Set([
  'CLASS', 'SERIE', 'SERIES', 'LHD', 'RHD', 'AUTOMATIKK', 'AUTOMATIC', 'KOMBI', 'LIMITED',
  'SPORT', 'STYLE', 'TURBO', 'TDI', 'CDI', 'TFSI', 'TSI', 'TFSIE', '4MATIC', 'XDRIVE',
  'SDRIVE', 'BLUETEC', 'DIESEL', 'GTD', 'GTE', 'GTI', 'AMG', 'ACTIVE', 'DYNAMIC', 'TREND',
  'COMFORT', 'LIFE', 'PASSION', 'BASIC', 'EXECUTIVE', 'R-LINE', 'S-LINE', 'PREMIUM', 'BENZ',
]);
function modellTokensAv(modell, merke) {
  const merkeNorm = (merke || '').toUpperCase().replace(/[^A-ZÆØÅ0-9]+/g, '');
  const ord = (modell || '').toUpperCase().replace(/[^A-ZÆØÅ0-9]+/g, ' ').split(/\s+/).filter(Boolean);
  const tokens = [];
  for (const o of ord) {
    if (o.length < 2) continue;
    if (o === merkeNorm) continue;
    if (/^\d+$/.test(o) && o.length >= 3 && ord.length > 1) continue;
    if (/^\d+(KW|KWH)$/.test(o)) continue;
    if (STOPP_TOKENS.has(o)) continue;
    tokens.push(o);
  }
  return tokens;
}
function ordTokensAv(s) {
  return new Set((s || '').toUpperCase().replace(/[^A-ZÆØÅ0-9]+/g, ' ').split(/\s+/).filter((t) => t.length >= 2));
}
function ordTreff(model, tokens) {
  if (!tokens.length) return false;
  const sett = ordTokensAv(model);
  return tokens.some((t) => {
    if (sett.has(t)) return true;
    if (t.length < 4) return false;
    for (const ord of sett) {
      if (ord.length >= 4 && (ord.startsWith(t) || t.startsWith(ord))) return true;
    }
    return false;
  });
}

// ── Les GT-rader ──
function lesGtSql(sqlFil) {
  const tekst = readFileSync(sqlFil, 'utf8');
  const rader = [];
  const re = /\('([^']*)', '([^']*)', (\d{4}), '([^']*)'/g;
  let m;
  while ((m = re.exec(tekst)) !== null) {
    rader.push({ make: m[1], model: m[2], year: parseInt(m[3], 10), varenr: m[4] });
  }
  return rader;
}

// ── Simuler lagGroundTruth: make(normBrand) + eksakt år + ordTreff + serieKey → unike kandidater ──
function simuler(gtRader, make, model, year) {
  const tokens = modellTokensAv(model, make);
  const serie = serieKey(make, model, year);
  if ((!tokens.length && !serie) || year == null) return [];
  const makeNorm = normBrand(make);
  const kandidater = [];
  const sett = new Set();
  for (const r of gtRader) {
    if (normBrand(r.make) !== makeNorm) continue;
    if (r.year !== year) continue;
    const gtSerie = normaliserKatalogModell(r.model);
    const serieMatch = !!serie && !!gtSerie && gtSerie === serie;
    if (!ordTreff(r.model, tokens) && !serieMatch) continue;
    if (!sett.has(r.varenr)) { sett.add(r.varenr); kandidater.push(r); }
  }
  return kandidater;
}

async function main() {
  const gtGammel = existsSafe(`${DIR}/gt-ekspansjon/gt-gammel.json`)
    ? JSON.parse(readFileSync(`${DIR}/gt-ekspansjon/gt-gammel.json`, 'utf8'))
    : [];
  const gtNy = lesGtSql(GT_NY);
  // Prod-import er INSERT OR IGNORE med PK (make, model, year, frontrute_eurocode):
  // merger gammel + ny — begge bidrar.
  const mergeKey = (r) => `${r.make}|${r.model}|${r.year}|${r.varenr}`;
  const merged = new Map();
  for (const r of [...gtGammel, ...gtNy]) merged.set(mergeKey(r), r);
  const gtMerged = [...merged.values()];
  console.log(`Gammel GT: ${gtGammel.length} rader · Ny GT: ${gtNy.length} rader · Merged: ${gtMerged.length} rader`);

  const biler = readFileSync(HULL, 'utf8').split('\n').filter((l) => l.trim()).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const targetMerker = new Set(['TESLA', 'MERCEDES', 'MERCEDES-BENZ', 'OPEL', 'BMW']);

  let n = 0;
  const res = { total: 0, perMerke: {} };
  const bump = (o, k) => { o[k] ??= { n: 0, gammelP: 0, gammelV: 0, gammelF: 0, nyP: 0, nyV: 0, nyF: 0 }; return o[k]; };

  for (const bil of biler) {
    if (!bil.make || !bil.model || !bil.year) continue;
    res.total++;
    n++;
    const merke = bil.make.toUpperCase();
    const m = bump(res.perMerke, merke);
    m.n++;
    const g = simuler(gtGammel, bil.make, bil.model, bil.year);
    const ny = simuler(gtMerged, bil.make, bil.model, bil.year);
    for (const [rad, pKey, vKey, fKey] of [[g, 'gammelP', 'gammelV', 'gammelF'], [ny, 'nyP', 'nyV', 'nyF']]) {
      if (rad.length === 1) { m[pKey]++; res[pKey] = (res[pKey] ?? 0) + 1; }
      else if (rad.length >= 2) { m[vKey]++; res[vKey] = (res[vKey] ?? 0) + 1; }
      else { m[fKey]++; res[fKey] = (res[fKey] ?? 0) + 1; }
    }
  }
  res.pinpointGammelPst = Math.round((res.gammelP / res.total) * 100);
  res.pinpointNyPst = Math.round((res.nyP / res.total) * 100);
  res.verifyNyPst = Math.round((res.nyV / res.total) * 100);
  res.fallbackNyPst = Math.round((res.nyF / res.total) * 100);
  writeFileSync(`${DIR}/gt-ekspansjon/gt-validering.json`, JSON.stringify(res, null, 2));
  console.log('\n=== FØR/ETTER (simulert, alle 2 335 hull-kart-biler) ===');
  console.log(`PINPOINT: ${res.pinpointGammelPst}% → ${res.pinpointNyPst}%`);
  console.log(`VERIFY(ny): ${res.verifyNyPst}% · FALLBACK(ny): ${res.fallbackNyPst}%`);
  console.log('\n=== Per merke (ny GT) ===');
  for (const [k, v] of Object.entries(res.perMerke).filter(([k]) => targetMerker.has(k)).sort((a, b) => b[1].n - a[1].n)) {
    console.log(`${k.padEnd(16)} n=${String(v.n).padEnd(4)} P:${Math.round(v.nyP / v.n * 100)}% V:${Math.round(v.nyV / v.n * 100)}% F:${Math.round(v.nyF / v.n * 100)}%`);
  }
}

function existsSafe(f) { try { return readFileSync(f).length > 0; } catch { return false; } }

main().catch((e) => { console.error('❌', e); process.exit(1); });
