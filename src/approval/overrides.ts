/**
 * approval/overrides.ts — operatør-godkjente overrides (Oppgave 4).
 *
 * Leses automatisk av matcher.ts: en match gir hasVerifiedCatalogRule=true og
 * snevrer kandidatlisten til den godkjente SKU-en. Skrives kun via ops-center
 * etter at approvalPolicy har godkjent (eller ved eksplisitt operatørvalg av
 * alternativ SKU — alltid logget i evidence_events).
 */
import type { GlassAttributes } from '../fitment-v1/glass-sku.js';

export interface ManualOverride {
  id: number;
  vinPrefix: string | null;
  make: string;
  modelSeries: string | null;
  validFrom: string | null;
  validTo: string | null;
  attributesJson: string | null;
  approvedSku: string;
  eurocode: string | null;
  approvedBy: string;
  approvedAt: string;
}

export interface OverrideTreff {
  hasVerifiedCatalogRule: boolean;
  override: ManualOverride | null;
}

/** Rene match-regler (testbare uten D1). */
export function overrideMatcherBil(
  o: ManualOverride,
  bil: { merke?: string; modell?: string; aar?: number | null; vin?: string | null },
  idagIso: string,
): boolean {
  const merke = (bil.merke || '').toUpperCase();
  if (o.make !== merke) return false;
  if (o.vinPrefix) {
    if (!bil.vin) return false; // VIN-regel uten VIN → kan ikke bekrefte (aldri anta)
    if (!bil.vin.toUpperCase().startsWith(o.vinPrefix)) return false;
  }
  if (o.modelSeries) {
    const modell = (bil.modell || '').toUpperCase();
    const serie = o.modelSeries.toUpperCase();
    const tokens = modell.split(/[^A-ZÆØÅ0-9]+/).filter((t) => t.length >= 3);
    const treff = tokens.some((t) => serie.includes(t) || t.startsWith(serie) || serie.startsWith(t));
    if (!treff) return false;
  }
  if (o.validFrom || o.validTo) {
    const aar = bil.aar ?? parseInt(idagIso.slice(0, 4), 10);
    const fra = o.validFrom ? parseInt(o.validFrom.slice(0, 4), 10) : null;
    const til = o.validTo ? parseInt(o.validTo.slice(0, 4), 10) : null;
    if (fra !== null && aar < fra) return false;
    if (til !== null && aar > til) return false;
  }
  return true;
}

/** Parse attributes_json → bevis-profil (feil JSON = ingen attributter, aldri krasj). */
export function overrideAttributter(o: ManualOverride): Partial<GlassAttributes> {
  if (!o.attributesJson) return {};
  try {
    return JSON.parse(o.attributesJson) as Partial<GlassAttributes>;
  } catch {
    return {};
  }
}

/**
 * P0.1.4: Tidligere manuelle saksbeslutninger er IKKE gjenbrukbare
 * kjøretøyregler. Gamle rader ligger urørt i D1 for revisjon.
 * Ikke snevre kandidatlisten eller gi verified fra VIN-prefiks/familie.
 */
export async function lesOverrider(
  _env: { FINNBILGLASS_DB: D1Database },
  _bil: { merke?: string; modell?: string; aar?: number | null; vin?: string | null },
): Promise<OverrideTreff> {
  return { hasVerifiedCatalogRule: false, override: null };
}
