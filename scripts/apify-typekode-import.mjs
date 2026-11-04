/**
 * AUTO-GLASS TYPEKODE → glass_typekode  (IKKE Glavista-adapteren)
 *
 * To Apify-pipelines som IKKE må blandes:
 *   1) tomarnejensen/finnbilglass-price-import  → auto-glass.no (forhandlerlogin)
 *      → typekode-data (varenr + typekode), ingen priser i typekodeOnly-modus
 *      → denne mapperen → glass_typekode
 *   2) finnbilglass-catalog (repo .actor/)  → Glavista sitemap
 *      → priser/attributter → scripts/apify-catalog-adapter.ts (source: apify-glavista)
 *
 * Bruk:
 *   node scripts/apify-typekode-import.mjs --dataset=<fil.json|-> [--dry-run]
 *        [--kilde=apify-auto-glass] [--out=db/katalog/typekode_upsert.sql]
 *
 * Datasettet kan være rå Apify-eksport (array av items) eller
 * { items: [...] } / { defaultDatasetId, items: [...] }.
 *
 * Sjekker (feiler hardt = exit 1):
 *   - varenr mangler eller er tom
 *   - typekode mangler eller har ugyldig format
 *   - prisfelt er med (typekodeOnly skal ikke gi priser)
 *   - samme varenr med to ulike typekoder (konflikt rapporteres, ikke overskrives)
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

function load() {
  const raw = dataset === '-' ? readFileSync(0, 'utf8') : readFileSync(dataset, 'utf8');
  const parsed = JSON.parse(raw);
  if (Array.isArray(parsed)) return { items: parsed, id: null };
  if (Array.isArray(parsed.items)) return { items: parsed.items, id: parsed.defaultDatasetId ?? null };
  throw new Error('Ukjent datasett-format: forventet array eller { items: [...] }');
}

const { items, id: datasetId } = load();
const now = Date.now();

const TYPEKODE_RE = /^[A-Z0-9][A-Z0-9._/+-]{1,39}$/;
const PRICE_FIELDS = [
  'pris', 'pris_eur', 'pris_valuta', 'listPrice', 'listPriceValue', 'priceText',
  'priceEvidence', 'listPriceRaw', 'vatBasis',
];

const rader = [];
const avvist = [];
const konflikter = [];
const sett = new Map();

for (const [i, item] of items.entries()) {
  if (!item || typeof item !== 'object') {
    avvist.push({ rad: i, grunn: 'ikke et objekt' });
    continue;
  }
  const varenr = String(item.sku ?? item.varenr ?? item.articleNumber ?? '').trim();
  const typekode = String(item.typeCodeRaw ?? item.typekode ?? '').trim();

  if (!varenr) { avvist.push({ rad: i, grunn: 'varenr mangler' }); continue; }
  if (!typekode) { avvist.push({ rad: i, varenr, grunn: 'typekode mangler' }); continue; }
  if (!TYPEKODE_RE.test(typekode.toUpperCase())) {
    avvist.push({ rad: i, varenr, grunn: `ugyldig typekode-format: ${typekode.slice(0, 40)}` });
    continue;
  }

  // typekodeOnly skal aldri gi priser — Glavista-priser skal ikke inn her.
  const lekkasje = PRICE_FIELDS.filter((f) => item[f] !== undefined && item[f] !== null && item[f] !== '');
  if (lekkasje.length) {
    avvist.push({ rad: i, varenr, grunn: `prisfelt i typekode-datasett: ${lekkasje.join(', ')}` });
    continue;
  }

  const nokkel = varenr.toUpperCase();
  const ny = { varenr, typekode: typekode.toUpperCase(), beskrivelse: String(item.typeCodeSource ?? '').slice(0, 60) };
  const finnes = sett.get(nokkel);
  if (finnes) {
    if (finnes.typekode !== ny.typekode) {
      konflikter.push({ varenr, forste: finnes.typekode, andre: ny.typekode });
    }
    continue;
  }
  sett.set(nokkel, ny);
  rader.push(ny);
}

function sqlEscape(v) {
  return String(v).replace(/'/g, "''");
}

const kildefil = datasetId ? `apify:${datasetId}` : `fil:${dataset.split('/').pop()}`;
const sql = [
  `-- AUTO-GLASS TYPEKODE fra Apify (ikke Glavista-priser)`,
  `-- kilde=${kilde} kildefil=${kildefil} rader=${rader.length}`,
  `-- Idempotent: oppdaterer typekode kun naar den er ny eller endret.`,
  ...rader.map(
    (r) =>
      `INSERT INTO glass_typekode (varenr, typekode, typekode_beskrivelse, kilde, kildefil, hentet_at)\n` +
      `VALUES ('${sqlEscape(r.varenr)}', '${sqlEscape(r.typekode)}', '${sqlEscape(r.beskrivelse)}', '${sqlEscape(kilde)}', '${sqlEscape(kildefil)}', ${now})\n` +
      `ON CONFLICT(varenr) DO UPDATE SET typekode=excluded.typekode, typekode_beskrivelse=excluded.typekode_beskrivelse, kildefil=excluded.kildefil, hentet_at=excluded.hentet_at\n` +
      `WHERE glass_typekode.typekode <> excluded.typekode;`,
  ),
];

const rapport = {
  dataset: datasetId ?? dataset,
  kilde,
  items: items.length,
  godkjent: rader.length,
  avvist: avvist.length,
  konflikter: konflikter.length,
  avviste_eksempler: avvist.slice(0, 10),
  konflikt_eksempler: konflikter.slice(0, 10),
};

console.log(JSON.stringify(rapport, null, 2));

if (dryRun) {
  console.log('\n--dry-run: skriver ingen fil.');
} else {
  const out = String(args.out || 'db/katalog/typekode_upsert.sql');
  writeFileSync(out, sql.join('\n') + '\n', 'utf8');
  console.log(`\nskrevet: ${out} (${rader.length} rader)`);
}

// Konflikter er ikke en feil i importen, men skal alltid rapporteres.
process.exit(avvist.length > 0 ? 1 : 0);
