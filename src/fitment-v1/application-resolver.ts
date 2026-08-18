/**
 * fitment-v1/application-resolver — Application Resolver.
 * Svarer: «Hvilke(n) eksakt(e) kjøretøy-applikasjon(er) er fortsatt mulig?»
 * Returnerer FLERE applikasjonskandidater når nødvendig — tvinger aldri én.
 * VEHICLE IDENTITY kollapses ALDRI inn i EXACT APPLICATION.
 */
import type { ApplicationIdentity } from './domain.js';

export interface VehicleFacts {
  make: string;
  model: string;
  modelYear: number | null;
  firstRegistration?: string | null;      // 'YYYY-MM-DD'
  productionInterval?: { from: number | null; to: number | null } | null;
  body?: string | null;
  engine?: string | null;
  market?: string | null;
  facelift?: string | null;               // 'pre-facelift' | 'post-facelift' | null
  vinFacts?: { vin: string | null; wmi: string | null; vds: string | null; yearDigit: string | null };
  ktype?: { id: number; provider: string; namespace: string } | null; // namespaced — aldri rå likhet
}

export interface ApplicationCandidate {
  applicationId: string;
  make: string;
  model: string;
  generation: string | null;
  body: string | null;
  engine: string | null;
  productionInterval: { from: number | null; to: number | null } | null;
  facelift: string | null;
  market: string | null;
  /** Hvorfor denne applikasjonen er mulig (evidens) */
  reasons: string[];
  /** Hvor sikkert vi vet at applikasjonen er KORREKT for dette kjøretøyet */
  evidenceClass: 'AUTHORITATIVE' | 'INFERRED' | 'HEURISTIC';
}

export interface ApplicationResolution {
  vehicleIdentityResolved: boolean;
  identityEvidence: string[];
  applications: ApplicationCandidate[];
  unresolved: string[];                   // faktorer som gjenstår ukjente
}

/**
 * Applikasjons-resolver v1. Ren, deterministisk, ingen LLM.
 * Kunnskap: modell-generasjoner + produksjonsintervaller + VIN-avledede fakta.
 */
export class ApplicationResolver {
  constructor(private readonly registry: { families: FamilyKnowledge[] }) {}

  resolve(v: VehicleFacts): ApplicationResolution {
    const identityEvidence: string[] = [];
    const unresolved: string[] = [];
    if (v.vinFacts?.vin) identityEvidence.push(`VIN ${v.vinFacts.vin} bekrefter kjøretøyets identitet (SVV/avkoding)`);
    else if (v.firstRegistration) identityEvidence.push(`kjennemerke + førstegangsregistrert ${v.firstRegistration}`);
    else unresolved.push('ingen VIN og ingen registreringsdato');

    const apps: ApplicationCandidate[] = [];
    for (const fam of this.registry.families) {
      if (!matchesMakeModel(v.make, v.model, fam)) continue;
      const interval = fam.productionInterval;
      const yearOk = v.modelYear != null && interval ? v.modelYear >= (interval.from ?? -Infinity) && v.modelYear <= (interval.to ?? Infinity) : v.modelYear == null;
      if (v.modelYear != null && interval && !yearOk) continue;
      const reasons: string[] = [];
      let evidenceClass: ApplicationCandidate['evidenceClass'] = 'HEURISTIC';
      if (v.vinFacts?.vin) { evidenceClass = 'AUTHORITATIVE'; reasons.push('VIN-bekreftet kjøretøyidentitet'); }
      if (v.modelYear != null && interval) { reasons.push(`produksjonsintervall ${interval.from}–${interval.to} rommer år ${v.modelYear}`); if (evidenceClass === 'HEURISTIC') evidenceClass = 'INFERRED'; }
      if (v.facelift && fam.faceliftSplit) {
        const fl = v.facelift;
        // Evidens ELIMINERER motstridende applikasjon — ikke bare styrker den
        if ((fl === 'pre-facelift' && fam.faceliftSplit !== 'pre-facelift') || (fl === 'post-facelift' && fam.faceliftSplit !== 'post-facelift')) {
          continue;
        }
        reasons.push(`facelift: ${fl}`);
        if (fl === 'pre-facelift' && fam.faceliftSplit === 'pre-facelift') evidenceClass = 'AUTHORITATIVE';
        if (fl === 'post-facelift' && fam.faceliftSplit === 'post-facelift') evidenceClass = 'AUTHORITATIVE';
      }
      if (v.ktype && fam.ktypes?.some((k) => k.id === v.ktype!.id && k.provider === v.ktype!.provider && k.namespace === v.ktype!.namespace)) {
        reasons.push(`namespaced kType ${v.ktype.provider}:${v.ktype.namespace}:${v.ktype.id}`);
        if (evidenceClass === 'HEURISTIC') evidenceClass = 'INFERRED';
      }
      apps.push({
        applicationId: fam.applicationId,
        make: fam.make,
        model: fam.model,
        generation: fam.generation,
        body: fam.body ?? null,
        engine: null,
        productionInterval: interval,
        facelift: fam.faceliftSplit ?? null,
        market: v.market ?? 'EU',
        reasons,
        evidenceClass,
      });
    }
    if (apps.length === 0) unresolved.push('ingen kjent applikasjon i registeret for dette kjøretøyet');
    return { vehicleIdentityResolved: v.vinFacts?.vin != null || v.firstRegistration != null, identityEvidence, applications: apps, unresolved };
  }
}

function matchesMakeModel(make: string, model: string, fam: FamilyKnowledge): boolean {
  const mk = make.toUpperCase();
  const mo = model.toUpperCase();
  if (fam.make.toUpperCase() !== mk) return false;
  if (mo.includes(fam.model.toUpperCase()) || fam.model.toUpperCase().includes(mo)) return true;
  // Aliaser: CARAVELLE/MULTIVAN er Transporter-varianter (samme glass) — deterministisk
  if (fam.modelAliases?.some((a) => mo.includes(a.toUpperCase()))) return true;
  return false;
}

export interface FamilyKnowledge {
  applicationId: string;
  make: string;
  model: string;
  /** Modellaliaser (f.eks. CARAVELLE/MULTIVAN = Transporter-varianter) — deterministisk */
  modelAliases?: string[];
  generation: string | null;
  body?: string | null;
  productionInterval: { from: number | null; to: number | null } | null;
  faceliftSplit?: 'pre-facelift' | 'post-facelift' | null;
  ktypes?: { id: number; provider: string; namespace: string }[];
}
