/**
 * accessory-v1/engine — AccessoryApplicabilityEngine (deterministisk, IKKE LLM).
 * Inngang: vehicleIdentity/applicationIdentity/selectedGlass/glassFeatures/catalogueData.
 * Utgang: AccessoryApplicability[] med nøyaktig ÉN tilstand per relasjon.
 * Regler:
 *  - INGEN relasjon dokumentert → vises ikke, spørres ikke om, ingen placeholder.
 *  - UNKNOWN ≠ NOT_APPLICABLE. UNKNOWN er aldri upsell.
 *  - INCLUDED_WITH_GLASS forhindrer duplikat-salg.
 *  - Generiske forbruksvarer (INSTALLATION_CONSUMABLE) er aldri fitment-evidens.
 */
import type { AccessoryApplicability, AccessoryEngineInput, AccessoryRelation } from './schema.js';
import { parseEmcComment } from './catalogue.js';

export class AccessoryApplicabilityEngine {
  constructor(private readonly relations: AccessoryRelation[]) {}

  /** AUTO_GLASS_PRODUCT_RELATION matcher på base-nummer-prefiks (varekort-kobling); ellers eksakt. */
  private relMatches(rel: AccessoryRelation, glass: AccessoryEngineInput['selectedGlass']): boolean {
    if (!glass) return false;
    if (rel.linkedVarenr) {
      if (rel.provenance.source === 'AUTO_GLASS_PRODUCT_RELATION') return glass.varenr?.startsWith(rel.linkedVarenr) ?? false;
      return glass.varenr === rel.linkedVarenr;
    }
    if (rel.linkedEurocode) return glass.glass === rel.linkedEurocode;
    return false;
  }

  evaluate(input: AccessoryEngineInput): AccessoryApplicability[] {
    const out: AccessoryApplicability[] = [];
    const glass = input.selectedGlass;
    const features = input.glassFeatures ?? {};

    for (const rel of this.relations) {
      // 0) salesPolicy=DISABLED (viskere): bevares som relasjon, men ALDRI i kundeflyt
      if (rel.salesPolicy === 'DISABLED') {
        const linked = this.relMatches(rel, glass);
        if (linked) out.push({
          accessory: rel.accessory,
          state: 'EXCLUDED_FROM_FINNBILGLASS_FOR_NOW',
          reason: 'salesPolicy=DISABLED (vindusviskere utenfor scope inntil Tom endrer policy)',
          provenance: rel.provenance,
        });
        continue;
      }

      // 1) Glass-spesifikk kobling (eurokode/varenr) — ingen match → relasjonen finnes ikke for dette glasset
      if (rel.linkedEurocode || rel.linkedVarenr) {
        const linked = this.relMatches(rel, glass);
        if (!linked) continue; // usynlig — ingen placeholder, ingen upsell
        out.push({
          accessory: rel.accessory,
          state: rel.stateWhenApplicable,
          reason: `dokumentert relasjon (${rel.provenance.sourceRecord})`,
          provenance: rel.provenance,
          duplicateOfGlassComponent: rel.stateWhenApplicable === 'INCLUDED_WITH_GLASS',
          requiresInstallerConfirmation: rel.stateWhenApplicable === 'REQUIRED_SEPARATE',
        });
        continue;
      }

      // 2) Feature-betingede relasjoner (sensorgel for sensor-glass)
      if (rel.featureRequirement || rel.featureExclusion) {
        const req = rel.featureRequirement;
        const excl = rel.featureExclusion;
        const reqMet = req ? features[req.feature] === req.value : true;
        if (excl && features[excl.feature] === excl.value) {
          // Vi HAR evidens for at komponenten ikke er relevant → NOT_APPLICABLE (ikke UNKNOWN)
          out.push({ accessory: rel.accessory, state: 'NOT_APPLICABLE', reason: `glasset har ikke ${excl.feature} — komponenten er ikke relevant`, provenance: rel.provenance });
          continue;
        }
        if (!reqMet) {
          out.push({ accessory: rel.accessory, state: 'UNKNOWN', reason: `mangler evidens for feature «${req?.feature}» — verken bekreftet eller avkreftet`, provenance: rel.provenance });
          continue;
        }
        if (rel.provenance.authority === 'EXPERT_TEACHING_PROVISIONAL') {
          // C3-policy: PROVISIONAL kan ikke låse ordre. Tilstanden er UNKNOWN inntil VERIFIED.
          out.push({ accessory: rel.accessory, state: 'UNKNOWN', reason: 'ekspert-regel er PROVISIONAL under C3-policy — krever REVIEWED/VERIFIED før den kan bli REQUIRED', provenance: rel.provenance });
          continue;
        }
        out.push({ accessory: rel.accessory, state: rel.stateWhenApplicable, reason: `feature «${req?.feature}» bekreftet på glasset`, provenance: rel.provenance, requiresInstallerConfirmation: rel.stateWhenApplicable === 'REQUIRED_SEPARATE' });
        continue;
      }

      // 3) Universelle forbruksvarer (SCHEIBENKLEBESET) — OPTIONAL_COMPATIBLE, aldri fitment-evidens
      if (rel.accessory.kind === 'INSTALLATION_CONSUMABLE') {
        out.push({ accessory: rel.accessory, state: 'OPTIONAL_COMPATIBLE', reason: 'generisk installasjons-forbruksvare (universell i Glavista alleKoder) — ikke fitment-evidens', provenance: rel.provenance });
      }
    }
    return out;
  }
}

/** Utled glass-features fra kandidat + katalog-kommentar (EMB-parsing). */
export function featuresFromGlass(glass: { glavista?: Record<string, unknown> | null; features?: string[] }, comment?: string | null): Record<string, string | boolean | null> {
  const f: Record<string, string | boolean | null> = {};
  for (const feat of glass.features ?? []) f[feat] = true;
  const g = glass.glavista as { features?: string[]; calibration?: string } | null | undefined;
  for (const p of g?.features ?? []) f[p] = true;
  if (g?.calibration === 'Yes') f.calibrated = true;
  const emb = parseEmcComment(comment ?? null);
  if (emb.mouldingIncluded) f.moulding = true;
  return f;
}
