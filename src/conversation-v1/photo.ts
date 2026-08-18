/**
 * conversation-v1/photo — strukturert foto-observasjonspipeline.
 * Bilde-AI produserer OBSERVASJONER, aldri glass-valg. OCR-konfidens er IKKE fitment-evidens.
 * Identifikator-stater: EXTRACTED → CONFIRMATION_REQUIRED → CONFIRMED / REJECTED / SUPERSEDED.
 */
import type { FitmentSession, PhotoRecord } from './session.js';
import { formatEchoBack } from './identifiers.js';

export const OE_VISION_CONFIDENCE_THRESHOLD = 0.8;

export const PHOTO_OBSERVATION_KEYS = [
  'cameraPresent', 'sensorPresent', 'sensorBracketType', 'heatingVisible',
  'HUDIndication', 'manufacturerMark', 'manufacturerPartNumber',
  'oeNumberCandidate', 'glassFeatureMarking',
];

export interface PhotoInput {
  sourceImageId: string;
  observations?: { key: string; value: string | boolean; visionConfidence: number }[];
  r43?: { rawText: string; normalizedCandidate: string; visionConfidence: number }[];
  oes?: { rawText: string; normalizedCandidate: string; visionConfidence: number }[];
}

/**
 * Registrer strukturerte foto-observasjoner:
 * - OE-kandidat under terskel → avvist (EXTRACTED, aldri autoritativ; be om nytt bilde).
 * - OE-kandidat over terskel → CONFIRMATION_REQUIRED (kunde må bekrefte; konfidens alene er aldri nok).
 * - R43 → secondaryMetadata.r43[] (SEKUNDÆR — aldri fitment-input).
 */
export function submitPhotoObservations(session: FitmentSession, input: PhotoInput): {
  ok: boolean;
  photo?: PhotoRecord;
  requiresConfirmation: string[];
  rejectedOEs: { normalizedCandidate: string; visionConfidence: number }[];
  problems: string[];
} {
  const problems: string[] = [];
  const validated = [];
  for (const obs of input.observations ?? []) {
    if (!PHOTO_OBSERVATION_KEYS.includes(obs.key)) { problems.push(`ukjent observasjonsnøkkel: ${obs.key}`); continue; }
    validated.push({ ...obs, customerConfirmed: false, sourceImageId: input.sourceImageId });
  }
  const r43Meta = (input.r43 ?? []).map((r) => ({ ...r, customerConfirmed: false, sourceImageId: input.sourceImageId }));
  const oeCandidates = (input.oes ?? []).map((o) => {
    const norm = String(o.normalizedCandidate || o.rawText || '').replace(/\s+/g, '').toUpperCase();
    return { ...o, normalizedCandidate: norm, eligible: (o.visionConfidence ?? 0) >= OE_VISION_CONFIDENCE_THRESHOLD, sourceImageId: input.sourceImageId };
  });

  const rejectedOEs = oeCandidates.filter((o) => !o.eligible);
  const eligibleOEs = oeCandidates.filter((o) => o.eligible);

  const identifierCandidates = eligibleOEs.map((o) => ({
    identifierId: `id-${session.auditEvents.length}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    identifierType: 'OE' as const,
    rawText: o.rawText,
    parsed: o.normalizedCandidate,
    echoBack: formatEchoBack(o.normalizedCandidate),
    state: 'CONFIRMATION_REQUIRED' as const,
    modality: 'PHOTO' as const,
    visionConfidence: o.visionConfidence,
    sourceImageId: input.sourceImageId,
    recordedAt: new Date().toISOString(),
  }));

  const photo: PhotoRecord = {
    sourceImageId: input.sourceImageId,
    observations: validated,
    identifierCandidates,
    r43: r43Meta,
    receivedAt: new Date().toISOString(),
  };
  session.photos.push(photo);
  session.secondaryMetadata.r43.push(...r43Meta.map((r) => ({ rawText: r.rawText, normalizedCandidate: r.normalizedCandidate, visionConfidence: r.visionConfidence })));
  session.identifierObservations.push(...identifierCandidates);
  session.pendingConfirmations.push(...identifierCandidates);

  session.audit({
    actor: 'vision-ai', action: 'photo_observations_submitted', channel: session.channel, tool: 'submit_photo_observations',
    mediaRef: input.sourceImageId,
    observationEffect: JSON.stringify(validated.map((o) => `${o.key}=${String(o.value)}`)),
    notes: `r43:${r43Meta.length}, oe:${oeCandidates.length}, rejected:${rejectedOEs.length}`,
  });

  return {
    ok: problems.length === 0,
    photo,
    requiresConfirmation: identifierCandidates.map((c) => c.parsed),
    rejectedOEs: rejectedOEs.map((o) => ({ normalizedCandidate: o.normalizedCandidate, visionConfidence: o.visionConfidence })),
    problems,
  };
}

/** Lav-konfidens-håndtering: resolver-definerte fotoinstruksjoner (aldri fri LLM-gjetting). */
export function photoRetakeInstruction(session: FitmentSession): string | null {
  if (!session.vehicleIdentity) return null;
  // Resolver-definert behov: OE-merking nederst i hjørnet / regnsensor-området bak speil
  const needsOE = session.candidateSet.length > 1;
  const hasSensorQuestion = session.questionsAsked.some((q) => q.questionId === 'fitment-rainSensor');
  if (needsOE && !hasSensorQuestion) return 'Ta et nærbilde av merkingen nederst i hjørnet av frontruten.';
  return 'Ta et bilde av området bak innvendig speil (regnsensor/kamera).';
}
