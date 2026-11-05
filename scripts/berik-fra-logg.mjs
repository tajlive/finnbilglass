#!/usr/bin/env node
/**
 * berik-fra-logg — utvider testgrunnlaget med biler vi ALLEREDE har oppslag på.
 *
 * KILDE: egne D1-logger (`regnr_logg`), ikke FINN.no. FINN.no forbyr crawling
 * (robots.txt), så nye kjennemerker hentes aldri derfra. Her brukes kun
 * registreringsnummer kunden selv har søkt på i vår egen tjeneste.
 *
 * Berikelse skjer mot STAGING (`lookupOnly: true`, som ikke logger), ikke
 * produksjon, og med sekvensielle kall og pause.
 *
 * Bruk:
 *   node --import tsx scripts/berik-fra-logg.mjs --plater=/tmp/plater-nye.json \
 *     --limit=500 --ut=data/testgrunnlag/manifest-v3.json
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const PLATER = arg('plater', '/tmp/plater-nye.json');
const LIMIT = Number(arg('limit', '500'));
const UT = arg('ut', 'data/testgrunnlag/manifest-v3.json');
const BASE = (process.env.BASE_URL ?? 'https://finnbilglass-frontrute-staging.tomarnejensen.workers.dev').replace(/\/$/, '');
const PAUSE = Number(arg('pause', '450'));

const plater = JSON.parse(readFileSync(PLATER, 'utf8')).slice(0, LIMIT);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const biler = [];
const feilet = [];

for (const [i, regnr] of plater.entries()) {
  const test_id = 'FBG-L-' + String(i + 1).padStart(4, '0');
  try {
    const res = await fetch(`${BASE}/api/regnr`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'Finnbilglass-Testgrunnlag/1.0' },
      body: JSON.stringify({ regnr, lookupOnly: true }),
      signal: AbortSignal.timeout(20000),
    });
    const d = await res.json();
    const bil = d?.bil;
    if (!res.ok || !bil?.merke || !bil?.modell) { feilet.push({ test_id, regnr, grunn: d?.error ?? `status ${res.status}` }); }
    else {
      biler.push({
        test_id,
        regnr,
        merke: bil.merke,
        modell: bil.modell,
        aar: bil.aar ?? null,
        kilde: 'D1 regnr_logg + SVV (staging lookupOnly)',
        utfall: d?.resolver?.utfall ?? null,
      });
    }
  } catch (e) {
    feilet.push({ test_id, regnr, grunn: String(e).slice(0, 80) });
  }
  if ((i + 1) % 50 === 0) console.log(`  ${i + 1}/${plater.length} — ${biler.length} beriket, ${feilet.length} feilet`);
  await sleep(PAUSE);
}

const merker = {};
for (const b of biler) merker[b.merke] = (merker[b.merke] ?? 0) + 1;

const manifest = {
  laget: new Date().toISOString(),
  kilde: 'egne D1-logger (regnr_logg) — ikke FINN.no',
  antallForsoekt: plater.length,
  antallBeriket: biler.length,
  antallFeilet: feilet.length,
  merker,
  biler,
  feilet,
};
manifest.sha256 = createHash('sha256').update(JSON.stringify(biler)).digest('hex');

writeFileSync(UT, JSON.stringify(manifest, null, 2), 'utf8');
console.log(`\nberiket: ${biler.length} | feilet: ${feilet.length}`);
console.log('merker:', Object.entries(merker).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v]) => `${k} ${v}`).join(', '));
console.log('sha256:', manifest.sha256.slice(0, 32));
console.log('skrevet:', UT);
