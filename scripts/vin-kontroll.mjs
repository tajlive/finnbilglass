// Kjører kontrollsettet mot én kodeversjon (staging). Skriver JSON per kjøring.
import { readFileSync, writeFileSync } from 'node:fs';
const BASE = 'https://finnbilglass-frontrute-staging.tomarnejensen.workers.dev';
const merke = process.argv[2] || 'ukjent';
const man = JSON.parse(readFileSync('/Users/taj/finnbilglass/data/testgrunnlag/manifest-samlet.json','utf8')).biler;
async function kall(regnr) {
  const r = await fetch(BASE + '/api/regnr', { method:'POST',
    headers:{'Content-Type':'application/json','User-Agent':'Mozilla/5.0'},
    body: JSON.stringify({ regnr, lookupOnly:true }) });
  const d = await r.json(); const res = d.resolver || {};
  return { aar: d.bil?.aar ?? null, vin: d.bil?.vin ?? null, utfall: res.utfall ?? null,
           varenr: (res.kandidater||[]).map(k=>k.varenr).sort() };
}
const ut = {};
// 1) ZZ33141 — med og uten VIN
ut.ZZ33141_regnr = await kall('ZZ33141');
const r1 = await fetch(BASE + '/api/frontrute', { method:'POST',
  headers:{'Content-Type':'application/json','User-Agent':'Mozilla/5.0'},
  body: JSON.stringify({ merke:'MERCEDES', modell:'GLE 350 DE 4MATIC COUPE', aar:2021 }) });
const d1 = await r1.json();
ut.ZZ33141_utenVIN = { utfall: d1.utfall ?? null, varenr: (d1.kandidater||[]).map(k=>k.varenr).sort() };
const r2 = await fetch(BASE + '/api/frontrute', { method:'POST',
  headers:{'Content-Type':'application/json','User-Agent':'Mozilla/5.0'},
  body: JSON.stringify({ merke:'MERCEDES', modell:'GLE 350 DE 4MATIC COUPE', aar:2021, vin:'W1N1673171A365845' }) });
const d2 = await r2.json();
ut.ZZ33141_medVIN_frontrute = { utfall: d2.utfall ?? null, varenr: (d2.kandidater||[]).map(k=>k.varenr).sort() };
// 2) kontrollgruppe: hele 616
ut.kontroll = {};
let i = 0;
for (const b of man) {
  const regnr = (b.regnr||'').replace(/\s+/g,''); if (!regnr) continue;
  ut.kontroll[b.test_id] = await kall(regnr);
  if (++i % 150 === 0) console.log(`${merke}: ${i}/${man.length}`);
}
writeFileSync(`reports/vin-kontroll-${merke}.json`, JSON.stringify(ut,null,1));
console.log(`${merke} ferdig: ${Object.keys(ut.kontroll).length} biler`);
