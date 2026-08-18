/**
 * conversation-v1/tools — DETERMINISTISKE verktøykontrakter (11 stk).
 * LLM-en kan ALDRI sette fitmentStatus/verificationMode/selectedGlass/authoritative/evidenceStrength
 * direkte — kun deterministisk policy (resolve_fitment / request_manual_review) gjør det.
 * Alle verktøy validerer på server-siden; kundetekst er UTRYKTET INPUT (prompt-injection-barriere).
 */
import type { Candidate, FitmentResult } from '../fitment-v1/domain.js';
import { EvidenceKernel } from '../fitment-v1/policy/kernel.js';
import { evaluateObservationGate } from '../fitment-v1/policy/gate.js';
import type { FitmentSession, IdentifierObservation, SessionQuestion } from './session.js';
import { FitmentSession as SessionClass, generateSessionId, type Channel } from './session.js';
import {
  submitSpokenIdentifier, submitTypedRegistration, submitTypedIdentifier,
  confirmIdentifier, confirmedIdentifiers, isValidRegnr,
} from './identifiers.js';
import { submitPhotoObservations, photoRetakeInstruction } from './photo.js';
import { assertPhraseAllowed, policyPhrase } from './policy.js';

// ── Kjøretøyregister (staging: SVV-verifiserte fasiter; prod vil bruke SVV-adapter bak grensesnitt) ──
export interface VehicleRegistryEntry {
  registrationNumber: string;
  vin: string | null;
  make: string;
  model: string;
  modelYear: number | null;
  firstRegistrationDate: string | null;
  svvSource: string;
}

const VEHICLE_REGISTRY: Record<string, VehicleRegistryEntry> = {
  SU18018: {
    registrationNumber: 'SU18018', vin: 'WV1ZZZ7HZ5H060934', make: 'VW', model: 'Transporter T5 2005',
    modelYear: 2005, firstRegistrationDate: '2005-04-20', svvSource: 'SVV enkeltoppslag (prod-api)',
  },
  AJ95429: {
    registrationNumber: 'AJ95429', vin: null, make: 'Mercedes', model: 'CLA 200 D 4MATIC',
    modelYear: 2016, firstRegistrationDate: '2016', svvSource: 'SVV (modell) + fixture (år)',
  },
};

export const kernel = new EvidenceKernel();

// ── 1. identify_vehicle ──
export function identifyVehicle(session: FitmentSession, registrationNumber: string): { ok: boolean; known?: boolean; vehicle?: VehicleRegistryEntry; error?: string } {
  session.touch();
  const parsed = registrationNumber.toUpperCase().replace(/\s+/g, '');
  if (!isValidRegnr(parsed)) {
    session.audit({ actor: 'tool', action: 'identify_vehicle_rejected', channel: session.channel, tool: 'identify_vehicle', raw: registrationNumber, notes: 'ugyldig regnr-format' });
    return { ok: false, error: 'ugyldig registreringsnummer' };
  }
  const vehicle = VEHICLE_REGISTRY[parsed];
  if (!vehicle) {
    session.audit({ actor: 'tool', action: 'identify_vehicle_unknown', channel: session.channel, tool: 'identify_vehicle', raw: parsed });
    session.applyFitmentPolicy({ fitmentStatus: 'UNKNOWN', verificationMode: 'HEURISTIC_ONLY', selectedGlass: null, reasonCodes: ['VEHICLE_NOT_IN_REGISTRY'], conflicts: [], evidence: [] });
    return { ok: true, known: false };
  }
  session.vehicleIdentity = { registrationNumber: vehicle.registrationNumber, make: vehicle.make, model: vehicle.model, modelYear: vehicle.modelYear };
  session.audit({ actor: 'tool', action: 'identify_vehicle_ok', channel: session.channel, tool: 'identify_vehicle', raw: parsed, notes: 'VIN fra troverdig kilde, ikke kunde' });
  return { ok: true, known: true, vehicle };
}

// ── 2. get_fitment_state ──
export function getFitmentState(session: FitmentSession): ReturnType<FitmentSession['state']> {
  session.touch();
  return session.state(true);
}

// ── 3. get_next_question — KUN resolver-definerte spørsmål ──
export function getNextQuestion(session: FitmentSession): SessionQuestion | null {
  session.touch();
  // 1) Ventende identifikator-bekreftelser har forrang (echo-back-kontroll)
  const pending = session.pendingConfirmations[0];
  if (pending) {
    const q: SessionQuestion = {
      questionId: `ident-confirm-${pending.identifierId}`,
      customerFriendlyMeaning: `Jeg leste ${pending.echoBack}. Stemmer det?`,
      candidateImpact: 'identifikator må bekreftes før den kan brukes som evidens',
      preferredModality: 'YES_NO',
      riskOfMisunderstanding: 'HIGH',
      system: true,
    };
    session.lastQuestion = q;
    return q;
  }
  // 2) Resolver-definerte fitment-spørsmål — hopp over besvarte
  const answered = new Set(session.observations.filter((o) => o.status === 'ACTIVE').map((o) => o.questionId.split('-')[1]));
  const kernelQuestions = kernelQuestionsFor(session).filter((kq) => !answered.has(kq.discriminates[0]));
  if (kernelQuestions.length > 0) {
    const kq = kernelQuestions[0];
    const discriminator = kq.discriminates[0];
    const q: SessionQuestion = {
      questionId: `fitment-${discriminator}`,
      customerFriendlyMeaning: FRIENDLY_MEANING[discriminator] ?? kq.question,
      candidateImpact: CANDIDATE_IMPACT[discriminator] ?? 'snevrer kandidatsettet',
      preferredModality: MODALITY_BY_FEATURE[discriminator] ?? 'TEXT',
      riskOfMisunderstanding: RISK[discriminator] ?? 'MEDIUM',
      system: false,
    };
    session.lastQuestion = q;
    return q;
  }
  // 3) Foto-behov fra resolveren (ikke fri LLM-gjetting)
  if (session.candidateSet.length > 1) {
    const instruction = photoRetakeInstruction(session);
    const q: SessionQuestion = {
      questionId: `photo-${Date.now()}`,
      customerFriendlyMeaning: instruction ?? 'Kan du sende et bilde av glasskanten/merkingen?',
      candidateImpact: 'foto kan gi identifikator-kandidat for bekreftelse',
      preferredModality: 'PHOTO',
      riskOfMisunderstanding: 'MEDIUM',
      system: true,
    };
    session.lastQuestion = q;
    return q;
  }
  return null;
}

function kernelQuestionsFor(session: FitmentSession) {
  // Reimplementert her for å unngå sirkulær import; identisk logikk med fitment-v1/policy/kernel.buildQuestions
  const cs = session.candidateSet;
  if (cs.length <= 1) return [];
  const has = (c: Candidate, f: string) => c.features?.includes(f) || (c.glavista as { features?: string[] } | null)?.features?.includes(f);
  const anyHas = (f: string) => cs.some((c) => has(c, f));
  const anyNotHas = (f: string) => cs.some((c) => !has(c, f));
  const out: { question: string; discriminates: string[] }[] = [];
  const Q: [string, string][] = [
    ['rainSensor', 'Har bilen regnsensor på frontruten?'],
    ['camera', 'Har bilen kamera (ADAS) i frontrutens område?'],
    ['antenna', 'Har bilen antenne i frontruten?'],
    ['coated', 'Er frontruten coated (solskjermende belegg)?'],
    ['heated', 'Har frontruten varmeelementer?'],
    ['acoustic', 'Er frontruten akustisk (støydempende)?'],
  ];
  for (const [f, q] of Q) if (anyHas(f) && anyNotHas(f)) out.push({ question: q, discriminates: [f] });
  out.push({ question: 'Kan du lese OE-nummeret (f.eks. 7H0 845 101 H) på glasskanten av den EKSISTERENDE frontruten?', discriminates: ['OE'] });
  return out;
}

const MODALITY_BY_FEATURE: Record<string, SessionQuestion['preferredModality']> = {
  rainSensor: 'YES_NO', camera: 'YES_NO', antenna: 'YES_NO', coated: 'YES_NO',
  heated: 'YES_NO', acoustic: 'YES_NO', OE: 'IDENTIFIER', photo: 'PHOTO',
};
const FRIENDLY_MEANING: Record<string, string> = {
  rainSensor: 'Har bilen regnsensor på frontruten?',
  camera: 'Har bilen kamera (ADAS) i frontrutens område?',
  antenna: 'Har bilen antenne i frontruten?',
  coated: 'Er frontruten coated (solskjermende belegg)?',
  heated: 'Har frontruten varmeelementer?',
  acoustic: 'Er frontruten akustisk (støydempende)?',
  OE: 'Kan du lese OE-nummeret på kanten av den eksisterende frontruten?',
};
const CANDIDATE_IMPACT: Record<string, string> = {
  rainSensor: 'separerer varianter med/uten regnsensor', camera: 'separerer varianter med/uten kamera',
  antenna: 'separerer varianter med/uten antenne', coated: 'separerer coated vs ikke-coated',
  heated: 'separerer varianter med/uten varme', acoustic: 'separerer akustisk vs ikke-akustisk',
  OE: 'kan entydig peke ut riktig glass via OE→glass-evidens',
};
const RISK: Record<string, SessionQuestion['riskOfMisunderstanding']> = {
  rainSensor: 'LOW', camera: 'MEDIUM', antenna: 'LOW', coated: 'MEDIUM',
  heated: 'LOW', acoustic: 'LOW', OE: 'HIGH',
};

// ── 4. submit_observation (kundesvar på resolver-spørsmål) ──
export function submitObservation(session: FitmentSession, questionId: string, value: string | boolean, opts: { modality?: string; confidence?: number; supersedes?: string | null } = {}): { ok: boolean; observationId?: string; error?: string } {
  session.touch();
  const parsed = typeof value === 'boolean' ? value : parseAnswerValue(value);
  const observationId = session.nextObservationId();
  session.observations.push({
    observationId, questionId, rawValue: String(value), value: parsed,
    modality: opts.modality ?? session.channel, confidence: opts.confidence ?? 1.0,
    status: 'ACTIVE', supersedes: opts.supersedes ?? null, recordedAt: new Date().toISOString(),
  });
  session.audit({
    actor: 'customer', action: 'observation_submitted', channel: session.channel, tool: 'submit_observation',
    inputRef: questionId, raw: String(value), normalized: String(parsed), notes: `confidence=${opts.confidence ?? 1.0}`,
  });
  return { ok: true, observationId };
}

function parseAnswerValue(value: string): boolean | string {
  const v = String(value).toLowerCase().trim();
  if (['ja', 'yes', 'true', '1'].includes(v)) return true;
  if (['nei', 'no', 'false', '0'].includes(v)) return false;
  return v;
}

// ── 5. submit_identifier_candidate ──
export function submitIdentifierCandidate(session: FitmentSession, rawIdentifier: string, identifierType: IdentifierObservation['identifierType'], opts: { modality?: string } = {}): { ok: boolean; identifier?: IdentifierObservation; echoBack?: string; error?: string } {
  session.touch();
  const modality = opts.modality ?? session.channel;
  if (identifierType === 'registrationNumber') {
    if (modality === 'TYPED' || modality === 'WEB_CHAT') return submitTypedRegistration(session, rawIdentifier);
    return submitSpokenIdentifier(session, rawIdentifier, identifierType);
  }
  if (modality === 'TYPED' || modality === 'WEB_CHAT') return submitTypedIdentifier(session, rawIdentifier, identifierType as 'OE' | 'partNumber');
  return submitSpokenIdentifier(session, rawIdentifier, identifierType);
}

// ── 6. confirm_identifier ──
export function confirmIdentifierTool(session: FitmentSession, parsedValue: string, { confirmed = true } = {}): { ok: boolean; identifier?: IdentifierObservation; error?: string } {
  session.touch();
  return confirmIdentifier(session, parsedValue, { confirmed, channel: session.channel });
}

// ── 7. submit_photo_observations ──
export function submitPhotoObservationsTool(session: FitmentSession, payload: { sourceImageId: string; observations?: { key: string; value: string | boolean; visionConfidence: number }[]; r43?: { rawText: string; normalizedCandidate: string; visionConfidence: number }[]; oes?: { rawText: string; normalizedCandidate: string; visionConfidence: number }[] }): ReturnType<typeof submitPhotoObservations> {
  session.touch();
  return submitPhotoObservations(session, payload);
}

// ── 8. resolve_fitment — ENESTE sted fitment fastsettes fra evidens ──
export function resolveFitment(session: FitmentSession): { fitmentStatus: string | null; verificationMode: string | null; selectedGlass: Candidate | null } {
  session.touch();
  if (!session.vehicleIdentity) {
    session.applyFitmentPolicy({ fitmentStatus: 'UNKNOWN', verificationMode: 'HEURISTIC_ONLY', selectedGlass: null, reasonCodes: ['NO_VEHICLE_IDENTITY'], conflicts: [], evidence: [] });
    return { fitmentStatus: 'UNKNOWN', verificationMode: 'HEURISTIC_ONLY', selectedGlass: null };
  }
  const acceptedOEs = confirmedIdentifiers(session, 'OE');

  // Korreksjoner superseder (append-only; siste svar per questionId vinner)
  const byQuestion = new Map<string, typeof session.observations>();
  for (const obs of session.observations) {
    if (!byQuestion.has(obs.questionId)) byQuestion.set(obs.questionId, []);
    byQuestion.get(obs.questionId)!.push(obs);
  }
  const featureObs: typeof session.observations = [];
  for (const [qid, list] of byQuestion) {
    const latest = list[list.length - 1];
    if (typeof latest.value === 'boolean' && latest.confidence >= 0.8 && latest.status === 'ACTIVE') featureObs.push(latest);
    for (const older of list.slice(0, -1)) {
      if (older.status === 'ACTIVE' && older.value !== latest.value) {
        older.status = 'SUPERSEDED';
        session.audit({ actor: 'resolver-policy', action: 'observation_superseded', channel: session.channel, inputRef: qid, raw: String(older.value), normalized: String(latest.value), notes: 'korreksjon: gammel evidens SUPERSEDED' });
      }
    }
  }

  // Konservativ narrowing: kun bekreftet «nei» + LISTET feature ekskluderer
  let candidates = session.candidateSet;
  const conflicts: string[] = [];
  for (const obs of featureObs) {
    const feature = obs.questionId.split('-')[1];
    if (obs.value === false && feature && feature !== 'OE') {
      const before = candidates.length;
      candidates = candidates.filter((c) => !(c.features ?? []).includes(feature));
      if (candidates.length < before) {
        session.audit({ actor: 'resolver-policy', action: 'candidate_narrowed', channel: session.channel, inputRef: feature, previousState: String(before), newState: String(candidates.length) });
      } else {
        conflicts.push(`observasjon '${feature}=nei' eliminerte ingen kandidater`);
      }
    }
  }

  if (candidates.length === 0) {
    session.applyFitmentPolicy({ fitmentStatus: 'AMBIGUOUS', verificationMode: 'HEURISTIC_ONLY', selectedGlass: null, reasonCodes: ['ZERO_CANDIDATES_AFTER_NARROWING'], conflicts, evidence: session.evidence });
    session.candidateSet = candidates;
    return { fitmentStatus: 'AMBIGUOUS', verificationMode: 'HEURISTIC_ONLY', selectedGlass: null };
  }
  session.candidateSet = candidates;

  if (acceptedOEs.length > 0) {
    const vehicleData = {
      registrationNumber: session.vehicleIdentity.registrationNumber,
      vin: vinFor(session),
      make: session.vehicleIdentity.make,
      model: session.vehicleIdentity.model,
      modelYear: session.vehicleIdentity.modelYear,
      svvSource: 'staging-register',
    };
    const result = kernel.resolveWithObservation(
      vehicleData,
      acceptedOEs.map((oe) => ({ type: 'OE' as const, value: oe, reliable: true, notes: 'kundebekreftet identifikator' })),
      { observedAt: new Date().toISOString() },
    );
    const resolvedCandidates = result.candidates.filter((c) => candidates.some((k) => k.glass === c.glass) || c.reasonCodes?.includes('GLAVISTA_ONLY_IDENTITY'));
    const unique = resolvedCandidates.length === 1;
    const gate = evaluateObservationGate({ narrowedByEvidence: true, observations: [{ reliable: true }], remainingCandidates: resolvedCandidates });
    session.applyFitmentPolicy({
      fitmentStatus: unique && gate.passed ? 'EXACT' : 'AMBIGUOUS',
      verificationMode: unique && gate.passed ? 'CUSTOMER_OBSERVATION' : 'CUSTOMER_OBSERVATION',
      selectedGlass: unique && gate.passed ? resolvedCandidates[0] : null,
      reasonCodes: [...result.reasonCodes],
      conflicts, evidence: result.evidence,
    });
    session.candidateSet = resolvedCandidates;
    return { fitmentStatus: session.fitmentStatus, verificationMode: session.verificationMode, selectedGlass: session.selectedGlass };
  }

  if (featureObs.length > 0) {
    const gate = evaluateObservationGate({ narrowedByEvidence: true, observations: featureObs.map((o) => ({ reliable: o.confidence >= 0.8 })), remainingCandidates: candidates });
    const unique = candidates.length === 1;
    session.applyFitmentPolicy({
      fitmentStatus: unique && gate.passed ? 'EXACT' : 'AMBIGUOUS',
      verificationMode: unique && gate.passed ? 'CUSTOMER_OBSERVATION' : 'HEURISTIC_ONLY',
      selectedGlass: unique && gate.passed ? candidates[0] : null,
      reasonCodes: unique && gate.passed ? ['FEATURE_OBSERVATION_UNIQUE'] : ['APPLICATION_LINKAGE_NOT_AUTHORITATIVE'],
      conflicts, evidence: session.evidence,
    });
    return { fitmentStatus: session.fitmentStatus, verificationMode: session.verificationMode, selectedGlass: session.selectedGlass };
  }

  if (!session.fitmentStatus) {
    session.applyFitmentPolicy({ fitmentStatus: 'AMBIGUOUS', verificationMode: 'HEURISTIC_ONLY', selectedGlass: null, reasonCodes: ['NO_NEW_EVIDENCE'], conflicts, evidence: session.evidence });
  }
  return { fitmentStatus: session.fitmentStatus, verificationMode: session.verificationMode, selectedGlass: session.selectedGlass };
}

function vinFor(session: FitmentSession): string | null {
  // VIN hentes kun fra troverdig kjøretøy-data (registret/SVV) — aldri kunde-diktert
  const reg = VEHICLE_REGISTRY[session.vehicleIdentity?.registrationNumber ?? ''];
  return reg?.vin ?? null;
}

// ── 9. request_manual_review — strukturert handoff-pakke ──
export function requestManualReview(session: FitmentSession, reason: string): { ok: boolean; handoff?: ReturnType<typeof buildHandoffPacket>; error?: string } {
  session.touch();
  const packet = buildHandoffPacket(session);
  session.handoffState = { reason, packet };
  session.audit({ actor: 'tool', action: 'manual_review_requested', channel: session.channel, tool: 'request_manual_review', inputRef: reason, newState: packet.sessionId });
  return { ok: true, handoff: packet };
}

export function buildHandoffPacket(session: FitmentSession) {
  const accepted = session.identifierObservations.filter((i) => i.state === 'CONFIRMED').map((i) => ({ identifierId: i.identifierId, parsed: i.parsed }));
  const rejectedOrSuperseded = session.identifierObservations.filter((i) => i.state === 'REJECTED' || i.state === 'SUPERSEDED').map((i) => ({ identifierId: i.identifierId, parsed: i.parsed, state: i.state }));
  return {
    sessionId: session.fitmentSessionId,
    customerRequest: session.customerRequest,
    vehicle: session.vehicleIdentity,
    vin: vinFor(session), // internt der det trengs — aldri i klient-tilstand
    candidateSet: session.candidateSet.map((c) => c.glass),
    acceptedEvidence: accepted,
    rejectedOrSupersededEvidence: rejectedOrSuperseded,
    photos: session.photos.map((p) => p.sourceImageId),
    unresolvedQuestions: session.questionsAsked.filter((q) => !q.system).map((q) => q.questionId),
    conflicts: session.conflicts,
    reasonCodes: session.reasonCodes,
    conversationSummary: summarize(session),
    recommendedHumanAction: recommendedAction(session),
  };
}

function summarize(session: FitmentSession): string {
  const lines: string[] = [];
  if (session.vehicleIdentity) lines.push(`Kjøretøy: ${session.vehicleIdentity.make} ${session.vehicleIdentity.model} (${session.vehicleIdentity.registrationNumber})`);
  lines.push(`Status: ${session.fitmentStatus ?? 'ikke løst'} / ${session.verificationMode ?? '-'}`);
  lines.push(`Kandidater: ${session.candidateSet.length}`);
  lines.push(`Bekreftede identifikatorer: ${confirmedIdentifiers(session, 'OE').join(', ') || 'ingen'}`);
  lines.push(`Kundesvar: ${session.observations.map((o) => `${o.questionId}=${String(o.value)}`).join('; ') || 'ingen'}`);
  return lines.join('\n');
}

function recommendedAction(session: FitmentSession): string {
  if (session.fitmentStatus === 'UNKNOWN') return 'Verifiser kjøretøy mot SVV/VIN manuelt';
  if (session.fitmentStatus === 'AMBIGUOUS' && session.candidateSet.length === 0) return 'Konflikt: alle kandidater ekskludert — verifiser kundens svar';
  if (session.fitmentStatus === 'AMBIGUOUS') return 'Få kunde til å lese OE-nummer på eksisterende frontrute, eller verifiser mot EPC';
  return 'Bekreft funn og opprett ordre';
}

// ── 10. get_price_estimate (PRICE_ESTIMATE — tillatt ved AMBIGUOUS) ──
export function getPriceEstimate(session: FitmentSession): { ok: boolean; estimate?: { min: number | null; max: number | null; labelled: boolean }; error?: string } {
  session.touch();
  const prices = session.candidateSet.map((c) => (c as Candidate & { listepris?: number | null }).listepris ?? catalogPrice(c.glass)).filter((p): p is number => typeof p === 'number');
  if (prices.length === 0) return { ok: false, error: 'ingen priser tilgjengelig for kandidatene' };
  session.quoteState = 'PRICE_ESTIMATE';
  session.audit({ actor: 'tool', action: 'price_estimate_created', channel: session.channel, tool: 'get_price_estimate', newState: `${Math.min(...prices)}-${Math.max(...prices)}`, notes: 'estimat — aldri orderable' });
  return { ok: true, estimate: { min: Math.min(...prices), max: Math.max(...prices), labelled: true } };
}

function catalogPrice(eurocode: string): number | null {
  const PRICES: Record<string, number> = {
    '8579ACSGYAVZ1B': 14045, '8579AGSVZ1B': 10070, '8579AGSGYAVZ1B': 9980,
    '8579AGSGYAMVZ1B': 10010, '8579AGSGYMVZ1B': 10505,
  };
  return PRICES[eurocode] ?? null;
}

// ── 11. create_orderable_quote (kun EXACT + AUTHORITATIVE_DATA/CUSTOMER_OBSERVATION/MANUAL_VERIFICATION) ──
const ORDERABLE_MODES = ['AUTHORITATIVE_DATA', 'CUSTOMER_OBSERVATION', 'MANUAL_VERIFICATION'] as const;

export function createOrderableQuote(session: FitmentSession): { ok: boolean; quote?: { varenr: string | null; eurocode: string; verificationMode: string | null }; error?: string } {
  session.touch();
  const allowed = session.fitmentStatus === 'EXACT' && session.verificationMode !== null && (ORDERABLE_MODES as readonly string[]).includes(session.verificationMode);
  if (!allowed || !session.selectedGlass) {
    session.audit({ actor: 'tool', action: 'orderable_quote_rejected', channel: session.channel, tool: 'create_orderable_quote', reasonCode: session.fitmentStatus ?? 'NOT_RESOLVED', notes: 'HEURISTIC_ONLY må aldri låse opp checkout' });
    return { ok: false, error: `ORDERABLE_QUOTE krever EXACT + autoritativ/kundebekreftet/manuell verifisering — nåværende: ${session.fitmentStatus ?? 'ikke løst'}/${session.verificationMode ?? '-'}` };
  }
  session.quoteState = 'ORDERABLE_QUOTE';
  const quote = { varenr: session.selectedGlass.varenr, eurocode: session.selectedGlass.glass, verificationMode: session.verificationMode };
  session.audit({ actor: 'tool', action: 'orderable_quote_created', channel: session.channel, tool: 'create_orderable_quote', newState: session.selectedGlass.glass, notes: JSON.stringify(quote) });
  return { ok: true, quote };
}

// ── bootstrap: last kandidater fra kjernen ved identifisering ──
export function bootstrapCandidates(session: FitmentSession): { ok: boolean; candidateCount?: number; error?: string } {
  if (!session.vehicleIdentity) return { ok: false, error: 'ingen kjøretøyidentitet' };
  const vehicle = VEHICLE_REGISTRY[session.vehicleIdentity.registrationNumber];
  const result: FitmentResult = kernel.resolve({
    registrationNumber: vehicle.registrationNumber, vin: vehicle.vin, make: vehicle.make,
    model: vehicle.model, modelYear: vehicle.modelYear, firstRegistrationDate: vehicle.firstRegistrationDate,
    svvSource: vehicle.svvSource,
  });
  session.candidateSet = result.candidates;
  session.applicationIdentity = { modelFamily: result.candidates.length > 0 ? 'ukjent generasjon' : null, unknownAttributes: ['generation', 'body', 'productionInterval', 'engine', 'salesVariant', 'facelift'] };
  session.applyFitmentPolicy({ fitmentStatus: result.fitmentStatus, verificationMode: result.verificationMode, selectedGlass: null, reasonCodes: result.reasonCodes, conflicts: result.conflicts, evidence: result.evidence });
  session.audit({ actor: 'resolver-policy', action: 'candidate_set_loaded', channel: session.channel, newState: String(result.candidates.length), reasonCode: result.reasonCodes.join(',') });
  return { ok: true, candidateCount: result.candidates.length };
}

// ── sesjonsfabrikk (unguessable ID-er) ──
export function createSession(channel: Channel, opts: { maxTurnsBeforeHandoff?: number } = {}): FitmentSession {
  return new SessionClass({ channel, maxTurnsBeforeHandoff: opts.maxTurnsBeforeHandoff });
}

export { assertPhraseAllowed, policyPhrase, generateSessionId };
export type { Channel };
