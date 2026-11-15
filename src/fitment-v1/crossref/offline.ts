/**
 * Offline Eurocode cross-reference research.
 *
 * No network, D1, third-party imports or automatic fitment approval.
 * A catalogue coincidence is not evidence of which glass is installed in a car.
 * Reference data is supplied by callers and must have a checked usage licence
 * before any production reuse. See GitHub issue #86.
 */
export type VerificationState = 'VERIFIED' | 'PROVISIONAL' | 'AMBIGUOUS' | 'UNVERIFIED' | 'CONFLICTING';
export type LicenseState = 'RESEARCH_ONLY' | 'UNVERIFIED' | 'PERMITTED';

export interface VehicleForCrossref {
  make: string;
  model: string;
  year: number;
  generation?: string | null;
  powertrain?: string | null;
}

export interface CatalogueGlass {
  id: string;
  eurocode: string | null;
  make: string;
  model: string;
  yearFrom?: number | null;
  yearTo?: number | null;
  generation?: string | null;
  powertrain?: string | null;
  /** Unknown is null/undefined; never interpret as "false". */
  features?: Record<string, boolean | null>;
}

export interface ReferenceObservation extends CatalogueGlass {
  sourceId: string;
  sourceUrl: string;
  observedAt: string;
  licenseState: LicenseState;
}

export type CatalogueOverlap = 'IDENTICAL_CODE' | 'SAME_FAMILY_ONLY' | 'NONE' | 'NOT_APPLICABLE';
export interface CrossrefCandidateResult {
  id: string;
  eurocode: string | null;
  catalogueOverlap: CatalogueOverlap;
  exactCodeReferences: string[];
  familyOnlyReferences: string[];
  warnings: string[];
  /** Always true: external catalogue research cannot approve customer fitment. */
  needsStaffReview: true;
}

export interface CrossrefReport {
  vehicle: VehicleForCrossref;
  existingVerificationState: VerificationState;
  fitmentVerificationState: VerificationState;
  autoApproved: false;
  candidates: CrossrefCandidateResult[];
  rejectedReferenceIds: { id: string; reason: string }[];
  metrics: {
    candidates: number;
    exactCatalogueOverlaps: number;
    familyOnlyOverlaps: number;
    autoApproved: 0;
  };
}

const norm = (value: string): string => value.trim().toUpperCase().replace(/[^A-Z0-9]+/g, ' ');

/**
 * A conservative *plausibility* check, not an ARGIC code validator.
 * Old/exceptional codes may be legitimate even when marked for manual review.
 * Do not strip variant suffixes to force a match.
 */
export function plausibleCompleteEurocode(raw: string | null | undefined): boolean {
  if (!raw) return false;
  const code = raw.trim().toUpperCase();
  return code.length >= 7 && code.length <= 17 &&
    /^[A-Z0-9]+$/.test(code) &&
    /^[A-Z0-9]{4,5}[ABFLRS][A-Z0-9]{2,11}$/.test(code) &&
    /[0-9]/.test(code.slice(0, 5));
}

function applicationIssues(vehicle: VehicleForCrossref, glass: CatalogueGlass): string[] {
  const issues: string[] = [];
  if (norm(vehicle.make) !== norm(glass.make) || norm(vehicle.model) !== norm(glass.model)) {
    issues.push('MODEL_MISMATCH');
  }
  if (glass.yearFrom != null && vehicle.year < glass.yearFrom) issues.push('BEFORE_PRODUCTION_RANGE');
  if (glass.yearTo != null && vehicle.year > glass.yearTo) issues.push('AFTER_PRODUCTION_RANGE');
  if (vehicle.generation && glass.generation && norm(vehicle.generation) !== norm(glass.generation)) {
    issues.push('GENERATION_MISMATCH');
  }
  if (vehicle.powertrain && glass.powertrain && norm(vehicle.powertrain) !== norm(glass.powertrain)) {
    issues.push('POWERTRAIN_MISMATCH');
  }
  return issues;
}

/**
 * Research-level comparison of local product candidates with a tiny, manually
 * reviewed reference sample. No reference is used to change verification state.
 */
export function compareEurocodeCandidates(
  vehicle: VehicleForCrossref,
  localCandidates: CatalogueGlass[],
  observations: ReferenceObservation[],
  existingVerificationState: VerificationState = 'UNVERIFIED',
): CrossrefReport {
  const rejectedReferenceIds: CrossrefReport['rejectedReferenceIds'] = [];
  const eligible = observations.filter((ref) => {
    if (!plausibleCompleteEurocode(ref.eurocode)) {
      rejectedReferenceIds.push({ id: ref.id, reason: 'CODE_REQUIRES_MANUAL_VALIDATION' });
      return false;
    }
    const issues = applicationIssues(vehicle, ref);
    if (issues.length) {
      rejectedReferenceIds.push({ id: ref.id, reason: issues.join(',') });
      return false;
    }
    if (!ref.sourceId || !/^https:\/\//.test(ref.sourceUrl) || !ref.observedAt) {
      rejectedReferenceIds.push({ id: ref.id, reason: 'INCOMPLETE_PROVENANCE' });
      return false;
    }
    // Licensing remains separate from catalog comparison. Even PERMITTED
    // reference rows can never change a fitment verification decision.
    return true;
  });

  const candidates: CrossrefCandidateResult[] = localCandidates.map((candidate) => {
    const issues = applicationIssues(vehicle, candidate);
    const warnings: string[] = [...issues];
    if (!plausibleCompleteEurocode(candidate.eurocode)) warnings.push('LOCAL_CODE_REQUIRES_MANUAL_VALIDATION');
    if (!vehicle.generation && candidate.generation) warnings.push('GENERATION_UNCONFIRMED');
    if (vehicle.powertrain && !candidate.powertrain) warnings.push('POWERTRAIN_UNCONFIRMED');

    const applicable = issues.length === 0 && plausibleCompleteEurocode(candidate.eurocode);
    const code = candidate.eurocode?.trim().toUpperCase() ?? '';
    const same = applicable ? eligible.filter((ref) => ref.eurocode!.trim().toUpperCase() === code) : [];
    const family = applicable ? eligible.filter((ref) =>
      ref.eurocode!.trim().toUpperCase() !== code &&
      ref.eurocode!.trim().toUpperCase().slice(0, 4) === code.slice(0, 4),
    ) : [];
    // Compare only explicitly known feature values. Unknown is not false.
    for (const reference of same) {
      for (const [feature, localValue] of Object.entries(candidate.features ?? {})) {
        const referenceValue = reference.features?.[feature];
        if (typeof localValue === 'boolean' && typeof referenceValue === 'boolean' &&
            localValue !== referenceValue) {
          warnings.push('FEATURE_CONFLICT:' + feature);
        }
      }
    }
    if (same.some((ref) => ref.licenseState !== 'PERMITTED') ||
        family.some((ref) => ref.licenseState !== 'PERMITTED')) {
      warnings.push('REFERENCE_RESEARCH_ONLY_OR_UNLICENSED');
    }
    if (!vehicle.generation && eligible.some((ref) => ref.generation)) {
      warnings.push('REFERENCE_GENERATION_UNCONFIRMED');
    }

    const catalogueOverlap: CatalogueOverlap = issues.length ? 'NOT_APPLICABLE' :
      same.length ? 'IDENTICAL_CODE' : family.length ? 'SAME_FAMILY_ONLY' : 'NONE';
    return {
      id: candidate.id,
      eurocode: candidate.eurocode,
      catalogueOverlap,
      exactCodeReferences: same.map((ref) => ref.id),
      familyOnlyReferences: family.map((ref) => ref.id),
      warnings: [...new Set(warnings)],
      needsStaffReview: true,
    };
  });

  return {
    vehicle,
    existingVerificationState,
    fitmentVerificationState: existingVerificationState,
    autoApproved: false,
    candidates,
    rejectedReferenceIds,
    metrics: {
      candidates: candidates.length,
      exactCatalogueOverlaps: candidates.filter((c) => c.catalogueOverlap === 'IDENTICAL_CODE').length,
      familyOnlyOverlaps: candidates.filter((c) => c.catalogueOverlap === 'SAME_FAMILY_ONLY').length,
      autoApproved: 0,
    },
  };
}
