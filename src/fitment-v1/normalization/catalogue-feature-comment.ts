/**
 * Weak catalogue text observations, NOT vehicle build data or verified fitment.
 * Records positive, explicit negative and unknown evidence without equating
 * absence of a keyword with equipment absence.
 */
export type CatalogueFeature = 'camera' | 'rainSensor' | 'heated' | 'hud' |
  'antenna' | 'coated' | 'acoustic' | 'encapsulated';

export interface ParsedFeatureComment {
  rawComment: string;
  sourceKind: 'INTERNAL_CATALOGUE_DESCRIPTION';
  states: Record<CatalogueFeature, boolean | null>;
  warnings: string[];
}

/** All patterns are word/abbreviation hints, never physical-car confirmations. */
const ALIASES: Record<CatalogueFeature, string[]> = {
  camera: ['CAMERA', 'KAMERA', 'LDW'],
  rainSensor: ['REGNSENSOR', 'SENSOR', 'RAIN SENSOR'],
  heated: ['OPPVARMET', 'HEATED', 'VARMETRADER', 'VARMETRADER'],
  hud: ['HUD', 'HEAD UP DISPLAY'],
  antenna: ['ANTENNE', 'ANTENNEFESTE', 'ANTENNA'],
  coated: ['COATED', 'SOLAR', 'IR'],
  acoustic: ['AKUSTISK', 'ACOUSTIC', 'NOISE'],
  encapsulated: ['EMB'],
};

const ALL_FEATURES = Object.keys(ALIASES) as CatalogueFeature[];
const protect = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const isNegative = (prefix: string) =>
  /(?:^|[\s,;/()\[\]-])(?:UTEN|IKKE|NO|WITHOUT|EXCL)\s+$/.test(prefix);

/**
 * Detects explicit negative/positive evidence. Contradictory text returns
 * null and a warning rather than allowing one side to win.
 */
export function parseCatalogueComment(raw: string | null | undefined): ParsedFeatureComment {
  const rawComment = String(raw ?? '');
  const upper = rawComment.toUpperCase();
  const states = Object.fromEntries(ALL_FEATURES.map(k => [k, null])) as Record<CatalogueFeature, boolean | null>;
  const warnings: string[] = [];

  for (const feature of ALL_FEATURES) {
    let positive = false;
    let negative = false;
    for (const alias of ALIASES[feature]) {
      const re = new RegExp('\\b' + protect(alias).replace(/\s+/g, '\\s+') + '\\b', 'g');
      for (const hit of upper.matchAll(re)) {
        const start = hit.index ?? 0;
        const prefix = upper.slice(Math.max(0, start - 30), start);
        if (isNegative(prefix)) negative = true;
        else positive = true;
      }
    }
    // Existing EMB=100 comments identify encapsulation metadata (weak only).
    if (feature === 'encapsulated' && /\bEMB=10\d/.test(upper)) positive = true;
    if (positive && negative) {
      warnings.push('CONTRADICTORY_FEATURE:' + feature);
      continue;
    }
    if (positive) states[feature] = true;
    if (negative) states[feature] = false;
  }
  return { rawComment, sourceKind: 'INTERNAL_CATALOGUE_DESCRIPTION', states, warnings };
}
