#!/usr/bin/env node
/**
 * Priskontroll: alle positive XLS-priser skal gi nøyaktig listepris × 0,25 × 1,25
 * (= × 0,3125), avrundet til øre. Manglende/ugyldig pris skal gi null
 * («Pris på forespørsel»), aldri 0 kr eller en gjettet pris.
 *
 * Bruk: node --import tsx scripts/pris-invariant-sjekk.mjs [dump.json]
 */
import { readFileSync } from 'node:fs';
import { estimertKundeprisInklMva, XLS_RABATT_FAKTOR, MVA_SATS } from '../src/pricing/nok-prising.ts';
import { offentligPris } from '../src/public-contract.ts';

const fil = process.argv[2] ?? 'reports/_staging-dump-20261104.json';
const rader = JSON.parse(readFileSync(fil, 'utf8'))[0].results;
const FAKTOR = XLS_RABATT_FAKTOR * (1 + MVA_SATS);

let medPris = 0, utenPris = 0, avvik = [], avrundingsavvik = [];
for (const r of rader) {
  const p = r.pris;
  const forventet = typeof p === 'number' && Number.isFinite(p) && p > 0 ? Math.round(p * FAKTOR * 100) / 100 : null;
  const faktisk = estimertKundeprisInklMva(p);
  if (forventet == null) {
    utenPris++;
    if (faktisk !== null) avvik.push({ varenr: r.varenr, pris: p, faktisk });
    if (offentligPris(p) !== null) avvik.push({ varenr: r.varenr, pris: p, offentlig: offentligPris(p) });
  } else {
    medPris++;
    if (faktisk !== forventet) avvik.push({ varenr: r.varenr, pris: p, forventet, faktisk });
    const o = offentligPris(p);
    if (!o || o.kundePris !== forventet) avvik.push({ varenr: r.varenr, pris: p, forventet, offentlig: o });
    if (o && o.sikkerhet !== 'ESTIMERT') avvik.push({ varenr: r.varenr, pris: p, grunn: 'sikkerhet ikke ESTIMERT', sikkerhet: o.sikkerhet });
    // mva + eks. mva skal summere til kundeprisen
    if (o && Math.abs((o.mva + o.prisEksMva) - o.kundePris) > 0.011) avrundingsavvik.push({ varenr: r.varenr, pris: p, o });
  }
}

console.log(JSON.stringify({
  fil,
  rader: rader.length,
  med_positiv_pris: medPris,
  uten_pris: utenPris,
  faktor: FAKTOR,
  avvik: avvik.length,
  avrundingsavvik: avrundingsavvik.length,
  eksempler_avvik: avvik.slice(0, 5),
}, null, 2));
process.exit(avvik.length === 0 && avrundingsavvik.length === 0 ? 0 : 1);
