#!/usr/bin/env node
/**
 * Fase 3 – Velg 100 representative varekort for prøvekjøring
 * 
 * Kriterier (per oppdrag):
 * - Alle glassklasser (frontrute, bakrute, dør, side, ventil, tak)
 * - Fremre/bakre dør, venstre/høyre
 * - Ventilruter foran/bakre
 * - Takglass
 * - Dokumenterte konflikter (Mazda CX-5, 1 492 navnekonflikter)
 * - Forskjellige merker/modeller
 * 
 * Output: test-utvalg.csv med 100 rader
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { parse } from 'csv-parse/sync';

const CSV_FIL = '/Users/taj/bilglass/data/autoglass-scrape/products-autoglass-no.csv';
const UT_FIL = '/Users/taj/finnbilglass/data/test-utvalg-100.csv';

const raw = readFileSync(CSV_FIL, 'utf8');
const rader = parse(raw, { columns: true, skip_empty_lines: true, trim: true });

console.log(`Lest ${rader.length} rader`);

// Filtrer bort tomme type_code
const medTypekode = rader.filter(r => r.type_code && r.type_code.trim());
console.log(`Rader med type_code: ${medTypekode.length}`);

// Grupper per type_code
const perType = {};
for (const r of medTypekode) {
  const tc = r.type_code.trim().toUpperCase();
  if (!perType[tc]) perType[tc] = [];
  perType[tc].push(r);
}

console.log('\nTypekode-grupper:');
for (const [tc, liste] of Object.entries(perType).sort((a,b) => b[1].length - a[1].length)) {
  console.log(`  ${tc}: ${liste.length}`);
}

// Velg representanter per type_code (proportionalt, men min 2 per type)
const UT_VALG = 100;
const valgte = new Set();
const utvalg = [];

// Først: sørg for at alle type_koder er representert (min 2 per type)
for (const [tc, liste] of Object.entries(perType)) {
  const antall = Math.min(2, liste.length);
  for (let i = 0; i < antall; i++) {
    const idx = Math.floor(Math.random() * liste.length);
    const r = liste[idx];
    const key = `${r.sku}|${r.source_url}`;
    if (!valgte.has(key)) {
      valgte.add(key);
      utvalg.push({ ...r, _typekode: tc });
    }
  }
}

console.log(`\nEtter min 2 per type: ${utvalg.length} valgt`);

// Deretter: fyll opp til 100 med proporsjonal fordeling
const gjensta = UT_VALG - utvalg.length;
if (gjensta > 0) {
  // Vekt: mer vanlige typekoder får flere
  const totalMedTypekode = medTypekode.length;
  let fordeling = {};
  
  for (const [tc, liste] of Object.entries(perType)) {
    const prop = liste.length / totalMedTypekode;
    fordeling[tc] = Math.max(1, Math.round(prop * gjensta));
  }
  
  // Justér til nøyaktig gjensta
  let sumFordelt = Object.values(fordeling).reduce((a,b) => a+b, 0);
  const diff = gjensta - sumFordelt;
  if (diff !== 0) {
    const storst = Object.keys(fordeling).reduce((a,b) => fordeling[a] > fordeling[b] ? a : b);
    fordeling[storst] += diff;
  }
  
  console.log('\nFordeling for gjenstående:');
  for (const [tc, ant] of Object.entries(fordeling)) {
    console.log(`  ${tc}: +${ant}`);
  }
  
  for (const [tc, ant] of Object.entries(fordeling)) {
    const kandidater = perType[tc].filter(r => {
      const key = `${r.sku}|${r.source_url}`;
      return !valgte.has(key);
    });
    
    for (let i = 0; i < Math.min(ant, kandidater.length); i++) {
      const idx = Math.floor(Math.random() * kandidater.length);
      const r = kandidater.splice(idx, 1)[0];
      const key = `${r.sku}|${r.source_url}`;
      valgte.add(key);
      utvalg.push({ ...r, _typekode: tc });
    }
  }
}

// Sjekk Mazda CX-5 konflikt (må være med)
const mazda = medTypekode.find(r => r.sku.trim().toUpperCase() === '29730YP');
if (mazda && !utvalg.some(u => u.sku === '29730YP')) {
  utvalg.push({ ...mazda, _typekode: 'DFFV' });
  console.log('\n✅ Mazda CX-5 29730YP lagt til (konflikt-prioritet)');
}

// Begrens til 100 — men sørg for at Mazda er med
const endelig = utvalg.slice(0, UT_VALG);
if (!endelig.some(u => u.sku === '29730YP') && mazda) {
  // Erstatt siste rad med Mazda
  endelig[endelig.length - 1] = { ...mazda, _typekode: 'DFFV' };
  console.log('\n✅ Mazda CX-5 29730YP sikret i endelige utvalg');
}
console.log(`\n=== ENDELIG UTVALG: ${endelig.length} rader ===`);

// Statistikk
const typekodeCount = {};
for (const u of endelig) {
  typekodeCount[u._typekode] = (typekodeCount[u._typekode] || 0) + 1;
}
console.log('\nTypekode-fordeling i utvalg:');
for (const [tc, ant] of Object.entries(typekodeCount).sort((a,b) => b[1] - a[1])) {
  console.log(`  ${tc}: ${ant}`);
}

// Glassklasse-fordeling
const TYPE_MAP = {
  'F': 'frontrute', 'B': 'bakrute',
  'DFF': 'dor', 'DFB': 'dor', 'DPF': 'dor', 'DPB': 'dor',
  'DFFV': 'ventil', 'DFBV': 'ventil', 'DPFV': 'ventil', 'DPBV': 'ventil',
  'SFB1': 'side', 'SPB1': 'side', 'SFB2': 'side', 'SPB2': 'side', 'SFB3': 'side', 'SPB3': 'side',
  'BF': 'ukjent', 'BP': 'ukjent'
};
const klasseCount = {};
for (const u of endelig) {
  const kl = TYPE_MAP[u._typekode] || 'ukjent';
  klasseCount[kl] = (klasseCount[kl] || 0) + 1;
}
console.log('\nGlassklasse-fordeling:');
for (const [kl, ant] of Object.entries(klasseCount).sort((a,b) => b[1] - a[1])) {
  console.log(`  ${kl}: ${ant}`);
}

// Skriv CSV
const kolonner = [
  'sku', 'title', 'brand', 'model', 'submodel', 'year_start', 'year_end', 'year_range',
  'type_code', 'type_code_desc', 'price', 'source_url', '_typekode'
];
const csvRader = [kolonner.join(',')];
for (const u of endelig) {
  const rad = kolonner.map(k => {
    const v = u[k] || '';
    return typeof v === 'string' && v.includes(',') ? `"${v.replace(/"/g, '""')}"` : v;
  }).join(',');
  csvRader.push(rad);
}

writeFileSync(UT_FIL, csvRader.join('\n'));
console.log(`\n✅ Skrev ${endelig.length} rader til ${UT_FIL}`);

// Vis oversikt over konflikter i utvalget
console.log('\n=== KONFLIKT-SJEKK I UTVALG ===');
for (const u of endelig) {
  if (u.type_code === 'DFFV' && u.sku === '29730YP') {
    console.log(`⚠️  KONFLIKT: ${u.sku} (${u.type_code_desc}) — Mazda CX-5 29730YP`);
  }
}