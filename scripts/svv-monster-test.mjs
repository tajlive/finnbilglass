#!/usr/bin/env node
/**
 * SVV-mønster-klassetest: kjør representative biler fra hver gjentagende
 * SVV-modell-mønster-klasse mot staging-resolveren og mål utfallet.
 *
 * Klasser (fra 2 396-bilers SVV-datasett):
 *  M1  merke-prefiks i modell («TOYOTA TOYOTA RAV4»)
 *  M1x merke-prefiks + suffiks-støy («NISSAN X-TRAIL NISSANNENV»)
 *  M3  dupliserte tokens («MG MG 5», «E 350 E»)
 *  M4  drivlinje-suffiks («X5 XDRIVE30D», «520D XDRIVE», «C 200 CDI»)
 *  M4b kW/kWh-suffiks («ID.4 PRO 150 KW», «NISSAN LEAF 40KWH»)
 *  M5  komma-separerte modeller («AUDI A4, S4», «KIA PICANTO, MORNING»)
 *  M6  manglende modell («-», «---»)
 *  M8  VW ID-serie («ID.4 GTX 220 KW»)
 *  M9  E-klasse med E-suffiks («E 350 E»)
 */
import { readFileSync } from 'node:fs';

const BASE = process.env.STAGING_BASE ?? 'https://finnbilglass-frontrute-staging.tomarnejensen.workers.dev';
const DATASET = '/Users/taj/bilglass/data/finn-no-regnr/svv-finn-broad-results.ndjson';
const UA = 'SvvMonsterTest/1.0 (intern kvalitetsmåling)';

const biler = readFileSync(DATASET, 'utf8').split('\n').filter(Boolean)
  .map((l) => { try { return JSON.parse(l); } catch { return null; } })
  .filter(Boolean);

function klasse(b) {
  const m = (b.make ?? '').toUpperCase().replace(/\s+/g, ' ');
  const mod = (b.model ?? '').toUpperCase();
  const mk = m.replace(/[^A-ZÆØÅ0-9]/g, '');
  const mc = mod.replace(/[^A-ZÆØÅ0-9]/g, '');
  if (!mod || ['-', '---'].includes(mod)) return 'M6-tom';
  if (mc.startsWith(mk) && mc.length > mk.length) {
    if (mc.endsWith(mk) && mc.length > 2 * mk.length) return 'M1x-prefiks+suffiks';
    return 'M1-merke-prefiks';
  }
  const toks = mod.split(/[^A-ZÆØÅ0-9]+/).filter(Boolean);
  const dup = toks.some((t, i) => toks.indexOf(t) !== i);
  if (dup) return 'M3-duplikat-token';
  if (/,\s*(S\d|MORNING|ACTIVE|GT)/.test(mod) || /^[A-Z0-9]+,[A-Z0-9]+/.test(mod)) return 'M5-komma-modell';
  if (/\b\d{2,3}\s*KW(?:H)?\b/.test(mod)) return 'M4b-kw-suffiks';
  if (/ID\.\d|ID BUZZ/.test(mod)) return 'M8-ID-serie';
  if (/^\d{3,4}[A-Z]?$/.test(mod)) return 'M7-ren-kode';
  return 'annet';
}

// Plukk opptil 6 representative per klasse (prioriter vanlige)
const plukket = new Map();
for (const b of biler) {
  const k = klasse(b);
  if (!plukket.has(k)) plukket.set(k, []);
  if (plukket.get(k).length < 6) plukket.get(k).push(b);
}

const utfall = new Map();
async function main() {
  for (const [k, bs] of [...plukket.entries()].sort()) {
    if (!utfall.has(k)) utfall.set(k, { total: 0, pinpoint: 0, verify: 0, fallback: 0, bom: 0, eks: [] });
    for (const b of bs) {
      const res = await fetch(`${BASE}/api/regnr`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
        body: JSON.stringify({ regnr: b.regnr }),
      });
      let j = null;
      try { j = await res.json(); } catch { /* tom */ }
      const u = utfall.get(k);
      u.total++;
      const treff = String(j?.resolver?.utfall ?? (j?.bil?.merke ? 'BOM' : 'SVV_BOM') ?? 'feil').toLowerCase();
      if (treff.includes('pinpoint')) u.pinpoint++;
      else if (treff.includes('verify')) u.verify++;
      else if (treff.includes('fallback')) u.fallback++;
      else u.bom++;
      if (u.eks.length < 3) u.eks.push(`${b.regnr} ${b.make} ${b.model} → ${treff}${j?.resolver?.varenr ? ' (' + j.resolver.varenr + ')' : ''}`);
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  console.log('SVV-mønster-klasser mot staging-resolver (n per klasse, utfall):');
  console.log('┌──────────────────────┬──────┬──────────┬────────┬──────────┬─────┐');
  console.log('│ klasse               │  n   │ PINPOINT │ VERIFY │ FALLBACK │ bom │');
  console.log('├──────────────────────┼──────┼──────────┼────────┼──────────┼─────┤');
  for (const [k, u] of [...utfall.entries()].sort()) {
    console.log(`│ ${k.padEnd(20)} │ ${String(u.total).padEnd(4)} │ ${String(u.pinpoint).padEnd(8)} │ ${String(u.verify).padEnd(6)} │ ${String(u.fallback).padEnd(8)} │ ${String(u.bom).padEnd(3)} │`);
  }
  console.log('└──────────────────────┴──────┴──────────┴────────┴──────────┴─────┘');
  for (const [k, u] of utfall) {
    console.log(`\n[${k}]`);
    for (const e of u.eks) console.log('  ' + e);
  }
}
main();
