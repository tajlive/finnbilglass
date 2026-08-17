import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  gtRadMatch, gtRaderSett, gtRaderKandidater, filtrerPaaProfil, normBrand,
} from '../src/vin-resolver.ts';
import { dekodeEurokode, katalogKode } from '../src/eurokode-dekoder.ts';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const FIX = join(ROOT, 'data', 'fixtures');

// ── gtRadMatch: enhetsnivå (ingen fixtures nødvendig) ──────────────────────
test('gtRadMatch: eksakt modellnavn', () => {
  assert.equal(gtRadMatch('PASSAT', 'VW', 'PASSAT', [2008]), true);
  assert.equal(gtRadMatch('PASSAT SED+STV', 'VW', 'PASSAT', [2008]), true); // token-treff
  assert.equal(gtRadMatch('GOLF', 'VW', 'PASSAT', [2008]), false);
});

test('gtRadMatch: 1-tegns modellnavn (MAZDA 3) via eksakt-match', () => {
  assert.equal(gtRadMatch('3', 'MAZDA', '3', [2009]), true);
  assert.equal(gtRadMatch('DEMIO', 'MAZDA', '3', [2009]), false);
});

test('gtRadMatch: CLA matcher aldri S-CLASS (substring-sikkerhet)', () => {
  assert.equal(gtRadMatch('S-CLASS W222', 'MERCEDES', 'CLA 180', [2016]), false);
  assert.equal(gtRadMatch('CLA 180', 'MERCEDES', 'CLA 180', [2016]), true);
});

test('gtRadMatch: serie-kode-match (Mercedes C 180 CDI 2013 → W204)', () => {
  // GT-rad uten direkte kode i navnet, samme serie via år
  assert.equal(gtRadMatch('C 200', 'MERCEDES', 'C 180 CDI', [2013]), true);
  assert.equal(gtRadMatch('S 350', 'MERCEDES', 'C 180 CDI', [2013]), false); // S-klasse ≠ C-klasse
});

test('gtRadMatch: modell med bare stopp-ord matcher ikke alt', () => {
  assert.equal(gtRadMatch('CLASS', 'VW', 'GOLF', [2010]), false);
});

// ── filtrerPaaProfil: kundens utstyrssvar ───────────────────────────────────
function kand(varenr, eurokode) {
  const dek = dekodeEurokode(eurokode);
  const att = { sensor: null, antenne: null, hud: null, kamera: null, adas: null, coated: null };
  if (dek.posisjon) {
    att.sensor = dek.egenskaper.includes('sensor');
    att.antenne = dek.egenskaper.includes('antenne');
    att.coated = dek.egenskaper.includes('coated');
    att.hud = dek.egenskaper.includes('oppvarmet');
  }
  return { varenr, varenavn: varenr, pris: null, listepris: null, eurokode, attributter: att };
}

test('filtrerPaaProfil: sensor-svar gjør varianter entydige', () => {
  const ks = [kand('A', '1234AGN'), kand('B', '1234AMGN')]; // A: ingen sensor, B: sensor
  const ut = filtrerPaaProfil(ks, { sensor: true });
  assert.equal(ut.length, 1);
  assert.equal(ut[0].varenr, 'B');
  const ut2 = filtrerPaaProfil(ks, { sensor: false });
  assert.equal(ut2[0].varenr, 'A');
});

test('filtrerPaaProfil: ukjent (null) attributt straffes ikke, ja-lookahead velger entydig', () => {
  const oem = { ...kand('OEM', '7H0877051') }; // sensor=null (ukjent)
  const moderne = kand('MOD', '1234AMGN');     // sensor=true
  const ut = filtrerPaaProfil([oem, moderne], { sensor: true });
  // Begge overlever false-strykingen (null ≠ false), men lookahead velger den
  // ene kandidaten som definitivt har sensor → 1, den moderne.
  assert.equal(ut.length, 1);
  assert.equal(ut[0].varenr, 'MOD');
});

test('filtrerPaaProfil: ACL-kode (klar fargetone) er IKKE coated etter dekoder-fiks', () => {
  const acl = kand('007C', '2205ACL'); // AUSTIN A40 — klart glass
  assert.equal(acl.attributter.coated, false, 'CL = klar fargetone, ikke coating');
  const cs = kand('2543CSM', '2727ACCMV6T'); // CITROEN C5 — ekte coated
  assert.equal(cs.attributter.coated, true);
  const ut = filtrerPaaProfil([acl, cs], { coated: false });
  assert.deepEqual(ut.map((k) => k.varenr), ['007C']);
});

test('filtrerPaaProfil: ingen profil → uendret liste', () => {
  const ks = [kand('A', '1234AGN'), kand('B', '1234AMGN')];
  assert.equal(filtrerPaaProfil(ks, undefined).length, 2);
  assert.equal(filtrerPaaProfil(ks, {}).length, 2);
});

// ── Fixtures: GT-søkbarhet (roundtrip + kjente hull) ────────────────────────
const harFixtures = existsSync(join(FIX, 'ground-truth.jsonl'));
const gt = harFixtures
  ? readFileSync(join(FIX, 'ground-truth.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
  : [];
const pl = harFixtures
  ? readFileSync(join(FIX, 'glass-prisliste.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
  : [];

const plMap = new Map();
for (const r of pl) {
  if (r.rad_type !== 'glass') continue;
  if (r.varenr != null && !plMap.has(String(r.varenr))) plMap.set(String(r.varenr), r);
  if (r.eurokode != null && !plMap.has(String(r.eurokode))) plMap.set(String(r.eurokode), r);
}

const byKey = new Map();
for (const r of gt) {
  const key = `${r.make}|${r.year}`;
  if (!byKey.has(key)) byKey.set(key, []);
  byKey.get(key).push(r);
}

async function tilKandidat(kode) {
  const r = plMap.get(String(kode));
  if (!r) return null;
  const dek = dekodeEurokode(r.eurokode);
  const att = { sensor: null, antenne: null, hud: null, kamera: null, adas: null, coated: null };
  if (dek.posisjon) {
    att.sensor = dek.egenskaper.includes('sensor');
    att.antenne = dek.egenskaper.includes('antenne');
    att.coated = dek.egenskaper.includes('coated');
    att.hud = dek.egenskaper.includes('oppvarmet');
  }
  return { varenr: r.varenr, varenavn: r.varenavn, pris: null, listepris: r.pris, eurokode: r.eurokode, attributter: att };
}

test('fixtures: ground-truth.jsonl er til stede (dump-d1-fixtures.mjs)', { skip: !harFixtures }, () => {
  assert.ok(gt.length > 40000, `forventet ≥ 40 000 GT-rader, fikk ${gt.length}`);
  assert.ok(pl.length > 25000, `forventet ≥ 25 000 prisliste-rader, fikk ${pl.length}`);
});

test('GT-roundtrip: hver GT-rad er søkbar via egen (make, modell, år)', { skip: !harFixtures }, () => {
  let feil = 0;
  let sjekket = 0;
  for (const r of gt) {
    const kode = String(r.frontrute_eurocode ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!kode) continue;
    const gruppe = byKey.get(`${r.make}|${r.year}`) ?? [];
    const sett = gtRaderSett(gruppe, normBrand(r.make), String(r.model ?? '').toUpperCase(), [r.year]);
    if (!sett || !sett.has(kode)) {
      feil++;
      if (feil <= 3) console.error(`  roundtrip-feil: ${r.make} ${r.model} ${r.year} → ${kode}`);
    }
    sjekket++;
  }
  assert.equal(feil, 0, `${feil} GT-rader er ikke søkbare (av ${sjekket})`);
});

test('MAZDA 3 2009 → GT-kode 2960GYELM finnes (1-tegns modellnavn)', { skip: !harFixtures }, () => {
  const rader = byKey.get('MAZDA|2009') ?? [];
  const sett = gtRaderSett(rader, 'MAZDA', '3', [2009]);
  assert.ok(sett && sett.has('2960GYELM'), `sett: ${sett ? [...sett] : 'null'}`);
});

test('VOLVO TRUCKS F16 1984 → entydig 1318GN (make-alias må ikke miste lastebil-glass)', { skip: !harFixtures }, () => {
  const rader = [...(byKey.get('VOLVO TRUCKS|1984') ?? []), ...(byKey.get('VOLVO|1984') ?? [])];
  const sett = gtRaderSett(rader, 'VOLVO', 'F16', [1984]);
  assert.ok(sett, 'GT-sett skal finnes');
  assert.deepEqual([...sett], ['1318GN'], 'F16 skal være entydig på 1318GN');
});

test('VW PASSAT 2008 → multi-GT (VERIFY er korrekt, aldri tving PINPOINT)', { skip: !harFixtures }, () => {
  const rader = byKey.get('VW|2008') ?? [];
  const sett = gtRaderSett(rader, 'VW', 'PASSAT', [2008]);
  assert.ok(sett && sett.size > 1, `forventet flerkodet GT (G1-doktrine), fikk ${sett ? [...sett] : 'null'}`);
  assert.ok(sett.has('2875GYM'), 'PASSAT-hovedvarianten må være i settet');
});

test('GT-konsistens mot test-500-gt-detaljer: entydige sett må komme fra en matchende GT-rad', { skip: !harFixtures }, () => {
  const detaljFil = join(ROOT, 'data', 'test-500-gt-detaljer.jsonl');
  if (!existsSync(detaljFil)) return; // ingen fasit-fil → hopp
  const detaljer = readFileSync(detaljFil, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  let avvik = 0;
  for (const d of detaljer) {
    if (d.klasse !== 'VERIFY' || (d.gtKoder ?? []).length !== 1) continue;
    const rader = byKey.get(`${d.make}|${d.year}`) ?? [];
    const sett = gtRaderSett(rader, normBrand(d.make), String(d.model ?? '').toUpperCase(), [d.year]);
    if (sett && sett.size === 1) {
      const enKode = [...sett][0];
      // Den entydige koden må ha en GT-rad (make+år) som matcher bilens modell
      // (fasit-kilden er GT-dataene, ikke test-scriptets gruppering).
      // NB: gtRaderSett normaliserer koder (f.eks. bobil-koder «BO90.02.203GN» →
      // «BO9002203GN»); kildeRad-sjekken må normalisere på samme måte.
      const normKode = (k) => String(k ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      const kildeRad = rader.find((r) => normKode(r.frontrute_eurocode) === enKode);
      if (!kildeRad) {
        avvik++;
        if (avvik <= 3) console.error(`  avvik: ${d.make} ${d.model} ${d.year}: ${enKode} har ingen GT-rad i make+år`);
      }
    }
  }
  assert.equal(avvik, 0, `${avvik} entydige sett uten GT-kilde-rad`);
});

test('L1-kandidater: VOLVO TRUCKS F16 blir salgbar PINPOINT-kandidat (1318GN)', { skip: !harFixtures }, async () => {
  const rader = [...(byKey.get('VOLVO TRUCKS|1984') ?? []), ...(byKey.get('VOLVO|1984') ?? [])];
  const kand = await gtRaderKandidater(rader, 'VOLVO', 'F16', [1984], tilKandidat);
  assert.equal(kand.length, 1);
  assert.equal(kand[0].varenr, '1318GN');
});

test('katalogKode: crosswalk varenr/eurokode-regel (base-8-koder)', () => {
  // 2051AGAC ↔ 2051AGACHIMVZ = samme glass med ulik granularitet
  assert.equal(katalogKode('2051AGACHIMVZ'), '2051');
  assert.equal(katalogKode('2051AGAC'), '2051');
});
