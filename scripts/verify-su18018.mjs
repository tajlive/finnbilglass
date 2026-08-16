#!/usr/bin/env node
// Verifiserer SU18018-testsettet i finnbilglass-db (D1).
// Fasit (Tom-korrigert 2026-08-13): 2525GYA = 9 980 kr (INNK+ANT, IKKE coated)
import fs from 'node:fs';

const DB_ID = 'ac35018c-0d43-4742-adf8-d881b7274684';
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
const ACCOUNT = env.CLOUDFLARE_ACCOUNT_ID;
const TOKEN = env.CLOUDFLARE_API_TOKEN;

async function d1(sql) {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/d1/database/${DB_ID}/query`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql }),
  });
  const json = await res.json();
  if (!json.success) throw new Error(`D1-feil: ${JSON.stringify(json.errors).slice(0, 300)}`);
  return json.result?.[0]?.results ?? null;
}

console.log('=== SU18018-testsett (VW T5 2003, fasit = 2525GYA) ===');
const q = await d1(`
  SELECT varenr, varenavn, kommentar, pris, eurokode, rad_type
  FROM glass_prisliste
  WHERE varenr IN ('2525GYA','2525CSGYA','2525GY') OR varenavn LIKE '%TRANSPORTER%FRONTRUTE%' OR varenavn LIKE '%T5%FRONTRUTE%'
  ORDER BY varenr
`);
for (const r of q ?? []) {
  console.log(`${r.varenr} | ${r.pris} kr | ${r.eurokode ?? '-'} | ${(r.varenavn ?? '').slice(0, 55)} | ${r.kommentar ?? ''}`);
}

console.log('\n=== Frontrute-varianter totalt (rad_type=glass, FRONTRUTE/FRONT i navn) ===');
const c = await d1(`SELECT COUNT(*) AS n FROM glass_prisliste WHERE rad_type='glass' AND (varenavn LIKE '%FRONTRUTE%' OR varenavn LIKE '%FRONT%')`);
console.log(c?.[0]?.n);

console.log('\n=== Topp 10 merker etter varenr-prefiks (frontruter) ===');
const brands = await d1(`
  SELECT substr(varenavn, 1, instr(varenavn || ' ', ' ') - 1) AS merke, COUNT(*) AS n
  FROM glass_prisliste
  WHERE rad_type='glass' AND (varenavn LIKE '%FRONTRUTE%' OR varenavn LIKE '%FRONT%')
  GROUP BY merke ORDER BY n DESC LIMIT 10
`);
for (const r of brands ?? []) console.log(`  ${r.merke}: ${r.n}`);
