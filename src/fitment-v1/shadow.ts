/**
 * fitment-v1/shadow — SHADOW MODE: V1 beregner uavhengig, påvirker aldri kunden.
 * Sammenligner legacy-resolver-resultat mot Evidence Resolver v1-resultat.
 */

import type { FitmentResult } from './domain.js';

export interface LegacyResult {
  utfall: 'PINPOINT' | 'VERIFY' | 'FALLBACK' | 'ERROR';
  selectedVarenr: string | null;
  candidateVarenr: string[];
  confidence: number | null;
  reason: string | null;
}

export interface ShadowComparison {
  registrationNumber: string;
  timestamp: string;
  legacyResult: LegacyResult;
  evidenceV1Result: {
    fitmentStatus: FitmentResult['fitmentStatus'];
    verificationMode: FitmentResult['verificationMode'];
    selectedGlass: string | null;
    candidateCount: number;
  };
  candidateOverlap: string[];
  decisionDifference: 'SAME' | 'DIFFERENT';
  reasonCodes: string[];
  v1AffectsCustomer: false; // shadow-mode: V1 påvirker ALDRI kunden
}

/**
 * Bygg shadow-sammenligning. V1-resultatet brukes kun til måling.
 */
export function buildShadowComparison(registrationNumber: string, legacy: LegacyResult, v1: FitmentResult): ShadowComparison {
  const v1Selected = v1.selectedGlass?.glass ?? null;
  const v1Candidates = v1.candidates.map((c) => c.varenr ?? c.glass);
  const overlap = legacy.candidateVarenr.filter((v) => v1Candidates.includes(v));

  // Beslutningsforskjell (kategori-nivå):
  const legacyCategory = legacy.utfall === 'PINPOINT' ? 'EXACT' : legacy.utfall === 'VERIFY' ? 'AMBIGUOUS' : 'UNKNOWN';
  const v1Category = v1.fitmentStatus;
  const decisionDifference: 'SAME' | 'DIFFERENT' = legacyCategory === v1Category ? 'SAME' : 'DIFFERENT';

  return {
    registrationNumber,
    timestamp: new Date().toISOString(),
    legacyResult: legacy,
    evidenceV1Result: {
      fitmentStatus: v1.fitmentStatus,
      verificationMode: v1.verificationMode,
      selectedGlass: v1Selected,
      candidateCount: v1Candidates.length,
    },
    candidateOverlap: overlap,
    decisionDifference,
    reasonCodes: v1.reasonCodes,
    v1AffectsCustomer: false,
  };
}
