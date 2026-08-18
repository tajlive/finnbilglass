/**
 * learning-v1/evidence-ledger — C8.1: Evidence Ledger (rent domene, ingen D1-avhengighet).
 * Immutable append-only evidens- og fixture-logging. Hver event har Toms modell:
 * source_type / evidence_type / value / confidence / status / created_by.
 *
 * - Evidence Decay: evidens eldes (montør i går = 100 %, 5 år siden = 90 %; kunde = 70 %; AI-antakelse = 0 %)
 * - Evidence Monotonicity: når systemet har sterkere evidens, går det aldri bakover og spør om det samme igjen
 * - Læring ≠ sannhet: status-gate CAPTURED → VERIFIED; REJECTED beholdes (audit trail)
 * - explainDecision(): «Hvorfor valgte systemet dette glasset?» → forklaringskjede
 */

export type LedgerSourceType = 'CUSTOMER' | 'OE_IMAGE' | 'INSTALLATION' | 'MONTOR' | 'SYSTEM';
export type LedgerEvidenceType = 'CAMERA' | 'RAIN_SENSOR' | 'OE' | 'ACOUSTIC' | 'HEATED' | 'ANTENNA' | 'COATED' | 'TINT' | 'SHADE_BAND' | 'OTHER';
export type LedgerStatus = 'CAPTURED' | 'CONFIRMED' | 'VERIFIED' | 'REJECTED';
export type LedgerCreatedBy = 'customer' | 'installer' | 'ai' | 'system';
export type FixtureOutcome = 'INSTALLED_SUCCESSFULLY' | 'WRONG_GLASS';
export type FixtureStatus = 'CAPTURED' | 'VERIFIED' | 'REJECTED';

export interface LedgerEvent {
  id: string;
  vehicleIdentityHash: string;
  registrationHash: string | null;
  createdAt: number;
  sourceType: LedgerSourceType;
  evidenceType: LedgerEvidenceType;
  value: string;
  confidence: number; // 0–100
  status: LedgerStatus;
  createdBy: LedgerCreatedBy;
  sessionId: string | null;
  candidateVarenr: string | null;
  supersedes: string | null;
  notes: string | null;
}

export interface FixtureRecord {
  fixtureId: string;
  vehicleIdentityHash: string;
  candidateVarenr: string;
  eurokode: string | null;
  outcome: FixtureOutcome;
  installerId: string | null;
  confirmedAt: number;
  status: FixtureStatus;
  sourceOrderId: string | null;
  notes: string | null;
}

export interface LedgerStore {
  appendEvent(ev: LedgerEvent): Promise<void>;
  eventsForVehicle(vehicleIdentityHash: string): Promise<LedgerEvent[]>;
  upsertFixture(fx: FixtureRecord): Promise<void>;
  fixturesForVehicle(vehicleIdentityHash: string): Promise<FixtureRecord[]>;
  allEvents(): Promise<LedgerEvent[]>;
}

/** Hash for personvern: kjennemerke/VIN lagres aldri rå — kun sha256-hash med salt (Web Crypto, workers-kompatibel). */
export async function identityHash(input: string): Promise<string> {
  const data = new TextEncoder().encode(`finnbilglass-evidence:${input.trim().toUpperCase()}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Evidence Decay (C8.1): base-styrke per kilde, lineært forfall 2 %/år — montør i går 100 %, 5 år siden 90 %. */
export function evidenceStrength(ev: Pick<LedgerEvent, 'sourceType' | 'createdBy' | 'confidence' | 'createdAt'>, now = Date.now()): number {
  if (ev.createdBy === 'ai') return 0; // AI-antakelse er aldri evidens (0 %), uansett sourceType
  const base = ev.sourceType === 'OE_IMAGE' || ev.sourceType === 'INSTALLATION' || ev.sourceType === 'MONTOR' ? 1.0
    : ev.sourceType === 'CUSTOMER' ? 0.7
    : 0.5;                            // SYSTEM (f.eks. SVV/VIN)
  const ageYears = Math.max(0, (now - ev.createdAt) / (365.25 * 24 * 3600 * 1000));
  const decayed = base * Math.max(0, 1 - 0.02 * ageYears);
  return Math.round(decayed * (ev.confidence / 100) * 1000) / 1000;
}

/**
 * Evidence Monotonicity Rule: aldri spør om det samme igjen når systemet har aktiv evidens.
 * «Når systemet får sterkere evidens skal det aldri gå bakover og spørre om det samme igjen.»
 */
export function hasActiveEvidence(events: LedgerEvent[], evidenceType: LedgerEvidenceType, now = Date.now()): boolean {
  return events.some(
    (e) => e.evidenceType === evidenceType && e.status !== 'REJECTED' && evidenceStrength(e, now) > 0,
  );
}

/**
 * explainDecision — «Hvorfor valgte systemet dette glasset?»
 * Returnerer forklaringskjeden: evidens (sortert etter styrke) + fixture-korroborasjon + konklusjon.
 * Kun deterministisk: EXACT krever bekreftet OE-evidence ELLER korroborerte installasjoner (≥3),
 * aldri AI-gjetting (AI-strength = 0 teller ikke).
 */
export function explainDecision(events: LedgerEvent[], fixtures: FixtureRecord[], now = Date.now()) {
  const korroborertVarenr = new Map<string, { installed: number; wrong: number }>();
  for (const fx of fixtures) {
    const r = korroborertVarenr.get(fx.candidateVarenr) ?? { installed: 0, wrong: 0 };
    if (fx.outcome === 'INSTALLED_SUCCESSFULLY') r.installed++;
    else r.wrong++;
    korroborertVarenr.set(fx.candidateVarenr, r);
  }
  const evidence = events
    .map((e) => ({ event: e, strength: evidenceStrength(e, now) }))
    .filter((x) => x.strength > 0)
    .sort((a, b) => b.strength - a.strength);

  const oe = evidence.find((x) => x.event.evidenceType === 'OE' && (x.event.status === 'CONFIRMED' || x.event.status === 'VERIFIED'));
  const bestFixture = [...korroborertVarenr.entries()].sort((a, b) => b[1].installed - a[1].installed)[0];
  const exact = Boolean(
    (oe && (oe.event.candidateVarenr || oe.event.notes)) ||
    (bestFixture && bestFixture[1].installed >= 3 && bestFixture[1].wrong === 0),
  );
  const konklusjon = exact ? 'EXACT' : 'UNKNOWN';
  return {
    konklusjon,
    evidens: evidence.map((x) => ({
      type: x.event.evidenceType, value: x.event.value, styrke: x.strength,
      kilde: x.event.sourceType, status: x.event.status, createdBy: x.event.createdBy, dato: new Date(x.event.createdAt).toISOString(),
    })),
    installasjoner: [...korroborertVarenr.entries()].map(([varenr, r]) => ({ varenr, installed: r.installed, wrong: r.wrong })),
    beslutningsgrunnlag: exact
      ? (oe ? `OE ${oe.event.value} bekreftet (styrke ${oe.strength})` : `${bestFixture![1].installed} uavhengige INSTALLED_SUCCESSFULLY på ${bestFixture![0]}`)
      : 'mangler autoritativ evidens — UNKNOWN er korrekt svar (jeg vet ikke er bedre enn feil)',
  };
}
