#!/usr/bin/env node
// Sammenligner /api/regnr FØR (produksjon) og ETTER (staging med VIN-fiks)
// på samme frosne 616-grunnlag. Skriver reports/vin-fiks-for-etter-616.json.
import { readFileSync, writeFileSync } from 'node:fs';

const PROD = 'https://finnbilglass.no';
const STAGING = 'https://finnbilglass-frontrute-staging.tomarnejensen.workers.dev';
const manifest = JSON.parse(readFileSync('/Users/taj/finnbilglass/data/testgrunnlag/manifest-samlet.json', 'utf8')).biler;

async function kall(base, regnr) {
  try {
    const r = await fetch(base + '/api/regnr', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' },
      body: JSON.stringify({ regnr, lookupOnly: true }),
    });
    const d = await r.json();
    const res = d.resolver || {};
    return {
      ok: !!d.ok,
      aar: d.bil?.aar ?? null,
      utfall: res.utfall ?? null,
      antall: res.totalAntall ?? (res.kandidater?.length ?? 0),
      varenr: (res.kandidater || []).map(k => k.varenr).sort(),
    };
  } catch (e) {
    return { ok: false, feil: String(e).slice(0, 80) };
  }
}

const rader = [];
let endret = 0, feilet = 0;
for (const b of manifest) {
  const regnr = (b.regnr || '').replace(/\s+/g, '');
  if (!regnr) continue;
  const før = await kall(PROD, regnr);
  const etter = await kall(STAGING, regnr);
  const lik = JSON.stringify(før.varenr) === JSON.stringify(etter.varenr) &&
              før.utfall === etter.utfall && før.aar === etter.aar;
  if (!før.ok || !etter.ok) feilet++;
  if (!lik) endret++;
  rader.push({ test_id: b.test_id, bil: `${b.merke} ${b.modell} ${b.aar ?? ''}`.trim(),
               har_vin: !!b.vin, foer: før, etter });
  if (rader.length % 100 === 0) console.log(`${rader.length}/${manifest.length} — endret ${endret}`);
}

writeFileSync('reports/vin-fiks-for-etter-616.json',
  JSON.stringify({ antall: rader.length, endret, feilet, rader }, null, 2));
console.log(`\nFERDIG: ${rader.length} biler, ${endret} endret, ${feilet} feilet`);
for (const r of rader.filter(r => JSON.stringify(r.foer.varenr) !== JSON.stringify(r.etter.varenr)).slice(0, 15)) {
  console.log(`  ${r.test_id} ${r.bil} vin=${r.har_vin} aar ${r.foer.aar}->${r.etter.aar} | ${r.foer.varenr.join(',')} -> ${r.etter.varenr.join(',')}`);
}
