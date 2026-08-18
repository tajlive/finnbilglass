/**
 * conversation-v1/evidence-capture — C8: AI-agenten som kunnskapsinnsamler.
 * Kobler samtaleobservasjoner til C8-evidence-lagrene (customer-evidence + installation-fixture).
 * C8.1: valgfri D1-ledger — hver observasjon appender til evidence_events (immutable, sha256-hash).
 * REGEL: AI spør → kunden svarer → evidens bygges. AI gjetter aldri.
 * Alt registreres deterministisk fra eksisterende session-state; ingen LLM-tolkning.
 */
import { ObservationStore } from '../learning-v1/customer-evidence.js';
import type { CustomerObservation } from '../learning-v1/customer-evidence.js';
import type { LedgerStore, LedgerEvent, LedgerSourceType, LedgerEvidenceType, LedgerStatus, LedgerCreatedBy } from '../learning-v1/evidence-ledger.js';
import { identityHash } from '../learning-v1/evidence-ledger.js';

interface SessionLike {
  fitmentSessionId?: string;
  vehicleIdentity: { registrationNumber: string; make: string; model: string; modelYear: number | null } | null;
}

export class EvidenceCapture {
  constructor(
    private readonly store: ObservationStore = new ObservationStore(),
    private readonly ledger: LedgerStore | null = null,
  ) {}

  /** Append til D1-ledgeren (fire-and-forget, append-only, aldri rå kjennemerke — kun sha256-hash). */
  private appendLedger(
    s: SessionLike | null,
    sourceType: LedgerSourceType,
    evidenceType: LedgerEvidenceType,
    value: string,
    confidence: number,
    status: LedgerStatus,
    createdBy: LedgerCreatedBy,
    candidateVarenr: string | null,
  ): void {
    if (!this.ledger || !s?.vehicleIdentity?.registrationNumber) return;
    void (async () => {
      const vehicleHash = await identityHash(s.vehicleIdentity!.registrationNumber!);
      const ev: LedgerEvent = {
        id: `ev-${crypto.randomUUID()}`,
        vehicleIdentityHash: vehicleHash,
        registrationHash: null,
        createdAt: Date.now(),
        sourceType, evidenceType, value, confidence, status, createdBy,
        sessionId: s.fitmentSessionId ?? null, candidateVarenr, supersedes: null, notes: null,
      };
      await this.ledger!.appendEvent(ev);
    })().catch(() => { /* ledger-feil blokkerer aldri samtalen */ });
  }

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
    this.appendLedger(s, 'CUSTOMER', feature.toUpperCase() as LedgerEvidenceType, String(value), 100, 'CONFIRMED', 'customer', candidateVarenr);
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
    this.appendLedger(s, 'CUSTOMER', 'OE', oe.toUpperCase(), 100, 'CONFIRMED', 'customer', candidateVarenr);
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
    this.appendLedger(s, 'CUSTOMER', 'OE', oe.toUpperCase(), 70, 'CAPTURED', 'customer', null);
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
