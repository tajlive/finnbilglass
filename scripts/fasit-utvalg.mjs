/**
 * Fasit-utvalg — måler riktige treff, feil forslag og manglende treff per glassklasse.
 *
 * DOKTRINE: bare et uavhengig, verifisert utvalg kan si noe om kvalitet.
 * Katalogavledede rader (ground_truth) er IKKE uavhengige — de kommer fra samme
 * kilde som systemet selv bruker. Denne kjøringen skiller derfor eksplisitt
 * mellom:
 *   KILDE=A  uavhengig verifisert (OE fra gammelt glass, OEM-portal eller montør)
 *   KILDE=B  autoritativ katalog/OE-evidens
 *   KILDE=C  sterk avledet evidens
 * og rapporterer dem hver for seg. «Kandidater til manuell kontroll» er alltid
 * en egen kolonne — det er ikke det samme som dokumentert passform.
 *
 * Bruk:
 *   node --import tsx scripts/fasit-utvalg.mjs [--base <url>] [--fil data/fasit-utvalg.csv]
 *
 * CSV-kolonner (header påkrevd):
 *   regnr,klasse,side,kropp,forventet_varenr,forventet_eurokode,oe,kilde,verifisert
 * - klasse: frontrute|dor|side|ventil|bakrute|tak
 * - forventet_varenr: fasitens produkt (det som faktisk satt på bilen)
 * - forventet_eurokode: valgfri, brukes bare til intern kontroll (vises ikke)
 * - kilde: A|B|C
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const BASE = process.argv.includes('--base')
  ? process.argv[process.argv.indexOf('--base') + 1]
  : 'https://finnbilglass-frontrute-staging.tomarnejensen.workers.dev';
const FIL = process.argv.includes('--fil')
  ? process.argv[process.argv.indexOf('--fil') + 1]
  : 'data/fasit-utvalg.csv';

const KIND = { frontrute: 'windshield', dor: 'door', side: 'side', ventil: 'ventil', bakrute: 'rear', tak: 'roof' };

function lesCsv(tekst) {
  const linjer = tekst.trim().split(/\r?\n/);
  const hode = linjer[0].split(',').map((h) => h.trim());
  return linjer.slice(1).filter(Boolean).map((l) => {
    const celler = l.split(',').map((c) => c.trim());
    return Object.fromEntries(hode.map((h, i) => [h, celler[i] ?? '']));
  });
}

function selectionFor(rad) {
  const kind = KIND[rad.klasse] ?? 'unknown';
  const sel = { kind };
  if (kind === 'door') { sel.side = rad.side || 'unknown'; sel.door = 'unknown'; sel.body = rad.kropp || 'unknown'; }
  if (kind === 'side') { sel.side = rad.side || 'unknown'; sel.section = 'unknown'; sel.mounting = 'unknown'; sel.body = rad.kropp || 'unknown'; }
  if (kind === 'ventil') { sel.side = rad.side || 'unknown'; sel.placement = 'unknown'; sel.body = rad.kropp || 'unknown'; }
  if (kind === 'rear') { sel.layout = 'unknown'; sel.body = rad.kropp || 'unknown'; }
  if (kind === 'roof') { sel.system = 'unknown'; sel.panel = 'unknown'; }
  return sel;
}

/**
 * /api/frontrute tar merke/modell/år (ikke regnr). Oppgis ikke det i fasiten,
 * slås bilen opp via /api/regnr — som SKRIVER en regnr_logg-rad. I produksjon
 * skal fasitfilen derfor ha merke/modell/aar, så målingen er lese-only.
 */
async function bilFor(rad) {
  if (rad.merke) return { merke: rad.merke, modell: rad.modell ?? '', aar: Number(rad.aar) || undefined };
  const r = await fetch(`${BASE}/api/regnr`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ regnr: rad.regnr }),
  });
  const d = await r.json();
  const b = d?.bil ?? {};
  return { merke: b.merke ?? '', modell: b.modell ?? '', aar: b.aar ?? undefined };
}

async function kall(rad) {
  if ((rad.klasse ?? 'frontrute') === 'frontrute') {
    const bil = await bilFor(rad);
    const r = await fetch(`${BASE}/api/frontrute`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bil),
    });
    const d = await r.json();
    const ks = Array.isArray(d.kandidater) ? d.kandidater : [];
    return { http: r.status, utfall: d.utfall ?? null, varenr: ks.map((k) => k.varenr).filter(Boolean) };
  }
  const r = await fetch(`${BASE}/api/glass/kandidater`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ regnr: rad.regnr, schemaVersion: 1, selection: selectionFor(rad), answers: {} }),
  });
  const d = await r.json();
  const ks = Array.isArray(d.kandidater) ? d.kandidater : [];
  return { http: r.status, utfall: d.status ?? null, varenr: ks.map((k) => k.varenr).filter(Boolean) };
}

if (!existsSync(FIL)) {
  console.error(`Fant ikke ${FIL}. Lag filen med kolonnene:`);
  console.error('regnr,klasse,side,kropp,forventet_varenr,forventet_eurokode,oe,kilde,verifisert');
  process.exit(2);
}

const rader = lesCsv(readFileSync(FIL, 'utf8'));
const resultat = [];
for (const rad of rader) {
  if (!rad.regnr) continue;
  let svar;
  try {
    svar = await kall(rad);
  } catch (e) {
    resultat.push({ ...rad, dom: 'TEKNISK_FEIL', detalj: String(e.message || e) });
    continue;
  }
  const forventet = (rad.forventet_varenr || '').toUpperCase();
  const harForventet = forventet && svar.varenr.map((v) => String(v).toUpperCase()).includes(forventet);
  let dom;
  if (svar.http >= 400) dom = 'TEKNISK_FEIL';
  else if (!forventet) {
    // Fasiten sier «ingen fasit» (tvetydig datagrunnlag): riktig oppførsel er
    // manuell kontroll, aldri en påstått entydig konklusjon.
    dom = ['VERIFY', 'MANUAL_REVIEW', 'CANDIDATES'].includes(String(svar.utfall)) ? 'MANUELL_FORVENTET' : 'AVVIK_FRA_FASIT';
  } else if (!svar.varenr.length) dom = 'MANGLENDE_TREFF';
  else if (harForventet && svar.varenr.length === 1) dom = 'RIKTIG_ENTYDIG';
  else if (harForventet) dom = 'RIKTIG_BLANT_KANDIDATER';
  else dom = 'FEIL_FORSLAG';

  resultat.push({
    regnr: rad.regnr, klasse: rad.klasse || 'frontrute', kilde: rad.kilde || '?', forventet,
    http: svar.http, utfall: svar.utfall, antall: svar.varenr.length,
    kandidater: svar.varenr.slice(0, 6).join(' '), dom,
  });
}

const perKlasse = {};
for (const r of resultat) {
  const k = r.klasse || 'frontrute';
  perKlasse[k] ??= { RIKTIG_ENTYDIG: 0, RIKTIG_BLANT_KANDIDATER: 0, MANUELL_FORVENTET: 0, FEIL_FORSLAG: 0, MANGLENDE_TREFF: 0, AVVIK_FRA_FASIT: 0, TEKNISK_FEIL: 0, antall: 0 };
  perKlasse[k][r.dom] = (perKlasse[k][r.dom] ?? 0) + 1;
  perKlasse[k].antall += 1;
}

console.log(`Fasit-utvalg mot ${BASE}\n`);
console.log('regnr      klasse      kilde  utfall            kandidater  dom');
for (const r of resultat) {
  console.log(`${r.regnr.padEnd(10)} ${String(r.klasse).padEnd(11)} ${String(r.kilde).padEnd(6)} ${String(r.utfall ?? '-').padEnd(16)} ${String(r.antall ?? '-').padEnd(11)} ${r.dom}`);
}
console.log('\nPer glassklasse:');
for (const [k, v] of Object.entries(perKlasse)) {
  console.log(`  ${k.padEnd(10)} n=${v.antall}  riktig-entydig=${v.RIKTIG_ENTYDIG}  riktig-blant=${v.RIKTIG_BLANT_KANDIDATER}  manuell-forventet=${v.MANUELL_FORVENTET}  feil-forslag=${v.FEIL_FORSLAG}  manglende=${v.MANGLENDE_TREFF}  avvik=${v.AVVIK_FRA_FASIT}  teknisk=${v.TEKNISK_FEIL}`);
}

const ut = { base: BASE, tid: new Date().toISOString(), fil: FIL, resultat, perKlasse };
writeFileSync('data/fasit-utvalg-resultat.json', JSON.stringify(ut, null, 2));
console.log('\nSkrevet: data/fasit-utvalg-resultat.json');
