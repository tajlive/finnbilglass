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
// År-tolkning: XX ∈ [50,59] eller ≥60 → 19XX (53-57 = 1953-57, 79- = 1979); XX < 50 → 20XX.
// Slutt-år: YY < XX og start ≥ 1950 → 2000+YY («95-06» = 1995-2006); ellers startens århundre.
const MND = ['JAN', 'FEB', 'MAR', 'APR', 'MAI', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OKT', 'OCT', 'NOV', 'DES', 'DEC'];
const tilStart = (xx) => (xx >= 50 ? 1900 + xx : 2000 + xx);
const tilSlutt = (yy, start) => (start >= 1950 && yy < start - 1900 ? 2000 + yy : start >= 1950 ? 1900 + yy : 2000 + yy);
function parseAarVindu(s) {
  const t = s.trim();
  // Eksplisitt vindu: «14-JUNI16», «18-21», «18-20», «2003-2008»
  let m = t.match(/(\d{2})\s*-\s*(\d{2})$/);
  if (m) {
    const a = tilStart(parseInt(m[1], 10)), b = tilSlutt(parseInt(m[2], 10), a);
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
  if (m) return { start: tilStart(parseInt(m[1], 10)), end: tilSlutt(parseInt(m[3], 10), tilStart(parseInt(m[1], 10))) };
  // Åpen start med måned: «JULI16-», «NOV21-», «JUNI16-», «03/23-», «22-»
  m = t.match(/(JAN|FEB|MAR|APR|MAI|MAY|JUN|JUL|AUG|SEP|OKT|OCT|NOV|DES|JUNI|JULI)(\d{2})\s*-\s*$/);
  if (m) return { start: tilStart(parseInt(m[2], 10)), end: null };
  m = t.match(/(\d{1,2})\/(\d{2})\s*-\s*$/);
  if (m) return { start: tilStart(parseInt(m[2], 10)), end: null };
  m = t.match(/^(\d{2})\s*-\s*$/);
  if (m) return { start: tilStart(parseInt(m[1], 10)), end: null };
  // «2003-» — åpent 4-sifret vindu
  m = t.match(/^(\d{4})\s*-\s*$/);
  if (m) return { start: parseInt(m[1], 10), end: null };
  m = t.match(/(\d{2})\s*-\s*$/);
  if (m) return { start: tilStart(parseInt(m[1], 10)), end: null };
  return null;
}

// ── Frontrute-klassifisering ──
const IKKE_FRONTRUTE = ['DØRRUTE', 'DORRUTE', 'SIDERUTE', 'BAKRUTE', 'BACKLITE', 'SUNROOF', 'HATCH', 'TAKLUKE', 'TAKRUTE', 'PANORAMA', 'REAR', 'QUARTER', 'VENT'];
function erFrontrute(varenavn, varenr) {
  const n = varenavn.toUpperCase();
  if (IKKE_FRONTRUTE.some((k) => n.includes(k))) return false;
  // Side-glass-mønster: L/R direkte etter 4- ELLER 5-sifret prefiks
  // (8103LGAR5 = 4-sifret, 26270LFWXBYN = 5-sifret prefiks)
  if (/^\d{4,5}[LR]/.test(varenr ?? '')) return false;
  return true; // uten side/bak-markør = frontrute-kandidat (FR/WS/uten markør)
}

// ── Modell-normalisering: fjern karosseri/utstyrs-ord, behold modell-kjernen ──
const MODELL_STOPP = ['2D', '3D', '4D', '5D', 'SED', 'SEDAN', 'SUV', 'COUPE', 'KOMBI', 'STASJONSVOGN',
  'FR', 'WS', 'EL', 'CL', 'COATED', 'AKU', 'AKO', 'SENS', 'TRIPPEL', 'TRIPLE', 'KAMERA'];
function parseVarenavn(varenavn, merke) {
  const n = varenavn.replace(/\s+/g, ' ').trim();
  // Årvindu-markør: finn første årvindu-mønster og del navnet der
  const deler = n.split(/(?=\b(?:JAN|FEB|MAR|APR|MAI|MAY|JUN|JUL|AUG|SEP|OKT|OCT|NOV|DES|JUNI|JULI)?(?:\d{4}|\d{1,2})\s*(?:\/|-))/i);
  const hode = deler[0]?.trim() ?? n;
  const vinduTekst = deler.slice(1).join(' ').trim();
  // Vindu kan være en del av «18-21 FR AKU» — parse fra start av vindu-teksten
  const vindu = vinduTekst ? parseAarVindu(vinduTekst) : null;
  // Modell-tokens: hode minus merke
  const utenMerke = hode.replace(new RegExp(`^${merke.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*`, 'i'), '');
  // Samle-rader med «/» («CIVIC/ ROVER») = ULIKE biler på én rad → ekskluder (falsk GT-kilde).
  // «+»-rader («V70+S60») deler glass ifølge katalogen → beholdes.
  if (utenMerke.includes('/')) return null;
  const ord = utenMerke.split(/\s+/).filter((o) => o && !MODELL_STOPP.includes(o));
  // Tall-tokens: behold 1-2-sifrede («MODEL 3», «A 80»); fjern ≥3-sifrede («200», «308»)
  // bare når andre ord finnes — ellers behold (modell-navnet ER tallet).
  let filtert;
  const ikkeTall = ord.filter((o) => !/^\d+$/.test(o));
  const tall = ord.filter((o) => /^\d+$/.test(o));
  const storeTall = tall.filter((o) => o.length >= 3);
  if (storeTall.length && ikkeTall.length) filtert = [...ikkeTall, ...tall.filter((o) => o.length <= 2)];
  else filtert = ord;
  let modell = filtert.join(' ');
  // Serie-normalisering: «W204 STV» → «W204», «SERIEN E39» → «E39» (matcher serieKey i resolveren)
  let serieKode = normaliserKatalogModell(modell);
  // Multi-kode-rader («W638/W639/W640 VITO») kanoniseres IKKE til første kode —
  // serien må velges fra årvinduet via serieKey.
  if (serieKode && /[WXCR]\d{3}\/[WXCR]\d{3}\/[WXCR]\d{3}/.test(modell.toUpperCase())) serieKode = null;
  if (serieKode) {
    modell = serieKode;
  } else {
    const v = vinduTekst ? parseAarVindu(vinduTekst) : null;
    const sk = serieKey(merke, modell.replace(/[WXCR]\d{3}(?:\/[WXCR]?\d{3})*/g, '').trim(), v?.start ?? null);
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
    let merke = (r.varenavn.split(/\s+/)[0] ?? '').toUpperCase();
    // «3 SERIES SAL G20» → BMW (serie-nummer som første token)
    if (/^\d$/.test(merke) && /^SERIE/.test(r.varenavn.split(/\s+/)[1] ?? '')) merke = 'BMW';
    // «RANGE ROVER ...» → LAND ROVER (SVV-navn)
    if (merke === 'RANGE' && /^ROVER/.test(r.varenavn.split(/\s+/)[1] ?? '')) merke = 'LAND ROVER';
    if (!merkeSett.has(merke)) continue;
    if (!erFrontrute(r.varenavn, r.varenr)) { ekskludert++; continue; }
    frontruteRader++;
    const p = parseVarenavn(r.varenavn, merke);
    if (!p || !p.vindu || p.vindu.start == null) { utenVindu++; continue; }
    if (!p.modell) { utenVindu++; continue; }
    perMerkeModell[merke] ??= {};
    perMerkeModell[merke][p.modell] ??= [];
    perMerkeModell[merke][p.modell].push({
      varenr: r.varenr, modell: p.modell, start: p.vindu.start, end: p.vindu.end,
      utstyr: p.utstyr, varenavn: r.varenavn,
    });
  }

  // ── SVV-levetid: maks registreringsår per (merke, modell) fra verifiserte SVV-data.
  //    Brukes for å cappe åpne årvinduer — «C5 05-» må IKKE få GT-rader for 2023 (fantombil). ──
  const svvLevetid = new Map();
  {
    const files = ['/Users/taj/finnbilglass/data/hull-kart-resultater.ndjson', '/Users/taj/finnbilglass/data/finn-modeller/svv-verifisert.ndjson'];
    const keyAv = (make, model, aar) => {
      const sk = serieKey(make, model, aar);
      const base = sk ?? String(model ?? '').toUpperCase().split(/[^A-ZÆØÅ0-9]+/).filter(Boolean).sort().join('~');
      return `${String(make ?? '').toUpperCase().replace(/[^A-Z]/g, '')}|${base}`;
    };
    for (const fil of files) {
      if (!existsSync(fil)) continue;
      for (const linje of readFileSync(fil, 'utf8').split('\n')) {
        if (!linje.trim()) continue;
        try {
          const b = JSON.parse(linje);
          const make = b.make ?? b.merke ?? null;
          const model = b.model ?? b.modell ?? null;
          const aar = b.year ?? b.aar ?? (b.registrertAr ? Number(b.registrertAr) : null);
          if (!make || !model || !aar) continue;
          const k = keyAv(make, model, aar);
          if (!svvLevetid.has(k) || svvLevetid.get(k) < aar) svvLevetid.set(k, aar);
        } catch { /* ugyldig linje */ }
      }
    }
  }
  const levetidCap = (merke, modell, start) => {
    const sk = serieKey(merke, modell, start);
    const base = sk ?? String(modell ?? '').toUpperCase().split(/[^A-ZÆØÅ0-9]+/).filter(Boolean).sort().join('~');
    const k = `${merke.replace(/[^A-Z]/g, '')}|${base}`;
    const maks = svvLevetid.get(k);
    if (maks && maks >= start) return Math.min(maks + 2, 2026); // margin for nye modeller
    return Math.min(start + 12, 2026); // fallback: 12-års cap, aldri fantom-år
  };

  // ── Ekspandér til (make, model, year) → varenr-sett ──
  const gtRader = new Map(); // key: make|model|year|varenr
  const konfliktInfo = {};
  // Familie-deteksjon: to varianter er «samme modellfamilie» hvis minst ett modell-ord
  // (≥4 tegn) har prefiks-overlapp — «TRANSPORTER»↔«TRANSPORTE+MULTIVAN» ✓,
  // «MODEL S»↔«MODEL 3» ✗ (S/3 <4 tegn). Brukes for generasjons-capp av åpne vinduer.
  const ordAv = (m) => String(m ?? '').toUpperCase().split(/[^A-ZÆØÅ0-9]+/).filter((o) => o.length >= 4);
  const familieOverlapp = (a, b) => {
    const A = ordAv(a), B = ordAv(b);
    return A.some((x) => B.some((y) => x.startsWith(y) || y.startsWith(x)));
  };
  for (const [merke, modeller] of Object.entries(perMerkeModell)) {
    const alleVarianter = Object.entries(modeller).flatMap(([modell, varianter]) =>
      varianter.map((v) => ({ ...v, modell })));
    for (const [modell, varianter] of Object.entries(modeller)) {
      // Generasjonsslutt: eksplisitt slutt, ellers neste start i FAMILIEN − 1,
      // capet av SVV-levetid (ingen fantom-rader for utgåtte modeller)
      const starter = [...new Set(varianter.map((v) => v.start))].sort((a, b) => a - b);
      for (const v of varianter) {
        let slutt = v.end;
        if (slutt == null) {
          const egenNeste = starter.find((s) => s > v.start);
          const familieNeste = alleVarianter
            .filter((fv) => familieOverlapp(fv.modell, modell) && fv.start > v.start)
            .map((fv) => fv.start)
            .sort((a, b) => a - b)[0];
          const neste = [egenNeste, familieNeste].filter((n) => n != null).sort((a, b) => a - b)[0];
          slutt = neste ? neste - 1 : levetidCap(merke, modell, v.start);
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
