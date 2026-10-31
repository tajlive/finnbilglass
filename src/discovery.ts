import { normBrand, modellTokensAv, ordTreff } from './vin-resolver';
import { LAVESTE_SITERBARE_LISTEPRIS } from './pricing/nok-prising';

/** Katalogen bruker kortformen (VW, ikke Volkswagen). Gjenbruker
 *  merke-aliasene fra resolveren saa /api/glass og kundereisen
 *  forstaar samme navn. */
function normaliserMerke(merke: string): string {
  return normBrand(merke);
}

/** Discovery: find front-rute candidates with pagination, canonical URL and stable SKU identifiers */
export interface Kandidat {
  varenr: string;
  varenavn: string;
  eurokode: string;
  typeCode?: string;
  side?: 'frontrute' | 'bakrute' | 'dor' | 'side';
  /** Canonical URL for deduplication */
  canonicalUrl?: string;
  /** SKU fingerprint for dedup */
  skuFingerprint?: string;
  /** Listepris i NOK fra glass_prisliste. Intern — eksponeres aldri direkte. */
  pris?: number | null;
  /** Fitment-status. Katalogsøk setter aldri BEKREFTET — det krever evidens. */
  kompatibilitet?: 'BEKREFTET' | 'KATALOGTREFF';
}

/**
 * Discovery result with pagination support.
 */
export interface DiscoveryResult {
  candidates: Kandidat[];
  /** Total available candidates (may be more than returned) */
  totalAvailable: number;
  /** Next page cursor for pagination, or null if no more */
  nextCursor?: string;
  /** Whether there are more pages available */
  hasMore: boolean;
  /** Hvilken kilde kandidatene kom fra. 'ground_truth' = fasit, 'tekst' = fallback. */
  kilde?: 'ground_truth' | 'tekst';
}

/** Kolonner som garantert finnes i både prod- og staging-prislista. */
const SLANKE_KOLONNER = ['varenr', 'varenavn', 'kommentar', 'pris', 'eurokode', 'alias_av', 'rad_type'];
/** Prod har også typeCode/side. Prøves først, faller tilbake til slank form. */
const FULLE_KOLONNER = [...SLANKE_KOLONNER, 'typeCode', 'side'];

const GT_KODE_MAKS = 60;
const SIDE_STORRELSE = 20;

type Rad = {
  varenr: string;
  varenavn: string;
  kommentar?: string | null;
  pris?: number | null;
  eurokode?: string | null;
  alias_av?: string | null;
  rad_type?: string | null;
  typeCode?: string | null;
  side?: string | null;
};

function tilKandidat(r: Rad): Kandidat {
  return {
    varenr: r.varenr,
    varenavn: r.varenavn,
    eurokode: r.eurokode ?? '',
    typeCode: r.typeCode ?? undefined,
    side: (r.side as Kandidat['side']) ?? undefined,
    canonicalUrl: `https://finnbilglass.no/glas/${r.varenr}`,
    skuFingerprint: `${r.eurokode}-${r.varenr}`,
    pris: typeof r.pris === 'number' ? r.pris : null,
  };
}

/**
 * L1: fasit-koder fra ground_truth for merke + modell + EKSAKT år.
 *
 * Ground truth er verifiserte kjøretøy → frontrute (auto-glass.no). Den er den
 * eneste kilden som faktisk vet at «TOYOTA C-HR 2018» har disse rutene —
 * fritekstsøk i prislista gjør det ikke. Derfor prøves GT først.
 *
 * Uten år returneres koder fra alle år (kunden får da utvalg, aldri påstand
 * om kompatibilitet).
 */
async function gtFrontruteKoder(
  env: { FINNBILGLASS_DB: any },
  merke: string,
  modell: string,
  aar?: number
): Promise<string[]> {
  const tokens = modellTokensAv(modell || '', merke);
  if (!tokens.length) return [];
  const like = tokens.map(() => 'model LIKE ?').join(' OR ');
  const params: (string | number)[] = [merke, ...tokens.map((t) => `%${t}%`)];
  let sql = `SELECT model, frontrute_eurocode FROM ground_truth WHERE make = ? AND (${like})`;
  if (aar) {
    sql += ' AND year = ?';
    params.push(aar);
  }
  sql += ' ORDER BY confidence DESC LIMIT 300';
  const rows = await env.FINNBILGLASS_DB.prepare(sql).bind(...params).all();
  const koder = new Set<string>();
  for (const r of rows.results ?? []) {
    // Ordbasert modellkontroll — aldri substring.
    if (!ordTreff(r?.model ?? '', tokens)) continue;
    const kode = r?.frontrute_eurocode;
    if (typeof kode === 'string' && kode.trim()) koder.add(kode.trim());
  }
  return [...koder].slice(0, GT_KODE_MAKS);
}

/** Henter prisliste-rader for eksakte GT-koder. Navnet på raden avgjør ikke om
 *  det er en frontrute — koden er identiteten. Dette er grunnen til at
 *  «TOYOTA C-HR 5D CROSSOVER 16-» (uten ordet FRONTRUTE) nå blir funnet. */
async function raderForKoder(env: { FINNBILGLASS_DB: any }, koder: string[]): Promise<Rad[]> {
  if (!koder.length) return [];
  const plasser = koder.map(() => '?').join(',');
  const likePlasser = koder.map(() => 'eurokode LIKE ?').join(' OR ');
  const bygg = (kolonner: string[]) =>
    `SELECT ${kolonner.join(', ')}
       FROM glass_prisliste
      WHERE rad_type='glass'
        AND (varenr IN (${plasser}) OR eurokode IN (${plasser}) OR ${likePlasser})
      ORDER BY (pris IS NULL), (pris < ?), pris`;
  const bind = () => [...koder, ...koder, ...koder.map((k) => `${k}%`), LAVESTE_SITERBARE_LISTEPRIS];

  try {
    const r = await env.FINNBILGLASS_DB.prepare(bygg(FULLE_KOLONNER)).bind(...bind()).all();
    return r.results ?? [];
  } catch {
    const r = await env.FINNBILGLASS_DB.prepare(bygg(SLANKE_KOLONNER)).bind(...bind()).all();
    return r.results ?? [];
  }
}

/**
 * Tekstsøk i prislista — kun fallback når ground_truth ikke har kjøretøyet.
 *
 * FEIL SOM ER RETTET HER: tidligere ble merkenavnet lagt inn i OR-gruppa
 * (seed-søket ble prependet med merket), slik at `varenavn LIKE '%TOYOTA%'`
 * alene tilfredsstilte hele OR-gruppa. Modell og år ble dermed filtrende
 * no-ops, og «TOYOTA C-HR 2018» returnerte COROLLA 97-01, RAV-4 03-05 og
 * HI ACE 96 — feil biler, men med tilsynelatende gyldig pris
 * (WRONG_GLASS-risiko). Nå bygges OR-gruppa KUN av modell- og årstokens;
 * merke håndheves med AND.
 */
async function tekstFallback(
  env: { FINNBILGLASS_DB: any },
  merke: string,
  modell: string,
  aar?: number
): Promise<Rad[]> {
  const frontGlob = `(varenavn LIKE '%FRONTRUTE%' OR varenavn LIKE '%FRONT%')`;
  const seedOrd: string[] = [];
  if (modell) seedOrd.push(modell);
  if (aar) seedOrd.push(String(aar));

  const bygg = (kolonner: string[]) =>
    `SELECT ${kolonner.join(', ')}
       FROM glass_prisliste
      WHERE rad_type='glass' AND ${frontGlob} AND varenavn LIKE ?
        ${seedOrd.length ? `AND (${seedOrd.map(() => 'varenavn LIKE ?').join(' OR ')})` : ''}
      ORDER BY (pris IS NULL), (pris < ?), pris`;

  const params: (string | number)[] = [
    `%${merke}%`,
    ...seedOrd.map((o) => `%${o.toUpperCase()}%`),
    LAVESTE_SITERBARE_LISTEPRIS,
  ];

  try {
    const r = await env.FINNBILGLASS_DB.prepare(bygg(FULLE_KOLONNER)).bind(...params).all();
    return r.results ?? [];
  } catch {
    const r = await env.FINNBILGLASS_DB.prepare(bygg(SLANKE_KOLONNER)).bind(...params).all();
    return r.results ?? [];
  }
}

/**
 * Discovery: frontrute-kandidater for et kjøretøy.
 *
 * Rekkefølge:
 *   1. ground_truth (fasit) — verifiserte kjøretøy → frontrute
 *   2. tekstfallback (prisliste) — kun når GT ikke har kjøretøyet
 *
 * GT-treff fylles aldri opp av teksttreff: en blandet liste presenterer
 * urelaterte biler som likeverdige kandidater.
 */
export async function discoverFrontRute(
  env: { FINNBILGLASS_DB: any },
  merke: string,
  modell?: string,
  aar?: number,
  cursor?: string
): Promise<DiscoveryResult> {
  const merkeNorm = normaliserMerke(merke);

  let rader: Rad[] = [];
  let kilde: 'ground_truth' | 'tekst' = 'ground_truth';

  const koder = await gtFrontruteKoder(env, merkeNorm, modell || '', aar);
  if (koder.length) rader = await raderForKoder(env, koder);
  if (!rader.length) {
    kilde = 'tekst';
    rader = await tekstFallback(env, merkeNorm, modell || '', aar);
  }

  // Dedupe på varenr — samme SKU kan finnes med flere eurokoder.
  const unike: Rad[] = [];
  const sett = new Set<string>();
  for (const r of rader) {
    if (!r?.varenr || sett.has(r.varenr)) continue;
    sett.add(r.varenr);
    unike.push(r);
  }

  const cursorIndex = cursor ? Number.parseInt(cursor, 10) || 0 : 0;
  const startIdx = cursorIndex;
  const endIdx = startIdx + SIDE_STORRELSE;
  const kandidater = unike.slice(startIdx, endIdx).map(tilKandidat);

  const hasMore = endIdx < unike.length;
  const nextCursor = hasMore ? String(endIdx) : undefined;

  return {
    candidates: kandidater,
    totalAvailable: unike.length,
    nextCursor,
    hasMore,
    kilde,
  };
}

/** Discover first page (cursor omitted or '0') */
export function discoverFrontRuteFirst(
  env: { FINNBILGLASS_DB: any },
  merke: string,
  modell?: string,
  aar?: number
): Promise<DiscoveryResult> {
  return discoverFrontRute(env, merke, modell, aar, undefined);
}
