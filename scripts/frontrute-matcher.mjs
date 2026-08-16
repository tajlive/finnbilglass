#!/usr/bin/env node
// Frontrute-matcher — POC: finn riktig frontrute for en bil.
//
// Kjede: bil (kjennemerke→SVV eller manuell) → D1-kandidater → eurokode-dekoder
//        → score mot bilens utstyrsprofil → 1 riktig vare.
//
// Eksempel (SU18018-fasit): VW T5 2003, sensor+antenne, ikke coated → 2525GYA (9 980 kr)
import fs from 'node:fs';
import { dekodeEurokode } from './eurokode-dekoder.mjs';
import { parseAar, matcherAar } from './aar-parser.mjs';

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

// --- varenavn → ekstra attributter (Autoglass sine forkortelser) ---
function navnAttributter(varenavn, kommentar) {
  const s = `${varenavn ?? ''} ${kommentar ?? ''}`.toUpperCase();
  const att = new Set();
  if (/COATED|COATING|CSGY/.test(s)) att.add('coated');
  if (/INNK|INNKAPSLET/.test(s)) att.add('innkapslet');
  if (/ANT|ANTENNE/.test(s)) att.add('antenne');
  if (/SENSOR/.test(s)) att.add('sensor');
  if (/S1C|SENSORTAPE|SENSORGEL|NB S1|HUSK S1/.test(s)) att.add('sensorgel');
  if (/OPPVARMET|EL-|ELEKTRISK/.test(s)) att.add('oppvarmet');
  if (/MAX ?5\d%/.test(s)) att.add('sotet-5x');
  return att;
}

// --- scorer kandidat mot bilens utstyrsprofil ---
// profil: { coated: bool|undefined, sensor, antenne, sensorgel, innkapslet, fargetone }
// bilAar: årsmodell — gir avstands-straff (skiller generasjoner som deler katalogkode)
function scoreKandidat(vare, profil, bilAar) {
  const dek = dekodeEurokode(vare.eurokode);
  const att = navnAttributter(vare.varenavn, vare.kommentar);
  let score = 0;
  const feil = [];

  // Årstall-avstand (straff for åpne intervall som "2003-" når bilen er 2016)
  if (bilAar != null) {
    const a = parseAar(vare.varenavn);
    if (a && isFinite(a.start)) {
      const avstand = Math.abs(bilAar - a.start);
      score -= Math.min(avstand / 5, 6); // max -6
      if (avstand > 8) feil.push(`årsmodell: bil ${bilAar}, vare starter ${a.start}`);
    }
  }

  // Dekoder-attributter (strukturelle)
  const har = (a) => att.has(a) || dek.egenskaper.includes(a);
  const kryss = (navn, kandidatHar) => {
    if (profil[navn] === undefined) return; // ukjent — ikke straff
    if (profil[navn] === true && kandidatHar) score += 3;
    else if (profil[navn] === false && !kandidatHar) score += 2;
    else { score -= 4; feil.push(`${navn}: bil ${profil[navn]}, vare ${kandidatHar}`); }
  };
  kryss('coated', har('coated'));
  kryss('sensor', har('sensor'));
  kryss('antenne', har('antenne'));
  kryss('sensorgel', har('sensorgel'));
  kryss('innkapslet', har('innkapslet'));

  // Fargetone (myk match)
  if (profil.fargetone && dek.fargetone) {
    if (dek.fargetone.includes(profil.fargetone)) score += 2;
    else { score -= 2; feil.push(`fargetone: bil ${profil.fargetone}, vare ${dek.fargetone}`); }
  }
  return { score, feil, att, dek };
}

// --- main ---
const [,, bilArg] = process.argv;
const bil = bilArg ? JSON.parse(bilArg) : null;
if (!bil) {
  console.error('Bruk: node frontrute-matcher.mjs \'{"merke":"VW","modell":"T5","aar":2003,"profil":{"sensor":true,"antenne":true,"coated":false}}\'');
  process.exit(1);
}

// Steg 1: seed-kandidater fra D1 — primær-nøkkelord (alle må matche) + sekundær (minst én)
// Autoglass-varenavn er inkonsistente (noen har T5, andre ikke) → årstall + modell-variant som OR
const primaer = bil.nokkelord ?? [bil.merke];
const sekundaer = [bil.modell, bil.aar ? String(bil.aar) : null].filter(Boolean);
const likePrim = primaer.map((k) => `varenavn LIKE '%${k.toUpperCase().replace(/'/g, "''")}%'`).join(' AND ');
const likeSek = sekundaer.map((k) => `varenavn LIKE '%${k.toUpperCase().replace(/'/g, "''")}%'`).join(' OR ');
const seed = await d1(`
  SELECT varenr, varenavn, kommentar, pris, eurokode, alias_av, rad_type
  FROM glass_prisliste
  WHERE rad_type='glass'
    AND (varenavn LIKE '%FRONTRUTE%' OR varenavn LIKE '%FRONT%'
         OR eurokode GLOB '[0-9][0-9][0-9]A*' OR eurokode GLOB '[0-9][0-9][0-9][0-9]A*' OR eurokode GLOB '[0-9][0-9][0-9][0-9][0-9]A*')
    AND ${likePrim}
    AND (${likeSek})
  ORDER BY pris
`);

// Steg 2: katalogkode-utvidelse (Toms regel, verifisert 87,6 % ren):
// katalogkoden (ledende siffer) identifiserer modellen → hent ALLE varianter med samme kode.
const katalogkoder = new Set();
for (const r of seed ?? []) {
  const m = (r.eurokode ?? '').match(/^(\d{3,5})/);
  if (m) katalogkoder.add(m[1]);
}

let utvidet = seed ?? [];
if (katalogkoder.size) {
  const globs = [...katalogkoder].map((k) => `eurokode LIKE '${k}%'`).join(' OR ');
  const ekstra = await d1(`
    SELECT varenr, varenavn, kommentar, pris, eurokode, alias_av, rad_type
    FROM glass_prisliste
    WHERE rad_type='glass' AND (${globs})
  `);
  utvidet = [...(seed ?? []), ...(ekstra ?? [])];
}

// Steg 3: dedupe + kollisjonsvalidering — varenavn må bekrefte bilen (merke + sekundær)
const sett = new Map();
for (const r of utvidet) {
  const n = (r.varenavn ?? '').toUpperCase();
  const okMerke = primaer.every((k) => n.includes(k.toUpperCase()));
  const okSek = sekundaer.length === 0 || sekundaer.some((k) => n.includes(k.toUpperCase()));
  if (!(okMerke && okSek)) continue; // kollisjons-skjerm: feil bil i katalogkode-gruppen
  sett.set(r.varenr, r);
}
const rader = [...sett.values()];

// Steg 4: frontrute-filter (posisjon A via dekoder ELLER FRONT i navn)
const front = rader.filter((r) => {
  const dek = dekodeEurokode(r.eurokode);
  return dek.posisjon === 'frontrute' || /FRONT/.test(r.varenavn ?? '');
});

// Steg 5: årstall-hardfilter — samme katalogkode spenner ofte flere generasjoner
// (8579 = T5 2003- OG T6 16- OG 2022-). Bilens år må ligge i varenavnets intervall.
const kandidater = bil.aar != null
  ? front.filter((r) => matcherAar(parseAar(r.varenavn), bil.aar))
  : front;
const aarEkskludert = front.length - kandidater.length;
if (aarEkskludert > 0) console.log(`(Årstall-filter: ${aarEkskludert} av ${front.length} ekskludert — utenfor ${bil.aar})`);

console.log(`Kandidater (${kandidater.length}):`);
for (const r of kandidater) {
  console.log(`  ${r.varenr} | ${String(r.pris).padStart(7)} kr | ${r.eurokode ?? '-'} | ${(r.varenavn ?? '').slice(0, 50)} | ${(r.kommentar ?? '').slice(0, 45)}`);
}

// Steg 6: score kun frontrute-kandidatene
const profil = bil.profil ?? {};
const vurdert = kandidater.map((r) => ({ vare: r, ...scoreKandidat(r, profil, bil.aar) }));
vurdert.sort((a, b) => b.score - a.score);

console.log(`\nUtstyrsprofil: ${JSON.stringify(profil)}`);
console.log('\nRangering:');
for (const v of vurdert) {
  const badge = v.feil.length === 0 ? '✔' : '✘';
  console.log(`  ${badge} ${v.vare.varenr} | score ${v.score} | ${v.vare.pris} kr`);
  for (const f of v.feil) console.log(`       ! ${f}`);
}
const beste = vurdert[0];
console.log(`\n=> ANBEFALING: ${beste?.vare.varenr} — ${beste?.vare.pris} kr (${beste?.vare.varenavn?.slice(0, 60)})`);
