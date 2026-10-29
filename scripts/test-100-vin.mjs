#!/usr/bin/env node
/**
 * test-100 klassifisert med OE/VIN-resolver (mot staging-worker).
 * Klassifisering per bil (fra /api/regnr → resolver):
 *   correct_pinpoint — PINPOINT og varenavn inneholder SVV-merke (prefix ≥ 3 tegn)
 *   wrong_pinpoint   — PINPOINT uten merkebekreftelse (skal aldri skje — false positive)
 *   verify           — VERIFY (2+ kandidater)
 *   fallback         — FALLBACK (tekstmatcher overtar)
 *
 * Bruk:
 *   node scripts/test-100-vin.mjs
 *   BASE_URL=... node scripts/test-100-vin.mjs
 * Skriver data/test-100-resolver-rapport.json
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const BASE = process.env.BASE_URL ?? 'https://finnbilglass-frontrute-staging.tomarnejensen.workers.dev';
const LINJER = readFileSync(join(ROOT, 'data/finn-100.jsonl'), 'utf8').split('\n').filter(Boolean);

function makePrefix(merke) {
  return (merke || '').toUpperCase().replace(/[^A-ZÆØÅ]/g, '').slice(0, 3);
}

async function sok(regnr) {
  const r = await fetch(`${BASE}/api/regnr`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ regnr }),
  });
  return r.json();
}

const fordeling = { correct_pinpoint: 0, wrong_pinpoint: 0, verify: 0, fallback: 0 };
const detaljer = [];
let feil = 0;

for (const [i, linje] of LINJER.entries()) {
  const annonse = JSON.parse(linje);
  let svar;
  try {
    svar = await sok(annonse.regnr);
  } catch (e) {
    feil++;
    detaljer.push({ regnr: annonse.regnr, klasse: 'api_feil', feil: e.message });
    continue;
  }
  const bil = svar.bil;
  const res = svar.resolver;
  if (!bil || !res) {
    feil++;
    detaljer.push({ regnr: annonse.regnr, klasse: 'svv_eller_resolver_mangler' });
    continue;
  }
  let klasse = 'fallback';
  let bekreftet = null;
  if (res.utfall === 'PINPOINT') {
    const pref = makePrefix(bil.merke);
    bekreftet = (res.varenavn ?? '').toUpperCase().includes(pref);
    klasse = bekreftet ? 'correct_pinpoint' : 'wrong_pinpoint';
  } else if (res.utfall === 'VERIFY') {
    klasse = 'verify';
  }
  fordeling[klasse]++;
  detaljer.push({
    regnr: annonse.regnr,
    klasse,
    bil: `${bil.merke} ${bil.modell ?? ''} ${bil.aar ?? ''}`,
    utfall: res.utfall,
    grunn: res.grunn,
    treff: res.utfall === 'PINPOINT' ? `${res.varenr} (${res.pris ?? '?'} kr)` : null,
    antallKandidater: res.kandidater?.length ?? 0,
    bekreftet,
  });
  process.stdout.write(`\r${i + 1}/${LINJER.length} — ${klasse.padEnd(16)}`);
}

const rapport = {
  generert: new Date().toISOString(),
  base: BASE,
  total: LINJER.length,
  fordeling,
  apiFeil: feil,
  detaljer,
};
writeFileSync(join(ROOT, 'data/test-100-resolver-rapport.json'), JSON.stringify(rapport, null, 2));

console.log('\n\n=== test-100 × OE/VIN-resolver ===');
console.log(`total: ${LINJER.length}  apiFeil: ${feil}`);
for (const [k, v] of Object.entries(fordeling)) console.log(`  ${k.padEnd(18)} ${v}`);
const wrong = detaljer.filter((d) => d.klasse === 'wrong_pinpoint');
if (wrong.length) {
  console.log('\n⚠ wrong_pinpoint (false positive — MÅ nullstilles):');
  for (const d of wrong) console.log(`  ${d.regnr} ${d.bil} → ${d.treff}`);
}
const pin = detaljer.filter((d) => d.klasse === 'correct_pinpoint');
if (pin.length) {
  console.log('\nEksempler correct_pinpoint:');
  for (const d of pin.slice(0, 8)) console.log(`  ${d.regnr} ${d.bil} → ${d.treff} (${d.grunn})`);
}
if (feil > 0 || fordeling.wrong_pinpoint > 0) process.exitCode = 1;
