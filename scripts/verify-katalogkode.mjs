#!/usr/bin/env node
// Verifiserer Toms regel: katalogkode (ledende siffer-sekvens) = samme modell.
// «Står det front og har fire nummer, så er det frontrute — andre glass med
//  like fire nummer er samme modell, bare en annen variant.»
// Sjekker: grupper på katalogkode → er alle varenavn i gruppen samme bil-merke/modell?
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

// Hent alle glass-rader med eurokode, beregn katalogkode + posisjon lokalt
const rader = await d1(`
  SELECT varenr, varenavn, eurokode FROM autoglass_prisliste
  WHERE rad_type='glass' AND eurokode IS NOT NULL AND eurokode != ''
`);

// Katalogkode = ledende siffer-sekvens (typisk 4-5), posisjon = første bokstav etter
function katalogInfo(kode) {
  const m = kode.toUpperCase().match(/^(\d+)([A-Z])(.*)$/);
  if (!m) return null;
  return { katalog: m[1], posisjon: m[2] };
}

const grupper = new Map();
let utenKode = 0;
for (const r of rader) {
  const ki = katalogInfo(r.eurokode);
  if (!ki) { utenKode++; continue; }
  if (!grupper.has(ki.katalog)) grupper.set(ki.katalog, []);
  grupper.get(ki.katalog).push({ ...r, ...ki });
}

// Analyse: grupper med frontrute (A) + andre posisjoner — er merket konsistent?
const kollisjoner = [];
const ens = [];
let medFrontOgAndre = 0;
for (const [kode, vars] of grupper) {
  if (vars.length < 2) continue;
  const harFront = vars.some((v) => v.posisjon === 'A');
  const harAnnet = vars.some((v) => v.posisjon !== 'A');
  if (!(harFront && harAnnet)) continue;
  medFrontOgAndre++;
  // Merke = første ord i varenavn
  const merker = new Set(vars.map((v) => (v.varenavn ?? '').split(/\s+/)[0].toUpperCase()));
  if (merker.size > 1) kollisjoner.push({ kode, merker: [...merker], vars: vars.length });
  else ens.push({ kode, merke: [...merker][0], vars: vars.length });
}

console.log(`Rader totalt: ${rader.length}, uten katalogkode-struktur: ${utenKode}`);
console.log(`Unike katalogkoder: ${grupper.size}`);
console.log(`Katalogkoder med BÅDE frontrute og andre ruter: ${medFrontOgAndre}`);
console.log(`  → konsistente (samme merke): ${ens.length}`);
console.log(`  → KOLLISJONER (ulike merker!): ${kollisjoner.length}`);
if (kollisjoner.length) {
  console.log('\nKollisjoner (må undersøkes):');
  for (const k of kollisjoner.slice(0, 15)) console.log(`  ${k.kode}: ${k.merker.join(' / ')} (${k.vars} varianter)`);
}
console.log('\nEksempler konsistente (kode → merke → antall):');
for (const e of ens.slice(0, 15)) console.log(`  ${e.kode}: ${e.merke} (${e.vars})`);
