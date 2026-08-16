/**
 * OE/VIN-pinpoint-resolver (finnbilglass, Fase 2).
 *
 * Tre eksplisitte utfall:
 *   PINPOINT — nøyaktig ETT salgbart glass for kjøretøyet.
 *   VERIFY   — 2+ kandidater (utstyrsvarianter) — kunden må verifisere.
 *   FALLBACK — ingen resolver-data — eksisterende tekstmatcher overtar.
 *
 * Doktrine (Tom 2026-08-13): ALDRI tving tvetydige biler til PINPOINT.
 * False positive er verre enn fallback.
 *
 * Lag (i rekkefølge, alle leser fra lokale tabeller — alternativ A):
 *   L1 ground_truth  — verifiserte kjøretøy → frontrute (auto-glass.no, 92 % i prisliste)
 *   L2 glass_catalog — Pilkington brand/modell/år + utstyrsflagg (Pilkington-dump)
 *   L3 ktype         — ktype_registry → glass_catalog.ktype (aktiv når B2B-live-data finnes)
 *   L4 FALLBACK      — matchFrontrute (eksisterende, uendret)
 */
import type { BilInput } from './matcher';
import { tierPris } from './matcher';
import { matcherAar, parseAar } from './aar-parser';
import { serieKey, normaliserKatalogModell } from './serie-mapping';
import { dekodeEurokode, type Dekodet } from './eurokode-dekoder';

export type ResolverUtfall = 'PINPOINT' | 'VERIFY' | 'FALLBACK';

export interface ResolverKandidat {
  varenr: string;
  varenavn: string | null;
  pris: number | null;      // sluttpris (tier), samme regel som matcher
  listepris: number | null;
  eurokode: string | null;
  attributter: {
    sensor: boolean | null;
    antenne: boolean | null;
    hud: boolean | null;
    kamera: boolean | null;
    adas: boolean | null;
    coated: boolean | null;
  };
}

export interface ResolverResultat {
  utfall: ResolverUtfall;
  grunn: string;            // sporbarhet: lag + kontekst
  confidence: number;
  varenr?: string;
  varenavn?: string | null;
  pris?: number | null;     // sluttpris (tier)
  listepris?: number | null;
  eurokode?: string | null;
  kandidater?: ResolverKandidat[];
  /** Spørsmål som FAKTISK skiller kandidatene (VERIFY) — tom liste = ingen spørsmål nødvendig. */
  sporsmaal?: string[];
}

interface Env { FINNBILGLASS_DB: D1Database }

/** Merke-aliaser (SVV/B2C-navn ↔ B2B-katalognavn). */
const BRAND_ALIAS: Record<string, string> = {
  VOLKSWAGEN: 'VW',
  'VW TRUCKS': 'VW',
  'MERCEDES-BENZ': 'MERCEDES',
  'MERCEDES BENZ': 'MERCEDES',
  'MERCEDES TRUCKS': 'MERCEDES',
  'OPEL VAUXHALL': 'OPEL',
  'FIAT TRUCKS': 'FIAT',
  'FORD TRUCKS': 'FORD',
  'IVECO TRUCKS': 'IVECO',
  'RENAULT TRUCKS': 'RENAULT',
  'PEUGEOT TRUCKS': 'PEUGEOT',
  'CITROEN TRUCKS': 'CITROEN',
  'NISSAN COMMERCIAL': 'NISSAN',
  'TOYOTA COMMERCIAL': 'TOYOTA',
  'SCANIA TRUCKS': 'SCANIA',
  'MAN TRUCKS': 'MAN',
  'VOLVO TRUCKS': 'VOLVO',
  'DAF TRUCKS': 'DAF',
  'MG MOTOR': 'MG',
};

const MODEL_TOKEN_ALIAS: Record<string, string[]> = {
  CARAVELLE: ['CARAV'],
  TRANSPORTER: ['TRANSP'],
  MULTIVAN: ['MULTI'],
};

function normBrand(merke: string): string {
  const m = (merke || '').trim().toUpperCase();
  return BRAND_ALIAS[m] ?? m;
}

/** Tokens som ikke skiller glass-varianter (drivverk, utstyrsmarkører, generiske ord). */
const STOPP_TOKENS = new Set([
  'CLASS', 'SERIE', 'SERIES', 'LHD', 'RHD', 'AUTOMATIKK', 'AUTOMATIC', 'KOMBI', 'LIMITED',
  'SPORT', 'STYLE', 'TURBO', 'TDI', 'CDI', 'TFSI', 'TSI', 'TFSIE', '4MATIC', 'XDRIVE',
  'SDRIVE', 'BLUETEC', 'DIESEL', 'GTD', 'GTE', 'GTI', 'AMG', 'ACTIVE', 'DYNAMIC', 'TREND',
  'COMFORT', 'LIFE', 'PASSION', 'BASIC', 'EXECUTIVE', 'R-LINE', 'S-LINE', 'PREMIUM', 'BENZ',
]);

/** Signifikante modell-tokens: ≥2 tegn, ikke tall-dominert, ikke i stopp-liste, ikke merkenavnet. */
function modellTokensAv(modell: string, merke: string): string[] {
  const merkeNorm = normBrand(merke).replace(/[^A-ZÆØÅ0-9]+/g, '');
  const ord = (modell || '').toUpperCase().replace(/[^A-ZÆØÅ0-9]+/g, ' ').split(/\s+/).filter(Boolean);
  const tokens: string[] = [];
  for (const o of ord) {
    if (o.length < 2) continue;
    if (o === merkeNorm) continue;
    if (/^\d+$/.test(o) && o.length >= 3 && ord.length > 1) continue; // '200'-lignende trim/motor
    if (/^\d+(KW|KWH)$/.test(o)) continue; // effekt/batteri er ikke glassmodell
    if (STOPP_TOKENS.has(o)) continue;
    tokens.push(o);
    tokens.push(...(MODEL_TOKEN_ALIAS[o] ?? []));
  }
  return [...new Set(tokens)];
}

function escLike(s: string): string {
  return s.replace(/[%_]/g, '\\$&');
}

/** Ord-tokens (≥2 tegn) for ordbasert matching — aldri substring (unngår «CLA» ⊂ «CLASS»). */
function ordTokensAv(s: string): Set<string> {
  return new Set(
    (s || '').toUpperCase().replace(/[^A-ZÆØÅ0-9]+/g, ' ').split(/\s+/)
      .filter((t) => t.length >= 2)
  );
}
function ordTreff(model: string, tokens: string[]): boolean {
  if (!tokens.length) return false;
  const sett = ordTokensAv(model);
  return tokens.some((t) => {
    if (sett.has(t)) return true;
    if (t.length < 4) return false;
    for (const ord of sett) {
      if (ord.length >= 4 && (ord.startsWith(t) || t.startsWith(ord))) return true;
    }
    return false;
  });
}

function modellAarIntervall(model: string | null): { start: number; slutt: number } | null {
  const intervall = parseAar(model);
  if (intervall) return intervall;
  const m = (model ?? '').match(/\b(19|20)\d{2}\b/);
  return m ? { start: parseInt(m[0], 10), slutt: Infinity } : null;
}

/** Ikke-frontrute-keywords (samme liste som scripts/gt-generator.mjs sin erFrontrute,
 *  pluss svenske varianter og pakning — sett i faktiske katalogdata).
 *  Ordgrense-lookaround forhindrer substring-falske positiver:
 *  «VENT» må IKKE treffe «VENTURE»/«VENTO», «HATCH» må IKKE treffe «HATCHBACK». */
const IKKE_FRONTRUTE = ['DØRRUTE', 'DORRUTE', 'SIDERUTE', 'SIDORUTE', 'SIDORUTA', 'SIDERUTA', 'BAKRUTE', 'BAGRUTE',
  'BACKLITE', 'SUNROOF', 'SOLTAK', 'HATCH', 'TAKLUKE', 'TAKRUTE', 'PANORAMA', 'REAR', 'QUARTER', 'VENT',
  'PYNTELIST', 'GUMMILIST', 'KLIPS', 'PAKNING'];
const IKKE_FRONTRUTE_RE = new RegExp(`(?<![A-ZÆØÅ0-9])(${IKKE_FRONTRUTE.join('|')})(?![A-ZÆØÅ0-9])`);

/** Er raden en FRONTRUTE-kandidat? Samme doktrine som gt-generator.mjs: avvis KUN klare
 *  ikke-frontrute-signaler (bak/side/dør/ventil-posisjon, takglass/keywords, side-glass-varenr
 *  L/R etter 3–5-sifret prefiks). 2-sifrede veteran-koder og OEM-delnummer uten side/bak-markør
 *  faller gjennom som frontrute-kandidater (aldri false-negative — Tom-doktrine). */
function erFrontrute(varenavn: string | null, varenr: string, dek: Dekodet): boolean {
  const n = (varenavn ?? '').toUpperCase();
  if (IKKE_FRONTRUTE_RE.test(n)) return false;
  if (/^\d{3,5}[LR]/.test(varenr)) return false; // side-glass-varenr (8103LGAR5, 26270LFWXBYN)
  if (dek.posisjon && dek.posisjon !== 'frontrute') return false; // bak/side/dør/ventil
  return true; // frontrute-posisjon ELLER ukjent (veteran/OEM) → kandidat
}

/** Prisliste-oppslag på varenr ELLER eurokode (rad_type='glass'), frontrute-gated.
 *  Attributter: eurokode-dekoder er autoritativ for A/M/C/H (Tom 2026-08-13);
 *  glass_catalog brukes KUN for kamera/adas (ikke kodet i eurokoden). Ikke-frontrute
 *  (bak/side/dør/takglass) og OEM-delnummer uten FRONTR-markør returnerer null. */
async function prisKandidat(env: Env, kode: string): Promise<ResolverKandidat | null> {
  const r = await env.FINNBILGLASS_DB.prepare(
    `SELECT varenr, varenavn, pris, eurokode FROM glass_prisliste
     WHERE rad_type='glass' AND (varenr = ? OR eurokode = ?) LIMIT 1`
  ).bind(kode, kode).first<{ varenr: string; varenavn: string | null; pris: number | null; eurokode: string | null }>();
  if (!r) return null;

  const dek = dekodeEurokode(r.eurokode);
  if (!erFrontrute(r.varenavn, r.varenr, dek)) return null; // bak/side/dør/takglass

  const attributter: ResolverKandidat['attributter'] = { sensor: null, antenne: null, hud: null, kamera: null, adas: null, coated: null };

  // Attributter: eurokode-dekoder er autoritativ for A/M/C/H (Tom 2026-08-13),
  // men KUN når koden faktisk er en eurokode (gyldig posisjonsbokstav). OEM-delnummer
  // (f.eks. VW 7H0877051) har posisjon=null — da er A/M/C/H ukjent (null), ikke false.
  if (dek.posisjon) {
    const eg = dek.egenskaper;
    attributter.sensor  = eg.includes('sensor');
    attributter.antenne = eg.includes('antenne');
    attributter.hud     = eg.includes('oppvarmet');
    attributter.coated  = eg.includes('coated');
  }

  // glass_catalog kun for kamera + adas (ikke kodet i eurokoden)
  if (r.eurokode) {
    const f = await env.FINNBILGLASS_DB.prepare(
      `SELECT camera, adas FROM glass_catalog WHERE eurocode = ? LIMIT 1`
    ).bind(r.eurokode).first<{ camera: number | null; adas: number | null }>();
    if (f) {
      attributter.kamera = f.camera == null ? null : f.camera === 1;
      attributter.adas   = f.adas   == null ? null : f.adas   === 1;
    }
  }

  return {
    varenr: r.varenr,
    varenavn: r.varenavn,
    pris: tierPris(r.pris),
    listepris: r.pris,
    eurokode: r.eurokode,
    attributter,
  };
}

/** Spørsmål som FAKTISK skiller kandidatene: felt der minst én kandidat har true OG minst én har false.
 *  Ukjente verdier (null) teller ikke — vi spør aldri om ting vi ikke kan skille på. */
export function skillendeSporsmaal(kandidater: ResolverKandidat[]): string[] {
  const felt: Array<keyof ResolverKandidat['attributter']> = ['sensor', 'antenne', 'hud', 'kamera', 'adas', 'coated'];
  const ut: string[] = [];
  for (const f of felt) {
    const verdier = kandidater.map((k) => k.attributter[f]).filter((v): v is boolean => typeof v === 'boolean');
    if (verdier.some((v) => v) && verdier.some((v) => !v)) ut.push(f);
  }
  return ut;
}

function normVin(vin: string | null | undefined): string | null {
  const v = (vin ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  return v.length >= 11 ? v : null;
}

/** VIN-posisjon 10 → FAKTISK modellår (fabrikkåret). SVV gir kun norsk registreringsdato —
 *  importbiler registrert år X kan være modellår X−n, og katalog-/GT-år er modellårsbasert.
 *  Standard VIN-årskoder: 1980–2000 = A–Y (uten I/O/Q/U/Z), 2001–2009 = 1–9, 2010+ = A–Y igjen.
 *  hintAar (registreringsåret) disambiguerer syklusene (A = 1980 eller 2010). */
export function vinModelYear(vin: string | null | undefined, hintAar: number | null | undefined): number | null {
  const v = (vin ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (v.length < 11) return null;
  const c = v.charAt(9); // posisjon 10 (1-indeksert)
  if (/^[1-9]$/.test(c)) return 2000 + parseInt(c, 10); // 2001–2009
  const BOKSTAV: Record<string, number> = {
    A: 0, B: 1, C: 2, D: 3, E: 4, F: 5, G: 6, H: 7, J: 8, K: 9, L: 10, M: 11, N: 12,
    P: 13, R: 14, S: 15, T: 16, V: 17, W: 18, X: 19, Y: 20,
  };
  const offset = BOKSTAV[c];
  if (offset == null) return null;
  const aar80 = offset + 1980; // 1980–2000
  const aar10 = offset + 2010; // 2010–2030
  if (hintAar != null) {
    return Math.abs(hintAar - aar80) <= Math.abs(hintAar - aar10) ? aar80 : aar10;
  }
  // Uten hint: moderne bilpark dominerer — velg 2010+-syklusen hvis den er rimelig.
  return aar10 <= new Date().getUTCFullYear() + 2 ? aar10 : aar80;
}

/** L0 — eksakt VIN-fasit. Kun manuelt verifiserte overstyringer. */
async function lagVinOverride(env: Env, vin: string | null | undefined): Promise<ResolverKandidat[]> {
  const v = normVin(vin);
  if (!v) return [];
  const rows = await env.FINNBILGLASS_DB.prepare(
    `SELECT eurocode FROM vin_glass_overrides
     WHERE vin = ?
     ORDER BY confidence DESC
     LIMIT 5`
  ).bind(v).all<{ eurocode: string }>();
  const unike = new Map<string, ResolverKandidat>();
  for (const r of rows.results ?? []) {
    const k = await prisKandidat(env, r.eurocode);
    if (k && !unike.has(k.varenr)) unike.set(k.varenr, k);
  }
  return [...unike.values()];
}

/** GT-radens serie-kode — begge veier: direkte kode i navnet («GOLF IV», «W204»,
 *  «F56») ELLER utledet fra (merke, GT-modell-navn, år) som SVV-modell
 *  («1 HBK» 2007 → E81 — seed-rader uten kode får generasjonskoden sin). */
function gtSerieFor(make: string, gtModell: string, aar: number | null): string | null {
  const direkte = normaliserKatalogModell(gtModell);
  if (direkte) return direkte;
  return serieKey(make, gtModell, aar);
}

/** Alla GT-eurokoder for et kjøretøy (inkl. de uten prislistetreff) — fasit-settet.
 *  Brukes for å gate PINPOINT fra L2/L3: kandidaten MÅ bekreftes av ground_truth.
 *  Serie-mapping: Mercedes W-koder («C 180 CDI» 2013 → W204), BMW E/F/G-koder
 *  («525D» 2001 → E39), VW-generasjoner («GOLF» 2005 → GOLF V), Opel-bokstaver,
 *  MINI R/F-koder, Nissan P/K/N, Toyota MK/J-serier — matches mot GT-rader
 *  nøklet med samme serie-kode (begge veier, se gtSerieFor). */
async function gtEurokoderSett(env: Env, make: string, model: string, aarList: number[]): Promise<Set<string> | null> {
  if (!aarList.length) return null;
  const tokens = modellTokensAv(model, make);
  const serie = serieKey(make, model, aarList[0]);
  if (!tokens.length && !serie) return null;
  const plasser = aarList.map(() => '?').join(',');
  const rows = await env.FINNBILGLASS_DB.prepare(
    `SELECT model, frontrute_eurocode FROM ground_truth
     WHERE make = ? AND year IN (${plasser})
     ORDER BY model LIMIT 200`
  ).bind(make, ...aarList).all<{ model: string; frontrute_eurocode: string }>();
  const eksakt = (r: { model: string }) => r.model.toUpperCase() === model;
  const sortert = [...(rows.results ?? [])].sort((a, b) => (eksakt(b) ? 1 : 0) - (eksakt(a) ? 1 : 0));
  const sett = new Set<string>();
  for (const r of sortert) {
    const gtSerie = gtSerieFor(make, r.model, aarList[0]);
    const serieMatch = !!serie && !!gtSerie && gtSerie === serie;
    if (!eksakt(r) && !ordTreff(r.model, tokens) && !serieMatch) continue;
    sett.add(String(r.frontrute_eurocode ?? '').toUpperCase().replace(/[^A-Z0-9]/g, ''));
  }
  return sett.size ? sett : null;
}

/** L1 — ground_truth: verifiserte kjøretøy → frontrute-kode (varenr i prisliste).
 *  Match: make + EKSAKT år + ordbasert modell-token (aldri substring)
 *  ELLER serie-kode-match (Mercedes W204 / BMW E39 / VW GOLF V / …).
 *  aarList: prioriterte år (VIN-modellåret først, registreringsåret som fallback) —
 *  GT-rader kan være nøklet på begge, og VIN-korreksjon må aldri MISTE GT-treff. */
async function lagGroundTruth(env: Env, make: string, model: string, aarList: number[]): Promise<ResolverKandidat[]> {
  if (!aarList.length) return [];
  const tokens = modellTokensAv(model, make);
  const serie = serieKey(make, model, aarList[0]);
  if (!tokens.length && !serie) return [];
  const plasser = aarList.map(() => '?').join(',');
  const rows = await env.FINNBILGLASS_DB.prepare(
    `SELECT model, frontrute_eurocode, confidence FROM ground_truth
     WHERE make = ? AND year IN (${plasser})
     ORDER BY confidence DESC, model ASC LIMIT 200`
  ).bind(make, ...aarList).all<{ model: string; frontrute_eurocode: string; confidence: number }>();
  const unike = new Map<string, ResolverKandidat>();
  const eksakt = (r: { model: string }) => r.model.toUpperCase() === model;
  const sortert = [...(rows.results ?? [])].sort((a, b) => (eksakt(b) ? 1 : 0) - (eksakt(a) ? 1 : 0));
  for (const r of sortert) {
    const gtSerie = gtSerieFor(make, r.model, aarList[0]);
    const serieMatch = !!serie && !!gtSerie && gtSerie === serie;
    if (!eksakt(r) && !ordTreff(r.model, tokens) && !serieMatch) continue;
    const k = await prisKandidat(env, r.frontrute_eurocode);
    if (k && !unike.has(k.varenr)) unike.set(k.varenr, k);
  }
  return [...unike.values()];
}

/** L2 — glass_catalog (Pilkington): brand + ordbasert modell-token + år + utstyrsflagg.
 *  År-regel når bilens år er kjent: kandidatens vindu (kolonne ELLER modellstreng) må
 *  være kjent og inneholde året — ellers ekskluderes (unngår feil generasjon). */
async function lagPilkington(env: Env, make: string, model: string, aar: number | null, profil: BilInput['profil']): Promise<ResolverKandidat[]> {
  const tokens = modellTokensAv(model, make).slice(0, 4);
  if (!tokens.length) return [];
  const like = tokens.map(() => 'model LIKE ?').join(' OR ');
  const params: (string | number)[] = [make, ...tokens.map((t) => `%${escLike(t)}%`)];
  const rows = await env.FINNBILGLASS_DB.prepare(
    `SELECT eurocode, brand, model, year_from, year_to, rain_sensor, antenna, hud, camera, adas, description
     FROM glass_catalog
     WHERE brand = ? AND category IN ('frontrute','annet') AND (${like})
     LIMIT 50`
  ).bind(...params).all<{
    eurocode: string; brand: string; model: string | null; year_from: number | null; year_to: number | null;
    rain_sensor: number | null; antenna: number | null; hud: number | null; camera: number | null; adas: number | null; description: string | null;
  }>();
  const unike = new Map<string, ResolverKandidat>();
  for (const r of rows.results ?? []) {
    if (!ordTreff(r.model ?? '', tokens)) continue; // ordbasert — aldri substring
    // Årvindu: kolonne-verdier, ellers år-hint i modellstrengen
    if (aar != null) {
      const intervall = r.year_from != null
        ? { start: r.year_from, slutt: r.year_to ?? Infinity }
        : modellAarIntervall(r.model);
      if (!intervall) continue; // ukjent generasjon → ekskluder (false positive verre enn fallback)
      if (!matcherAar({ start: intervall.start - 1, slutt: intervall.slutt === Infinity ? Infinity : intervall.slutt + 1 }, aar)) continue;
    }
    const k = await prisKandidat(env, r.eurocode);
    if (!k) continue;
    // prisKandidat gir allerede korrekte attributter (eurokode-dekoder for A/M/C/H,
    // glass_catalog kun for kamera/adas) — IKKE overstyr med glass_catalog-flagg her
    // (glass_catalog har feil/manglende antenna/rain_sensor for 57 %+ av radene).
    const nøkkel = k.eurokode ?? k.varenr;
    if (!unike.has(nøkkel)) unike.set(nøkkel, k);
  }
  let liste = [...unike.values()];
  // Utstyrsfiltrering: profil-flagg → kun kandidater som matcher (ukjente flagg straffes ikke)
  const p = profil ?? {};
  const aktiv: Array<keyof ResolverKandidat['attributter']> = [];
  if (p.sensor) aktiv.push('sensor');
  if (p.antenne) aktiv.push('antenne');
  if (liste.length > 1 && aktiv.length) {
    const matcher = liste.filter((k) => aktiv.every((a) => k.attributter[a] !== false));
    const positive = liste.filter((k) => aktiv.some((a) => k.attributter[a] === true));
    if (matcher.length === 1) liste = matcher;
    else if (matcher.length > 1 && positive.length === 1 && aktiv.every((a) => positive[0].attributter[a] === true)) liste = positive;
  }
  return liste;
}

/** L3 — ktype: ktype_registry → glass_catalog.ktype → eurokoder (klar, tom lokal). */
async function lagKtype(env: Env, make: string, model: string, aar: number | null): Promise<ResolverKandidat[]> {
  const tokens = modellTokensAv(model, make).slice(0, 4);
  if (!tokens.length) return [];
  const like = tokens.map(() => 'model LIKE ?').join(' OR ');
  const params: (string | number)[] = [make, ...tokens.map((t) => `%${escLike(t)}%`)];
  const reg = await env.FINNBILGLASS_DB.prepare(
    `SELECT ktype, model FROM ktype_registry WHERE brand = ? AND (${like}) LIMIT 20`
  ).bind(...params).all<{ ktype: string; model: string }>();
  const ktypes = [...new Set((reg.results ?? []).filter((r) => ordTreff(r.model, tokens)).map((r) => r.ktype))];
  if (!ktypes.length) return [];
  const unike = new Map<string, ResolverKandidat>();
  for (let i = 0; i < ktypes.length; i += 40) {
    const batch = ktypes.slice(i, i + 40);
    const plasser = batch.map(() => '?').join(',');
    const rows = await env.FINNBILGLASS_DB.prepare(
      `SELECT eurocode FROM glass_catalog WHERE ktype IN (${plasser}) AND category IN ('frontrute','annet') LIMIT 20`
    ).bind(...batch).all<{ eurocode: string }>();
    for (const r of rows.results ?? []) {
      const k = await prisKandidat(env, r.eurocode);
      if (k && !unike.has(k.varenr)) unike.set(k.varenr, k);
    }
  }
  return [...unike.values()];
}

/** L3T — lisensiert TecDoc: VIN → kType → canonical vehicle linkage.
 *
 * VIN-koblingen må være minst 0,90. Ett eneste kompatibelt glass gir fortsatt
 * VERIFY inntil OEM/build- eller feature-bevis finnes; kType alene beskriver
 * bilvarianten, ikke nødvendigvis fabrikkens komplette ruteutstyr.
 */
async function lagTecdocKtype(env: Env, vin: string | null | undefined): Promise<ResolverKandidat[]> {
  const v = normVin(vin);
  if (!v) return [];
  const map = await env.FINNBILGLASS_DB.prepare(
    `SELECT ktype FROM vin_ktype_map
     WHERE vin = ? AND confidence >= 0.90 AND source LIKE 'tecdoc:%'
     LIMIT 2`
  ).bind(v).all<{ ktype: string }>();
  const ktypes = [...new Set((map.results ?? []).map((row) => row.ktype))];
  if (ktypes.length !== 1) return [];
  const rows = await env.FINNBILGLASS_DB.prepare(
    `SELECT DISTINCT gm.eurocode
     FROM glass_vehicle_links AS link
     JOIN glass_master AS gm ON gm.id = link.glass_id
     WHERE link.ktype = ? AND link.is_current = 1
       AND gm.is_current = 1 AND gm.status = 'active'
     LIMIT 20`
  ).bind(ktypes[0]).all<{ eurocode: string | null }>();
  const unike = new Map<string, ResolverKandidat>();
  for (const row of rows.results ?? []) {
    if (!row.eurocode) continue;
    const kandidat = await prisKandidat(env, row.eurocode);
    if (kandidat && !unike.has(kandidat.varenr)) unike.set(kandidat.varenr, kandidat);
  }
  return [...unike.values()];
}

/** Felles utfalls-logikk: 0 → FALLBACK, 1 → PINPOINT (med GT-gate), 2+ → VERIFY.
 *  GT-gate (G1-doktrine): PINPOINT krever at kandidaten bekreftes av ground_truth —
 *  unntak: L0 (manuell VIN-fasit) og L1 (GT er selv kilden). */
function utfraKandidater(kandidater: ResolverKandidat[], lag: string, confidence: number, gtSett: Set<string> | null = null): ResolverResultat | null {
  if (kandidater.length === 0) return null;
  if (kandidater.length === 1) {
    const k = kandidater[0];
    const gtOk = lag.startsWith('0 ') || lag.startsWith('1 ') || (gtSett && k.eurokode && gtSett.has(k.eurokode.toUpperCase().replace(/[^A-Z0-9]/g, '')));
    if (!gtOk) {
      return {
        utfall: 'VERIFY',
        grunn: `L${lag}: 1 kandidat, men ikke bekreftet av ground_truth — utstyr må verifiseres`,
        confidence: Math.min(confidence, 0.5),
        kandidater: [k],
        sporsmaal: skillendeSporsmaal([k]),
      };
    }
    return {
      utfall: 'PINPOINT',
      grunn: `L${lag}: entydig treff (${kandidater.length} kandidat)`,
      confidence,
      varenr: k.varenr,
      varenavn: k.varenavn,
      pris: k.pris,
      listepris: k.listepris,
      eurokode: k.eurokode,
      kandidater: [k],
      sporsmaal: [],
    };
  }
  return {
    utfall: 'VERIFY',
    grunn: `L${lag}: ${kandidater.length} varianter — utstyr må verifiseres`,
    confidence: Math.min(confidence, 0.5),
    kandidater: kandidater.slice(0, 6),
    sporsmaal: skillendeSporsmaal(kandidater.slice(0, 6)),
  };
}

/** Hovedresolver: bil → PINPOINT / VERIFY / FALLBACK. */
export async function resolveFrontrute(env: Env, bil: BilInput): Promise<ResolverResultat> {
  const make = normBrand(bil.merke);
  const model = (bil.modell ?? '').trim().toUpperCase();
  // Faktisk modellår fra VIN (pos 10) vinner over registreringsåret: SVV gir kun norsk
  // registreringsdato, så importbiler registrert senere enn modellåret fikk feil generasjon.
  const aarVin = vinModelYear(bil.vin, bil.aar);
  const aar = aarVin ?? bil.aar ?? null;
  // GT-oppslag prøver begge år (VIN-året først, registreringsåret som fallback) —
  // GT-rader kan være nøklet på enten, og VIN-korreksjon må aldri miste GT-treff.
  const aarList = aar == null ? [] : [...new Set([aar, ...(bil.aar != null ? [bil.aar] : [])])];

  // L0 — eksakt VIN-overstyring for manuelt verifiserte fasitbiler
  let kand = await lagVinOverride(env, bil.vin);
  let res = utfraKandidater(kand, '0 (vin_glass_overrides)', 0.95);
  if (res) return res;

  // L1 — ground_truth (verifiserte kjøretøy)
  kand = await lagGroundTruth(env, make, model, aarList);
  res = utfraKandidater(kand, '1 (ground_truth)', 0.85);
  if (res) return res;

  // GT-fasit-settet for kjøretøyet (gate for L2/L3-PINPOINT — G1-doktrine)
  const gtSett = await gtEurokoderSett(env, make, model, aarList);

  // L3T — lisensiert TecDoc Vehicle Identification + parts linkage.
  // Ktype alene kan aldri overstyre feature-/OEM-gaten for PINPOINT.
  kand = await lagTecdocKtype(env, bil.vin);
  res = utfraKandidater(kand, '3T (TecDoc VIN→KType)', 0.9, gtSett);
  if (res) return res;

  // L2 — Pilkington-katalog
  kand = await lagPilkington(env, make, model, aar, bil.profil);
  res = utfraKandidater(kand, '2 (glass_catalog)', 0.7, gtSett);
  if (res) return res;

  // L3 — ktype (kun når data finnes)
  kand = await lagKtype(env, make, model, aar);
  res = utfraKandidater(kand, '3 (ktype)', 0.75, gtSett);
  if (res) return res;

  return { utfall: 'FALLBACK', grunn: 'ingen resolver-data — tekstmatcher overtar', confidence: 0 };
}
