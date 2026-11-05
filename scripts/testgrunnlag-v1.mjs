#!/usr/bin/env node
/**
 * Genererer testgrunnlag v1 (CTO-runde 2, punkt 2, 3 og 7).
 *
 * Prinsipp:
 *  - Kjennemerker er personindirekte (oppslagbare til eier via SVV) og havner
 *    KUN i data/testgrunnlag/ (gitignored, tilgangsbegrenset).
 *  - Delbare rapporter bruker test-ID, aldri kjennemerke.
 *  - Hver test har FIRE uavhengige forventninger (ikke ett statusfelt):
 *      forventet_identifisering · forventet_kandidatutfall ·
 *      forventet_kundestatus · tillatt_reserveflyt
 *    «Manuell kontroll» kan derfor aldri skjule en regresjon: en bil som
 *    tidligere ble identifisert og nå faller til kontroll er et avvik.
 *  - Fast frø (seed) gjør det tilfeldige utvalget reproduserbart.
 *
 * Bruk: node scripts/testgrunnlag-v1.mjs [--seed 20261104]
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const seedArg = args.indexOf('--seed');
const SEED = seedArg >= 0 ? Number(args[seedArg + 1]) : 20261104;
const TILFELDIG_UTVALG = 50;

/** Enkel deterministisk PRNG (mulberry32) — samme frø gir samme utvalg. */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const finn = readFileSync(join(ROOT, 'data/finn-100.jsonl'), 'utf8')
  .trim().split('\n').filter(Boolean).map((l, i) => ({ ...JSON.parse(l), kilde: 'data/finn-100.jsonl', kilderad: i + 1 }));

const selvtest = JSON.parse(readFileSync(join(ROOT, 'data/fixtures/self-test-50-cars.json'), 'utf8'));
const selvtestRader = selvtest.biler.map((b, i) => ({
  regnr: b.regnr, merke: b.merke, modell: b.modell, aar: b.aar,
  kilde: 'data/fixtures/self-test-50-cars.json', kilderad: i + 1, segment: b.segment,
}));

// Fasitutvalget (2 biler) er kjennemerke-kilden for de dokumenterte fasitene —
// uten denne ville SU18018 aldri kommet med i grunnlaget.
const fasitCsv = readFileSync(join(ROOT, 'data/fasit-utvalg.csv'), 'utf8').trim().split('\n');
const fasitHode = fasitCsv[0].split(',');
const fasitRader = fasitCsv.slice(1).map((linje, i) => {
  const deler = linje.split(',');
  const rad = Object.fromEntries(fasitHode.map((h, k) => [h, deler[k] ?? '']));
  return {
    regnr: rad.regnr, merke: rad.merke, modell: rad.modell, aar: Number(rad.aar),
    kilde: 'data/fasit-utvalg.csv', kilderad: i + 2,
  };
});

// Fasitene: SU18018 har Tom-bekreftet glass (PROVISIONAL), AJ95429 er tvetydig.
const FASIT = {
  SU18018: {
    fasitkilde: 'data/fitment-golden.json#SU18018 + data/fasit-glass.json',
    forventet_identifisering: 'VW TRANSPORTER T5 2005 (SVV + VIN-dekode)',
    forventet_kandidatutfall: 'INNEHOLDER 2525GYA (og 2525CSGY skal ikke presenteres som bekreftet)',
    forventet_kundestatus: 'KREVER_KONTROLL',
    tillatt_reserveflyt: 'JA',
    fasitstatus: 'PROVISIONAL',
  },
  AJ95429: {
    fasitkilde: 'data/fitment-golden.json#AJ95429 + data/fasit-glass.json',
    forventet_identifisering: 'MERCEDES CLA 200 D 4MATIC 2016 (SVV)',
    forventet_kandidatutfall: 'INGEN_KANDIDAT (resolveren har ikke 4MATIC-rad)',
    forventet_kundestatus: 'INGEN_DEKNING',
    tillatt_reserveflyt: 'JA (manuell forespørsel er eneste vei)',
    fasitstatus: 'AMBIGUOUS',
  },
};

// Dedupliser på kjennemerke; første forekomst vinner, kilder samles.
const biler = new Map();
for (const r of [...finn, ...selvtestRader, ...fasitRader]) {
  const key = String(r.regnr).toUpperCase();
  if (biler.has(key)) continue;
  biler.set(key, {
    regnr: key, merke: r.merke, modell: r.modell, aar: r.aar,
    kilder: [`${r.kilde}:${r.kilderad}`], segment: r.segment ?? null,
  });
}

// Test-ID-er tildeles i stabil sortert rekkefølge (merke, modell, år, regnr).
const sortert = [...biler.values()].sort((a, b) =>
  `${a.merke}|${a.modell}|${a.aar}|${a.regnr}`.localeCompare(`${b.merke}|${b.modell}|${b.aar}|${b.regnr}`));
sortert.forEach((b, i) => { b.test_id = `FBG-T-${String(i + 1).padStart(4, '0')}`; });

// Faste sett: fasitene + selvtest-kohorten er regresjon. Resten er kandidater
// for det tilfeldige utvalget (fast frø), slik at begge sett er reproduserbare.
const selvtestRegnr = new Set(selvtestRader.map((r) => r.regnr.toUpperCase()));
const regresjon = sortert.filter((b) => FASIT[b.regnr] || selvtestRegnr.has(b.regnr));
const resten = sortert.filter((b) => !regresjon.includes(b));

const rnd = mulberry32(SEED);
const stokket = [...resten];
for (let i = stokket.length - 1; i > 0; i--) {
  const j = Math.floor(rnd() * (i + 1));
  [stokket[i], stokket[j]] = [stokket[j], stokket[i]];
}
const tilfeldigUtvalg = new Set(stokket.slice(0, TILFELDIG_UTVALG).map((b) => b.test_id));

const rader = sortert.map((b) => {
  const f = FASIT[b.regnr] ?? null;
  const sett = regresjon.includes(b) ? 'regresjon' : (tilfeldigUtvalg.has(b.test_id) ? 'tilfeldig' : 'reserve');
  return {
    test_id: b.test_id,
    kjennemerke: b.regnr,
    kilde: b.kilder.join(';'),
    merke: b.merke,
    modell: b.modell,
    aar: b.aar,
    sett,
    fasitstatus: f ? f.fasitstatus : 'INGEN_FASIT',
    fasitkilde: f ? f.fasitkilde : '',
    forventet_identifisering: f ? f.forventet_identifisering : `IDENTIFISERES: ${b.merke} ${b.modell} ${b.aar}`,
    forventet_kandidatutfall: f ? f.forventet_kandidatutfall : 'IKKE_MALT',
    forventet_kundestatus: f ? f.forventet_kundestatus : 'IKKE_MALT',
    tillatt_reserveflyt: f ? f.tillatt_reserveflyt : 'JA',
    // Fire uavhengige akser (CTO punkt 3) — fylles etter kjøring, aldri blandet.
    teknisk_utfall: 'IKKE_KJORT',
    katalogutfall: 'IKKE_KJORT',
    fasitvurdering: f ? 'IKKE_KJORT' : 'IKKE_VURDERT',
    kundeutfall: 'IKKE_KJORT',
  };
});

const FELT = Object.keys(rader[0]);
const csv = [FELT.join(','), ...rader.map((r) => FELT.map((f) => {
  const v = r[f] ?? '';
  return /[",;\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);
}).join(','))].join('\n');

// 1) Tilgangsbegrenset grunnlag (kjennemerker) — gitignored.
const privatDir = join(ROOT, 'data/testgrunnlag');
if (!existsSync(privatDir)) mkdirSync(privatDir, { recursive: true });
writeFileSync(join(privatDir, 'testgrunnlag-v1-privat.csv'), csv + '\n');

// 2) Delebar versjon — samme rader, uten kjennemerke.
const delbare = rader.map((r) => ({ ...r, kjennemerke: '(skjult — se privat grunnlag)' }));
const csvDelbar = [FELT.join(','), ...delbare.map((r) => FELT.map((f) => {
  const v = r[f] ?? '';
  return /[",;\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);
}).join(','))].join('\n');
writeFileSync(join(ROOT, 'reports/testgrunnlag-v1-delebar.csv'), csvDelbar + '\n');

const antall = (s) => rader.filter((r) => r.sett === s).length;
console.log(`testgrunnlag v1 — seed ${SEED}`);
console.log(`  unike biler: ${rader.length}`);
console.log(`  regresjon: ${antall('regresjon')} · tilfeldig utvalg: ${antall('tilfeldig')} · reserve: ${antall('reserve')}`);
console.log(`  med dokumentert fasit: ${rader.filter((r) => r.fasitstatus !== 'INGEN_FASIT').length}`);
console.log(`  skrevet: data/testgrunnlag/testgrunnlag-v1-privat.csv (tilgangsbegrenset)`);
console.log(`  skrevet: reports/testgrunnlag-v1-delebar.csv (uten kjennemerker)`);
