#!/usr/bin/env node
/**
 * Pilot-kjøring mot staging (testplan v2, «prøvepulje først»).
 *
 * Kaller KUN /api/regnr med `lookupOnly: true`:
 *   - ingen skriving til D1 (skalLoggeSok() slår logging av, se src/sok-logg-policy.ts)
 *   - ingen henvendelse, ingen e-post, ingen R2-opplasting
 *   - sekvensielle kall med pause, stoppregler og kjørings-ID
 *
 * Resultatet skrives med fire uavhengige akser (CTO punkt 3):
 *   teknisk_utfall · katalogutfall · fasitvurdering · kundeutfall
 *
 * Bruk:
 *   node scripts/pilot-kjoring.mjs --limit 5
 *   node scripts/pilot-kjoring.mjs --limit 51 --sett regresjon
 *   BASE_URL=... node scripts/pilot-kjoring.mjs --limit 5
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const BASE = (process.env.BASE_URL ?? 'https://finnbilglass-frontrute-staging.tomarnejensen.workers.dev').replace(/\/$/, '');
const PAUSE_MS = 400;
const MAKS_PAAFOLGENDE_FEIL = 3;
const MAKS_429_ANDEL = 0.1;

function arg(navn, fallback) {
  const i = process.argv.indexOf(`--${navn}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const LIMIT = Number(arg('limit', 5));
const SETT = arg('sett', 'regresjon');
const RUN_ID = arg('run', `pilot-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '')}`);

if (/finnbilglass\.no/.test(BASE)) {
  console.error('NEKTER: prod-adresse. Piloten skal kjøre mot staging.');
  process.exit(2);
}

const fil = join(ROOT, 'data/testgrunnlag/testgrunnlag-v1-privat.csv');
if (!existsSync(fil)) {
  console.error('Mangler data/testgrunnlag/testgrunnlag-v1-privat.csv — kjør scripts/testgrunnlag-v1.mjs først.');
  process.exit(2);
}

const linjer = readFileSync(fil, 'utf8').trim().split('\n');
const hode = linjer[0].replace(/^\uFEFF/, '').split(',');
const rader = linjer.slice(1).map((l) => {
  // Enkel CSV-parser som tåler anførselstegn med komma.
  const felt = [];
  let naa = '', i = 0, iSitat = false;
  while (i < l.length) {
    const c = l[i];
    if (c === '"') {
      if (iSitat && l[i + 1] === '"') { naa += '"'; i += 2; continue; }
      iSitat = !iSitat; i++; continue;
    }
    if (c === ',' && !iSitat) { felt.push(naa); naa = ''; i++; continue; }
    naa += c; i++;
  }
  felt.push(naa);
  return Object.fromEntries(hode.map((h, k) => [h, felt[k] ?? '']));
}).filter((r) => r.sett === SETT).slice(0, LIMIT);

const soek = async (regnr) => {
  const start = Date.now();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const r = await fetch(`${BASE}/api/regnr`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': `fbg-pilot/${RUN_ID}` },
      body: JSON.stringify({ regnr, lookupOnly: true }),
      signal: ctrl.signal,
    });
    const tekst = await r.text();
    let data = null;
    try { data = JSON.parse(tekst); } catch { /* ikke JSON */ }
    return { http: r.status, data, ms: Date.now() - start };
  } finally {
    clearTimeout(t);
  }
};

const teknisk = (http, feil) => {
  if (feil) return feil.name === 'AbortError' ? 'TIMEOUT' : 'ANNET';
  if (http === 429) return '429';
  if (http >= 500) return '5xx';
  if (http >= 400) return '4xx';
  return 'OK';
};

const resultat = [];
let paaFolgendeFeil = 0;
let antall429 = 0;

for (const rad of rader) {
  let ut;
  let feil = null;
  try { ut = await soek(rad.kjennemerke); } catch (e) { feil = e; ut = { http: 0, data: null, ms: 0 }; }

  const res = ut.data?.resolver ?? null;
  const kandidater = Array.isArray(res?.kandidater) ? res.kandidater.length : 0;
  const t = teknisk(ut.http, feil);

  if (t !== 'OK') { paaFolgendeFeil++; if (t === '429') antall429++; } else paaFolgendeFeil = 0;

  const katalog = !res ? 'IKKE_VURDERT'
    : (kandidater > 0 ? 'KANDIDATER' : 'INGEN_DEKNING');

  // Fasitvurdering kun der det finnes en dokumentert fasit.
  let fasit = 'IKKE_VURDERT';
  if (rad.fasitstatus && rad.fasitstatus !== 'INGEN_FASIT') {
    if (t !== 'OK') fasit = 'UKLART';
    else if (!res) fasit = 'AVVIK';
    else if (/INGEN_KANDIDAT/i.test(rad.forventet_kandidatutfall)) {
      fasit = kandidater === 0 ? 'SAMSVAR' : 'AVVIK';
    } else if (/INNEHOLDER\s+(\S+)/i.test(rad.forventet_kandidatutfall)) {
      const forventet = rad.forventet_kandidatutfall.match(/INNEHOLDER\s+(\S+)/i)[1];
      const varenr = (res.kandidater ?? []).map((k) => k.varenr);
      fasit = varenr.includes(forventet) ? 'SAMSVAR' : 'AVVIK';
    } else fasit = 'UKLART';
  }

  const kunde = t !== 'OK' ? 'TEKNISK_FEIL'
    : (kandidater > 0 ? 'KANDIDATER_VIST' : 'HJELPEFLYT/MANUELL');

  resultat.push({
    test_id: rad.test_id,
    merke: rad.merke,
    modell: rad.modell,
    aar: rad.aar,
    utfall: res?.utfall ?? '',
    kandidatantall: kandidater,
    bil_funnet: ut.data?.bil ? 'JA' : 'NEI',
    teknisk_utfall: t,
    katalogutfall: katalog,
    fasitvurdering: fasit,
    kundeutfall: kunde,
    http: ut.http,
    ms: ut.ms,
  });

  console.log(`${rad.test_id} ${rad.merke} ${rad.modell} ${rad.aar} → ${res?.utfall ?? 'FEIL'} · ${kandidater} kand. · ${t} · fasit ${fasit} · ${ut.ms} ms`);

  if (paaFolgendeFeil >= MAKS_PAAFOLGENDE_FEIL) {
    console.error(`STOPP: ${MAKS_PAAFOLGENDE_FEIL} påfølgende tekniske feil.`);
    break;
  }
  if (resultat.length >= 10 && antall429 / resultat.length > MAKS_429_ANDEL) {
    console.error('STOPP: 429-andel over grensen (10 %).');
    break;
  }
  await new Promise((r) => setTimeout(r, PAUSE_MS));
}

const FELT = ['test_id', 'merke', 'modell', 'aar', 'utfall', 'kandidatantall', 'bil_funnet', 'teknisk_utfall', 'katalogutfall', 'fasitvurdering', 'kundeutfall', 'http', 'ms'];
const rappDir = join(ROOT, 'reports');
if (!existsSync(rappDir)) mkdirSync(rappDir, { recursive: true });
const utfil = join(rappDir, `${RUN_ID}.csv`);
writeFileSync(utfil, [FELT.join(','), ...resultat.map((r) => FELT.map((f) => String(r[f] ?? '')).join(','))].join('\n') + '\n');

const tell = (f) => resultat.reduce((a, r) => ({ ...a, [r[f]]: (a[r[f]] ?? 0) + 1 }), {});
console.log(`\n${RUN_ID} — ${resultat.length} kall mot ${BASE}`);
console.log(`  teknisk:  ${JSON.stringify(tell('teknisk_utfall'))}`);
console.log(`  katalog:  ${JSON.stringify(tell('katalogutfall'))}`);
console.log(`  kunde:    ${JSON.stringify(tell('kundeutfall'))}`);
const medFasit = resultat.filter((r) => r.fasitvurdering !== 'IKKE_VURDERT');
if (medFasit.length) console.log(`  fasit:    ${JSON.stringify(tell('fasitvurdering'))} (bare biler med dokumentert fasit)`);
console.log(`  rapport:  ${utfil}`);
