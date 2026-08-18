/**
 * learning-v1/schema — kunnskapsskjema for Expert Knowledge & Continuous Learning.
 * Kjerne: LEARNING != AUTOMATIC TRUTH. All kunnskap krever proveniens, scope,
 * autoritet og livssyklus-tilstand. Ingen konversasjon/LLM-output blir ACTIVE automatisk.
 */

// ── 1. Kunnskapsklasser (11) ──
export const KNOWLEDGE_CLASSES = [
  'FITMENT_RULE',
  'DOMAIN_KNOWLEDGE',
  'CUSTOMER_SERVICE_GUIDANCE',
  'QUESTION_GUIDANCE',
  'PHOTO_GUIDANCE',
  'CATALOGUE_SEMANTICS',
  'TERMINOLOGY',
  'INSTALLATION_KNOWLEDGE',
  'PRODUCT_KNOWLEDGE',
  'ORDERING_KNOWLEDGE',
  'KNOWN_EXCEPTION',
] as const;
export type KnowledgeClass = (typeof KNOWLEDGE_CLASSES)[number];

// ── 2. Livssyklus (7) ──
export const LIFECYCLE_STATES = ['CAPTURED', 'PROVISIONAL', 'REVIEWED', 'VERIFIED', 'ACTIVE', 'DEPRECATED', 'REJECTED'] as const;
export type LifecycleState = (typeof LIFECYCLE_STATES)[number];

// ── 3. Scope (eksplisitt; aldri globalisér fra én bil) ──
export interface KnowledgeScope {
  make?: string | null;
  modelFamily?: string | null;
  generation?: string | null;
  productionInterval?: { from: string | null; to: string | null } | null;
  market?: string | null;
  body?: string | null;
  engine?: string | null;
  application?: string | null;
  glassFamily?: string | null;
  supplier?: string | null;
  catalogueVersion?: string | null;
}

// ── 6. Autoritetsmodell (10 nivåer) ──
export const AUTHORITY_CLASSES = [
  'VERIFIED_REAL_WORLD_INSTALLATION', // høyest — bekreftet installasjon
  'AUTHORITATIVE_OEM_DATA',
  'VERIFIED_EXPERT_RULE',
  'SUPPLIER_DATA',
  'EXPERT_TEACHING_PROVISIONAL',
  'CUSTOMER_OBSERVATION',
  'CUSTOMER_STATEMENT',
  'HEURISTIC',
  'LLM_INFERENCE', // kan ALDRI alene skape ACTIVE fitment-sannhet
] as const;
export type AuthorityClass = (typeof AUTHORITY_CLASSES)[number];

export const AUTHORITY_RANK: Record<AuthorityClass, number> = {
  VERIFIED_REAL_WORLD_INSTALLATION: 90,
  AUTHORITATIVE_OEM_DATA: 80,
  VERIFIED_EXPERT_RULE: 70,
  SUPPLIER_DATA: 55,
  EXPERT_TEACHING_PROVISIONAL: 45,
  CUSTOMER_OBSERVATION: 35,
  CUSTOMER_STATEMENT: 20,
  HEURISTIC: 10,
  LLM_INFERENCE: 5,
};

/** Kun kunnskap med autoritet over terskelen KAN bli ACTIVE FITMENT_RULE. */
export const MIN_AUTHORITY_FOR_ACTIVE_FITMENT: AuthorityClass = 'VERIFIED_EXPERT_RULE';

// ── 5. Proveniens (aldri ødelegg forrige versjon) ──
export interface KnowledgeProvenance {
  origin: 'EXPERT_TEACHING' | 'CONVERSATION' | 'MANUAL_REVIEW' | 'INSTALLATION' | 'SUPPLIER_CATALOGUE' | 'CORRECTION' | 'SYSTEM_AUTOMATIC';
  author: string;
  source: string;
  sourceReference?: string | null;
  createdAt: string;
  reviewedBy?: string | null;
  verifiedBy?: string | null;
  verificationMethod?: string | null;
  supersedes?: string | null; // kunnskaps-ID den erstatter (versjonering, aldri sletting)
}

// ── 4. Kunnskapsitem ──
export interface KnowledgeItem {
  knowledgeId: string;
  version: number;
  class: KnowledgeClass;
  lifecycle: LifecycleState;
  authority: AuthorityClass;
  statement: string;
  reason?: string | null;
  scope: KnowledgeScope;
  examples?: { vehicle?: string; vin?: string | null; glass?: string | null; note?: string }[];
  counterexamples?: { vehicle?: string; vin?: string | null; glass?: string | null; note?: string }[];
  provenance: KnowledgeProvenance;
  relatedQuestionType?: string | null;
  sourceSessionId?: string | null;
  tags?: string[];
  /** KUN eksplisitt autoriserte ACTIVE FITMENT_RULE kan påvirke kandidat-eliminering. */
  mayInfluenceCandidateElimination(): boolean;
}

export function makeKnowledgeItem(k: Omit<KnowledgeItem, 'mayInfluenceCandidateElimination'>): KnowledgeItem {
  const item = { ...k } as KnowledgeItem;
  item.mayInfluenceCandidateElimination = function (this: KnowledgeItem): boolean {
    // Leser THIS (ikke closure) — slik at livssyklus-endringer (transition/revise) gjelder
    return (
      this.class === 'FITMENT_RULE' &&
      this.lifecycle === 'ACTIVE' &&
      AUTHORITY_RANK[this.authority] >= AUTHORITY_RANK[MIN_AUTHORITY_FOR_ACTIVE_FITMENT]
    );
  };
  return item;
}

// ── Teacher-kandidat (fra undervisningshendelse; aldri umiddelbar sannhet) ──
export interface KnowledgeCandidate {
  candidateId: string;
  teacher: string;
  timestamp: string;
  sourceSessionId?: string | null;
  statement: string;
  reason: string | null;
  scope: KnowledgeScope;
  examples: KnowledgeItem['examples'];
  counterexamples: KnowledgeItem['examples'];
  affectedKnowledgeClass: KnowledgeClass;
  proposedAuthority: AuthorityClass;
  status: LifecycleState; // starter alltid CAPTURED/PROVISIONAL
  source: string;
  conflictIds: string[];
  createdAt: string;
}

// ── 14. Konflikt (aldri overskriv ACTIVE) ──
export interface KnowledgeConflict {
  conflictId: string;
  oldKnowledgeId: string;
  oldKnowledge: KnowledgeItem;
  newCandidateId: string;
  newKnowledge: KnowledgeItem;
  scopes: KnowledgeScope[];
  sources: string[];
  authorities: AuthorityClass[];
  examplesAffected: string[];
  status: 'OPEN' | 'RESOLVED' | 'REJECTED';
  resolution?: string | null;
  resolvedBy?: string | null;
  resolvedAt?: string | null;
}

// ── 7. Konversasjonslæring (strukturerte signaler — aldri råtranskript som sannhet) ──
export interface ConversationLearningSignal {
  sessionId: string;
  channel: string;
  vehicle: { registrationNumber: string; make: string; model: string; modelYear: number | null } | null;
  questionsAsked: number;
  questionsAnswered: number;
  customerDidNotUnderstand: boolean;
  customerCorrections: string[];
  agentCorrections: string[];
  photosRequested: number;
  photoRetakes: number;
  manualHandoff: boolean;
  resolutionMethod: string | null;
  finalFitmentStatus: string | null;
  verificationMode: string | null;
  orderCreated: boolean;
  laterInstallationOutcome?: string | null;
  turns: number;
  derivedAt: string;
}

// ── 8. Utfallseviden (reell verden) ──
export const OUTCOME_STATES = [
  'ORDER_CREATED',
  'GLASS_DELIVERED',
  'INSTALLER_CONFIRMED',
  'INSTALLED_SUCCESSFULLY',
  'WRONG_GLASS',
  'RETURNED',
  'FITMENT_CORRECTED',
] as const;
export type OutcomeState = (typeof OUTCOME_STATES)[number];

export interface OutcomeEvidence {
  outcomeId: string;
  sessionId: string | null;
  registrationNumber: string | null;
  vin: string | null;
  selectedGlass: string | null;   // eurocode
  selectedVarenr: string | null;
  outcome: OutcomeState;
  observedAt: string;
  reportedBy: string;
  notes: string | null;
  promotedToVerifiedFitment: boolean;
  promotionEvidence?: string | null;
}

// ── 9. Golden-fixture ──
export interface GoldenFixture {
  fixtureId: string;
  sourceOutcomeId: string;
  registrationNumber: string;
  vin: string | null;
  vehicle: { make: string; model: string; modelYear: number | null };
  expectedGlass: string;      // eurocode
  expectedVarenr: string | null;
  expectedDecision: 'EXACT' | 'AMBIGUOUS' | 'UNKNOWN';
  evidenceClass: 'VERIFIED_REAL_WORLD_FITMENT';
  provenance: KnowledgeProvenance;
  regressionTest: string;     // testfil/-navn som kjører mot fasit
  createdAt: string;
}
