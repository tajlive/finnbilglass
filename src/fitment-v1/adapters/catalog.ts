/**
 * fitment-v1/adapters/catalog — intern katalog-kunnskapsbase (INTERNAL_CATALOG, IKKE uavhengig evidens).
 * Verifisert mot data/gt-ekspansjon/prisliste-alle-glass.json (2026-08-18) og prod-svar.
 */
import type { SourceRecord } from '../domain.js';

export const INTERNAL_CATALOG_SOURCE: SourceRecord = {
  id: 'gt-auto-prisliste-2026',
  provider: 'Autoglass intern prisliste (auto-glass.no)',
  dataset: 'gt-ekspansjon/prisliste-alle-glass.json',
  version: '2026-08',
  acquiredAt: '2026-08-13',
  url: 'https://auto-glass.no (bak innlogging)',
};

export interface CatalogRow {
  varenr: string;
  eurokode: string;
  variant?: string | null;
  productionInterval?: { from: string | null; to: string | null } | null;
  features: string[];
  listepris?: number | null;
  notes?: string | null;
}

/** SU18018-familien (prod-svar 2026-08-18; fasit 2525GYA, Tom 2026-08-16). */
export const T5_FAMILY: CatalogRow[] = [
  { varenr: '2525CSGY', eurokode: '8579ACSGYAVZ1B', features: ['coated', 'antenna'], listepris: 14045, notes: 'ANTENNEFESTE MIDT PÅ (katalog)' },
  { varenr: '2525GY', eurokode: '8579AGSVZ1B', features: [], listepris: 10070, notes: 'OBS-OBS SJEKK OM DET ER (katalog)' },
  { varenr: '2525GYA', eurokode: '8579AGSGYAVZ1B', features: ['antenna'], listepris: 9980, notes: 'EMB=101 (katalog); Tom-fasit 2026-08-16' },
  { varenr: '2525GYAM', eurokode: '8579AGSGYAMVZ1B', features: ['rainSensor', 'antenna'], listepris: 10010, notes: 'HUSK S1 (katalog)' },
  { varenr: '2525GYM', eurokode: '8579AGSGYMVZ1B', features: ['rainSensor'], listepris: 10505, notes: 'prod-kandidat 2026-08-18' },
  { varenr: '8579GZPV2', eurokode: '7H0877051', features: [], listepris: null, notes: 'MAX 30% (katalog); T5 Multivan 03-' },
];

/** AJ95429-familien — 1B/1T som SEPARATE varianter (produksjonsintervall i katalognavn). */
export const CLA_FAMILY: CatalogRow[] = [
  { varenr: '3172GNCM', eurokode: '5381AGACMVW1B', variant: '1B', productionInterval: { from: null, to: '2015-09' }, features: ['rainSensor', 'camera'], listepris: null, notes: 'MERCEDES A+CLA+GLA 5D 12-SEP15' },
  { varenr: '3172GNCM', eurokode: '5381AGACMVW1T', variant: '1T', productionInterval: { from: '2015-10', to: null }, features: ['rainSensor'], listepris: null, notes: 'MERCEDES A+CLA+GLA 5D OKT 15-' },
  { varenr: '3172GNCA', eurokode: '5381AGAACMVW1B', variant: '1B', productionInterval: { from: null, to: '2015-09' }, features: ['rainSensor', 'camera'], listepris: null, notes: 'A+CLA+GLA 5D 12-SEP15' },
  { varenr: '3172GNCA', eurokode: '5381AGAACMVW1T', variant: '1T', productionInterval: { from: '2015-10', to: null }, features: ['rainSensor'], listepris: null, notes: 'A+CLA+GLA 5D OKT 15-' },
  { varenr: '3172GNM', eurokode: '5381AGAMVW', variant: '1B', productionInterval: { from: null, to: '2015-09' }, features: ['acoustic', 'rainSensor'], listepris: null, notes: '12-SEPT15' },
  { varenr: '3172GNM2', eurokode: '5381AGAMVW1T', variant: '1T', productionInterval: { from: '2015-10', to: null }, features: ['rainSensor'], listepris: null, notes: 'OKT15-' },
];

/** Finn katalogkandidater for kjøretøyfamilie (make+model-token). */
export function findCatalogCandidates(vehicle: { make: string; model: string }): CatalogRow[] {
  const m = String(vehicle.make || '').toUpperCase();
  const mo = String(vehicle.model || '').toUpperCase();
  if (m.includes('VW') && (mo.includes('TRANSPORTER') || mo.includes('TRANSPORT') || mo.includes('MULTIVAN') || mo.includes('CARAVELLE'))) {
    return T5_FAMILY;
  }
  if (m.includes('MERCEDES') && (mo.includes('CLA') || mo.includes('A-CLASS') || mo.includes('GLA'))) {
    return CLA_FAMILY;
  }
  return [];
}
