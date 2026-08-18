/**
 * fitment-v1/generation-registry — modellgenerasjoner med produksjonsintervaller.
 * KILDE: SVV-mønster-analyse 2026-08-16 (Wikipedia-fasit, dokumentert i data/gt-ekspansjon/svv-monster-analyse-2026-08-16.md).
 * Dette er KANDIDAT-materiale (hever VEHICLE → MODEL GENERATION → APPLICATION CANDIDATE),
 * ALDRI fasit og ALDRI EXACT alene.
 */
import type { FamilyKnowledge } from './application-resolver.js';

const G = (applicationId: string, make: string, model: string, generation: string, from: number, to: number | null): FamilyKnowledge => ({
  applicationId, make, model, generation, productionInterval: { from, to },
});

export function buildDefaultGenerationRegistry(): FamilyKnowledge[] {
  return [
    // ── VW Transporter T5 (eksisterende, med facelift-split) ──
    { applicationId: 'app-vw-t5-2003', make: 'VW', model: 'Transporter', modelAliases: ['Caravelle', 'Multivan'], generation: 'T5', body: 'van', productionInterval: { from: 2003, to: 2015 }, faceliftSplit: 'post-facelift' },
    { applicationId: 'app-vw-t5-2003-prefacelift', make: 'VW', model: 'Transporter', modelAliases: ['Caravelle', 'Multivan'], generation: 'T5', body: 'van', productionInterval: { from: 2003, to: 2010 }, faceliftSplit: 'pre-facelift' },
    // ── VW Transporter T6 / T6.1 (2015–2024; T6.1 = facelift fra 2019) ──
    { applicationId: 'app-vw-t6-2015', make: 'VW', model: 'Transporter', modelAliases: ['Caravelle', 'Multivan'], generation: 'T6', body: 'van', productionInterval: { from: 2015, to: 2024 }, faceliftSplit: 'post-facelift' },
    { applicationId: 'app-vw-t6-2015-prefacelift', make: 'VW', model: 'Transporter', modelAliases: ['Caravelle', 'Multivan'], generation: 'T6', body: 'van', productionInterval: { from: 2015, to: 2019 }, faceliftSplit: 'pre-facelift' },
    // ── Mercedes CLA (eksisterende) ──
    { applicationId: 'app-mb-cla-2013', make: 'Mercedes', model: 'CLA', generation: 'C117', productionInterval: { from: 2013, to: 2019 } },
    { applicationId: 'app-mb-cla-2019', make: 'Mercedes', model: 'CLA', generation: 'C118', productionInterval: { from: 2019, to: null } },

    // ── VW Golf I–VIII (år → generasjon) ──
    G('app-vw-golf-1', 'VW', 'Golf', 'Golf I (Typ 17)', 1974, 1983),
    G('app-vw-golf-2', 'VW', 'Golf', 'Golf II (Typ 19E/1G)', 1983, 1991),
    G('app-vw-golf-3', 'VW', 'Golf', 'Golf III (Typ 1H)', 1991, 1997),
    G('app-vw-golf-4', 'VW', 'Golf', 'Golf IV (Typ 1J)', 1997, 2003),
    G('app-vw-golf-5', 'VW', 'Golf', 'Golf V (Typ 1K)', 2003, 2008),
    G('app-vw-golf-6', 'VW', 'Golf', 'Golf VI (Typ 5K)', 2008, 2012),
    G('app-vw-golf-7', 'VW', 'Golf', 'Golf VII (Typ 5G)', 2012, 2019),
    G('app-vw-golf-8', 'VW', 'Golf', 'Golf VIII (Typ CD1)', 2019, null),

    // ── VW Passat B1–B9 ──
    G('app-vw-passat-1', 'VW', 'Passat', 'Passat B1', 1973, 1981),
    G('app-vw-passat-2', 'VW', 'Passat', 'Passat B2', 1981, 1988),
    G('app-vw-passat-3', 'VW', 'Passat', 'Passat B3', 1988, 1993),
    G('app-vw-passat-4', 'VW', 'Passat', 'Passat B4', 1993, 1996),
    G('app-vw-passat-5', 'VW', 'Passat', 'Passat B5', 1996, 2005),
    G('app-vw-passat-6', 'VW', 'Passat', 'Passat B6', 2005, 2010),
    G('app-vw-passat-7', 'VW', 'Passat', 'Passat B7', 2010, 2014),
    G('app-vw-passat-8', 'VW', 'Passat', 'Passat B8', 2014, 2023),
    G('app-vw-passat-9', 'VW', 'Passat', 'Passat B9', 2023, null),

    // ── VW Polo I–VI ──
    G('app-vw-polo-1', 'VW', 'Polo', 'Polo I', 1975, 1981),
    G('app-vw-polo-2', 'VW', 'Polo', 'Polo II', 1981, 1994),
    G('app-vw-polo-3', 'VW', 'Polo', 'Polo III', 1994, 2002),
    G('app-vw-polo-4', 'VW', 'Polo', 'Polo IV', 2002, 2009),
    G('app-vw-polo-5', 'VW', 'Polo', 'Polo V', 2009, 2017),
    G('app-vw-polo-6', 'VW', 'Polo', 'Polo VI', 2017, null),

    // ── Opel (fra svv-monster-analyse del 2) ──
    G('app-opel-vectra-a', 'Opel', 'Vectra', 'Vectra A', 1988, 1995),
    G('app-opel-vectra-b', 'Opel', 'Vectra', 'Vectra B', 1995, 2002),
    G('app-opel-vectra-c', 'Opel', 'Vectra', 'Vectra C', 2002, 2008),
    G('app-opel-corsa-a', 'Opel', 'Corsa', 'Corsa A', 1982, 1993),
    G('app-opel-corsa-b', 'Opel', 'Corsa', 'Corsa B', 1993, 2000),
    G('app-opel-corsa-c', 'Opel', 'Corsa', 'Corsa C', 2000, 2006),
    G('app-opel-corsa-d', 'Opel', 'Corsa', 'Corsa D', 2006, 2014),
    G('app-opel-astra-f', 'Opel', 'Astra', 'Astra F', 1991, 1998),
    G('app-opel-astra-g', 'Opel', 'Astra', 'Astra G', 1998, 2004),
    G('app-opel-astra-h', 'Opel', 'Astra', 'Astra H', 2004, 2010),
    G('app-opel-astra-j', 'Opel', 'Astra', 'Astra J', 2010, 2015),
    G('app-opel-astra-k', 'Opel', 'Astra', 'Astra K', 2015, 2021),

    // ── MINI (fra svv-monster-analyse del 2) ──
    G('app-mini-r50', 'MINI', 'Cooper', 'MINI R50', 2001, 2006),
    G('app-mini-r56', 'MINI', 'Cooper', 'MINI R56', 2007, 2013),
    G('app-mini-f56', 'MINI', 'Cooper', 'MINI F56', 2014, null),
  ];
}
