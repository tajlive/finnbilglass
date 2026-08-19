/**
 * Feature-flags for evidence-flyten — default false (kun eksplisitt 'true' åpner).
 * AI får aldri beslutningsmyndighet: alle skrivebaner krever token-autentisert,
 * append-only handling med actor + tidspunkt.
 */

export type FeatureNavn = 'EVIDENCE_UPLOAD_ENABLED' | 'EVIDENCE_REVIEW_ENABLED' | 'EVIDENCE_STATUS_CHANGE_ENABLED';

export interface FlagEnv {
  EVIDENCE_UPLOAD_ENABLED?: string;
  EVIDENCE_REVIEW_ENABLED?: string;
  EVIDENCE_STATUS_CHANGE_ENABLED?: string;
}

/** true kun når var-verdien er eksakt 'true'. Udefinert/annet = false (sikker default). */
export function featureEnabled(env: FlagEnv, navn: FeatureNavn): boolean {
  return env[navn] === 'true';
}

/** Standard 403 når et feature-flag er av — forståelig, ikke 404. */
export function featureDisabled(navn: string): Response {
  return new Response(JSON.stringify({ ok: false, error: 'feature_disabled', feature: navn, melding: 'Denne funksjonen er ikke aktivert ennå.' }), {
    status: 403,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

/** Gyldige operatør-beslutninger for AI-observasjon-gjennomgang (append-only). */
export const GYLDIGE_REVIEW_DECISIONS = ['godkjenn', 'avvis', 'request_image'] as const;
export type ReviewDecision = (typeof GYLDIGE_REVIEW_DECISIONS)[number];

export function erGyldigReviewDecision(d: string): d is ReviewDecision {
  return (GYLDIGE_REVIEW_DECISIONS as readonly string[]).includes(d);
}
