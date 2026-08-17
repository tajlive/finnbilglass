/** Offline-simulering: hvor mange VERIFY blir PINPOINT med perfekt SVV-karosseri?
 *  Mål først (TDD): tallene styrer filter-designet.
 *  Kjøring: node --import tsx scripts/simuler-karosseri.mjs
 */
import fs from 'node:fs';
import { gtRadMatch, normBrand, modellTokensAv } from '../src/vin-resolver.ts';

const detaljer = fs
  .readFileSync('data/test-500-gt-detaljer.jsonl', 'utf8')
  .trim()
  .split('\n')
  .map((l) => JSON.parse(l));
const gt = fs
  .readFileSync('data/fixtures/ground-truth.jsonl', 'utf8')
  .trim()
  .split('\n')
  .map((l) => JSON.parse(l));

// Karosseri-tokens vi stoler på i GT-modell-kolonnen (CC/CAB/CROSS er modellnavn — utelatt)
const KAROSSERI_TOKENS = new Set([
  'SED', 'STV', 'SW', 'CPE', 'COUPE', 'CABRIOLET', 'ROADSTER',
  'MPV', 'SUV', 'VAN', 'PICK', 'KOMBI', 'COMBI',
]);

function karosseriTokens(radModel) {
  return radModel.toUpperCase().split(/[^A-ZÆØÅ0-9]+/).filter((o) => KAROSSERI_TOKENS.has(o));
}

function gtRaderFor(bil) {
  const make = normBrand(bil.make);
  const makeRaa = bil.make.toUpperCase();
  const tokens = modellTokensAv(bil.model, bil.make);
  const aarList = [Number(bil.year)];
  return gt.filter((r) => {
    const rm = (r.make || '').toUpperCase();
    if (rm !== make && rm !== makeRaa) return false;
    const y = Number(r.year);
    if (!aarList.includes(y)) return false;
    return gtRadMatch(r.model, make, bil.model, aarList);
  });
}

let pinpoint = 0;
let verify = 0;
let potensieltKarosseri = 0;
let utstyr = 0;
const karosseriEksempler = [];
const utstyrEksempler = [];

for (const d of detaljer) {
  const rader = gtRaderFor(d);
  const unike = [...new Set(rader.map((r) => String(r.frontrute_eurocode || '').toUpperCase().replace(/[^A-Z0-9]/g, '')).filter(Boolean))];
  if (unike.length <= 1) { pinpoint++; continue; }
  verify++;
  // Grupper GT-rader på karosseri-token-mønster
  const grupper = new Map();
  for (const r of rader) {
    const k = karosseriTokens(r.model).sort().join('+') || '(ingen)';
    if (!grupper.has(k)) grupper.set(k, new Set());
    grupper.get(k).add(String(r.frontrute_eurocode || '').toUpperCase().replace(/[^A-Z0-9]/g, ''));
  }
  const gruppeListe = [...grupper.entries()].map(([k, s]) => ({ k, koder: [...s] }));
  // Har vi en gruppe som alene er entydig, og skiller gruppene på karosseri?
  const entydigeGrupper = gruppeListe.filter((g) => g.koder.length === 1);
  const skillerPaaKarosseri = gruppeListe.length > 1 && entydigeGrupper.length >= 1;
  if (skillerPaaKarosseri) {
    potensieltKarosseri++;
    if (karosseriEksempler.length < 8) {
      karosseriEksempler.push(`${d.make} ${d.model} ${d.year} | ${gruppeListe.map((g) => `${g.k}: ${g.koder.join(',')}`).join(' / ')}`);
    }
  } else {
    utstyr++;
    if (utstyrEksempler.length < 5) {
      utstyrEksempler.push(`${d.make} ${d.model} ${d.year} | ${gruppeListe.map((g) => `${g.k}: ${g.koder.join(',')}`).join(' / ')}`);
    }
  }
}

console.log(`Totalt: ${detaljer.length} | PINPOINT nå: ${pinpoint} | VERIFY: ${verify}`);
console.log(`→ Karosseri-løsbare (perfekt SVV): ${potensieltKarosseri}`);
console.log(`→ Utstyr-løsbare (ikke karosseri): ${utstyr}`);
console.log('\n=== Karosseri-eksempler ===');
karosseriEksempler.forEach((e) => console.log(' ', e));
console.log('\n=== Utstyr-eksempler ===');
utstyrEksempler.forEach((e) => console.log(' ', e));

// ==== Del 2: simuler det KONSERVATIVE filteret ====
// Bilens karosseri → GT-token-sett (mapping SVV → GT)
const KAROSSERI_MAP = {
  SEDAN: ['SED'],
  STASJONSVOGN: ['STV', 'SW', 'KOMBI', 'COMBI'],
  KUPE: ['CPE', 'COUPE'],
  KABRIOLET: ['CABRIOLET', 'ROADSTER'],
  VAREBIL: ['VAN'],
  PICKUP: ['PICK'],
  SUV: ['MPV', 'SUV'],
};

// For hver bil: prøv alle karosseriklasser, finn om NOEN gir entydighet
let losbare = 0;
const losbareEksempler = [];
const fortsattVerify = [];
for (const d of detaljer) {
  const rader = gtRaderFor(d);
  const unikeAlle = [...new Set(rader.map((r) => String(r.frontrute_eurocode || '').toUpperCase().replace(/[^A-Z0-9]/g, '')).filter(Boolean))];
  if (unikeAlle.length <= 1) continue; // allerede pinpoint
  // Finn beste karosseriklasse
  let best = null;
  for (const [klasse, tokens] of Object.entries(KAROSSERI_MAP)) {
    const tset = new Set(tokens);
    const filtrert = rader.filter((r) => {
      const kt = karosseriTokens(r.model);
      if (!kt.length) return true; // (ingen) beholdes
      return kt.some((t) => tset.has(t));
    });
    const unike = [...new Set(filtrert.map((r) => String(r.frontrute_eurocode || '').toUpperCase().replace(/[^A-Z0-9]/g, '')).filter(Boolean))];
    if (unike.length === 1 && (!best || best.gevinst === 0)) {
      best = { klasse, kode: unike[0], rader: filtrert.length };
    }
  }
  if (best) {
    losbare++;
    if (losbareEksempler.length < 8) losbareEksempler.push(`${d.make} ${d.model} ${d.year} | ${best.klasse} → ${best.kode} (${best.rader} rader igjen)`);
  } else {
    if (fortsattVerify.length < 5) fortsattVerify.push(`${d.make} ${d.model} ${d.year}`);
  }
}
console.log(`\n=== KONSERVATIVT filter (behold rader uten token) ===`);
console.log(`VERIFY som blir PINPOINT for minst én karosseriklasse: ${losbare}`);
console.log('Eksempler:', losbareEksempler);
console.log('Fortsatt VERIFY (eks.):', fortsattVerify);

// ==== Del 3: ærlig gevinst — bilens karosseri utledet fra MODELLNAVNET (proxy for SVV) ====
function klasseFraModellnavn(model) {
  const m = model.toUpperCase();
  const ord = m.split(/[^A-ZÆØÅ0-9]+/).filter(Boolean);
  if (ord.includes('STVOGN') || ord.includes('STV') || ord.includes('SW') || ord.includes('KOMBI') || ord.includes('COMBI')) return 'STASJONSVOGN';
  if (ord.includes('SEDAN') || ord.includes('SED')) return 'SEDAN';
  if (ord.includes('CABRIOLET') || ord.includes('CABRIO')) return 'KABRIOLET';
  if (ord.includes('CPE') || ord.includes('COUPE')) return 'KUPE';
  if (ord.includes('VAN')) return 'VAREBIL';
  if (ord.includes('PICK')) return 'PICKUP';
  if (ord.includes('MINIVAN') || ord.includes('MPV') || ord.includes('SUV')) return 'SUV';
  return null;
}

let losbareEkte = 0;
const losbareEkteEks = [];
for (const d of detaljer) {
  const rader = gtRaderFor(d);
  const unikeAlle = [...new Set(rader.map((r) => String(r.frontrute_eurocode || '').toUpperCase().replace(/[^A-Z0-9]/g, '')).filter(Boolean))];
  if (unikeAlle.length <= 1) continue;
  const klasse = klasseFraModellnavn(d.model);
  if (!klasse) continue;
  const tset = new Set(KAROSSERI_MAP[klasse]);
  const filtrert = rader.filter((r) => {
    const kt = karosseriTokens(r.model);
    if (!kt.length) return true;
    return kt.some((t) => tset.has(t));
  });
  const unike = [...new Set(filtrert.map((r) => String(r.frontrute_eurocode || '').toUpperCase().replace(/[^A-Z0-9]/g, '')).filter(Boolean))];
  if (unike.length === 1) {
    losbareEkte++;
    if (losbareEkteEks.length < 10) losbareEkteEks.push(`${d.make} ${d.model} ${d.year} | ${klasse} → ${unike[0]}`);
  }
}
console.log(`\n=== ÆRLIG gevinst (modellnavn som karosseri-proxy, konservativt filter) ===`);
console.log(`Biler som blir PINPOINT: ${losbareEkte} av 500`);
losbareEkteEks.forEach((e) => console.log(' ', e));
