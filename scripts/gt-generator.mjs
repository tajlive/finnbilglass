#!/usr/bin/env node
/**
 * GT-generator: oversetter autoglass_prisliste (Autoglass' egen salgsliste = fasit)
 * til ground_truth-rader (make, model, year) → frontrute-varenr.
 *
 * Doktrine (G1): GT er verifisert fasit. Prislisten er Autoglass' operative katalog
 * — den er den autoritative norske kilden. Kvalitetsgater:
 *   A) Kun rader med EKSPLISITT årvindu-markør (aldri gjett åpne vinduer).
 *   B) Generasjonsslutt = eksplisitt slutt ELLER neste start for samme modell − 1.
 *   C) Kun frontruter (ekskluder dør-/side-/bak-/tak-glass via nøkkelord).
 *   D) 1 rad per (make, model, year) → PINPOINT-kandidat; 2+ → VERIFY (doktrinen).
 *
 * Usage: node scripts/gt-generator.mjs [--merker=TESLA,MERCEDES] [--dry-run]
 * Output: data/gt-ekspansjon/gt-generert.sql + gt-generator-rapport.json
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { serieKey, normaliserKatalogModell } from '../src/serie-mapping.ts';

const DATA = '/Users/taj/finnbilglass/data/gt-ekspansjon';
const DUMPS = { 'TESLA,MERCEDES': `${DATA}/tesla-mercedes.json`, 'OPEL,BMW': `${DATA}/opel-bmw.json`, 'ALLE': `${DATA}/prisliste-alle-glass.json` };

function parseArgs() {
  const a = process.argv.slice(2);
  const o = { merker: ['TESLA', 'MERCEDES', 'OPEL', 'BMW'], dry: a.includes('--dry-run') };
  const m = a.find((x) => x.startsWith('--merker='));
  if (m) o.merker = m.split('=')[1].split(',').map((s) => s.trim());
  return o;
}

// ── Årvindu-parsing ──
// «14-JUNI16» → {start:2014, end:2016} · «JULI16-» → {start:2016} · «03/23-» → {start:2023}
// «18-21» → {start:2018, end:2021} · «22-» → {start:2022} · «NOV21-» → {start:2021}
// År-tolkning XX: ≥60 → 19XX (Gelandewagen 79- = 1979), ellers 20XX (12- = 2012).
const MND = ['JAN', 'FEB', 'MAR', 'APR', 'MAI', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OKT', 'OCT', 'NOV', 'DES', 'DEC'];
const tilAar = (xx) => (xx >= 60 ? 1900 + xx : 2000 + xx);
function parseAarVindu(s) {
  const t = s.trim();
  // Eksplisitt vindu: «14-JUNI16», «18-21», «18-20», «2003-2008»
  let m = t.match(/(\d{2})\s*-\s*(\d{2})$/);
  if (m) {
    const a = tilAar(parseInt(m[1], 10)), b = tilAar(parseInt(m[2], 10));
    if (b < a) return null;
    return { start: a, end: b };
  }
  m = t.match(/(\d{4})\s*-\s*(\d{4})$/);
  if (m) {
    const a = parseInt(m[1], 10), b = parseInt(m[2], 10);
    if (b < a) return null;
    return { start: a, end: b };
  }
  // «14-JUNI16» (med måned i slutt)
  m = t.match(/(\d{2})\s*-\s*(JAN|FEB|MAR|APR|MAI|MAY|JUN|JUL|AUG|SEP|OKT|OCT|NOV|DES)(\d{2})$/);
  if (m) return { start: tilAar(parseInt(m[1], 10)), end: tilAar(parseInt(m[3], 10)) };
  // Åpen start med måned: «JULI16-», «NOV21-», «JUNI16-», «03/23-», «22-»
  m = t.match(/(JAN|FEB|MAR|APR|MAI|MAY|JUN|JUL|AUG|SEP|OKT|OCT|NOV|DES|JUNI|JULI)(\d{2})\s*-\s*$/);
  if (m) return { start: tilAar(parseInt(m[2], 10)), end: null };
  m = t.match(/(\d{1,2})\/(\d{2})\s*-\s*$/);
  if (m) return { start: tilAar(parseInt(m[2], 10)), end: null };
  m = t.match(/^(\d{2})\s*-\s*$/);
  if (m) return { start: tilAar(parseInt(m[1], 10)), end: null };
  m = t.match(/(\d{2})\s*-\s*$/);
  if (m) return { start: tilAar(parseInt(m[1], 10)), end: null };
  return null;
}

// ── Frontrute-klassifisering ──
const IKKE_FRONTRUTE = ['DØRRUTE', 'DORRUTE', 'SIDERUTE', 'BAKRUTE', 'BACKLITE', 'SUNROOF', 'HATCH', 'TAKLUKE', 'TAKRUTE', 'PANORAMA', 'REAR', 'QUARTER', 'VENT'];
function erFrontrute(varenavn, varenr) {
  const n = varenavn.toUpperCase();
  if (IKKE_FRONTRUTE.some((k) => n.includes(k))) return false;
  // Side-glass-mønster: L/R direkte etter 4-sifret prefiks (8103LGAR5, 9684LGSH5)
  if (/^\d{4}[LR]/.test(varenr ?? '')) return false;
  // 4-sifret prefiks + fargekoder med L/R i 5. posisjon (8103LGAR5 = venstre siderute)
  if (/^\d{4}[LR][A-Z]/.test(varenr ?? '')) return false;
  return true; // uten side/bak-markør = frontrute-kandidat (FR/WS/uten markør)
}

// ── Modell-normalisering: fjern karosseri/utstyrs-ord, behold modell-kjernen ──
const MODELL_STOPP = ['2D', '3D', '4D', '5D', 'SED', 'SEDAN', 'SUV', 'COUPE', 'KOMBI', 'STASJONSVOGN',
  'FR', 'WS', 'EL', 'CL', 'COATED', 'AKU', 'AKO', 'SENS', 'TRIPPEL', 'TRIPLE', 'KAMERA'];
function parseVarenavn(varenavn, merke) {
  const n = varenavn.replace(/\s+/g, ' ').trim();
  // Årvindu-markør: finn første årvindu-mønster og del navnet der
  const deler = n.split(/(?=\b(?:JAN|FEB|MAR|APR|MAI|MAY|JUN|JUL|AUG|SEP|OKT|OCT|NOV|DES|JUNI|JULI)?\d{1,2}\s*(?:\/|-))/i);
  const hode = deler[0]?.trim() ?? n;
  const vinduTekst = deler.slice(1).join(' ').trim();
  // Vindu kan være en del av «18-21 FR AKU» — parse fra start av vindu-teksten
  const vindu = vinduTekst ? parseAarVindu(vinduTekst) : null;
  // Modell-tokens: hode minus merke
  const utenMerke = hode.replace(new RegExp(`^${merke.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*`, 'i'), '');
  const ord = utenMerke.split(/\s+/).filter((o) => o && !MODELL_STOPP.includes(o) && !/^\d/.test(o));
  let modell = ord.join(' ');
  // Serie-normalisering: «W204 STV» → «W204», «SERIEN E39» → «E39» (matcher serieKey i resolveren)
  const serieKode = normaliserKatalogModell(modell);
  if (serieKode) modell = serieKode;
  // For Mercedes-rader uten W-kode i navnet: «VIANO/VITO» med vindu 2003-2014 → W639
  if (!serieKode) {
    const v = vinduTekst ? parseAarVindu(vinduTekst) : null;
    const sk = serieKey(merke, modell, v?.start ?? null);
    if (sk) modell = sk;
  }
  const utstyr = (vinduTekst.split(/\d{2}\s*-\s*|-/).slice(1).join(' ') + ' ' + (hode.match(/FR|WS|EL|CL|COATED|AKU|AKO|SENS|PLAID|JUNIPER|4MATIC|AMG/g)?.join(' ') ?? '')).toUpperCase();
  return { modell, vindu, utstyr: utstyr.trim() };
}

function lastDumps(merker) {
  const rader = [];
  const alle = merker.length === 1 && merker[0] === 'ALLE';
  for (const [nokler, fil] of Object.entries(DUMPS)) {
    if (!existsSync(fil)) continue;
    if (alle && nokler !== 'ALLE') continue;
    if (!alle && nokler === 'ALLE') continue;
    const d = JSON.parse(readFileSync(fil, 'utf8'));
    const rows = (d[0] && d[0].results) ? d[0].results : d;
    for (const r of rows) rader.push(r);
  }
  return rader;
}

async function main() {
  const o = parseArgs();
  mkdirSync(DATA, { recursive: true });
  const alle = o.merker.length === 1 && o.merker[0] === 'ALLE';
  const rader = lastDumps(o.merker);
  const merkeSett = alle
    ? new Set(rader.map((r) => (r.varenavn.split(/\s+/)[0] ?? '').toUpperCase()))
    : new Set(o.merker.map((m) => m.toUpperCase()));

  // Grupper per merke → modell → variant
  const perMerkeModell = {};
  let frontruteRader = 0, ekskludert = 0, utenVindu = 0;
  for (const r of rader) {
    const merke = (r.varenavn.split(/\s+/)[0] ?? '').toUpperCase();
    if (!merkeSett.has(merke)) continue;
    if (!erFrontrute(r.varenavn, r.varenr)) { ekskludert++; continue; }
    frontruteRader++;
    const p = parseVarenavn(r.varenavn, merke);
    if (!p.vindu || p.vindu.start == null) { utenVindu++; continue; }
    if (!p.modell) { utenVindu++; continue; }
    perMerkeModell[merke] ??= {};
    perMerkeModell[merke][p.modell] ??= [];
    perMerkeModell[merke][p.modell].push({
      varenr: r.varenr, modell: p.modell, start: p.vindu.start, end: p.vindu.end,
      utstyr: p.utstyr, varenavn: r.varenavn,
    });
  }

  // ── Ekspandér til (make, model, year) → varenr-sett ──
  const gtRader = new Map(); // key: make|model|year|varenr
  const konfliktInfo = {};
  for (const [merke, modeller] of Object.entries(perMerkeModell)) {
    for (const [modell, varianter] of Object.entries(modeller)) {
      // Generasjonsslutt: eksplisitt slutt, ellers neste start for samme modell − 1
      const starter = [...new Set(varianter.map((v) => v.start))].sort((a, b) => a - b);
      for (const v of varianter) {
        let slutt = v.end;
        if (slutt == null) {
          const neste = starter.find((s) => s > v.start);
          slutt = neste ? neste - 1 : 2026;
        }
        if (slutt < v.start) slutt = v.start;
        for (let yr = v.start; yr <= slutt; yr++) {
          const key = `${merke}|${modell}|${yr}|${v.varenr}`;
          if (!gtRader.has(key)) {
            gtRader.set(key, { make: merke, model: modell, year: yr, frontrute_eurocode: v.varenr });
          }
        }
      }
    }
  }

  // ── SQL + rapport ──
  const sql = [
    "-- GT-generert fra autoglass_prisliste (source=gt-auto-prisliste) — 2026-08-15",
    "INSERT OR IGNORE INTO ground_truth (make, model, year, frontrute_eurocode, verified_by, confidence, source) VALUES",
  ];
  const linjer = [];
  const perMake = {};
  for (const r of gtRader.values()) {
    perMake[r.make] = (perMake[r.make] ?? 0) + 1;
    linjer.push(`('${r.make.replace(/'/g, "''")}', '${r.model.replace(/'/g, "''")}', ${r.year}, '${r.frontrute_eurocode.replace(/'/g, "''")}', 'gt-auto-prisliste', 0.80, 'gt-auto-prisliste')`);
  }
  sql.push(linjer.join(',\n') + ';');

  // Entydighet per (make, model, year)
  const perKjoretoy = {};
  for (const r of gtRader.values()) {
    const k = `${r.make}|${r.model}|${r.year}`;
    perKjoretoy[k] = (perKjoretoy[k] ?? 0) + 1;
  }
  const grupper = Object.entries(perKjoretoy);
  const entydige = grupper.filter(([, n]) => n === 1).length;
  const flerkandidat = grupper.length - entydige;

  const rapport = {
    generert: new Date().toISOString(),
    inputRader: rader.length,
    frontruteRader, ekskludertIkkeFrontrute: ekskludert, utenArvindu: utenVindu,
    gtRaderTotalt: gtRader.size,
    kjoretoyGrupper: grupper.length,
    entydigeGrupper: entydige,
    flerkandidatGrupper: flerkandidat,
    perMake,
    eksempler: [...gtRader.values()].slice(0, 40),
  };
  writeFileSync(`${DATA}/gt-generert.sql`, sql.join('\n'));
  writeFileSync(`${DATA}/gt-generator-rapport.json`, JSON.stringify(rapport, null, 2));
  console.log(JSON.stringify(rapport, null, 2));
  if (o.dry) console.log('\n[dry-run] SQL ikke skrevet til DB — kun filer over.');
}

main().catch((e) => { console.error('❌', e); process.exit(1); });
