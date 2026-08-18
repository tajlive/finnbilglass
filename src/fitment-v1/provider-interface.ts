/**
 * fitment-v1/provider-interface — grensesnitt for fremtidig VIN/applikasjon → article/OE.
 * Lisensiert TecDoc/EPC eller annen leverandør kan legges til UTEN å skrive om resolveren.
 * Lokal 1Q2019 TecDoc-snapshot mangler article_vehicle_linkage/OE/VIN — aldri late som det finnes.
 */
import type { ApplicationCandidate } from './application-resolver.js';

export interface ArticleOELookupResult {
  oes: { raw: string; normalized: string; provider: string; namespace: string }[];
  applicationId: string | null;
  provider: string;
  evidenceClass: 'AUTHORITATIVE' | 'INFERRED';
  gap: 'VEHICLE_TO_OE_GAP' | null;
  notes?: string;
}

export interface VinApplicationProvider {
  readonly name: string;
  /** VIN → applikasjon(er) med OE-artikler. Må ALDRI blande rå kType-ID-er på tvers av navnerom. */
  lookupApplicationAndOEs(v: { vin: string; make: string; model: string; modelYear: number | null }): Promise<ArticleOELookupResult[]>;
  availability(): 'AVAILABLE' | 'ACCESS_REQUIRED' | 'NOT_CONFIGURED';
}

/** Lokal TecDoc-probe (1Q2019-snapshot): tilgjengelig men mangler de kritiske koblingene. */
export class LocalTecDocProbeProvider implements VinApplicationProvider {
  readonly name = 'tecdoc-local-1q2019';
  availability() { return 'ACCESS_REQUIRED' as const; }
  async lookupApplicationAndOEs(): Promise<ArticleOELookupResult[]> {
    // Snapshot har kType-registry (70 891) men INGEN article_vehicle_linkage/OE/VIN-kobling.
    return [{ oes: [], applicationId: null, provider: this.name, evidenceClass: 'INFERRED', gap: 'VEHICLE_TO_OE_GAP', notes: '1Q2019-snapshot mangler article_vehicle_linkage + OE-på-artikler + VIN-identifikasjon. VEHICLE_TO_OE_GAP opprettholdes eksplisitt.' }];
  }
}

export const VEHICLE_TO_OE_GAP = 'VEHICLE_TO_OE_GAP';
