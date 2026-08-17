#!/usr/bin/env node
/**
 * fitment-baseline-analysis.mjs — Phase A0 (read-only).
 * Kvantifiserer kildeautoritet + ground_truth-kontaminasjon i prod D1.
 * Ingen mutasjon. Bruker CF D1 REST API.
 *
 * Bruk:
 *   CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=80d5b1d5... \
 *     node scripts/fitment-baseline-analysis.mjs
 */
const TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID;
const DB = 'ac35018c-0d43-4742-adf8-d881b7274684';
if (!TOKEN || !ACCOUNT) { console.error('Sett CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID'); process.exit(2); }

async function q(sql, params = []) {
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/d1/database/${DB}/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql, params }),
  });
  const j = await r.json();
  if (!j.success) throw new Error(`D1 feil: ${JSON.stringify(j.errors)}`);
  return j.result[0].results ?? [];
}
const one = async (sql, p = []) => (await q(sql, p))[0] ?? null;
const n = (rows) => (rows && rows[0] ? Object.values(rows[0])[0] : null);

console.log('=== A/B. Kildeautoritet + ground_truth-kontaminasjon ===\n');

// 1. ground_truth source-fordeling
const gtSrc = await q(`SELECT source, COUNT(*) AS n, ROUND(AVG(confidence),3) AS avg_conf, COUNT(DISTINCT make||'|'||model||'|'||year) AS vehicles FROM ground_truth GROUP BY source ORDER BY n DESC`);
console.log('ground_truth pr. source:');
for (const r of gtSrc) console.log(`  ${r.source}: ${r.n} rader, ${r.vehicles} kjøretøy, avg_conf ${r.avg_conf}`);

// 2. verified_by-fordeling (hvor "verifisert" er dokumentert)
const gtVer = await q(`SELECT verified_by, COUNT(*) AS n FROM ground_truth GROUP BY verified_by`);
console.log('\nground_truth verified_by:');
for (const r of gtVer) console.log(`  ${r.verified_by ?? 'NULL'}: ${r.n}`);

// 3. Duplikate kjøretøy-identiteter (make,model,year med 2+ DISTINCT frontrute_eurocode)
const dup = await q(`SELECT make, model, year, COUNT(DISTINCT frontrute_eurocode) AS koder, COUNT(*) AS rader FROM ground_truth GROUP BY make, model, year HAVING koder > 1 ORDER BY koder DESC, rader DESC LIMIT 20`);
console.log('\nTopp 20 (make,model,year) med >1 DISTINCT frontrute_eurocode (VERIFY-klasse):');
for (const r of dup) console.log(`  ${r.make} | ${r.model} | ${r.year}: ${r.koder} koder, ${r.rader} rader`);

const dupTot = await one(`SELECT COUNT(*) AS n FROM (SELECT make,model,year FROM ground_truth GROUP BY make,model,year HAVING COUNT(DISTINCT frontrute_eurocode)>1)`);
const vehTot = await one(`SELECT COUNT(DISTINCT make||'|'||model||'|'||year) AS n FROM ground_truth`);
console.log(`\n  Kjøretøy totalt: ${vehTot.n} | med >1 kode (flervariant): ${dupTot.n} (${(dupTot.n/vehTot.n*100).toFixed(1)}%)`);

// 4. Konflikt b2b-seed vs gt-auto-prisliste for SAMME (make,model,year)
const konfl = await q(`
  SELECT a.make, a.model, a.year,
         (SELECT GROUP_CONCAT(DISTINCT frontrute_eurocode) FROM ground_truth b WHERE b.make=a.make AND b.model=a.model AND b.year=a.year AND b.source='b2b-seed') AS b2b,
         (SELECT GROUP_CONCAT(DISTINCT frontrute_eurocode) FROM ground_truth b WHERE b.make=a.make AND b.model=a.model AND b.year=a.year AND b.source='gt-auto-prisliste') AS auto
  FROM ground_truth a
  WHERE a.source='b2b-seed'
    AND EXISTS (SELECT 1 FROM ground_truth c WHERE c.make=a.make AND c.model=a.model AND c.year=a.year AND c.source='gt-auto-prisliste')
  GROUP BY a.make, a.model, a.year
  LIMIT 30`);
console.log('\nOverlapp (make,model,year) som finnes i BÅDE b2b-seed OG gt-auto-prisliste:');
console.log(`  antall: ${konfl.length} (første 30)`);
for (const r of konfl) console.log(`  ${r.make} | ${r.model} | ${r.year}\n    b2b-seed: ${r.b2b}\n    gt-auto:  ${r.auto}`);

// 5. glass_catalog.oem_numbers dekning
const oem = await one(`SELECT COUNT(*) AS total, SUM(CASE WHEN oem_numbers IS NOT NULL AND oem_numbers != '' THEN 1 ELSE 0 END) AS med_oem FROM glass_catalog`);
console.log(`\nglass_catalog: ${oem.total} rader, ${oem.med_oem} med oem_numbers (${(oem.med_oem/oem.total*100).toFixed(1)}%)`);

// 6. oe_eurocode_mapping source
const oe = await q(`SELECT source, COUNT(*) AS n FROM oe_eurocode_mapping GROUP BY source ORDER BY n DESC`);
console.log('\noe_eurocode_mapping pr. source:');
for (const r of oe) console.log(`  ${r.source}: ${r.n}`);

// 7. VW T5 (8579*) OE-numre i oe_eurocode_mapping + glass_catalog.oem_numbers
const t5oe = await q(`SELECT oe_number, eurocode FROM oe_eurocode_mapping WHERE eurocode LIKE '8579%' OR oe_number LIKE '7H0%' OR oe_number LIKE '7H1%' LIMIT 30`);
console.log(`\nVW T5 (8579*/7H0*) OE-numre i oe_eurocode_mapping (${t5oe.length} treff):`);
for (const r of t5oe) console.log(`  OE ${r.oe_number} → ${r.eurocode}`);

// 8. 8579* familien i glass_catalog med oem_numbers
const t5gc = await q(`SELECT eurocode, oem_numbers, year_from, year_to FROM glass_catalog WHERE eurocode LIKE '8579%' LIMIT 40`);
console.log(`\n8579*-familien i glass_catalog (${t5gc.length} rader):`);
for (const r of t5gc) console.log(`  ${r.eurocode} | oem: ${r.oem_numbers ?? 'NULL'} | ${r.year_from}-${r.year_to}`);

// 9. Døde tabeller
for (const t of ['vin_glass_overrides','vin_ktype_map','ece_r43','resolution_audit','glass_evidence','glass_master','glass_vehicle_links','glass_identifiers','glass_features','ktype_matches','tecdoc_import_runs']) {
  const c = await one(`SELECT COUNT(*) AS n FROM ${t}`);
  console.log(`  ${t}: ${c?.n ?? 'ERR'}`);
}
console.log('\nDone.');
