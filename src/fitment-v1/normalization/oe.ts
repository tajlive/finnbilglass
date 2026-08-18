/**
 * fitment-v1/normalization — OE-normalisering.
 * Rå verdi immutabel, normalisert avledet. Revisjonsbokstaver er fitment-kritiske og bevares.
 */
import type { OEIdentity, Provenance } from '../domain.js';

export const OE_NORMALIZATION_VERSION = 'a2-2026-08-18-v1';

export function looksLikeGtin(raw: string): boolean {
  return /^0{4,5}\d{8,9}$/.test(raw);
}

export function canonicalOE(raw: string): string {
  return String(raw).trim().toUpperCase().replace(/\s+/g, '');
}

export function oeTokens(canonical: string): string[] {
  const tokens: string[] = [];
  if (/^A\d/.test(canonical)) {
    tokens.push('A-PREFIX');
    tokens.push(canonical.slice(1));
  } else {
    tokens.push(canonical);
  }
  if (canonical.endsWith('NVB')) tokens.push('NVB-SUFFIX');
  return tokens;
}

export function sameOEPart(a: string, b: string): boolean {
  const ca = canonicalOE(a);
  const cb = canonicalOE(b);
  if (ca === cb) return true;
  return (ca.startsWith('A') && ca.slice(1) === cb) || (cb.startsWith('A') && cb.slice(1) === ca);
}

export function normalizeOE(raw: string, p?: Partial<Provenance>): OEIdentity {
  const rawTrimmed = String(raw).trim();
  const canonical = canonicalOE(rawTrimmed);
  return {
    manufacturer: null,
    rawOE: rawTrimmed,
    normalizedOE: canonical,
    normalizationVersion: OE_NORMALIZATION_VERSION,
    provenance: p ? [p as Provenance] : [],
  };
}
