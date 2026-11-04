#!/usr/bin/env node
/** Leser /api/regnr-svaret i detalj for utvalgte test-ID-er (staging).
 *  Bruk: node scripts/pilot-detalj.mjs FBG-T-0113 FBG-T-0008 ...
 */
import { readFileSync } from 'node:fs';

const BASE = (process.env.BASE_URL ?? 'https://finnbilglass-frontrute-staging.tomarnejensen.workers.dev').replace(/\/$/, '');
const ids = process.argv.slice(2);
const linjer = readFileSync('data/testgrunnlag/testgrunnlag-v1-privat.csv', 'utf8').trim().split('\n');
const hode = linjer[0].replace(/^\uFEFF/, '').split(',');
const rader = linjer.slice(1).map((l) => Object.fromEntries(hode.map((h, i) => [h, l.split(',')[i] ?? ''])));

for (const id of ids) {
  const r = rader.find((x) => x.test_id === id);
  if (!r) { console.log(id, '— finnes ikke'); continue; }
  const res = await fetch(`${BASE}/api/regnr`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'fbg-detalj' },
    body: JSON.stringify({ regnr: r.kjennemerke, lookupOnly: true }),
  });
  const d = await res.json();
  const fr = d.frontrute ?? d.resolver ?? d;
  console.log(`\n=== ${id} ${r.merke} ${r.modell} ${r.aar} (${r.kjennemerke}) HTTP ${res.status}`);
  console.log('   nøkler:', Object.keys(d).join(','));
  console.log('   utfall:', fr.utfall, '| grunn:', fr.grunn, '| kandidater:', (fr.kandidater ?? []).length, '| sporsmaal:', JSON.stringify(fr.sporsmaal ?? []));
  for (const k of fr.kandidater ?? []) {
    console.log(`     - ${k.varenr} | ${k.eurokode} | ${k.varenavn} | ${k.listepris ?? k.pris} | ${k.variantId ?? '-'}`);
  }
  if (fr.varenr) console.log('   valgt:', fr.varenr, fr.eurokode, fr.variantId ?? '-');
}
