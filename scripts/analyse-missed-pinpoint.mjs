#!/usr/bin/env node
/**
 * Diagnose missed-PINPOINT: replikerer resolverens GT-søk mot lokale D1-fixtures
 * (data/fixtures/) for hver rad i data/test-500-gt-detaljer.jsonl (prod-kjøring),
 * og klassifiserer VERIFY-tilfeller med entydig GT (gtKoder.length === 1).
 *
 * Kategorier per VERIFY-tilfelle:
 *   missed_pinpoint_l1   — GT-sett = 1 kode OG L1 gir 1 salgbar kandidat → prod burde
 *                          gitt PINPOINT (resolver/DB-avvik — bug-jakt).
 *   gt_ikke_i_prisliste  — GT-koden finnes, men er ikke salgbar glass-rad → L1 tom,
 *                          L2/3 må dekke (VERIFY er korrekt, men fasit-dekning svekkes).
 *   multi_gt             — GT-settet har >1 kode → VERIFY er korrekt (G1-doktrine).
 *   ingen_gt_rad         — ingen GT-rad med make+år → L1 tom.
 *   token_mismatch       — GT-rader finnes (make+år), men ingen matcher modellen.
 *
 * Bruk: node --import tsx scripts/analyse-missed-pinpoint.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gtRaderSett, gtRaderKandidater, erFrontrute, normBrand } from '../src/vin-resolver.ts';
import { dekodeEurokode } from '../src/eurokode-dekoder.ts';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const FIX = join(ROOT, 'data', 'fixtures');

const gt = readFileSync(join(FIX, 'ground-truth.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const pl = readFileSync(join(FIX, 'glass-prisliste.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));

// Prisliste-indeks: varenr → rad, eurokode → rad (rad_type='glass')
const plMap = new Map();
for (const r of pl) {
  if (r.rad_type !== 'glass') continue;
  if (r.varenr != null && !plMap.has(String(r.varenr))) plMap.set(String(r.varenr), r);
  if (r.eurokode != null && !plMap.has(String(r.eurokode))) plMap.set(String(r.eurokode), r);
}

// tilKandidat — samme logikk som prisKandidat (uten glass_catalog kamera/adas, påvirker ikke utfall)
async function tilKandidat(kode) {
  const r = plMap.get(String(kode));
  if (!r) return null;
  const dek = dekodeEurokode(r.eurokode);
  if (!erFrontrute(r.varenavn, r.varenr, dek)) return null;
  return {
    varenr: r.varenr,
    varenavn: r.varenavn,
    pris: null,
    listepris: r.pris,
    eurokode: r.eurokode,
    attributter: {},
  };
}

const detaljer = readFileSync(join(ROOT, 'data', 'test-500-gt-detaljer.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));

// GT-indeks per make|year
const gtByKey = new Map();
for (const r of gt) {
  const key = `${r.make}|${r.year}`;
  if (!gtByKey.has(key)) gtByKey.set(key, []);
  gtByKey.get(key).push(r);
}

const kat = { missed_pinpoint_l1: 0, gt_ikke_i_prisliste: 0, multi_gt: 0, ingen_gt_rad: 0, token_mismatch: 0, ok: 0 };
const eksempler = {};
for (const k of Object.keys(kat)) eksempler[k] = [];

for (const d of detaljer) {
  if (d.klasse !== 'VERIFY') continue;
  if ((d.gtKoder ?? []).length !== 1) continue; // kun entydig-GT-tilfellene

  const make = normBrand(d.make);
  const model = d.model;
  const aarList = [d.year];
  const rader = gtByKey.get(`${d.make}|${d.year}`) ?? [];

  if (!rader.length) { kat.ingen_gt_rad++; pushEks(eksempler, 'ingen_gt_rad', d, 'ingen GT-rad make+år'); continue; }

  const sett = gtRaderSett(rader, make, model, aarList);
  if (!sett) {
    // Finnes GT-rader for make+år som matcher på enklere vilkår?
    const raderNorm = rader.filter((r) => r.make === make);
    kat.token_mismatch++;
    pushEks(eksempler, 'token_mismatch', d, `GT-rader make+år: ${rader.length}, matcher: 0 (sett null)`);
    continue;
  }
  if (sett.size > 1) { kat.multi_gt++; pushEks(eksempler, 'multi_gt', d, `GT-sett: ${[...sett].join(',')}`); continue; }

  // sett.size === 1: L1-kandidater?
  const kandidater = await gtRaderKandidater(rader, make, model, aarList, tilKandidat);
  const enKode = [...sett][0];
  if (kandidater.length === 1 && kandidater[0].eurokode && String(kandidater[0].eurokode).toUpperCase().replace(/[^A-Z0-9]/g, '') === enKode) {
    kat.missed_pinpoint_l1++;
    pushEks(eksempler, 'missed_pinpoint_l1', d, `L1: ${kandidater[0].varenr} (${kandidater[0].eurokode}) ∈ GT {${enKode}} — BURDE VÆRE PINPOINT`);
  } else if (kandidater.length === 0) {
    kat.gt_ikke_i_prisliste++;
    pushEks(eksempler, 'gt_ikke_i_prisliste', d, `GT-kode ${enKode} ikke salgbar i prisliste → L1 tom`);
  } else {
    kat.ok++;
    pushEks(eksempler, 'ok', d, `L1-kandidater: ${kandidater.map((k) => k.varenr).join(',')} vs GT {${enKode}}`);
  }
}

function pushEks(eks, key, d, msg) {
  if (eks[key].length < 6) eks[key].push({ bil: `${d.make} ${d.model} ${d.year}`, gt: d.gtKoder, msg, valgt: d.valgtEuro });
}

console.log('=== MISSED-PINPOINT-ANALYSE (VERIFY med entydig GT, n=' + detaljer.filter((d) => d.klasse === 'VERIFY' && (d.gtKoder ?? []).length === 1).length + ') ===');
console.log(JSON.stringify(kat, null, 1));
for (const [k, eks] of Object.entries(eksempler)) {
  console.log(`\n— ${k} —`);
  for (const e of eks) console.log(`  ${e.bil}: ${e.msg}`);
}
