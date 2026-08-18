/**
 * learning-v1/conversation-learning — utled strukturerte læringssignaler fra en sesjon.
 * Råtranskriptet behandles ALDRI som sannhet — kun strukturerte signaler.
 * Personidentifiserende data skilles fra gjenbrukbar domene-læring (data-minimering).
 */
import type { ConversationLearningSignal } from './schema.js';

export interface SessionView {
  fitmentSessionId: string;
  channel: string;
  vehicleIdentity: { registrationNumber: string; make: string; model: string; modelYear: number | null } | null;
  questionsAsked: { questionId: string; system: boolean }[];
  observations: { questionId: string; value: string | boolean; status: string; recordedAt: string }[];
  identifierObservations: { state: string; parsed: string; modality: string }[];
  photos: { identifierCandidates: { state: string }[] }[];
  fitmentStatus: string | null;
  verificationMode: string | null;
  handoffState: { reason: string } | null;
  quoteState: string | null;
  auditEvents: { action: string; notes?: string | null; raw?: string | null }[];
  turnCount: number;
}

/** Strukturerte signaler fra en avsluttet/aktuell sesjon. */
export function extractLearningSignals(s: SessionView): ConversationLearningSignal {
  const questionsAsked = s.questionsAsked.length;
  const questionsAnswered = s.observations.length;
  const customerCorrections = s.auditEvents.filter((e) => e.action === 'observation_superseded').map((e) => e.notes ?? '');
  const agentCorrections = s.auditEvents.filter((e) => e.action === 'identifier_rejected').map((e) => e.raw ?? '');
  const photoRetakes = s.auditEvents.filter((e) => e.action === 'photo_observations_submitted' && (e.notes ?? '').includes('rejected:1')).length;
  return {
    sessionId: s.fitmentSessionId,
    channel: s.channel,
    vehicle: s.vehicleIdentity,
    questionsAsked,
    questionsAnswered,
    customerDidNotUnderstand: customerCorrections.length > 0,
    customerCorrections,
    agentCorrections,
    photosRequested: s.auditEvents.filter((e) => e.action === 'photo_observations_submitted').length,
    photoRetakes,
    manualHandoff: s.handoffState !== null,
    resolutionMethod: s.handoffState ? 'MANUAL_REVIEW' : s.fitmentStatus ?? null,
    finalFitmentStatus: s.fitmentStatus,
    verificationMode: s.verificationMode,
    orderCreated: s.quoteState === 'ORDERABLE_QUOTE',
    laterInstallationOutcome: null,
    turns: s.turnCount,
    derivedAt: new Date().toISOString(),
  };
}

// ── 16. Personvern: data-minimering ──
/** Trekk ut gjenbrukbar domene-læring; koble FRA kundeidentifiserende data. */
export interface ReusableLearning {
  pattern: string;
  evidenceCount: number;
  example: string; // anonymisert
  category: 'misunderstanding' | 'correction' | 'question_weakness' | 'terminology' | 'photo_issue';
}

const PII_PATTERNS = [/\+47[\s-]?(\d[\s-]?){8,9}/g, /[A-ZÆØÅ]{2}\s?\d{5}/g, /[\w.+-]+@[\w-]+\.[\w.]+/g];

export function anonymize(text: string): string {
  let out = text;
  out = out.replace(PII_PATTERNS[0], '[telefon]');
  out = out.replace(PII_PATTERNS[1], '[kjennemerke]');
  out = out.replace(PII_PATTERNS[2], '[epost]');
  return out;
}

/**
 * Transformér kundeobservasjoner til gjenbrukbar læring:
 * «Tom Hansen på +47… sa at regnsensor og kamera var det samme» →
 * «Kunder forveksler regnsensor og ADAS-kamera.»
 */
export function deriveReusableLearning(customerStatements: string[], misreadIdentifiers: string[]): ReusableLearning[] {
  const out: ReusableLearning[] = [];
  const confusion = customerStatements.filter((t) => /regnsensor|kamera|sensor/i.test(t) && /samme|tror|trodde|bland/i.test(t));
  if (confusion.length > 0) {
    out.push({ pattern: 'Kunder forveksler regnsensor og ADAS-kamera.', evidenceCount: confusion.length, example: anonymize(confusion[0]).slice(0, 120), category: 'misunderstanding' });
  }
  const misread = misreadIdentifiers.filter(Boolean);
  if (misread.length > 0) {
    out.push({ pattern: 'Kunder leser feil revisjonsbokstav på OE-nummer (H/F/B forveksles).', evidenceCount: misread.length, example: `feillest: ${anonymize(misread[0])}`, category: 'correction' });
  }
  return out;
}
