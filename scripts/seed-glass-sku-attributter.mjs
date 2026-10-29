/**
 * seed-glass-sku-attributter.mjs — Oppgave 6a-2: seed glavista-attributter
 * fra data/glass-skus.json til D1 glass_sku_attributes.
 *
 * Kun KJENTE verdier (true/false/string) lagres — null/UKJENT hoppes over
 * (aldri tolkes som false). Bruker CF D1 REST API (wrangler-i-child feiler).
 * Batch à 200 (SQLITE_TOOBIG-guard).
 *
 * Bruk: CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... node scripts/seed-glass-sku-attributter.mjs [--db finnbilglass-db-staging] [--dry-run]
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DRY = process.argv.includes('--dry-run');
const dbArg = process.argv.indexOf('--db');
const DB_NAVN = dbArg > -1 ? process.argv[dbArg + 1] : 'finnbilglass-db';
const token = process.env.CLOUDFLARE_API_TOKEN;
const acct = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!token || !acct) { console.error('FEIL: CLOUDFLARE_API_TOKEN/CLOUDFLARE_ACCOUNT_ID mangler'); process.exit(1); }

const skuer = JSON.parse(readFileSync(join(ROOT, 'data', 'glass-skus.json'), 'utf8'));

// Samle eurocode → kjente attributter (flere SKU-er kan dele eurokode; siste kjente vinner ikke — merge konservativt: aldri overskriv kjent med null).
const map = new Map();
for (const s of skuer) {
  const kjente = {};
  for (const [k, v] of Object.entries(s.attributes)) {
    if (v === true || v === false || (typeof v === 'string' && v.length)) kjente[k] = v;
  }
  if (!Object.keys(kjente).length) continue;
  for (const euro of s.eurocodes) {
    const u = euro.toUpperCase();
    const eksisterende = map.get(u) ?? {};
    map.set(u, { ...eksisterende, ...kjente });
  }
}
const rader = [...map.entries()];
console.log(`SKU-er: ${skuer.length} · eurokoder med kjente attributter: ${rader.length}`);

async function query(sql, params = []) {
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${acct}/d1/database/${await dbUuid()}/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql, params }),
  }).then((res) => res.json());
  if (!r.success) throw new Error(r.errors?.[0]?.message ?? 'query feilet');
  return r.result?.[0]?.results ?? [];
}
let uuidCache = null;
async function dbUuid() {
  if (uuidCache) return uuidCache;
  // Eksakt uuid (36 tegn) brukes direkte — navne-søk har prefiks-match-felle
  // (?name=finnbilglass-db matcher finnbilglass-db-staging først).
  if (/^[0-9a-f-]{36}$/i.test(DB_NAVN)) { uuidCache = DB_NAVN; return uuidCache; }
  const list = await fetch(`https://api.cloudflare.com/client/v4/accounts/${acct}/d1/database?name=${DB_NAVN}`, {
    headers: { Authorization: `Bearer ${token}` },
  }).then((r) => r.json());
  uuidCache = list?.result?.[0]?.uuid;
  if (!uuidCache) throw new Error(`${DB_NAVN} ikke funnet`);
  return uuidCache;
}

if (DRY) {
  console.log('DRY-RUN: ingen skriving. Eksempler:');
  for (const [euro, attrs] of rader.slice(0, 5)) console.log(`  ${euro} → ${JSON.stringify(attrs)}`);
  process.exit(0);
}

// Batch-upsert à 40 (D1 SQLITE_MAX_VARIABLE_NUMBER-grense ~100 variabler)
let innsatt = 0;
for (let i = 0; i < rader.length; i += 40) {
  const batch = rader.slice(i, i + 40);
  const values = batch.map(() => '(?, ?, \'glavista-index\', strftime(\'%Y-%m-%dT%H:%M:%fZ\',\'now\'))').join(',');
  const params = batch.flatMap(([euro, attrs]) => [euro, JSON.stringify(attrs)]);
  await query(`INSERT OR REPLACE INTO glass_sku_attributes (eurocode, attributes_json, source, updated_at) VALUES ${values}`, params);
  innsatt += batch.length;
  console.log(`  innsatt ${innsatt}/${rader.length}`);
}
console.log(`Ferdig: ${innsatt} eurokoder seidet i glass_sku_attributes.`);
