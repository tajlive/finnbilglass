#!/usr/bin/env node
// Import av Autoglass-prislisten (29 627 varer) inn i finnbilglass-db (D1).
// Kilde: genererte SQL-filer fra Autoglass PROSEKT-eksport (16.05.2026).
// Leser CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID fra klarpakke/.env.local (aldri printet).
import fs from 'node:fs';
import path from 'node:path';

const DB_ID = 'ac35018c-0d43-4742-adf8-d881b7274684'; // finnbilglass-db (account 80d5b1d5)

// --- les creds fra .env.local uten å eksponere dem ---
function readEnvLocal(file) {
  const env = {};
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    env[m[1]] = v;
  }
  return env;
}

const env = readEnvLocal('/Users/taj/klarpakke/.env.local');
const TOKEN = env.CLOUDFLARE_API_TOKEN;
const ACCOUNT = env.CLOUDFLARE_ACCOUNT_ID;
if (!TOKEN || !ACCOUNT) { console.error('FEIL: mangler CLOUDFLARE_API_TOKEN/CLOUDFLARE_ACCOUNT_ID i .env.local'); process.exit(1); }

async function d1(sql) {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/d1/database/${DB_ID}/query`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql }),
  });
  const json = await res.json();
  if (!json.success) {
    const err = json.errors?.[0]?.message ?? JSON.stringify(json.errors ?? json).slice(0, 300);
    throw new Error(`D1-feil: ${err}`);
  }
  return json.result?.[0]?.results ?? json.result?.[0] ?? null;
}

// --- 1. schema ---
console.log('1/3 Oppretter tabell + indekser ...');
const schema = fs.readFileSync('/Users/taj/finnbilglass/db/schema-katalog.sql', 'utf8');
await d1(schema);

// --- 2. inserts ---
const dir = '/Users/taj/finnbilglass/db/katalog';
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
let total = 0;
console.log(`2/3 Importerer ${files.length} batcher ...`);
for (const f of files) {
  const sql = fs.readFileSync(path.join(dir, f), 'utf8');
  const r = await d1(sql);
  const changed = r?.meta?.changes ?? 0;
  total += changed;
  console.log(`  ${f}: +${changed} rader`);
}

// --- 3. verifiser ---
console.log('3/3 Verifiserer ...');
const count = await d1('SELECT COUNT(*) AS n FROM glass_prisliste');
const byType = await d1(`SELECT rad_type, COUNT(*) AS n FROM glass_prisliste GROUP BY rad_type ORDER BY n DESC`);
const front = await d1(`SELECT COUNT(*) AS n FROM glass_prisliste WHERE rad_type='glass' AND (varenavn LIKE '%FRONTRUTE%' OR varenavn LIKE '%FRONT%')`);
const euro = await d1(`SELECT COUNT(*) AS n FROM glass_prisliste WHERE rad_type='glass' AND eurokode IS NOT NULL AND eurokode != ''`);
console.log(`Totalt: ${count?.[0]?.n ?? '?'} rader`);
for (const row of byType ?? []) console.log(`  ${row.rad_type}: ${row.n}`);
console.log(`Frontrute-varianter (FRONTRUTE/FRONT i navn): ${front?.[0]?.n ?? '?'}`);
console.log(`Glass med eurokode: ${euro?.[0]?.n ?? '?'}`);
