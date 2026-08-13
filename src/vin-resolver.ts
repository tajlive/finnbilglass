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
    if (/^\d/.test(o) && o.length >= 3 && ord.length > 1) continue; // '200', '40KWH'-lignende
    if (STOPP_TOKENS.has(o)) continue;
    tokens.push(o);
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
  return tokens.some((t) => sett.has(t));
}

/** År-hint fra modellstreng («A CLASS W176 LHD 2012/ CLA CLASS» → 2012). */
function aarFraModell(model: string | null): number | null {
  const m = (model ?? '').match(/\b(19|20)\d{2}\b/);
  return m ? parseInt(m[0], 10) : null;
}

/** Prisliste-oppslag på varenr ELLER eurokode (rad_type='glass'). */
async function prisKandidat(env: Env, kode: string): Promise<ResolverKandidat | null> {
  const r = await env.FINNBILGLASS_DB.prepare(
    `SELECT varenr, varenavn, pris, eurokode FROM autoglass_prisliste
     WHERE rad_type='glass' AND (varenr = ? OR eurokode = ?) LIMIT 1`
  ).bind(kode, kode).first<{ varenr: string; varenavn: string | null; pris: number | null; eurokode: string | null }>();
  if (!r) return null;
  return {
    varenr: r.varenr,
    varenavn: r.varenavn,
    pris: tierPris(r.pris),
    listepris: r.pris,
    eurokode: r.eurokode,
    attributter: { sensor: null, antenne: null, hud: null, kamera: null, adas: null },
  };
}

function normVin(vin: string | null | undefined): string | null {
  const v = (vin ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  return v.length >= 11 ? v : null;
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

/** L1 — ground_truth: verifiserte kjøretøy → frontrute-kode (varenr i prisliste).
 *  Match: make + EKSAKT år + ordbasert modell-token (aldri substring). */
async function lagGroundTruth(env: Env, make: string, model: string, aar: number | null): Promise<ResolverKandidat[]> {
  if (aar == null) return [];
  const tokens = modellTokensAv(model, make);
  if (!tokens.length) return [];
  const rows = await env.FINNBILGLASS_DB.prepare(
    `SELECT model, frontrute_eurocode, confidence FROM ground_truth
     WHERE make = ? AND year = ?
     ORDER BY confidence DESC LIMIT 30`
  ).bind(make, aar).all<{ model: string; frontrute_eurocode: string; confidence: number }>();
  const unike = new Map<string, ResolverKandidat>();
  const eksakt = (r: { model: string }) => r.model.toUpperCase() === model;
  const sortert = [...(rows.results ?? [])].sort((a, b) => (eksakt(b) ? 1 : 0) - (eksakt(a) ? 1 : 0));
  for (const r of sortert) {
    if (!eksakt(r) && !ordTreff(r.model, tokens)) continue;
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
  const unike = new Map<string, ResolverKandidat & { flagg: number }>();
  for (const r of rows.results ?? []) {
    if (!ordTreff(r.model ?? '', tokens)) continue; // ordbasert — aldri substring
    // Årvindu: kolonne-verdier, ellers år-hint i modellstrengen
    const yf = r.year_from ?? aarFraModell(r.model);
    const yt = r.year_to;
    if (aar != null) {
      if (yf == null) continue; // ukjent generasjon → ekskluder (false positive verre enn fallback)
      if (aar < yf - 1) continue;
      if (yt != null && aar > yt + 1) continue;
    }
    const k = await prisKandidat(env, r.eurocode);
    if (!k) continue;
    const flagg = {
      sensor: r.rain_sensor === 1,
      antenne: r.antenna === 1,
      hud: r.hud === 1,
      kamera: r.camera === 1,
      adas: r.adas === 1,
    };
    const nøkkel = k.eurokode ?? k.varenr;
    if (!unike.has(nøkkel)) unike.set(nøkkel, { ...k, attributter: flagg, flagg: 0 });
    // Behold rikeste attributt-info (senere rad kan ha flagg satt)
    const eks = unike.get(nøkkel)!;
    if (flagg.sensor || flagg.antenne || flagg.hud || flagg.kamera || flagg.adas) {
      unike.set(nøkkel, { ...k, attributter: flagg, flagg: eks.flagg });
    }
  }
  let liste = [...unike.values()].map(({ flagg: _f, ...rest }) => rest);
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

/** Felles utfalls-logikk: 0 → FALLBACK, 1 → PINPOINT, 2+ → VERIFY. */
function utfraKandidater(kandidater: ResolverKandidat[], lag: string, confidence: number): ResolverResultat | null {
  if (kandidater.length === 0) return null;
  if (kandidater.length === 1) {
    const k = kandidater[0];
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
    };
  }
  return {
    utfall: 'VERIFY',
    grunn: `L${lag}: ${kandidater.length} varianter — utstyr må verifiseres`,
    confidence: Math.min(confidence, 0.5),
    kandidater: kandidater.slice(0, 6),
  };
}

/** Hovedresolver: bil → PINPOINT / VERIFY / FALLBACK. */
export async function resolveFrontrute(env: Env, bil: BilInput): Promise<ResolverResultat> {
  const make = normBrand(bil.merke);
  const model = (bil.modell ?? '').trim().toUpperCase();

  // L0 — eksakt VIN-overstyring for manuelt verifiserte fasitbiler
  let kand = await lagVinOverride(env, bil.vin);
  let res = utfraKandidater(kand, '0 (vin_glass_overrides)', 0.95);
  if (res) return res;

  // L1 — ground_truth (verifiserte kjøretøy)
  kand = await lagGroundTruth(env, make, model, bil.aar ?? null);
  res = utfraKandidater(kand, '1 (ground_truth)', 0.85);
  if (res) return res;

  // L2 — Pilkington-katalog
  kand = await lagPilkington(env, make, model, bil.aar ?? null, bil.profil);
  res = utfraKandidater(kand, '2 (glass_catalog)', 0.7);
  if (res) return res;

  // L3 — ktype (kun når data finnes)
  kand = await lagKtype(env, make, model, bil.aar ?? null);
  res = utfraKandidater(kand, '3 (ktype)', 0.75);
  if (res) return res;

  return { utfall: 'FALLBACK', grunn: 'ingen resolver-data — tekstmatcher overtar', confidence: 0 };
}
