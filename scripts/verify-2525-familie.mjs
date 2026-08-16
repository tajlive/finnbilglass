#!/usr/bin/env node
// 2525-familien i finnbilglass-db — komplett variant-bilde for T5-testsettet
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
const rows = await d1(`
  SELECT varenr, varenavn, kommentar, pris, eurokode, alias_av, rad_type
  FROM glass_prisliste
  WHERE varenr LIKE '2525%' OR varenavn LIKE '%TRANSPORT%T5%' OR varenavn LIKE '%TRANSPORTER 2003%'
  ORDER BY varenr
`);
for (const r of rows ?? []) {
  console.log(`${r.varenr} | ${String(r.pris).padStart(7)} kr | ${r.eurokode ?? '-'.padEnd(14)} | ${(r.varenavn ?? '').slice(0, 42).padEnd(42)} | ${(r.kommentar ?? '').slice(0, 40)} | ${r.alias_av ?? ''} | ${r.rad_type}`);
}
