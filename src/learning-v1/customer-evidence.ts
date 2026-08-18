/**
 * learning-v1/customer-evidence — C8: kunder som sensorer.
 * Strukturert innsamling av kundeobservasjoner (feature-evidence) knyttet til kjøretøy og kandidater.
 * AI spør → kunden svarer → evidens bygges. AI gjetter aldri.
 * Personvern: vehicleRef er kun hash; ingen eierdata.
 */
export interface VehicleRef {
  regnrHash?: string | null;
  vinHash?: string | null;
  make: string;
  model: string;
  year: number | null;
}

export type ObservationFeature = 'rainSensor' | 'camera' | 'antenna' | 'coated' | 'heated' | 'acoustic' | 'oeMarking' | 'r43' | 'other';

export interface CustomerObservation {
  observationId: string;
  vehicleRef: VehicleRef;
  feature: ObservationFeature;
  /** Ja/nei/observert-verdi; for oeMarking: selve OE-strengen (normalisert) */
  value: string | boolean;
  source: 'CUSTOMER_OBSERVATION' | 'PHOTO' | 'SPOKEN' | 'ECHO_CONFIRMED';
  reliability: 'ECHO_CONFIRMED' | 'PLAIN' | 'INFERRED';
  candidateVarenr: string | null;
  capturedAt: string;
}

let obsCounter = 0;

/** Append-only observasjonslager. Innsamling bygger evidens; evidens alene setter aldri EXACT. */
export class ObservationStore {
  private observations: CustomerObservation[] = [];

  record(o: Omit<CustomerObservation, 'observationId' | 'capturedAt'>): CustomerObservation {
    const full: CustomerObservation = { ...o, observationId: `obs-${Date.now()}-${++obsCounter}`, capturedAt: new Date().toISOString() };
    this.observations.push(full);
    return full;
  }

  /** Observasjoner for et kjøretøy (hash-match). */
  forVehicle(vehicleRef: VehicleRef): CustomerObservation[] {
    const key = (v: VehicleRef) => `${v.make}|${v.model}|${v.year}`;
    return this.observations.filter((o) => key(o.vehicleRef) === key(vehicleRef));
  }

  all(): CustomerObservation[] {
    return [...this.observations];
  }
}

/** Ekstraherer et deterministisk feature-evidence-kart fra observasjoner (aldri LLM-tolket). */
export function buildFeatureEvidence(observations: CustomerObservation[]): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const o of observations) {
    if (o.feature === 'oeMarking' || o.feature === 'r43' || o.feature === 'other') continue;
    if (typeof o.value === 'boolean') out[o.feature] = o.value;
    else out[o.feature] = /ja|yes|true|1|har|finnes/i.test(String(o.value));
  }
  return out;
}
