/**
 * learning-v1/growth — C8: Evidence Growth Engine.
 * Hvor mye Application Coverage kan ekte installasjoner bygge, og hvor trengs de mest?
 * Input: SVV-korpus-volum per familie (truth) + ROI-prioritet (C7.6). Output: fixtur-plan.
 * Aldri auto-EXACT: fixtures styrker evidensgrafen; gaten avgjør.
 */
import type { FixtureAggregate } from './installation-fixture.js';

export interface FamilyVolume {
  familie: string;
  make: string;
  svvBiler: number;
  markedsAnnonser: number;
  roiScore: number;
}

export interface GrowthPlanRow {
  familie: string;
  make: string;
  svvBiler: number;
  markedsAnnonser: number;
  /** Korroborerte fixtures (applikasjon→glass) som allerede finnes */
  fixturesNow: number;
  /** Estimerte fixtures som trengs for 50 % applikasjonsdekning i familien */
  fixturesForHalfCoverage: number;
  /** Dekningsbidrag per fixture: hver bekreftet installasjon gir 1 applikasjon→glass-fixture */
  dekningPerFixturePct: number;
}

/**
 * Bygger vekstplan: for hver familie (sortert etter ROI), hvor mange bekreftede
 * installasjonsfixtures som trengs for å nå 50 % av bilene i familien.
 * Estimat: én korroborert fixture dekker én applikasjon; en applikasjon rommer
 * gjennomsnittlig svvBiler/applikasjonerPerFamilie biler (konservativt 8).
 */
export function buildGrowthPlan(volumes: FamilyVolume[], corroborated: FixtureAggregate[]): GrowthPlanRow[] {
  const fixturesPerFamily = new Map<string, number>();
  for (const fx of corroborated) {
    const fam = fx.applikasjonKey.split('|')[1]?.trim() ?? '';
    fixturesPerFamily.set(fam, (fixturesPerFamily.get(fam) ?? 0) + 1);
  }
  const plan = volumes.map((v) => {
    const fixturesNow = fixturesPerFamily.get(v.familie) ?? 0;
    const perFixture = 8; // konservativt: én applikasjon rommer ~8 biler i snitt
    const fixturesForHalfCoverage = Math.ceil((v.svvBiler * 0.5) / perFixture);
    return {
      familie: v.familie,
      make: v.make,
      svvBiler: v.svvBiler,
      markedsAnnonser: v.markedsAnnonser,
      fixturesNow,
      fixturesForHalfCoverage,
      dekningPerFixturePct: Math.round((perFixture / Math.max(1, v.svvBiler)) * 1000) / 10,
    };
  });
  return plan.sort((a, b) => b.markedsAnnonser - a.markedsAnnonser);
}

/** Prioriterte mål-familier (Toms liste): der kundemengden er. */
export const PRIORITY_FAMILIES = ['TRANSPORTER', 'GOLF', 'PASSAT', 'MODEL-3', 'MODEL-Y', '3-SERIE', 'SPRINTER', 'VITO', 'XC60', 'LEAF', 'RAV4'];
