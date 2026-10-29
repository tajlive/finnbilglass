/**
 * fitment-v1/policy/gate — EXACT-gate + observation-gate (deterministisk policy).
 * Kjerneregel: ONE CANDIDATE != PROOF. Heuristisk scoring kan ALDRI tilfredsstille krav B/C.
 */

export interface ExactGateInput {
  vehicleIdentityResolved: boolean;
  applicationEdgeAuthoritative: boolean;
  oeGlassEdgeAuthoritativeOrIndependent: boolean;
  materialConflicts: string[];
  candidateCount: number;
}

export interface GateResult {
  passed: boolean;
  checks: Record<string, boolean>;
  reasonCodes: string[];
  authoritativeDataExact: boolean;
}

/**
 * EXACT + AUTHORITATIVE_DATA krever:
 *  A. verifisert kjøretøy-identitet
 *  B. autoritativ application/fitment-kobling → valgt OE eller glass
 *  C. autoritativ eller uavhengig korroborert OE→glass-identitet
 *  D. ingen uløst materiell konflikt
 */
export function evaluateExactGate(input: ExactGateInput): GateResult {
  const checks = {
    A_vehicleIdentityVerified: input.vehicleIdentityResolved,
    B_applicationLinkageAuthoritative: input.applicationEdgeAuthoritative,
    C_oeGlassAuthoritativeOrIndependent: input.oeGlassEdgeAuthoritativeOrIndependent,
    D_noUnresolvedMaterialConflict: input.materialConflicts.length === 0,
    E_singleCandidate: input.candidateCount === 1,
  };
  const passed = Object.values(checks).every(Boolean);
  const reasonCodes: string[] = [];
  if (!checks.A_vehicleIdentityVerified) reasonCodes.push('VEHICLE_IDENTITY_NOT_VERIFIED');
  if (!checks.B_applicationLinkageAuthoritative) reasonCodes.push('APPLICATION_LINKAGE_NOT_AUTHORITATIVE');
  if (!checks.C_oeGlassAuthoritativeOrIndependent) reasonCodes.push('OE_GLASS_LINKAGE_NOT_AUTHORITATIVE');
  if (!checks.D_noUnresolvedMaterialConflict) reasonCodes.push('MATERIAL_CONFLICT_UNRESOLVED');
  if (!checks.E_singleCandidate) reasonCodes.push('CANDIDATE_COUNT_NOT_ONE');
  if (input.candidateCount === 1 && passed) reasonCodes.push('SINGLE_CANDIDATE_IS_NOT_PROOF_BY_ITSELF');
  return { passed, checks, reasonCodes, authoritativeDataExact: passed };
}

export interface ObservationGateInput {
  narrowedByEvidence: boolean;
  observations: { reliable: boolean }[];
  remainingCandidates: unknown[];
}

/** EXACT + CUSTOMER_OBSERVATION (§9): smalnende evidens + pålitelig fysisk observasjon som unikt separerer. */
export function evaluateObservationGate(input: ObservationGateInput): GateResult {
  const checks = {
    evidenceNarrowsSet: input.narrowedByEvidence,
    observationsPresent: input.observations.length > 0,
    observationReliable: input.observations.every((o) => o.reliable === true),
    uniquelySeparates: input.remainingCandidates.length === 1,
  };
  const passed = Object.values(checks).every(Boolean);
  const reasonCodes: string[] = [];
  if (!checks.evidenceNarrowsSet) reasonCodes.push('NO_NARROWING_EVIDENCE');
  if (!checks.observationsPresent) reasonCodes.push('NO_OBSERVATION');
  if (!checks.observationReliable) reasonCodes.push('OBSERVATION_UNRELIABLE');
  if (!checks.uniquelySeparates) reasonCodes.push(`OBSERVATION_AMBIGUOUS_${input.remainingCandidates.length}_CANDIDATES`);
  return { passed, checks, reasonCodes, authoritativeDataExact: false };
}
