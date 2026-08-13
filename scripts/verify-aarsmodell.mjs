#!/usr/bin/env node
// Undersøker årsmodell-spredning innenfor samme katalogkode.
// Spørsmål: deler varianter med samme katalogkode ulike årsmodell-intervaller?
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

const rader = await d1(`
  SELECT varenr, varenavn, eurokode FROM autoglass_prisliste
  WHERE rad_type='glass' AND eurokode IS NOT NULL AND eurokode != ''
`);

function katalogKode(kode) {
  const m = kode.toUpperCase().match(/^(\d+)/);
  return m ? m[1] : null;
}
// Trekk ut årstall (2-4 siffer som kan være årstall) fra varenavn
function aarFraNavn(navn) {
  const m = (navn ?? '').match(/(?:^|\s)(\d{2})\s*[-–]?\s*(?:$|\s|,)/g);
  if (!m) return null;
  const aar = m.map((x) => parseInt(x.match(/\d+/)[0], 10));
  if (!aar.length) return null;
  // Normaliser 2-sifret år (79 → 1979, 03 → 2003)
  return aar.map((a) => (a < 30 ? 2000 + a : a < 100 ? 1900 + a : a));
}

// Eksempel: 8579 (VW T5/T6)
console.log('=== Katalogkode 8579 (VW Transporter) — årsmodeller ===');
for (const r of rader) {
  if (katalogKode(r.eurokode) === '8579') {
    const aar = aarFraNavn(r.varenavn);
    console.log(`  ${r.varenr} | ${(r.varenavn ?? '').slice(0, 60)} | år=${JSON.stringify(aar)}`);
  }
}

// Generelt: katalogkoder med varianter som har >1 distinkt årstall-intervall
const grupper = new Map();
for (const r of rader) {
  const k = katalogKode(r.eurokode);
  if (!k) continue;
  if (!grupper.has(k)) grupper.set(k, []);
  const aar = aarFraNavn(r.varenavn);
  grupper.get(k).push({ varenr: r.varenr, aar: aar ?? [], navn: r.varenavn });
}
let spredt = 0;
const eksempler = [];
for (const [k, vars] of grupper) {
  const sett = new Set();
  for (const v of vars) for (const a of v.aar) sett.add(a);
  if (sett.size > 1) { spredt++; if (eksempler.length < 12) eksempler.push({ k, aar: [...sett].sort(), n: vars.length }); }
}
console.log(`\nKatalogkoder totalt: ${grupper.size}`);
console.log(`Katalogkoder med varianter på FLERE årsmodeller: ${spredt} (${((spredt / grupper.size) * 100).toFixed(1)}%)`);
console.log('Eksempler (kode → årstall → antall varianter):');
for (const e of eksempler) console.log(`  ${e.k}: ${e.aar.join(', ')} (${e.n} varianter)`);
