/**
 * learning-v1/installation-fixture — C8: Verified Installation Fixtures.
 * Montør/kunde bekrefter INSTALLED_SUCCESSFULLY → høyeste evidens (VERIFIED_REAL_WORLD_INSTALLATION).
 * WRONG_GLASS → NEGATIV evidens som ELIMINERER kandidaten (evidens eliminerer, aldri bare scorer).
 * Læring ≠ automatisk sannhet: fixtures holder PROVISIONAL til Tom-gjennomgang → VERIFIED.
 */
import type { VehicleRef, CustomerObservation } from './customer-evidence.js';

export type FixtureResult = 'INSTALLED_SUCCESSFULLY' | 'WRONG_GLASS' | 'PENDING';

export interface InstallationFixture {
  fixtureId: string;
  vehicleRef: VehicleRef;
  candidateVarenr: string;
  candidateEurokode: string | null;
  observations: CustomerObservation[];
  result: FixtureResult;
  recordedAt: string;
  reviewedBy?: string | null;
  lifecycle: 'CAPTURED' | 'PROVISIONAL' | 'VERIFIED' | 'REJECTED';
}

let fixtureCounter = 0;

export interface FixtureAggregate {
  varenr: string;
  applikasjonKey: string; // make|model|generasjon
  installert: number;      // INSTALLED_SUCCESSFULLY
  feilGlass: number;       // WRONG_GLASS — negativ evidens
  pending: number;
  /** Første korroborerte-installasjon-dato (ikke nødvendig for logikk, men for sporbarhet) */
  firstSeen: string;
}

/** C8-fixturelager: append-only, aggregerer korroborasjon deterministisk. */
export class InstallationFixtureStore {
  private fixtures: InstallationFixture[] = [];

  record(f: Omit<InstallationFixture, 'fixtureId' | 'recordedAt' | 'lifecycle'>): InstallationFixture {
    const full: InstallationFixture = {
      ...f,
      fixtureId: `fx-${Date.now()}-${++fixtureCounter}`,
      recordedAt: new Date().toISOString(),
      lifecycle: 'CAPTURED',
    };
    this.fixtures.push(full);
    return full;
  }

  /** Aggregat per (applikasjon, glass) — korroborasjon bygges av uavhengige installasjoner. */
  aggregate(): Map<string, FixtureAggregate> {
    const m = new Map<string, FixtureAggregate>();
    for (const fx of this.fixtures) {
      const key = `${fx.vehicleRef.make}|${fx.vehicleRef.model}|${fx.candidateVarenr}`;
      const appKey = `${fx.vehicleRef.make}|${fx.vehicleRef.model}`;
      const cur = m.get(key) ?? { varenr: fx.candidateVarenr, applikasjonKey: appKey, installert: 0, feilGlass: 0, pending: 0, firstSeen: fx.recordedAt };
      if (fx.result === 'INSTALLED_SUCCESSFULLY') cur.installert++;
      else if (fx.result === 'WRONG_GLASS') cur.feilGlass++;
      else cur.pending++;
      m.set(key, cur);
    }
    return m;
  }

  /** Negativ evidens: WRONG_GLASS-frekvens over terskel ELIMINERER kandidaten for applikasjonen. */
  eliminatedCandidates(threshold = 0.5): { varenr: string; applikasjonKey: string; feilGlass: number; installert: number }[] {
    const out: { varenr: string; applikasjonKey: string; feilGlass: number; installert: number }[] = [];
    for (const [key, agg] of this.aggregate()) {
      const total = agg.installert + agg.feilGlass;
      if (total >= 3 && agg.feilGlass / total >= threshold) {
        out.push({ varenr: agg.varenr, applikasjonKey: agg.applikasjonKey, feilGlass: agg.feilGlass, installert: agg.installert });
      }
    }
    return out;
  }

  /** Korroborasjon: ≥N uavhengige INSTALLED_SUCCESSFULLY på samme (applikasjon, glass). */
  corroboratedFixtures(minInstallations = 3): FixtureAggregate[] {
    return [...this.aggregate().values()].filter((a) => a.installert >= minInstallations).sort((a, b) => b.installert - a.installert);
  }
}
