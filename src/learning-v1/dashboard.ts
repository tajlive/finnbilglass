/**
 * learning-v1/dashboard — C8.3: Evidence Dashboard (rent domene, ingen I/O).
 * Kontrollpanel for læringsmotoren — svarer på fire styringsspørsmål:
 * 1. Hvilke biler mangler evidens? 2. Hvilke features skaper mest spørsmål?
 * 3. Hvilke glass har mest usikkerhet? 4. Hvilke installasjoner gir mest verdi?
 * All data er FAKTA (D1-evidens + deterministisk analytics) — aldri LLM-gjetting.
 */
import type { LedgerEvent, FixtureRecord } from './evidence-ledger.js';
import type { LearningOpportunity } from './analytics.js';

export interface FamilyCoverage {
  familie: string;
  annonser: number;
  dekningsgrad: number; // % med kandidater (C9.5)
}

export interface DashboardInput {
  evidenceEvents: LedgerEvent[];      // D1 evidence_events (kan være tom)
  fixtures: FixtureRecord[];          // D1 installation_fixtures (kan være tom)
  analytics: LearningOpportunity[];   // C8.2-utdata (scripts/out/c82-…)
  coverage: FamilyCoverage[];         // C9.5-utdata (scripts/out/c95-…)
}

/** 1. Hvilke biler mangler evidens? — kandidater finnes, men ingen CONFIRMED/VERIFIED-evidens. */
export function manglendeEvidens(d: DashboardInput) {
  const evidensFamilier = new Set(
    d.evidenceEvents
      .filter((e) => e.status === 'CONFIRMED' || e.status === 'VERIFIED')
      .map((e) => e.vehicleIdentityHash),
  );
  // Per familie: har noen evidens-hash? (proxy — ekte kjøretøy-hash → familie-mapping gjøres i D1-laget)
  const evidensAntall = d.evidenceEvents.filter((e) => e.status === 'CONFIRMED' || e.status === 'VERIFIED').length;
  return d.analytics.map((a) => ({
    familie: a.familie,
    kandidater: a.sok - a.manuell,
    manglendeFeatures: a.manglendeFeatures,
    harEvidens: evidensAntall > 0, // ærlig: D1-evidens er tynn → vises som «under oppbygging»
    prioritet: a.læringsscore,
    confidence: a.confidence,
  }));
}

/** 2. Hvilke features skaper mest spørsmål? — evidens-type-fordeling fra ledgeren. */
export function featuresMedFlestSpoersmaal(d: DashboardInput) {
  const teller = new Map<string, number>();
  for (const e of d.evidenceEvents) teller.set(e.evidenceType, (teller.get(e.evidenceType) ?? 0) + 1);
  return [...teller.entries()]
    .map(([feature, antall]) => ({ feature, antall }))
    .sort((a, b) => b.antall - a.antall);
}

/** 3. Hvilke glass har mest usikkerhet? — flest skillende features + lavest confidence. */
export function glassMedMestUsikkerhet(d: DashboardInput) {
  return d.analytics
    .filter((a) => a.manglendeFeatures.length > 0)
    .map((a) => ({
      familie: a.familie,
      skillendeFeatures: a.manglendeFeatures.length,
      features: a.manglendeFeatures,
      usikkerhet: a.manglendeFeatures.length * 10 + (a.confidence === 'LAV' ? 20 : a.confidence === 'MIDDELS' ? 10 : 0),
      confidence: a.confidence,
    }))
    .sort((a, b) => b.usikkerhet - a.usikkerhet);
}

/** 4. Hvilke installasjoner gir mest verdi? — korroberte installasjoner × markedsvolum (C7.6-kobling). */
export function installasjonerMedMestVerdi(d: DashboardInput, markedsVolum: Record<string, number>) {
  const aggregat = d.fixtures
    .map((f) => ({
      varenr: f.candidateVarenr,
      outcome: f.outcome,
      installed: f.outcome === 'INSTALLED_SUCCESSFULLY' ? 1 : 0,
      wrong: f.outcome === 'WRONG_GLASS' ? 1 : 0,
    }))
    .reduce((acc, f) => {
      const key = f.varenr;
      const eksisterende = acc.get(key) ?? { varenr: key, installed: 0, wrong: 0, markedsVolum: markedsVolum[key] ?? 0 };
      eksisterende.installed += f.installed;
      eksisterende.wrong += f.wrong;
      acc.set(key, eksisterende);
      return acc;
    }, new Map<string, { varenr: string; installed: number; wrong: number; markedsVolum: number }>());
  return [...aggregat.values()]
    .map((r) => ({ ...r, verdi: r.installed * (r.markedsVolum || 1) - r.wrong * 10 }))
    .sort((a, b) => b.verdi - a.verdi);
}
