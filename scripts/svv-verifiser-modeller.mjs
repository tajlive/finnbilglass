#!/usr/bin/env node
/**
 * SVV-verifiserer alle nye finn.no-annonser (data/finn-modeller/*-annonser.ndjson)
 * → data/finn-modeller/svv-verifisert.ndjson
 *
 * For hver annonse: SVV-enkeltoppslag → regnr, vin, merke, modell, aar, farge.
 * Logikk identisk med prod (src/svv.ts): aliasMerke + handelsbetegnelse + år fra
 * forstegangsregistrering.
 *
 * Usage: node scripts/svv-verifiser-modeller.mjs [--delay=300]
 */
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const OUT_DIR = '/Users/taj/finnbilglass/data/finn-modeller';
const ENV_FILE = '/Users/taj/bilglass/.env.local';
const SVV_URL = 'https://akfell-datautlevering.atlas.vegvesen.no/enkeltoppslag/kjoretoydata';

function getKey() {
  const env = readFileSync(ENV_FILE, 'utf8');
  const m = env.match(/^SVV_API_KEY=(.+)$/m);
  if (!m) throw new Error(`SVV_API_KEY ikke funnet i ${ENV_FILE}`);
  return m[1].trim().replace(/^["']|["']$/g, '');
}

const MERKE_ALIAS = {
  'MERCEDES-BENZ': 'MERCEDES', 'MERCEDES BENZ': 'MERCEDES',
  VOLKSWAGEN: 'VW', 'OPEL VAUXHALL': 'OPEL',
};

async function svvLookup(regnr, key) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(`${SVV_URL}?kjennemerke=${encodeURIComponent(regnr)}`, {
      signal: ctrl.signal,
      headers: { Accept: 'application/json', 'SVV-Authorization': `Apikey ${key}`, 'User-Agent': 'Finnbilglass/1.0' },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const k = data.kjoretoydataListe?.[0];
    if (!k) return null;
    const g = k.godkjenning?.tekniskGodkjenning?.tekniskeData?.generelt;
    const merkeRaw = g?.merke?.[0]?.merke ?? '';
    const merke = MERKE_ALIAS[(merkeRaw ?? '').trim().toUpperCase()] ?? merkeRaw;
    const modell = (g?.handelsbetegnelse?.[0] ?? '').trim().toUpperCase();
    if (!merke) return null;
    const regDato = k.forstegangsregistrering?.registrertForstegangNorgeDato ?? '';
    const aar = regDato ? parseInt(regDato.slice(0, 4), 10) : null;
    return {
      merke, modell,
      aar: aar && aar > 1900 && aar < 2100 ? aar : null,
      vin: k.kjoretoyId?.understellsnummer ?? null,
      farge: g?.karosseriOgLasteplan?.rFarge?.[0]?.kodeNavn ?? null,
      registrert: k.registrering?.registreringsstatus?.kodeVerdi === 'REGISTRERT',
    };
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function main() {
  const delay = parseInt(process.argv.find((a) => a.startsWith('--delay='))?.split('=')[1] ?? '300', 10);
  const key = getKey();
  const files = readdirSync(OUT_DIR).filter((f) => f.endsWith('-annonser.ndjson'));
  console.log(`🔍 SVV-verifisering av ${files.length} modell-filer (delay ${delay}ms)`);

  const outFile = `${OUT_DIR}/svv-verifisert.ndjson`;
  const seenRegnr = new Set();
  if (existsSync(outFile)) {
    for (const l of readFileSync(outFile, 'utf8').split('\n')) {
      if (!l.trim()) continue;
      try { const r = JSON.parse(l); if (r.regnr) seenRegnr.add(r.regnr); } catch {}
    }
  }

  let ok = 0, bom = 0, totalt = 0;
  const perModell = {};
  for (const f of files) {
    const modell = f.replace('-annonser.ndjson', '');
    perModell[modell] = { funnet: 0, svvOk: 0 };
    const annonser = readFileSync(`${OUT_DIR}/${f}`, 'utf8').split('\n').filter((l) => l.trim()).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    console.log(`\n▶ ${modell}: ${annonser.length} annonser`);
    for (const a of annonser) {
      if (seenRegnr.has(a.regnr)) continue;
      seenRegnr.add(a.regnr);
      totalt++;
      const bil = await svvLookup(a.regnr, key);
      if (bil) {
        ok++; perModell[modell].svvOk++;
        appendFileSync(outFile, JSON.stringify({
          regnr: a.regnr, finnkode: a.finnkode, modellSok: a.modellSok,
          merke: bil.merke, modell: bil.modell, aar: bil.aar, vin: bil.vin,
          farge: bil.farge, registrert: bil.registrert, verifisertAt: new Date().toISOString(),
        }) + '\n');
      } else {
        bom++;
      }
      if (totalt % 25 === 0) console.log(`   [${totalt}] SVV-treff ${ok}, bom ${bom}`);
      await sleep(delay);
    }
    console.log(`   ${perModell[modell].svvOk}/${annonser.length} SVV-treff`);
  }

  const rapport = {
    generert: new Date().toISOString(),
    totaltTestet: totalt, svvTreff: ok, svvBom: bom,
    svvTreffPst: Math.round((ok / Math.max(totalt, 1)) * 100),
    perModell,
    output: outFile,
  };
  writeFileSync(`${OUT_DIR}/svv-verifiseringsrapport.json`, JSON.stringify(rapport, null, 2));
  console.log('\n=== SVV-VERIFISERING ===');
  console.log(JSON.stringify(rapport, null, 2));
}

main().catch((e) => { console.error('❌', e); process.exit(1); });
