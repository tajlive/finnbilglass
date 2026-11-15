/**
 * Conservative Eurocode *position* parsing shared by research and local
 * candidate filtering. It is NOT a full ARGIC validator or vehicle-fitment
 * verifier. Do not infer specific vehicle equipment from a code alone.
 *
 * Important: an unknown code is NEVER silently classified as OTHER.
 */
export type GlassPosition = 'WINDSCREEN' | 'OTHER' | 'UNKNOWN';
export type EurocodeFormat = 'NUMERIC_3_TO_5' | 'UNRECOGNIZED';

export interface EurocodePosition {
  raw: string | null;
  normalized: string | null;
  format: EurocodeFormat;
  position: GlassPosition;
  /** Numeric catalogue family prefix, when confidently identifiable. */
  familyPrefix: string | null;
  /** Full text AFTER glass position, not a decoded feature claim. */
  variantSuffix: string | null;
  positionCode: string | null;
  warnings: string[];
}

export function parseEurocodePosition(input: string | null | undefined): EurocodePosition {
  const raw = input ?? null;
  const normalized = input?.trim().toUpperCase().replace(/\s+/g, '') || null;
  const unknown = (warnings: string[]): EurocodePosition => ({
    raw, normalized, format: 'UNRECOGNIZED', position: 'UNKNOWN',
    familyPrefix: null, variantSuffix: null, positionCode: null, warnings,
  });
  if (!normalized) return unknown(['EMPTY_CODE']);
  if (!/^[0-9A-Z]+$/.test(normalized)) return unknown(['NON_ALPHANUMERIC_CODE']);
  // Known legacy numeric catalogue prefix. Do not assume there are always
  // exactly FOUR characters before the glass position.
  const m = /^(\d{3,5})([ABFLRS])([A-Z0-9]+)$/.exec(normalized);
  if (!m) return unknown(['UNRECOGNIZED_FORMAT']);
  if (normalized.length > 17) return unknown(['LONG_CODE_FORMAT_UNVERIFIED']);
  return {
    raw, normalized, format: 'NUMERIC_3_TO_5',
    position: m[2] === 'A' ? 'WINDSCREEN' : 'OTHER',
    familyPrefix: m[1], positionCode: m[2],
    variantSuffix: m[3],
    warnings: normalized !== (input ?? '').trim().toUpperCase() ? ['WHITESPACE_NORMALIZED'] : [],
  };
}
