/**
 * AUTO-GLASS TYPEKODE → glass_typekode  (IKKE Glavista-adapteren)
 *
 * To Apify-pipelines som IKKE må blandes:
 *   1) tomarnejensen/finnbilglass-price-import (actor-id 1QF8RbAZ6ewBALyYj)
 *      → auto-glass.no (forhandlerlogin) → posisjonstekst per varenr.
 *      I typekodeOnly-modus er pris-/lagerfelt tomme. → denne mapperen.
 *   2) finnbilglass-catalog → glavista.com sitemap → eurokode/attributter/EUR
 *      → scripts/apify-catalog-adapter.ts (source: apify-glavista).
 *
 * MÅLT 2026-11-04: aktøren gir POSISJONSTEKST («BAKRUTE», «DØRRUTE FREMRE
 * FØRERSIDE»), mens glass_typekode bruker 18 korte koder (F, B, DFF, DPF, DFB,
 * DPB, DFFV, DPFV, DFBV, DPBV, SFB1-3, SPB1-3, BP, BF). Teksten MÅ oversettes.
 * Kryssjekk mot staging for 92 varer: 90 stemte, 2 avvek (27411GN/27412GN —
 * speilvendt side). Ukjent tekst avvises; aldri gjettet.
 *
 * Bruk:
 *   node scripts/apify-typekode-import.mjs --dataset=<fil.json|-> [--dry-run]
 *        [--eksisterende=<fil.json>]   # [{varenr,typekode}] fra glass_typekode
 *        [--kilde=apify-auto-glass] [--out=db/katalog/typekode_upsert.sql]
 *
 * Exit 1 hvis noe ble avvist eller en konflikt ble funnet.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...rest] = a.replace(/^--/, '').split('=');
    return [k, rest.length ? rest.join('=') : true];
  }),
);

const dataset = args.dataset;
if (!dataset) {
  console.error('Mangler --dataset=<fil.json|->');
  process.exit(2);
}

const kilde = String(args.kilde || 'apify-auto-glass');
const dryRun = Boolean(args['dry-run']);

/** Posisjonstekst → kanonisk kode (vokabularet i glass_typekode). */
const TEKST_TIL_KODE = {
  FRONTRUTE: 'F',
  BAKRUTE: 'B',
  'DORRUTE FREMRE FORERSIDE': 'DFF',
  'DORRUTE FREMRE PASSASJERSIDE': 'DPF',
  'DORRUTE BAKRE FORERSIDE': 'DFB',
  'DORRUTE BAKRE PASSASJERSIDE': 'DPB',
  'VENTIL/SIDERUTE FREMRE FORERSIDE': 'DFFV',
  'VENTIL/SIDERUTE FREMRE PASSASJERSIDE': 'DPFV',
  'VENTIL/SIDERUTE BAKRE FORERSIDE': 'DFBV',
  'VENTIL/SIDERUTE BAKRE PASSASJERSIDE': 'DPBV',
  'SIDERUTE BAKRE 1 FORERSIDE': 'SFB1',
  'SIDERUTE BAKRE 1 PASSASJERSIDE': 'SPB1',
  'SIDERUTE BAKRE 2 FORERSIDE': 'SFB2',
  'SIDERUTE BAKRE 2 PASSASJERSIDE': 'SPB2',
  'SIDERUTE BAKRE 3 FORERSIDE': 'SFB3',
  'SIDERUTE BAKRE 3 PASSASJERSIDE': 'SPB3',
};
const GYLDIGE_KODER = new Set([...Object.values(TEKST_TIL_KODE), 'BP', 'BF']);

function normaliserTekst(t) {
  return String(t || '')
    .toUpperCase()
    .replace(/Ø/g, 'O')
    .replace(/Å/g, 'A')
    .replace(/Æ/g, 'E')
    .replace(/\s+/g, ' ')
    .trim();
}

function tilKode(tekst) {
  const n = normaliserTekst(tekst);
  if (GYLDIGE_KODER.has(n)) return { kode: n, via: 'ALLEREDE_KODE' };
  if (TEKST_TIL_KODE[n]) return { kode: TEKST_TIL_KODE[n], via: 'POSISJONSTEKST' };
  return { kode: null, via: null };
}

function load() {
  const raw = dataset === '-' ? readFileSync(0, 'utf8') : readFileSync(dataset, 'utf8');
  const parsed = JSON.parse(raw);
  if (Array.isArray(parsed)) return { items: parsed, id: null };
  if (Array.isArray(parsed.items)) return { items: parsed.items, id: parsed.defaultDatasetId ?? null };
  throw new Error('Ukjent datasett-format: forventet array eller { items: [...] }');
}

const { items, id: datasetId } = load();
const eksisterende = args.eksisterende
  ? new Map(JSON.parse(readFileSync(String(args.eksisterende), 'utf8')).map((r) => [r.varenr, r.typekode]))
  : null;

const now = Date.now();
// Felt som beviser at datasettet IKKE er typekode-only. NOK-listepris fra
// Auto-Glass er ikke XLS-prisgrunnlaget og skal aldri inn i glass_typekode.
const PRISFELT = ['pris', 'pris_eur', 'pris_valuta', 'listPriceValue', 'customerPriceInclVat'];

const rader = [];
const avvist = [];
const konflikter = [];
const uendret = [];
const sett = new Map();

for (const [i, item] of items.entries()) {
  if (!item || typeof item !== 'object') { avvist.push({ rad: i, grunn: 'ikke et objekt' }); continue; }

  const varenr = String(item.sku ?? item.varenr ?? item.articleNumber ?? '').trim();
  const raa = String(item.typeCodeRaw ?? item.typekode ?? '').trim();

  if (!varenr) { avvist.push({ rad: i, grunn: 'varenr mangler' }); continue; }
  if (!raa) { avvist.push({ rad: i, varenr, grunn: 'typekode mangler' }); continue; }

  const lekkasje = PRISFELT.filter((f) => item[f] !== undefined && item[f] !== null && item[f] !== '');
  if (lekkasje.length) {
    avvist.push({ rad: i, varenr, grunn: `ikke typekode-only — prisfelt: ${lekkasje.join(', ')}` });
    continue;
  }

  const nokkel = varenr.toUpperCase();

  // Aktøren flagger selv sidekonflikt (f.eks. 29730YP: kilden sier DRIVER,
  // tidligere rapport sa PASSENGER). Slike rader skal ALDRI auto-importeres —
  // de rapporteres og krever manuell avgjørelse.
  if (item.sideConflict === true || item.manualReviewRequired === true) {
    konflikter.push({
      varenr,
      grunn: 'sidekonflikt/manuell kontroll',
      typeCodeSide: item.typeCodeSide ?? null,
      priorReportedSide: item.priorReportedSide ?? null,
      priorReportedSideVerified: item.priorReportedSideVerified ?? null,
      reviewStatus: item.reviewStatus ?? null,
      reviewReasons: item.reviewReasons ?? null,
    });
    sett.set(nokkel, { varenr, typekode: null, konflikt: true });
    continue;
  }

  const { kode, via } = tilKode(raa);
  if (!kode) { avvist.push({ rad: i, varenr, grunn: `ukjent posisjonstekst: ${raa.slice(0, 50)}` }); continue; }

  const finnes = sett.get(nokkel);
  if (finnes) {
    if (finnes.typekode !== kode) konflikter.push({ varenr, i_datasettet: finnes.typekode, igjen: kode });
    continue;
  }

  if (eksisterende && eksisterende.has(varenr)) {
    const db = eksisterende.get(varenr);
    if (db !== kode) {
      konflikter.push({ varenr, i_db: db, i_datasett: kode, posisjonstekst: raa });
      sett.set(nokkel, { varenr, typekode: kode, konflikt: true });
      continue;
    }
    uendret.push({ varenr, typekode: kode });
    sett.set(nokkel, { varenr, typekode: kode });
    continue;
  }

  sett.set(nokkel, { varenr, typekode: kode });
  rader.push({ varenr, typekode: kode, via });
}

const esc = (v) => String(v).replace(/'/g, "''");
const kildefil = datasetId ? `apify:${datasetId}` : `fil:${dataset.split('/').pop()}`;
const sql = [
  `-- AUTO-GLASS TYPEKODE fra Apify (posisjonstekst oversatt til kanonisk kode)`,
  `-- kilde=${kilde} kildefil=${kildefil} nye=${rader.length} uendret=${uendret.length} konflikter=${konflikter.length}`,
  ...rader.map(
    (r) =>
      `INSERT INTO glass_typekode (varenr, typekode, typekode_beskrivelse, kilde, kildefil, hentet_at)\n` +
      `VALUES ('${esc(r.varenr)}', '${esc(r.typekode)}', '${esc(r.via)}', '${esc(kilde)}', '${esc(kildefil)}', ${now})\n` +
      `ON CONFLICT(varenr) DO UPDATE SET typekode=excluded.typekode, typekode_beskrivelse=excluded.typekode_beskrivelse, kildefil=excluded.kildefil, hentet_at=excluded.hentet_at\n` +
      `WHERE glass_typekode.typekode <> excluded.typekode;`,
  ),
];

console.log(JSON.stringify({
  dataset: datasetId ?? dataset,
  kilde,
  items: items.length,
  nye: rader.length,
  uendret: uendret.length,
  avvist: avvist.length,
  konflikter: konflikter.length,
  konflikt_eksempler: konflikter.slice(0, 10),
  avviste_eksempler: avvist.slice(0, 10),
}, null, 2));

if (dryRun) console.log('\n--dry-run: skriver ingen fil.');
else {
  const out = String(args.out || 'db/katalog/typekode_upsert.sql');
  writeFileSync(out, sql.join('\n') + '\n', 'utf8');
  console.log(`\nskrevet: ${out} (${rader.length} rader)`);
}

process.exit(avvist.length > 0 || konflikter.length > 0 ? 1 : 0);
