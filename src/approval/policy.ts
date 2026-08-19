/**
 * approval/policy.ts — godkjenningspolicy for sakshåndtering (2026-08-19).
 *
 * HARD REGEL (Tom 2026-08-19, brytes aldri):
 *   En sak kan kun få status 'approved' hvis ALLE tre vilkår er oppfylt:
 *     1. candidateSkus.length === 1
 *     2. hasVerifiedCatalogRule === true
 *     3. ingen attributkonflikt (HUD/kamera/varme/akustisk/antenne)
 *   Alt annet → 'needs_verification'. 'approved' er ALDRI fallback/default.
 *
 * Modulen er ren (ingen DB/IO) — brukes av matcher-utvidelsen, ops-center-
 * godkjenning og tester.
 */
import type { GlassAttributes, GlassSku } from '../fitment-v1/glass-sku.js';

export type ApprovalStatus = 'approved' | 'needs_verification';

export interface ApprovalVurdering {
  status: ApprovalStatus;
  grunn: string[];
  /** Attributter der kandidatene er i konflikt (minst én true og én false). */
  konflikter: string[];
}

/** Attributter som KAN skilles av kunde-/bildebevis. */
export const SKILLENDE_ATTRIBUTTER: Array<keyof Omit<GlassAttributes, 'windshield' | 'tint'>> = [
  'hud', 'cameraBracket', 'rainLightSensor', 'heating', 'acoustic', 'antenna',
];

/**
 * Attributter der kandidatene har ULIK verdi (minst én true og én false).
 * Disse forhindrer entydighet og må bekreftes (kunde/foto/OE) for å redusere
 * kandidatlisten til 1. null (UKJENT) teller ikke som verdi.
 */
export function skillendeAttributter(skus: GlassSku[]): string[] {
  const ut: string[] = [];
  for (const key of SKILLENDE_ATTRIBUTTER) {
    const verdier = skus.map((s) => s.attributes[key]).filter((v): v is boolean => typeof v === 'boolean');
    if (verdier.some((v) => v) && verdier.some((v) => !v)) ut.push(key);
  }
  return ut;
}

/** Attributkonflikt: kunde-/bildebevis sier én verdi, kandidatens katalog sier motsatt. */
export function attributkonflikter(skus: GlassSku[], bevis: Partial<GlassAttributes>): string[] {
  const ut: string[] = [];
  for (const key of SKILLENDE_ATTRIBUTTER) {
    const bevist = bevis[key];
    if (bevist === undefined || bevist === null) continue; // ikke bevist → ingen konflikt
    for (const sku of skus) {
      const katalog = sku.attributes[key];
      if (katalog !== null && katalog !== bevist) {
        ut.push(`${key}: bevis=${bevist}, katalog=${katalog}`);
      }
    }
  }
  return ut;
}

/**
 * Hovedregel: approved KUN ved én kandidat + verifisert regel + ingen konflikt.
 * Returnerer alltid en eksplisitt status — aldri undefined/default-godkjenning.
 */
export function approvalPolicy(
  candidateSkus: GlassSku[],
  hasVerifiedCatalogRule: boolean,
  konflikter: string[] = [],
): ApprovalVurdering {
  const grunn: string[] = [];
  if (candidateSkus.length !== 1) {
    grunn.push(`candidateSkus.length=${candidateSkus.length} (krever 1)`);
  }
  if (!hasVerifiedCatalogRule) {
    grunn.push('hasVerifiedCatalogRule=false (ingen verifisert regel)');
  }
  if (konflikter.length > 0) {
    grunn.push(`attributkonflikt: ${konflikter.join(', ')}`);
  }
  if (grunn.length === 0) {
    return { status: 'approved', grunn: ['alle vilkår oppfylt'], konflikter };
  }
  return { status: 'needs_verification', grunn, konflikter };
}
