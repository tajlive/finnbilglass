#!/usr/bin/env node
/**
 * GT-generator: oversetter glass_prisliste (Autoglass' egen salgsliste = fasit)
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
import { gunzipSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';
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
  // Bare år uten bindestrek («75», «2003») — katalog-skrivefeil (814GB «75 FR+GB»).
  m = t.match(/^(\d{2})$/);
  if (m) return { start: tilStart(parseInt(m[1], 10)), end: null };
  m = t.match(/^(\d{4})$/);
  if (m) return { start: parseInt(m[1], 10), end: null };
  return null;
}

// ── Frontrute-klassifisering ──
// NB: «ALLE MOD»/«ALL MODELS»/«DOBBELTHYTTE»/«DOUBLE CAB» er FJERNET (2026-08-16) —
// de traff ekte frontruter («MAZDA 323 ALLE MOD», «LIGIER AMBRA/NOVA ALLE MOD» med
// posisjon A). Dobbel-cab-dørruter fanges av posisjonssjekken (L/R) uansett.
// Ordgrense-lookaround forhindrer substring-falske positiver: «VENT» må IKKE treffe
// «VENTURE»/«VENTO», «HATCH» må IKKE treffe «HATCHBACK».
const IKKE_FRONTRUTE = ['DØRRUTE', 'DORRUTE', 'SIDERUTE', 'SIDORUTE', 'SIDORUTA', 'SIDERUTA', 'BAKRUTE', 'BAGRUTE',
  'BACKLITE', 'SUNROOF', 'SOLTAK', 'HATCH', 'TAKLUKE', 'TAKRUTE', 'PANORAMA', 'REAR', 'QUARTER', 'VENT',
  'PYNTELIST', 'GUMMILIST', 'KLIPS', 'PAKNING'];
const IKKE_FRONTRUTE_RE = new RegExp(`(?<![A-ZÆØÅ0-9])(${IKKE_FRONTRUTE.join('|')})(?![A-ZÆØÅ0-9])`);
export function erFrontrute(varenavn, varenr, eurokode) {
  const n = varenavn.toUpperCase();
  if (IKKE_FRONTRUTE_RE.test(n)) return false;
  // PY*-suffiks = PYNTELIST, GU*-suffiks = GUMMILIST (dekorlist rundt glasset
  // som skjuler limfugen), IKKE glass. Hele familiene: PY, PYT, PYB, PYV, PYH,
  // PYS, PYC, PYKIT, PYCKI… og GU, GUM (Tom 2026-08-17). Autoglass-katalogen
  // bekrefter: «ROVER 800 PYNTELIST FRONTRUTE» 1 360 kr, «SMART FORTWO PYNTELIST
  // FRONTRUTE» 1 010 kr, «MERCEDES W108 GUMMILIST FRONTRUT» 1 590 kr —
  // frontruter koster 4 000-20 000+. 1 301 PY*/GU*-rader (55 merker) ble feilaktig
  // klassifisert som frontruter → feilpriser i GT (UR67407: 1979PY 625 kr vs
  // 1979C 5 320 kr; ALFA-klynge 300-2 900 kr vs 3 960-12 410 kr).
  // NB: YP/YPC/YPS/YPL er EKTE glass med list-attributt («SIDERUTE+INNK+CROM
  // LIST») — de skal IKKE ekskluderes, kun rene list-produkter (PY*/GU*).
  if (/(?:PY|GU)[A-Z]{0,4}$/.test(String(varenr ?? '').toUpperCase())) return false;
  // K-suffiks (rent siffer-prefiks + K) = KLIPS-KIT per bilmodell, IKKE glass
  // («NISSAN STANZA KLIPS» 1207K, «MERCEDES 190+190E KLIPS KIT» 1400K,
  // «KIA CREDOS KLIPS FRONTRUTE x10stk» 2052K — popnagler/spiletap).
  // Tom 2026-08-17: klips fester pyntelist/torpedodeksel til karosseriet.
  // 163 K-suffiks-rader i dumpen, 0 i katalogen (som glass).
  if (/^\d{3,5}K$/.test(String(varenr ?? '').toUpperCase())) return false;
  // Side-glass-mønster: L/R direkte etter 3–5-sifret prefiks
  // (8103LGAR5 = 4-sifret, 26270LFWXBYN = 5-sifret prefiks).
  if (/^\d{3,5}[LR]/.test(varenr ?? '')) return false;
  // Eurokode-posisjonssjekk: 3–5 sifre + glass-posisjon A=front, L/R=dør, B=bak, F=ventil, S=side.
  // 3-sifret prefiks fanges også («538LRGSC4RVWZ1M»=siderute, «671RGNC2FV»=siderute) —
  // 2-sifrede veteran-koder («42C», «3C») faller fortsatt gjennom som frontrute-kandidater.
  const ek = String(eurokode ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const mm = ek.match(/^(\d{3,5})([A-Z])/);
  if (mm && /[BLRFS]/.test(mm[2])) return false;
  return true; // uten side/bak-markør = frontrute-kandidat (FR/WS/uten markør)
}

// ── Modell-normalisering: fjern karosseri/utstyrs-ord, behold modell-kjernen ──
const MODELL_STOPP = ['2D', '3D', '4D', '5D', 'SED', 'SEDAN', 'SUV', 'COUPE', 'KOMBI', 'STASJONSVOGN',
  'FR', 'WS', 'EL', 'CL', 'COATED', 'AKU', 'AKO', 'SENS', 'TRIPPEL', 'TRIPLE', 'KAMERA'];
function parseVarenavn(varenavn, merke) {
  // Parenteser («MERCEDES SPRINTER (LAV TYPE)») er beskrivende tillegg, ikke
  // modell-tokens — strip dem FØR tokenisering så varianten normaliseres til
  // SPRINTER og matcher serieKey W901 (UR67407: 1979C/1979GY «(LAV TYPE)»).
  const n = varenavn.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
  // Årvindu-markør: finn første årvindu-mønster og del navnet der
  let deler = n.split(/(?=\b(?:JAN|FEB|MAR|APR|MAI|MAY|JUN|JUL|AUG|SEP|OKT|OCT|NOV|DES|JUNI|JULI)?(?:\d{4}|\d{1,2})\s*(?:\/|-))/i);
  // Katalog-skrivefeil: åpent vindu uten bindestrek («75 FR+GB», 814GB) —
  // splitt på år etterfulgt av utstyrsord.
  if (deler.length === 1) {
    deler = n.split(/(?=\b\d{2,4}\s+(?:FR|GB|GY|GN|AKU|WS|LDW|HUD|EL|CL|CAM|SENS|ACO|PYNT|FARGE|SOTET|GRØNN|GRONN)\b)/i);
  }
  const hode = deler[0]?.trim() ?? n;
  // Autoglass forkorter MERCEDES til MERC («MERC SPRINTER SKAPVOGN» 1971GG) —
  // normaliser FØR merke-stripping, ellers blir MERC et modell-token og
  // serieKey gir null (UR67407: 1971GG matchet aldri W901).
  const hodeNorm = merke === 'MERCEDES' ? hode.replace(/^MERC(?=\s)/i, 'MERCEDES') : hode;
  const vinduTekst = deler.slice(1).join(' ').trim();
  // Vindu kan være en del av «18-21 FR AKU» — parse fra start av vindu-teksten.
  // Fallback: strip utstyrssuffiks («FR AKU,», «LDW», «HUD») og parse igjen —
  // «18-22 FR AKU,» og «23- FR AKU, LDW» gir ellers null (regexene krever vindu på slutten).
  let vindu = vinduTekst ? parseAarVindu(vinduTekst) : null;
  if (!vindu) {
    const kjerne = vinduTekst?.split(/\s+(?=[A-ZÆØÅ]{2})/)[0];
    vindu = kjerne ? parseAarVindu(kjerne) : null;
  }
  // Modell-tokens: hode minus merke
  const utenMerke = hodeNorm.replace(new RegExp(`^${merke.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*`, 'i'), '');
  // Samle-rader med «/» («CIVIC/ ROVER») = ULIKE biler på én rad → ekskluder (falsk GT-kilde).
  // «+»-rader («V70+S60») deler glass ifølge katalogen → beholdes.
  if (utenMerke.includes('/')) return null;
  // Bindestrek-modell-lister («924-944-968», «T82-145», «C180-300») = flere modeller
  // på én rad → ekskluder (falsk GT-kilde; fasit: PORSCHE 924+944 1992 ≠ 1608GGA).
  if (/\d\s*[-–—]\s*\d/.test(utenMerke)) return null;
  // MM/YY-start («10/08-», «5/88-91») kan ikke representeres med år-granularitet
  // i GT → ekskluder (fasit: BMW X6 2008 ≠ 2969GYCM «10/08-»).
  // NB: split-regexen deler «10/08-» i «10/» + «08-» → tillat mellomrom rundt «/».
  if (/^\s*\d{1,2}\s*\/\s*\d{2}/.test(vinduTekst)) return null;
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

/** Katalog-index (catalog-prod): varenr → rader med strukturert brand/model/år/pris.
 *  GT-generatoren krever år i varenavnet, men Autoglass' navn har ofte IKKE år
 *  («MERCEDES SPRINTER (LAV TYPE)») — da mister vi hele varianten (UR67407:
 *  kun «95-06 LAV MOD»-raden 1979PY hadde år → feilpris 625 kr i GT).
 *  Berik fra den strukturerte katalogen (samme kilde som auto-glass.no). */
let KATALOG_INDEX = null;
function katalogIndex() {
  if (KATALOG_INDEX) return KATALOG_INDEX;
  KATALOG_INDEX = new Map();
  const fil = '/Users/taj/bilglass/data/catalog-prod.min.json.gz';
  if (!existsSync(fil)) return KATALOG_INDEX;
  const d = JSON.parse(gunzipSync(readFileSync(fil)).toString('utf8'));
  for (const r of d.records ?? []) {
    const vnr = String(r.article_number ?? '').toUpperCase();
    if (!vnr) continue;
    if (!KATALOG_INDEX.has(vnr)) KATALOG_INDEX.set(vnr, []);
    KATALOG_INDEX.get(vnr).push({
      brand: String(r.brand ?? '').toUpperCase(),
      model: String(r.model ?? '').toUpperCase(),
      start: r.year_from ?? null,
      end: r.year_to ?? null,
      pris: r.price ?? null,
    });
  }
  return KATALOG_INDEX;
}

/** Finn årvindu for (varenr, merke) fra katalogen — brand-prefiks-match
 *  («MERCEDES» ⊂ «MERCEDES TRUCKS»), ellers første rad med år. */
function katalogVindu(varenr, merke) {
  const rader = katalogIndex().get(String(varenr ?? '').toUpperCase());
  if (!rader?.length) return null;
  const m = (merke ?? '').toUpperCase().replace(/[^A-ZÆØÅ]/g, '');
  const match = rader.find((r) => r.start != null && (m ? r.brand.replace(/[^A-ZÆØÅ]/g, '').startsWith(m) || r.brand.replace(/[^A-ZÆØÅ]/g, '').includes(m) : true));
  const valgt = match ?? rader.find((r) => r.start != null);
  if (!valgt) return null;
  return { start: valgt.start, end: valgt.end ?? null };
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
    // «MERC SPRINTER SKAPVOGN» — Autoglass forkorter MERCEDES til MERC
    // (UR67407: 1971GG ble hoppet over → manglet helt i GT-radene).
    if (merke === 'MERC') merke = 'MERCEDES';
    if (!merkeSett.has(merke)) continue;
    if (!erFrontrute(r.varenavn, r.varenr, r.eurokode)) { ekskludert++; continue; }
    frontruteRader++;
    let p = parseVarenavn(r.varenavn, merke);
    // Berikelse (UR67407): Autoglass-navn uten år («MERCEDES SPRINTER (LAV TYPE)»)
    // mister hele varianten. Hent strukturert år fra katalogen (catalog-prod).
    if ((!p || !p.vindu || p.vindu.start == null) && r.varenr) {
      const kv = katalogVindu(r.varenr, merke);
      if (kv) {
        const eksisterende = p ?? { modell: null, utstyr: '' };
        p = { modell: eksisterende.modell, vindu: kv, utstyr: eksisterende.utstyr ?? '' };
      }
    }
    if (!p || !p.vindu || p.vindu.start == null) { utenVindu++; continue; }
    if (!p.modell) { utenVindu++; continue; }
    // Feilpris-guard (UR67407): GT-dumpen («prisliste-alle-glass.json») inneholder
    // rader som IKKE finnes i den autoritative katalogen (catalog-prod) — de er
    // feilprise/foreldede («1979PY» 625 kr / «1971PY» 695 kr, mens riktige varianter
    // er 1979C 5 320 / 1979GY 6 880 / 1971C 8 510 / 1971GG 9 510). Katalogen er
    // fasit: ekskluder GT-rader hvis varenummeret ikke finnes der (men behold
    // rader med år i varenavnet når katalogen ikke dekker dem — eldre glass).
    if (r.varenr && !katalogIndex().has(String(r.varenr).toUpperCase())) {
      // Kun ekskluder hvis katalogen DEKKER samme (merke, modell, årvindu) med
      // andre varenumre — da er dump-raden en feilpris-variant, ikke et hull.
      // Modell-sammenligning via serieKey (W901 == SPRINTER) ELLER token-prefiks.
      const gtSerie = serieKey(merke, p.modell, p.vindu.start);
      const dekkes = [...katalogIndex().values()].flat().some((k) =>
        k.start != null &&
        k.start <= (p.vindu.end ?? 9999) && (k.end == null || k.end >= p.vindu.start) &&
        (k.brand.includes(merke) || merke.includes(k.brand.replace(/[^A-ZÆØÅ]/g, '').slice(0, 4))) &&
        (
          (gtSerie != null && serieKey(merke, String(k.model ?? ''), k.start) === gtSerie) ||
          (p.modell ? String(k.model ?? '').toUpperCase().includes(String(p.modell).toUpperCase().split(' ')[0]) : true)
        )
      );
      if (dekkes) { ekskludert++; continue; }
    }
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

  // ── Karosserigrenser (Tom-godkjent 2026-08-16, Wikipedia-verifisert) ──
  // Åpne årvinduer cappes KUN ved ekte karosseriskifter — aldri ved facelift.
  // VW T-familie: T1 50-67 (katalogen), T2 1968-1979, T3 1980-1990, T4 1991-2003,
  // T5 2003-2015 (2009 = facelift T5.1→T5.2, SAMME karosseri), T6 2016-, T7 2022-.
  // Kilde: en.wikipedia.org/wiki/Volkswagen_Transporter_(T5)/(T6)/(T4) + Toms fasit.
  // Katalogen selv: 2525GYAM-kommentar «NB 09- 2980GYM HAR» → 2009-linjen er en
  // PARALLELL variant (rektangulert sensor), ikke en generasjon — aldri capp på 2009.
  const KAROSSERIGRENSER = {
    VW: {
      ord: ['TRANSP', 'CARAV', 'MULTIVAN'],
      grenser: [1968, 1980, 1991, 2003, 2016, 2022],
    },
  };
  const karosseriGrense = (merke, modell, start) => {
    const cfg = KAROSSERIGRENSER[String(merke).toUpperCase().replace(/[^A-ZÆØÅ]/g, '')];
    if (!cfg) return null;
    const ord = ordAv(modell);
    if (!ord.some((o) => cfg.ord.some((ko) => o.startsWith(ko) || ko.startsWith(o)))) return null;
    return cfg.grenser.find((g) => g > start) ?? null;
  };
  for (const [merke, modeller] of Object.entries(perMerkeModell)) {
    for (const [modell, varianter] of Object.entries(modeller)) {
      // Generasjonsslutt: eksplisitt slutt, ellers karosserigrense-tabellen
      // (VW T-familie: ekte karosseriskifter, parallell-varianter lever side om side),
      // ellers neste start i SAMME modell-streng − 1, capet av SVV-levetid.
      const starter = [...new Set(varianter.map((v) => v.start))].sort((a, b) => a - b);
      for (const v of varianter) {
        let slutt = v.end;
        if (slutt == null) {
          const kg = karosseriGrense(merke, modell, v.start);
          if (kg != null) {
            // Karosseri-tabell styrer: ingen capp ved facelift, ingen capp på tvers av
            // parallelle varianter («TRANSP+CARAVELLE 2003-» OG «2009-» → begge til 2015)
            slutt = kg - 1;
          } else {
            const egenNeste = starter.find((s) => s > v.start);
            slutt = egenNeste ? egenNeste - 1 : levetidCap(merke, modell, v.start);
          }
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
    "-- GT-generert fra glass_prisliste (source=gt-auto-prisliste) — 2026-08-15",
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

// Kjør kun main() ved direkte kjøring — ikke ved import (tester importerer erFrontrute).
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) main().catch((e) => { console.error('❌', e); process.exit(1); });
