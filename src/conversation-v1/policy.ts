/**
 * conversation-v1/policy — konversasjonspolicy + hard frase-guard (norsk).
 * Agenten må ALDRI bruke «riktig/eksakt glass funnet» når fitmentStatus != EXACT.
 */
import type { FitmentSession, SessionQuestion } from './session.js';

const FORBIDDEN_WHEN_NOT_EXACT: RegExp[] = [
  /(fant|funnet) (det |ditt |deres )?(eksakt|eksakte|riktig|riktige|korrekt|korrekte|rett|rette) glass/i,
  /\b(er|var) (det |ditt |deres )?(eksakt|eksakte|riktig|riktige|korrekt|korrekte|rett|rette) glass/i,
  /exact[ -]?match/i,
  /dette er (ruta|glasset|ruten) (til|for)/i,
  /garantert riktig variant/i,
];

/** Kast POLICY-BRUDD hvis agentteksten hevder eksakt treff uten EXACT-status. */
export function assertPhraseAllowed(text: string, fitmentStatus: string | null): boolean {
  if (fitmentStatus === 'EXACT') return true;
  for (const re of FORBIDDEN_WHEN_NOT_EXACT) {
    if (re.test(text)) {
      throw new Error(`POLICY-BRUDD: agent hevder eksakt treff mens fitmentStatus=${fitmentStatus}: "${text}"`);
    }
  }
  return true;
}

/** Kundevendt frase per status (fra C2-briefens ordlyd). */
export function policyPhrase(session: FitmentSession): string {
  if (session.handoffState) return 'Jeg sender saken til manuell kontroll.';
  switch (session.fitmentStatus) {
    case 'EXACT':
      return session.verificationMode === 'CUSTOMER_OBSERVATION'
        ? `Riktig variant bekreftet: ${session.selectedGlass?.varenr ?? session.selectedGlass?.glass}.`
        : `Riktig variant: ${session.selectedGlass?.varenr ?? session.selectedGlass?.glass}.`;
    case 'AMBIGUOUS': {
      const n = session.candidateSet.length;
      if (n === 0) return 'Jeg fant ingen aktuelle varianter uten konflikt. Jeg sender saken til manuell kontroll.';
      const q = session.lastQuestion;
      if (q) return `Jeg har funnet aktuelle varianter, men trenger én opplysning til før jeg kan bekrefte riktig rute: ${q.customerFriendlyMeaning}`;
      return `Jeg har funnet ${n} aktuelle varianter, men trenger én opplysning til før jeg kan bekrefte riktig rute.`;
    }
    case 'UNKNOWN':
      return 'Jeg kan ikke bekrefte riktig rute automatisk. Jeg sender saken til manuell kontroll.';
    default:
      return 'Vi starter med å identifisere bilen. Kan du oppgi registreringsnummeret?';
  }
}

/** Klientstatus-merkelapp (staging-UI) — ingen intern konfidens/jargon. */
export function stateLabel(session: FitmentSession): string {
  if (session.handoffState) return 'Sendt til manuell kontroll';
  switch (session.fitmentStatus) {
    case 'EXACT': return 'Riktig variant bekreftet';
    case 'AMBIGUOUS':
      if (session.pendingConfirmations.length > 0) return 'Trenger én kontroll';
      return 'Flere ruter mulige';
    case 'UNKNOWN': return 'Bil ikke funnet';
    default: return session.vehicleIdentity ? 'Bil funnet' : 'Identifiserer bil';
  }
}

export type { SessionQuestion };
