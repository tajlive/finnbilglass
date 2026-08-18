/**
 * fitment-v1/question-optimizer — C9: spørre-rekkefølge-optimalisering.
 * Mål: minst mulig friksjon — spør om det som ELIMINERER flest kandidater først.
 * Etter C7-prinsippet: evidens eliminerer. Optimalt spørsmål = høyest eliminasjonspotensial,
 * ved likhet vinner den mest balanserte splitten (nærmest 50/50).
 */
import type { Candidate } from './domain.js';
import { candidateDifferences, buildEvidenceRequests, type EvidenceRequest } from './differentiation.js';

export interface QuestionRank {
  feature: string;
  jaEliminerer: number;
  neiEliminerer: number;
  potensial: number;
  balanse: number; // 0 = perfekt 50/50
  /** C9.1: Question Value = potensial × feilkostnad × svarbarhet */
  questionValue: number;
  feilkostnad: number;
  svarbarhet: number;
}

/**
 * Feilkostnad per feature (C9.1): hvor dyrt er en feilbestilling hvis svaret er feil?
 * ADAS-kamera/HUD = høyest (kalibrering + speilhus), regnsensor høy, coated/acoustic middels.
 */
export const FEATURE_COST: Record<string, number> = {
  camera: 1.0, cameraBracket: 1.0, sensor: 0.9, sensorBracket: 0.9, rainSensor: 0.8,
  coated: 0.6, acoustic: 0.6, heated: 0.5, antenna: 0.4, tint: 0.4, shadeBand: 0.3,
  moulding: 0.3, variant: 0.5, OE: 1.0, calibrated: 1.0,
};

/**
 * Svarbarhet per feature (C9.1): kundens sannsynlighet for å vite svaret.
 * Kamera/regnsensor = lett å svare på; HUD/coated = sjelden kjent.
 */
export const FEATURE_ANSWERABILITY: Record<string, number> = {
  camera: 0.95, rainSensor: 0.9, cameraBracket: 0.85, antenna: 0.75, heated: 0.8,
  sensor: 0.6, sensorBracket: 0.6, acoustic: 0.6, variant: 0.7, moulding: 0.5,
  tint: 0.7, shadeBand: 0.5, coated: 0.4, OE: 0.95, calibrated: 0.35,
};

/** Eliminasjonspotensial per informativ feature: hvor mange kandidater et ja/nei-svar fjerner. */
export function rankQuestions(candidates: Candidate[]): QuestionRank[] {
  const diffs = candidateDifferences(candidates).filter((d) => d.informative);
  return diffs.map((d) => {
    let jaEliminerer = 0;
    let neiEliminerer = 0;
    for (const v of d.values) {
      if (v === true || v === 'true') neiEliminerer++;          // «nei» fjerner kandidater med feature=true
      else if (v === false || v === 'false') jaEliminerer++;     // «ja» fjerner kandidater med feature=false
      // null/ukjent: elimineres ikke konservativt
    }
    const potensial = Math.max(jaEliminerer, neiEliminerer);
    const balanse = Math.abs(jaEliminerer - neiEliminerer);
    const feilkostnad = FEATURE_COST[d.feature] ?? 0.5;
    const svarbarhet = FEATURE_ANSWERABILITY[d.feature] ?? 0.5;
    const questionValue = potensial * feilkostnad * svarbarhet;
    return { feature: d.feature, jaEliminerer, neiEliminerer, potensial, balanse, questionValue, feilkostnad, svarbarhet };
  });
}

/**
 * Optimal spørre-rekkefølge: potensial desc, så balanse asc (nærmest 50/50).
 * OE-ID (foto/merking) har alltid høyest prioritet når den skiller — én observasjon kan
 * erstatte flere spørsmål (C1-prinsippet «prefer minimum reliable evidence»).
 */
export function optimalQuestionOrder(candidates: Candidate[]): string[] {
  const ranks = rankQuestions(candidates);
  // C9.1: sorter på Question Value (eliminering × feilkostnad × svarbarhet) desc — ikke bare potensial
  const order = [...ranks].sort((a, b) => b.questionValue - a.questionValue || b.potensial - a.potensial).map((r) => r.feature);
  // OE-ID flyttes øverst hvis noen kandidat HAR OE — én lesning av merkingen kan erstatte flere
  // feature-spørsmål (C1 «prefer minimum reliable evidence»); selve OE-strengen er det som skiller.
  const harOe = candidates.some((c) => (c.glavista as { oes?: string[] } | null | undefined)?.oes?.length);
  if (harOe) {
    const rest = order.filter((f) => f !== 'OE');
    return ['OE', ...rest];
  }
  return order;
}

/** Bygger evidensspørsmål i optimal rekkefølge (brukes i stedet for buildEvidenceRequests). */
export function rankedEvidenceRequests(candidates: Candidate[], photoEnabled = true): EvidenceRequest[] {
  const requests = buildEvidenceRequests(candidates, photoEnabled);
  const order = optimalQuestionOrder(candidates);
  const byFeature = new Map(requests.map((r) => [r.feature, r]));
  return order.map((f) => byFeature.get(f)).filter((r): r is EvidenceRequest => r != null);
}
