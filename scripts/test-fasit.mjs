#!/usr/bin/env node
/**
 * Fasit-tester for OE/VIN-pinpoint (mot staging-worker).
 *
 *   SU18018 → PINPOINT, varenr 2525CSGYA   (HARD regresjonstest, Tom 2026-08-13)
 *   AJ95429 → VERIFY                        (tvetydig datagrunnlag → aldri tving PINPOINT)
 *
 * Bruk:
 *   node scripts/test-fasit.mjs                      # staging
 *   BASE_URL=... node scripts/test-fasit.mjs         # annen base
 * Exit 0 = alle krav møtt; exit 1 = krav brutt (feilfasit / forventet-FALLBACK).
 */
const BASE = process.env.BASE_URL ?? 'https://finnbilglass-frontrute-staging.klarpakke.workers.dev';

async function sok(regnr) {
  const r = await fetch(`${BASE}/api/regnr`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ regnr }),
  });
  return r.json();
}

const FA_SIT = [
  {
    navn: 'SU18018 → 2525CSGYA (hard regresjon)',
    regnr: 'SU18018',
    krav: (res) => res?.utfall === 'PINPOINT' && (res.varenr === '2525CSGYA' || res.eurokode === '8579ACSGYAVZ1B'),
    beskriv: 'PINPOINT med varenr 2525CSGYA (VW Transporter T5 frontrute)',
  },
  {
    navn: 'AJ95429 → VERIFY (tvetydig → aldri tving PINPOINT)',
    regnr: 'AJ95429',
    krav: (res) => res?.utfall === 'VERIFY',
    beskriv: 'VERIFY (Mercedes CLA 2016: 1B/1T-varianter krever utstyrsverifisering)',
  },
];

let feil = 0;
for (const t of FA_SIT) {
  let svar;
  try {
    svar = await sok(t.regnr);
  } catch (e) {
    console.log(`✘ ${t.navn}\n  FEIL ved kall: ${e.message}`);
    feil++;
    continue;
  }
  const bil = svar.bil;
  const res = svar.resolver;
  const ok = t.krav(res);
  console.log(`${ok ? '✓' : '✘'} ${t.navn}`);
  console.log(`  bil: ${bil?.merke ?? '?'} ${bil?.modell ?? ''} ${bil?.aar ?? ''} (SVV: ${bil ? 'ja' : 'nei'})`);
  console.log(`  utfall: ${res?.utfall ?? 'null'} — ${res?.grunn ?? ''}`);
  if (res?.utfall === 'PINPOINT') console.log(`  treff: ${res.varenr} (${res.varenavn}) ${res.pris ? res.pris + ' kr' : '—'}`);
  if (res?.utfall === 'VERIFY') console.log(`  kandidater: ${(res.kandidater ?? []).map((k) => `${k.varenr} (${k.pris ?? '?'} kr)`).join(', ')}`);
  if (!ok) {
    console.log(`  KRAV BRUTT: forventet ${t.beskriv}`);
    feil++;
  }
}
console.log(feil ? `\n${feil} fasit-test(er) feilet` : '\nAlle fasit-tester bestått');
process.exit(feil ? 1 : 0);
