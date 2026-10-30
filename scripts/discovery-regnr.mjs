#!/usr/bin/env node
// Discovery: slå opp alle kandidat-regnr mot staging /api/regnr → JSON for fixture-bygging.
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const BASE = process.env.BASE_URL ?? 'https://finnbilglass-frontrute-staging.tomarnejensen.workers.dev';
const regnrListe = execSync(`cd /private/tmp/fbg-ops-p0 && grep -rhoE "\\b[A-ZÆØÅ]{2}[0-9]{5}\\b" tests/ data/ scripts/ 2>/dev/null | sort -u | grep -vE "^(AA12345|AB12345|BB67890|CC12345|CD67890|DD67890|QR12345|ST67890|UV12345|WX67890|XX12345|XX99999|YZ12345|ZZ12345|ZZ99999)$"`, { encoding: 'utf8' }).trim().split('\n');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function sok(regnr) {
  try {
    const r = await fetch(`${BASE}/api/regnr`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 (self-test-50 discovery)' },
      body: JSON.stringify({ regnr }),
    });
    const d = await r.json().catch(() => null);
    return {
      regnr,
      status: r.status,
      ok: d?.ok ?? false,
      bil: d?.bil ? { merke: d.bil.merke ?? null, modell: d.bil.modell ?? null, aar: d.bil.aar ?? null } : null,
      utfall: d?.resolver?.utfall ?? null,
      kandidater: Array.isArray(d?.resolver?.kandidater) ? d.resolver.kandidater.length : 0,
      feil: d?.error ?? null,
    };
  } catch (e) {
    return { regnr, status: 0, ok: false, bil: null, utfall: null, kandidater: 0, feil: String(e) };
  }
}

const resultater = [];
let idx = 0;
const WORKERS = 3;
async function worker() {
  while (idx < regnrListe.length) {
    const r = regnrListe[idx++];
    resultater.push(await sok(r));
    await sleep(120);
  }
}
await Promise.all(Array.from({ length: WORKERS }, worker));

const medBil = resultater.filter((r) => r.bil?.merke);
console.log(`totalt: ${resultater.length} | med SVV-bil: ${medBil.length} | tomme: ${resultater.length - medBil.length}`);
console.log(`treff med kandidater: ${medBil.filter((r) => r.kandidater > 0).length} | uten kandidater: ${medBil.filter((r) => r.kandidater === 0).length}`);
writeFileSync('/tmp/fbg-discovery.json', JSON.stringify(resultater, null, 1));
// vis spredning
const eldre = medBil.filter((r) => r.bil.aar && r.bil.aar < 2012);
const nyere = medBil.filter((r) => r.bil.aar && r.bil.aar >= 2023);
console.log(`eldre (<2012): ${eldre.length} | nyere (>=2023): ${nyere.length}`);
console.log('eksempler:', medBil.slice(0, 8).map((r) => `${r.regnr} ${r.bil.merke} ${r.bil.modell} ${r.bil.aar} (${r.utfall}, ${r.kandidater})`).join('\n  '));
