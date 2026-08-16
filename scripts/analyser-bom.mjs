// Analyser matcher-bommene fra test-100: henter meta fra API-et for hver bom
// for å finne rotårsak (seed=0 → navngap, kand=0 → år/attributt-filter, etc.).
import { readFileSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const DIR = '/Users/taj/finnbilglass/data';
const rader = readFileSync(`${DIR}/test-100-resultater.jsonl`, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const bommer = rader.filter((r) => r.bil && r.bil.merke && !r.treff);
console.log(`Bommer: ${bommer.length}`);

const ut = [];
for (const b of bommer) {
  let meta = null;
  try {
    const res = await fetch('https://finnbilglass.no/api/frontrute', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ merke: b.bil.merke, modell: b.bil.modell, aar: b.bil.aar, profil: {} }),
      signal: AbortSignal.timeout(20000),
    });
    if (res.ok) {
      const d = await res.json();
      meta = d.meta ?? null;
    }
  } catch (e) { meta = null; }
  ut.push({
    regnr: b.regnr,
    finn: `${b.merke} ${b.modell} ${b.aar}`,
    svv: `${b.bil.merke} ${b.bil.modell} ${b.bil.aar}`,
    meta,
  });
  await sleep(500);
}
writeFileSync(`${DIR}/test-100-bom-analyse.json`, JSON.stringify(ut, null, 2));
const stats = {};
for (const u of ut) {
  const key = !u.meta ? 'api-feil' : u.meta.seedAntall === 0 ? 'seed=0 (navngap)' : u.meta.kandidaterTotalt === 0 ? 'kand=0 (filter)' : `kand>0 men tom (${u.meta.kandidaterTotalt})`;
  stats[key] = (stats[key] || 0) + 1;
}
console.log('Fordeling:', JSON.stringify(stats, null, 2));
console.log('\n=== BOM-DETALJER ===');
for (const u of ut) {
  console.log(`${u.regnr} | finn: ${u.finn} | svv: ${u.svv} | meta: ${JSON.stringify(u.meta)}`);
}
