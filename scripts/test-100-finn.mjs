// Test 100 bilnummer fra finn.no gjennom finnbilglass.no sin fulle kjede:
// finn.no-annonser → kjennemerke → SVV-oppslag (/api/regnr) → frontrute-matcher (/api/frontrute).
// Skriver data/finn-100.jsonl (annonser) + data/test-100-resultater.jsonl (resultater) + stdout-rapport.
import { execFileSync } from 'node:child_process';
import { writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = 'https://finnbilglass.no';
const DIR = '/Users/taj/finnbilglass/data';
mkdirSync(DIR, { recursive: true });

// ── Steg A: samle finnkoder (annonse-ID-er) fra finn.no-søk via headless Chrome ──
function collectIds() {
  const urls = [
    'https://www.finn.no/mobility/search/car',
    'https://www.finn.no/mobility/search/car?q=Volkswagen',
    'https://www.finn.no/mobility/search/car?q=Toyota',
    'https://www.finn.no/mobility/search/car?q=BMW',
  ];
  const ids = new Set();
  for (const u of urls) {
    let html = '';
    try {
      html = execFileSync(CHROME, [
        '--headless', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
        '--virtual-time-budget=25000',
        '--user-agent=Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0 Safari/537.36',
        '--dump-dom', u,
      ], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024, timeout: 90 * 1000 });
    } catch (e) {
      console.error('chrome feilet for', u, e.message);
      continue;
    }
    const re = /images\.finncdn\.no\/dynamic\/default\/item\/(\d+)\//g;
    let m; let n = 0;
    while ((m = re.exec(html)) !== null) { ids.add(m[1]); n++; }
    const re2 = /\?open=(\d+)/g;
    while ((m = re2.exec(html)) !== null) ids.add(m[1]);
    console.log(`  [steg A] ${u} → ${n} bilder, totalt unike ID-er: ${ids.size}`);
  }
  return [...ids];
}

// ── Steg B: hent annonsesidene og trekk ut kjennemerke + bil ──
async function fetchAd(id) {
  const res = await fetch(`https://www.finn.no/car/used/ad.html?finnkode=${id}`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0 Safari/537.36',
      'Accept-Language': 'nb-NO,no;q=0.9',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) return null;
  const html = await res.text();
  const par = /<dt class="[^"]*">([^<]{1,60})<\/dt><dd class="t4 m-0">([^<]{0,40})<\/dd>/g;
  const fakta = {};
  let m;
  while ((m = par.exec(html)) !== null) fakta[m[1]] = m[2];
  const regnr = (fakta['Registreringsnummer'] ?? '').replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{4,5}$/.test(regnr)) return null;
  return {
    finnkode: id,
    regnr,
    merke: fakta['Merke'] ?? '',
    modell: fakta['Modell'] ?? '',
    aar: parseInt(fakta['Modellår'], 10) || null,
  };
}

// ── Steg C: kjør platen gjennom finnbilglass.no sin kjede ──
async function testPlate(ad) {
  let bil = null, treff = null, pris = null, varenr = null, varenavn = null;
  try {
    const r1 = await fetch(`${BASE}/api/regnr`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ regnr: ad.regnr }), signal: AbortSignal.timeout(20000),
    });
    if (r1.ok) {
      const d1 = await r1.json();
      bil = d1.bil ?? null;
    }
  } catch (e) { bil = null; }
  if (bil && bil.merke) {
    try {
      const r2 = await fetch(`${BASE}/api/frontrute`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ merke: bil.merke, modell: bil.modell, aar: bil.aar, profil: {} }),
        signal: AbortSignal.timeout(20000),
      });
      if (r2.ok) {
        const d2 = await r2.json();
        const a = d2.anbefaling;
        treff = !!a;
        if (a) { pris = a.pris; varenr = a.varenr; varenavn = a.varenavn; }
      }
    } catch (e) { treff = null; }
  }
  return { ...ad, bil, treff, pris, varenr, varenavn };
}

// ── Hovedløp ──
const ids = collectIds();
console.log(`Unike finnkoder: ${ids.length}`);
let annonser = [];
for (const id of ids) {
  if (annonser.length >= 110) break;
  try {
    const a = await fetchAd(id);
    if (a) {
      annonser.push(a);
      appendFileSync(`${DIR}/finn-100.jsonl`, JSON.stringify(a) + '\n');
    }
  } catch (e) { /* hopp over */ }
  await sleep(900);
  if (annonser.length % 25 === 0) console.log(`  [steg B] ${annonser.length} annonser med kjennemerke…`);
}
annonser = annonser.slice(0, 100);
console.log(`Annonser med kjennemerke: ${annonser.length}`);

let svvOk = 0, matcherTreff = 0, matcherBom = 0;
const bomEksempler = [];
for (let i = 0; i < annonser.length; i++) {
  const r = await testPlate(annonser[i]);
  appendFileSync(`${DIR}/test-100-resultater.jsonl`, JSON.stringify(r) + '\n');
  if (r.bil && r.bil.merke) svvOk++;
  if (r.treff) matcherTreff++;
  else if (r.bil && r.bil.merke) {
    matcherBom++;
    if (bomEksempler.length < 15) bomEksempler.push(`${r.regnr} ${r.bil.merke} ${r.bil.modell} ${r.bil.aar}`);
  }
  await sleep(400);
  if ((i + 1) % 25 === 0) console.log(`  [steg C] testet ${i + 1}/${annonser.length} (SVV-treff ${svvOk}, matcher-treff ${matcherTreff})…`);
}

const rapport = {
  generert: new Date().toISOString(),
  antallAnnonser: annonser.length,
  svvTreff: svvOk,
  svvTreffPst: Math.round((svvOk / annonser.length) * 100),
  matcherTreff: matcherTreff,
  matcherTreffPst: Math.round((matcherTreff / Math.max(svvOk, 1)) * 100),
  matcherBom: matcherBom,
  bomEksempler,
};
writeFileSync(`${DIR}/test-100-rapport.json`, JSON.stringify(rapport, null, 2));
console.log('\n=== RAPPORT ===');
console.log(JSON.stringify(rapport, null, 2));
