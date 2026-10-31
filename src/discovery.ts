import { normBrand } from './vin-resolver';

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
}

/**
 * Discover front-rute candidates for a vehicle make.
 * Includes pagination, canonical URL support and SKU fingerprinting.
 * Limited to 20 results per page - full catalogue requires Tom approval.
 */
export async function discoverFrontRute(
  env: { FINNBILGLASS_DB: any },
  merke: string,
  modell?: string,
  aar?: number,
  cursor?: string
): Promise<DiscoveryResult> {
  const seedOrd: string[] = [];

  if (modell) {
    seedOrd.push(modell);
  }
  if (aar) {
    seedOrd.push(String(aar));
  }
  // Katalogen bruker kortform (VW, ikke Volkswagen). Normaliser én gang og
  // bruk samme verdi i både primær- og sekundærsøket — ellers gir «Volkswagen»
  // 0 treff selv om primærfeltet er riktig.
  const merkeNorm = normaliserMerke(merke);
  // Always include the make as seed
  seedOrd.unshift(merkeNorm);

  const primaer = [merkeNorm];
  const frontGlob =
    '(varenavn LIKE "%FRONTRUTE%" OR varenavn LIKE "%FRONT%")';

  const likePrim = primaer.map(() => 'varenavn LIKE ?').join(' AND ');
  const likeSek = seedOrd.map(() => 'varenavn LIKE ?').join(' OR ');
  const primParams = primaer.map((k) => `%${k.toUpperCase()}%`);
  const sekParams = seedOrd.map((k) => `%${k.toUpperCase()}%`);

  // Staging-D1 har en slankere glass_prisliste uten typeCode/side. Vi spør først
  // om den fulle formen (beholder typeCode/side der de finnes), og faller tilbake
  // til de kolonnene som garantert eksisterer. Uten dette gir /api/glass HTTP 500
  // i staging, og en hardkodet slank SELECT ville mistet typeCode/side i prod.
  const kolonner = ['varenr', 'varenavn', 'kommentar', 'pris', 'eurokode', 'alias_av', 'rad_type'];
  const byggSql = (cols: string[]) =>
    `SELECT ${cols.join(', ')}
      FROM glass_prisliste
      WHERE rad_type='glass' AND ${frontGlob} AND ${likePrim} AND (${likeSek})
      ORDER BY pris`;

  let seed;
  try {
    seed = await env.FINNBILGLASS_DB.prepare(byggSql([...kolonner, 'typeCode', 'side']))
      .bind(...primParams, ...sekParams)
      .all();
  } catch (e) {
    console.warn('discovery: typeCode/side finnes ikke i glass_prisliste — bruker slank spørring:', e);
    seed = await env.FINNBILGLASS_DB.prepare(byggSql(kolonner))
      .bind(...primParams, ...sekParams)
      .all();
  }

  // Apply pagination: 20 results per page
  const PAGE_SIZE = 20;
  const cursorIndex = cursor ? parseInt(cursor, 10) : 0;
  const startIdx = cursorIndex;
  const endIdx = startIdx + PAGE_SIZE;

  const allCandidates: Kandidat[] = [];
  const seen = new Set<string>();

  for (let i = startIdx; i < Math.min(endIdx, seed.results?.length || 0); i++) {
    const r = seed.results[i];
    if (!r) continue;
    const key = r.varenr;
    if (!seen.has(key)) {
      seen.add(key);
      allCandidates.push({
        varenr: r.varenr,
        varenavn: r.varenavn,
        eurokode: r.eurokode,
        typeCode: r.typeCode,
        side: r.side,
        canonicalUrl: `https://finnbilglass.no/glas/${r.varenr}`,
        skuFingerprint: `${r.eurokode}-${r.varenr}`,
        pris: typeof r.pris === 'number' ? r.pris : null,
      });
    }
  }

  const hasMore = endIdx < (seed.results?.length || 0);
  const nextCursor = hasMore ? String(endIdx) : undefined;

  return {
    candidates: allCandidates,
    totalAvailable: seed.results?.length || 0,
    nextCursor,
    hasMore,
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