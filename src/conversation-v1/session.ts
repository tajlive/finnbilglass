/**
 * conversation-v1 — kanal-nøytral sesjon med append-only audit.
 * fitmentStatus/verificationMode/selectedGlass kan KUN settes av deterministisk policy.
 */
import type { Candidate, EvidenceEdge, FitmentStatus, VerificationMode } from '../fitment-v1/domain.js';

export type Channel = 'WEB_CHAT' | 'WEB_VOICE' | 'PHONE' | 'PHOTO' | 'MANUAL';

export type EvidenceEventStatus = 'ACTIVE' | 'SUPERSEDED' | 'REJECTED';

export interface AuditEvent {
  ts: string;
  session: string;
  actor: string;              // customer | agent | vision-ai | stt | resolver-policy | tool | system
  channel: Channel | string;
  inputRef?: string | null;
  tool?: string | null;
  action: string;
  observationEffect?: string | null;
  previousState?: string | null;
  newState?: string | null;
  reasonCode?: string | null;
  raw?: string | null;
  normalized?: string | null;
  confirmationStatus?: string | null;
  mediaRef?: string | null;
  notes?: string | null;
}

export interface CustomerObservation {
  observationId: string;
  questionId: string;
  rawValue: string;
  value: boolean | string;
  modality: string;
  confidence: number;
  status: EvidenceEventStatus;
  supersedes?: string | null;   // observationId den superseder (korreksjon)
  recordedAt: string;
}

export interface IdentifierObservation {
  identifierId: string;
  identifierType: 'registrationNumber' | 'OE' | 'partNumber' | 'vin';
  rawText: string;
  parsed: string;
  echoBack: string;
  state: 'EXTRACTED' | 'CONFIRMATION_REQUIRED' | 'CONFIRMED' | 'REJECTED' | 'SUPERSEDED';
  modality: 'SPEECH' | 'TYPED' | 'PHOTO' | 'SYSTEM';
  visionConfidence?: number | null;
  sourceImageId?: string | null;
  confirmedAt?: string | null;
  supersedes?: string | null;
  recordedAt: string;
}

export interface PhotoRecord {
  sourceImageId: string;
  observations: { key: string; value: string | boolean; visionConfidence: number; customerConfirmed: boolean }[];
  identifierCandidates: IdentifierObservation[];
  r43: { rawText: string; normalizedCandidate: string; visionConfidence: number; customerConfirmed: boolean }[];
  receivedAt: string;
}

export interface SessionQuestion {
  questionId: string;
  customerFriendlyMeaning: string;
  candidateImpact: string;
  preferredModality: 'YES_NO' | 'TEXT' | 'PHOTO' | 'IDENTIFIER' | 'MANUAL';
  riskOfMisunderstanding: 'LOW' | 'MEDIUM' | 'HIGH';
  system: boolean;
}

export interface HandoffPacket {
  sessionId: string;
  customerRequest: string | null;
  vehicle: { registrationNumber: string; make: string; model: string; modelYear: number | null } | null;
  vin: string | null;                 // internt der det trengs — aldri i klient-tilstand
  candidateSet: string[];
  acceptedEvidence: { identifierId: string; parsed: string }[];
  rejectedOrSupersededEvidence: { identifierId: string; parsed: string; state: string }[];
  photos: string[];
  unresolvedQuestions: string[];
  conflicts: string[];
  reasonCodes: string[];
  conversationSummary: string;
  recommendedHumanAction: string;
}

export interface FitmentSessionState {
  fitmentSessionId: string;
  channel: Channel;
  vehicleIdentity: { registrationNumber: string; make: string; model: string; modelYear: number | null } | null;
  applicationIdentity: { modelFamily: string | null; unknownAttributes: string[] } | null;
  candidateSet: Candidate[];
  evidenceCount: number;
  observations: CustomerObservation[];
  identifierObservations: IdentifierObservation[];
  photos: PhotoRecord[];
  questionsAsked: SessionQuestion[];
  fitmentStatus: FitmentStatus | null;
  verificationMode: VerificationMode | null;
  selectedGlass: Candidate | null;
  reasonCodes: string[];
  quoteState: 'NONE' | 'PRICE_ESTIMATE' | 'ORDERABLE_QUOTE' | 'REJECTED' | null;
  handoffState: { reason: string } | null;
  auditEvents: AuditEvent[];
}

let sessionCounter = 0;
let obsCounter = 0;

export class FitmentSession {
  readonly fitmentSessionId: string;
  readonly channel: Channel;
  createdAt: number;
  lastActivityAt: number;
  readonly maxTurns: number;
  turnCount = 0;

  vehicleIdentity: FitmentSessionState['vehicleIdentity'] = null;
  applicationIdentity: FitmentSessionState['applicationIdentity'] = null;
  candidateSet: Candidate[] = [];
  evidence: EvidenceEdge[] = [];
  observations: CustomerObservation[] = [];
  identifierObservations: IdentifierObservation[] = [];
  photos: PhotoRecord[] = [];
  questionsAsked: SessionQuestion[] = [];
  pendingConfirmations: IdentifierObservation[] = [];
  secondaryMetadata: { r43: { rawText: string; normalizedCandidate: string; visionConfidence: number }[] } = { r43: [] };
  fitmentStatus: FitmentStatus | null = null;
  verificationMode: VerificationMode | null = null;
  selectedGlass: Candidate | null = null;
  quoteState: 'NONE' | 'PRICE_ESTIMATE' | 'ORDERABLE_QUOTE' | 'REJECTED' | null = null;
  handoffState: { reason: string; packet: HandoffPacket } | null = null;
  conflicts: string[] = [];
  reasonCodes: string[] = [];
  customerRequest: string | null = null;
  lastQuestion: SessionQuestion | null = null;
  auditEvents: AuditEvent[] = [];
  readonly maxTurnsBeforeHandoff: number;

  constructor(opts: { channel: Channel; sessionId?: string; maxTurnsBeforeHandoff?: number }) {
    this.channel = opts.channel;
    this.fitmentSessionId = opts.sessionId ?? generateSessionId();
    this.createdAt = Date.now();
    this.lastActivityAt = this.createdAt;
    this.maxTurnsBeforeHandoff = opts.maxTurnsBeforeHandoff ?? 30;
    this.maxTurns = this.maxTurnsBeforeHandoff;
    this.audit({ actor: 'system', action: 'session_created', channel: this.channel, newState: this.fitmentSessionId });
  }

  touch(): void { this.lastActivityAt = Date.now(); }

  audit(e: Omit<AuditEvent, 'ts' | 'session'>): number {
    this.auditEvents.push({ ts: new Date().toISOString(), session: this.fitmentSessionId, ...e });
    return this.auditEvents.length - 1;
  }

  nextObservationId(): string { return `obs-${++obsCounter}`; }

  /** ENESTE sted fitment-felt settes — deterministisk policy. */
  applyFitmentPolicy(p: { fitmentStatus: FitmentStatus; verificationMode: VerificationMode; selectedGlass: Candidate | null; reasonCodes: string[]; conflicts: string[]; evidence: EvidenceEdge[] }): FitmentStatus {
    this.fitmentStatus = p.fitmentStatus;
    this.verificationMode = p.verificationMode;
    this.selectedGlass = p.selectedGlass;
    this.reasonCodes = p.reasonCodes;
    this.conflicts = p.conflicts;
    this.evidence = p.evidence;
    this.audit({ actor: 'resolver-policy', action: 'fitment_applied', channel: this.channel, newState: p.fitmentStatus, reasonCode: p.reasonCodes.join(','), observationEffect: p.selectedGlass?.glass ?? null });
    return this.fitmentStatus;
  }

  state(publicView = false): FitmentSessionState {
    return {
      fitmentSessionId: this.fitmentSessionId,
      channel: this.channel,
      vehicleIdentity: this.vehicleIdentity,
      applicationIdentity: this.applicationIdentity,
      candidateSet: this.candidateSet,
      evidenceCount: this.evidence.length,
      observations: this.observations,
      identifierObservations: this.identifierObservations,
      photos: this.photos,
      questionsAsked: this.questionsAsked,
      fitmentStatus: this.fitmentStatus,
      verificationMode: this.verificationMode,
      selectedGlass: this.selectedGlass,
      reasonCodes: this.reasonCodes,
      quoteState: this.quoteState,
      handoffState: this.handoffState ? { reason: this.handoffState.reason } : null,
      auditEvents: publicView ? [] : this.auditEvents, // klient-visning eksponerer ikke audit internt
    };
  }

  /** Serialiserbar tilstand for D1-persistens (metoder er ikke data). */
  toJSON(): Record<string, unknown> {
    return {
      fitmentSessionId: this.fitmentSessionId,
      channel: this.channel,
      createdAt: this.createdAt,
      lastActivityAt: this.lastActivityAt,
      turnCount: this.turnCount,
      maxTurnsBeforeHandoff: this.maxTurnsBeforeHandoff,
      vehicleIdentity: this.vehicleIdentity,
      applicationIdentity: this.applicationIdentity,
      candidateSet: this.candidateSet,
      evidence: this.evidence,
      observations: this.observations,
      identifierObservations: this.identifierObservations,
      photos: this.photos,
      questionsAsked: this.questionsAsked,
      pendingConfirmations: this.pendingConfirmations,
      secondaryMetadata: this.secondaryMetadata,
      fitmentStatus: this.fitmentStatus,
      verificationMode: this.verificationMode,
      selectedGlass: this.selectedGlass,
      quoteState: this.quoteState,
      handoffState: this.handoffState,
      conflicts: this.conflicts,
      reasonCodes: this.reasonCodes,
      customerRequest: this.customerRequest,
      lastQuestion: this.lastQuestion,
      auditEvents: this.auditEvents,
    };
  }

  /** Gjenopprett sesjon fra serialisert tilstand (kun egne data — aldri ukjent input). */
  static hydrate(json: Record<string, unknown>): FitmentSession {
    const s = new FitmentSession({ channel: (json.channel as Channel) ?? 'WEB_CHAT', sessionId: json.fitmentSessionId as string, maxTurnsBeforeHandoff: (json.maxTurnsBeforeHandoff as number) ?? 30 });
    s.createdAt = (json.createdAt as number) ?? s.createdAt;
    s.lastActivityAt = (json.lastActivityAt as number) ?? s.lastActivityAt;
    s.turnCount = (json.turnCount as number) ?? 0;
    s.vehicleIdentity = json.vehicleIdentity as FitmentSessionState['vehicleIdentity'];
    s.applicationIdentity = json.applicationIdentity as FitmentSessionState['applicationIdentity'];
    s.candidateSet = (json.candidateSet as Candidate[]) ?? [];
    s.evidence = (json.evidence as EvidenceEdge[]) ?? [];
    s.observations = (json.observations as CustomerObservation[]) ?? [];
    s.identifierObservations = (json.identifierObservations as IdentifierObservation[]) ?? [];
    s.photos = (json.photos as PhotoRecord[]) ?? [];
    s.questionsAsked = (json.questionsAsked as SessionQuestion[]) ?? [];
    s.pendingConfirmations = (json.pendingConfirmations as IdentifierObservation[]) ?? [];
    s.secondaryMetadata = (json.secondaryMetadata as { r43: { rawText: string; normalizedCandidate: string; visionConfidence: number }[] }) ?? { r43: [] };
    s.fitmentStatus = json.fitmentStatus as FitmentStatus | null;
    s.verificationMode = json.verificationMode as VerificationMode | null;
    s.selectedGlass = json.selectedGlass as Candidate | null;
    s.quoteState = json.quoteState as FitmentSessionState['quoteState'];
    s.handoffState = json.handoffState as FitmentSession['handoffState'];
    s.conflicts = (json.conflicts as string[]) ?? [];
    s.reasonCodes = (json.reasonCodes as string[]) ?? [];
    s.customerRequest = json.customerRequest as string | null;
    s.lastQuestion = json.lastQuestion as SessionQuestion | null;
    s.auditEvents = (json.auditEvents as AuditEvent[]) ?? [];
    return s;
  }
}

/** Ugjettbare sesjons-ID-er (16 tilfeldige byte, hex). */
export function generateSessionId(): string {
  const buf = new Uint8Array(16);
  crypto.getRandomValues(buf);
  return `fs-${Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}
