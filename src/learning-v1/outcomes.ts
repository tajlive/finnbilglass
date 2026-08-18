/**
 * learning-v1/outcomes — utfallseviden fra reell verden + golden-pipeline.
 * Bekreftet installasjon KAN bli høy-autoritet fitment-evidens ETTER policy-validering.
 * Feil glass = kritisk negativt læringseksempel.
 */
import type { GoldenFixture, OutcomeEvidence, OutcomeState, KnowledgeItem } from './schema.js';
import { makeKnowledgeItem } from './schema.js';
import { KnowledgeStore, nextKnowledgeId } from './store.js';

let outcomeCounter = 0;
export function nextOutcomeId(): string { return `out-${Date.now()}-${++outcomeCounter}`; }

export function registerOutcome(e: Omit<OutcomeEvidence, 'outcomeId' | 'promotedToVerifiedFitment' | 'promotionEvidence'> & { outcomeId?: string }): OutcomeEvidence {
  return { ...e, outcomeId: e.outcomeId ?? nextOutcomeId(), promotedToVerifiedFitment: false, promotionEvidence: null };
}

/**
 * Promotér bekreftet installasjon → VERIFIED_REAL_WORLD_FITMENT-evidens.
 * Krever: INSTALLED_SUCCESSFULLY + verifisert av installatør + registreringsnummer/VIN.
 * Dette er ENESTE vei til høyeste autoritet utenom OEM-data.
 */
export function promoteToVerifiedFitment(store: KnowledgeStore, outcome: OutcomeEvidence, opts: { verifiedBy: string; verificationMethod: string }): { ok: boolean; knowledge?: KnowledgeItem; error?: string } {
  if (outcome.outcome !== 'INSTALLED_SUCCESSFULLY') {
    return { ok: false, error: `kun INSTALLED_SUCCESSFULLY kan promoteres (nå: ${outcome.outcome})` };
  }
  if (!outcome.registrationNumber && !outcome.vin) {
    return { ok: false, error: 'kjøretøy-identifikasjon kreves for promotering' };
  }
  if (!outcome.selectedGlass) {
    return { ok: false, error: 'valgt glass kreves for promotering' };
  }
  const knowledge = makeKnowledgeItem({
    knowledgeId: nextKnowledgeId(),
    version: 1,
    class: 'FITMENT_RULE',
    lifecycle: 'VERIFIED', // ikke automatisk ACTIVE — policy-validering følger
    authority: 'VERIFIED_REAL_WORLD_INSTALLATION',
    statement: `Bekreftet installasjon: ${outcome.registrationNumber ?? 'VIN'} (${outcome.selectedGlass}) passet.`,
    reason: 'installatør-bekreftet vellykket montering',
    scope: { make: null, modelFamily: null },
    examples: [{ vin: outcome.vin ?? null, glass: outcome.selectedGlass, note: `outcomeId: ${outcome.outcomeId}` }],
    counterexamples: [],
    provenance: {
      origin: 'INSTALLATION',
      author: opts.verifiedBy,
      source: 'installatør-bekreftet utfall',
      sourceReference: outcome.outcomeId,
      createdAt: new Date().toISOString(),
      verifiedBy: opts.verifiedBy,
      verificationMethod: opts.verificationMethod,
    },
    relatedQuestionType: null,
    sourceSessionId: outcome.sessionId,
  });
  store.add(knowledge);
  outcome.promotedToVerifiedFitment = true;
  outcome.promotionEvidence = knowledge.knowledgeId;
  return { ok: true, knowledge };
}

/** Feil glass = kritisk negativt eksempel (trening/evaluering). Aldri en positiv regel. */
export function wrongGlassNegativeExample(outcome: OutcomeEvidence): { example: string; severity: 'CRITICAL' } {
  const vehicle = outcome.registrationNumber ?? outcome.vin ?? 'ukjent';
  return {
    example: `FEIL GLASS: ${vehicle} — forventet ${outcome.selectedGlass ?? '?'}, utfallet var WRONG_GLASS (${outcome.notes ?? 'ingen detaljer'})`,
    severity: 'CRITICAL',
  };
}

// ── 9. Golden-dataset-pipeline ──
/**
 * reelt utfall → evidensgjennomgang → VERIFIED_REAL_WORLD_FITMENT → golden-fixture →
 * deterministisk regresjonstest. Endrer ALDRI eksisterende fixture-forventninger automatisk.
 */
export function toGoldenFixture(outcome: OutcomeEvidence, vehicle: { make: string; model: string; modelYear: number | null }): { ok: boolean; fixture?: GoldenFixture; error?: string } {
  if (outcome.outcome !== 'INSTALLED_SUCCESSFULLY') return { ok: false, error: `kun vellykket installasjon kan bli golden-fixture (nå: ${outcome.outcome})` };
  if (!outcome.selectedGlass) return { ok: false, error: 'valgt glass kreves' };
  if (!outcome.registrationNumber) return { ok: false, error: 'registreringsnummer kreves for fixture' };
  return {
    ok: true,
    fixture: {
      fixtureId: `fx-${outcome.outcomeId}`,
      sourceOutcomeId: outcome.outcomeId,
      registrationNumber: outcome.registrationNumber,
      vin: outcome.vin,
      vehicle,
      expectedGlass: outcome.selectedGlass,
      expectedVarenr: outcome.selectedVarenr,
      expectedDecision: 'EXACT',
      evidenceClass: 'VERIFIED_REAL_WORLD_FITMENT',
      provenance: { origin: 'INSTALLATION', author: outcome.reportedBy, source: 'outcome-pipeline', sourceReference: outcome.outcomeId, createdAt: new Date().toISOString() },
      regressionTest: `tests/fitment-golden.test.ts::${outcome.outcomeId}`,
      createdAt: new Date().toISOString(),
    },
  };
}

export type { OutcomeState };
