/**
 * migrate-glass-skus.mjs — Oppgave 1: migrer katalogdata → enhetlig GlassSku-modell.
 *
 * Kilder (alle lokale, ingen eksterne API-kall):
 *   1. data/glavista-index.json   (4 618 eurokoder; INDEPENDENT_CATALOG)
 *   2. data/gt-ekspansjon/gt-generert.sql (ground_truth-regler; INTERNAL_CATALOG)
 *   3. data/fasit-glass.json      (Tom-fasiter; AUTHORITATIVE → status='verified')
 *
 * Output: data/glass-skus.json (GlassSku[]) + rapport til stdout.
 * Ingen kildedata endres/slettes — mapping er lesende.
 *
 * Bruk: node scripts/migrate-glass-skus.mjs
 */
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'data');

// GlassSku-modellen er TypeScript; scriptet bruker de samme mappere via tsx.
const { byggSkuFraGlavista, gtTilVehicleRule, fasitTilSku, leggTilGtRule } =
  await import(join(ROOT, 'src/fitment-v1/glass-sku.ts'));

// ── 1. Glavista-index ──
const glavista = JSON.parse(readFileSync(join(DATA, 'glavista-index.json'), 'utf8'));
const skuer = new Map();
for (const [eurokode, rad] of Object.entries(glavista)) {
  const sku = byggSkuFraGlavista(eurokode, rad);
  // Slå sammen duplikater på glavistaNr (samme leverandør-SKU kan ha flere koder)
  const finnes = skuer.get(sku.sku);
  if (finnes) {
    finnes.eurocodes = [...new Set([...finnes.eurocodes, ...sku.eurocodes])];
    finnes.oemPartNumbers = [...new Set([...finnes.oemPartNumbers, ...sku.oemPartNumbers])];
    if (sku.vehicleRules[0] && !finnes.vehicleRules.some((v) => v.raw === sku.vehicleRules[0].raw)) {
      finnes.vehicleRules.push(sku.vehicleRules[0]);
    }
  } else {
    skuer.set(sku.sku, sku);
  }
}

// ── 2. GT-regler (ground_truth) — berik vehicleRules per eurokode ──
const gtSql = readFileSync(join(DATA, 'gt-ekspansjon', 'gt-generert.sql'), 'utf8');
let gtRegler = 0;
let gtTilordnet = 0;
const gtTilKode = new Map();
// Radformat: ('MAKE', 'MODEL', YEAR|NULL, 'EUROKODE', 'VERIFIED_BY', CONF, 'SOURCE')
const GT_RAD = /\('([^']*)',\s*'([^']*)',\s*(\d+|NULL),\s*'([^']*)',\s*'([^']*)',\s*([\d.]+),\s*'([^']*)'\)/g;
for (const m of gtSql.matchAll(GT_RAD)) {
  gtRegler++;
  const rad = {
    make: m[1], model: m[2],
    year: m[3] === 'NULL' ? null : parseInt(m[3], 10),
    frontruteEurocode: m[4],
    verifiedBy: m[5], confidence: parseFloat(m[6]), source: m[7],
  };
  const regel = gtTilVehicleRule(rad);
  if (!regel) continue;
  const kode = rad.frontruteEurocode;
  if (!gtTilKode.has(kode)) gtTilKode.set(kode, []);
  gtTilKode.get(kode).push(regel);
}
for (const sku of skuer.values()) {
  for (const kode of sku.eurocodes) {
    for (const regel of gtTilKode.get(kode) ?? []) {
      const oppdatert = leggTilGtRule(sku, regel);
      sku.vehicleRules = oppdatert.vehicleRules;
      gtTilordnet++;
    }
  }
}

// ── 3. Tom-fasiter → verified-status + Autoglass-varenr ──
const fasit = JSON.parse(readFileSync(join(DATA, 'fasit-glass.json'), 'utf8'));
const fasitRader = (fasit.fasiter ?? []);
let fasitMatchet = 0;
for (const f of fasitRader) {
  const sku = fasitTilSku(f);
  if (!sku) continue;
  const euro = (f.eurocode || '').toUpperCase();
  // Finn glavista-SKU med samme eurokode (eller alleKoder-treff)
  let maal = [...skuer.values()].find((s) => s.eurocodes.includes(euro));
  if (!maal) {
    // Fallback: match på OE — aldri fabrikk; bare knyt hvis eksisterende SKU har OE lik fasit-varenr
    maal = null;
  }
  if (maal) {
    maal.status = 'verified';
    maal.varenr = f.varenr || maal.varenr;
    if (f.varenr && !maal.supplierPartNumbers.includes(f.varenr)) maal.supplierPartNumbers.push(f.varenr);
    if (sku.vehicleRules[0] && !maal.vehicleRules.some((v) => v.raw === sku.vehicleRules[0].raw)) {
      maal.vehicleRules.push(sku.vehicleRules[0]);
    }
    fasitMatchet++;
  } else {
    // Fasit uten glavista-treff: behold som egen verified-SKU (ingen datatap)
    if (!skuer.has(sku.sku)) skuer.set(sku.sku, sku);
  }
}

// ── Rapportering ──
const alle = [...skuer.values()];
const umappetAttributter = alle.filter((s) => s.vehicleRules.length === 0);
const utenProps = alle.filter((s) => Object.values(s.attributes).filter((v) => v !== null && v !== true).length === 0 && !s.vehicleRules.length);
const verified = alle.filter((s) => s.status === 'verified');
const medGt = alle.filter((s) => s.vehicleRules.some((v) => v.source === 'ground-truth'));
const medOe = alle.filter((s) => s.oemPartNumbers.length > 0);

const rapport = {
  kilder: {
    glavistaIndex: Object.keys(glavista).length,
    gtRegler: gtRegler,
    fasitRader: fasitRader.length,
  },
  glassSkuTotalt: alle.length,
  medVehicleRule: alle.length - umappetAttributter.length,
  medGtRegel: medGt.length,
  medOe: medOe.length,
  verified: verified.length,
  fasitMatchet: fasitMatchet,
  fasitUtenGlavistaTreff: fasitRader.length - fasitMatchet,
  umappet: {
    utenVehicleRule: umapAttributter(alle).length,
    utenPropsOgRegel: utenProps.length,
    eksempler: utenProps.slice(0, 5).map((s) => s.sku),
  },
};
function umapAttributter(liste) { return liste.filter((s) => s.vehicleRules.length === 0); }

writeFileSync(join(DATA, 'glass-skus.json'), JSON.stringify(alle, null, 2));
console.log(JSON.stringify(rapport, null, 2));
console.log(`\nSkrevet data/glass-skus.json (${alle.length} SKU-er)`);
