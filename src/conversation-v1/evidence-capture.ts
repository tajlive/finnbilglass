/**
 * conversation-v1/evidence-capture — C8: AI-agenten som kunnskapsinnsamler.
 * Kobler samtaleobservasjoner til C8-evidence-lagrene (customer-evidence + installation-fixture).
 * REGEL: AI spør → kunden svarer → evidens bygges. AI gjetter aldri.
 * Alt registreres deterministisk fra eksisterende session-state; ingen LLM-tolkning.
 */
import { ObservationStore } from '../learning-v1/customer-evidence.js';
import type { CustomerObservation } from '../learning-v1/customer-evidence.js';

interface SessionLike {
  vehicleIdentity: { registrationNumber: string; make: string; model: string; modelYear: number | null } | null;
}

export class EvidenceCapture {
  constructor(private readonly store: ObservationStore = new ObservationStore()) {}

  private vehicleRef(s: SessionLike | null) {
    if (!s?.vehicleIdentity) return null;
    return {
      make: s.vehicleIdentity.make,
      model: s.vehicleIdentity.model,
      year: s.vehicleIdentity.modelYear,
      regnrHash: s.vehicleIdentity.registrationNumber ? `hash:${s.vehicleIdentity.registrationNumber}` : null,
    };
  }

  /** Strukturert feature-svar (fra /api/assistant/observation eller UI-knapper). */
  captureFeature(s: SessionLike | null, questionId: string, value: string | boolean, candidateVarenr: string | null): CustomerObservation | null {
    const ref = this.vehicleRef(s);
    if (!ref) return null;
    const feature = questionId.startsWith('q_') ? questionId.replace('q_', '') : questionId;
    if (!['rainSensor', 'camera', 'antenna', 'coated', 'heated', 'acoustic'].includes(feature)) return null;
    return this.store.record({
      vehicleRef: ref,
      feature: feature as CustomerObservation['feature'],
      value,
      source: 'ECHO_CONFIRMED',
      reliability: 'ECHO_CONFIRMED',
      candidateVarenr,
    });
  }

  /** OE-merking bekreftet (echo) — høyeste kundeobservasjon for EXACT-kjeden. */
  captureOeConfirmed(s: SessionLike | null, oe: string, candidateVarenr: string | null): CustomerObservation | null {
    const ref = this.vehicleRef(s);
    if (!ref) return null;
    return this.store.record({
      vehicleRef: ref,
      feature: 'oeMarking',
      value: oe.toUpperCase(),
      source: 'ECHO_CONFIRMED',
      reliability: 'ECHO_CONFIRMED',
      candidateVarenr,
    });
  }

  /** OE-merking skrevet (uten echo ennå) — svakere, oppgraderes ved bekreftelse. */
  captureOeTyped(s: SessionLike | null, oe: string): CustomerObservation | null {
    const ref = this.vehicleRef(s);
    if (!ref) return null;
    return this.store.record({
      vehicleRef: ref,
      feature: 'oeMarking',
      value: oe.toUpperCase(),
      source: 'CUSTOMER_OBSERVATION',
      reliability: 'PLAIN',
      candidateVarenr: null,
    });
  }

  observations(): CustomerObservation[] {
    return this.store.all();
  }
}
