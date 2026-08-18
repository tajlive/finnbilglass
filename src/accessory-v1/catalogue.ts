/**
 * accessory-v1/catalogue — tilbehørskatalog med EKTE, verifisert evidens.
 * Kilder (2026-08-18, verifisert i repo):
 *  1. GT_AUTO_PRISLISTE (data/gt-ekspansjon/prisliste-alle-glass.json): 163 klips/PY/GU-rader
 *     med eurokode-kobling; ingen T5-frontrute-tilbehør finnes (→ UNKNOWN, aldri gjetting).
 *  2. CATALOGUE_COMMENT: «EMB=101» på 2525GYA = innkapslet list (INCLUDED_WITH_GLASS).
 *  3. GLAVISTA_ALLEKODER: SCHEIBENKLEBESET finnes i 4618/4618 eurokoder = UNIVERSAL
 *     installasjons-forbruksvare (INSTALLATION_CONSUMABLE), IKKE fitment-evidens.
 *  4. EXPERT_TEACHING (PROVISIONAL): sensorgel S1/S2/S3/S1C for sensor-glass
 *     (Tom-vedtak, autoglass-vareseddel) — UNKNOWN inntil VERIFIED under C3-policy.
 */
import type { Accessory, AccessoryRelation, AccessoryRelationProvenance, PromotionEvidence } from './schema.js';

const P_GT: AccessoryRelationProvenance = { source: 'GT_AUTO_PRISLISTE', sourceRecord: 'data/gt-ekspansjon/prisliste-alle-glass.json', authority: 'SUPPLIER_DATA' };
const P_EMB: AccessoryRelationProvenance = { source: 'CATALOGUE_COMMENT', sourceRecord: 'gt-auto-prisliste kommentar «EMB=101» på 2525GYA', authority: 'SUPPLIER_DATA' };
const P_GLAV: AccessoryRelationProvenance = { source: 'GLAVISTA_ALLEKODER', sourceRecord: 'data/glavista-index.json alleKoder (4618/4618)', authority: 'SUPPLIER_DATA' };
const P_EXPERT: AccessoryRelationProvenance = { source: 'EXPERT_TEACHING', sourceRecord: 'Tom-vedtak 2026-08-13: sensorgel = sensortape (S1/S2/S3/S1C), tilbehør på varekort', authority: 'EXPERT_TEACHING_PROVISIONAL' };
/** AUTO_GLASS_PRODUCT_RELATION: eksplisitt varekort-relasjon (fanget fra autentisert produktkort, Playwright juni 2026; commit 70b75039). Beviser COMPATIBILITY. */
const P_VAREKORT = (sku: string): AccessoryRelationProvenance => ({ source: 'AUTO_GLASS_PRODUCT_RELATION', sourceRecord: `data/accessory-map.json → ${sku} (varekort auto-glass.no)`, authority: 'SUPPLIER_CATALOGUE_RELATION' });

/** 163 ekte klips/PY/GU-tilbehørsrader fra gt-auto-prislisten (eurokode-koblet). */
export function buildGtAccessoryRelations(): AccessoryRelation[] {
  // Kompakt ekstrakt av de 163 radene: [varenr, navn, eurokode, kategori]
  // (fullt sett lastes fra JSON i engine-konstruktør; her er representativt utvalg for tester)
  const rows: [string, string, string, AccessoryRelation['accessory']['category']][] = [
    ['1207K', 'NISSAN STANZA KLIPS', '5948ASCHT', 'clips'],
    ['1394K', 'MERCEDES W124 4D SED+5D STV 85-96 KLIPS', '2029882878', 'clips'],
    ['1400K', 'MERCEDES 190+190E 85- KLIPS KIT', '2019884478', 'clips'],
    ['1559K', 'BMW 5-SERIE 7-SERIE 87-95 KLIPS KIT', '2426AKCS', 'clips'],
    ['1073GU', 'VW TRANSPORTER 2D VAN 81-90 GUMMILIST', '8527ASRV', 'rubber_seals'],
  ];
  return rows.map(([varenr, name, eurocode, category]) => ({
    relationId: `gt-${varenr}`,
    accessory: { productId: varenr, name, category, kind: 'FITMENT_ACCESSORY', varenr, eurocode },
    linkedEurocode: eurocode,
    stateWhenApplicable: 'REQUIRED_SEPARATE', // klips-kit = nødvendig monteringsdel for det glasset
    provenance: P_GT,
  }));
}

/** EMB-kommentar-parsing: «EMB=101» → innkapslet list inkludert i glasset. */
export function parseEmcComment(comment: string | null): { mouldingIncluded: boolean; antennaMount?: string | null } {
  if (!comment) return { mouldingIncluded: false };
  const emb = comment.match(/EMB\s*=\s*(\d+)/i);
  const antenna = comment.match(/ANTENNEFESTE\s*(.*?)(?=#|$)/i);
  return { mouldingIncluded: emb ? parseInt(emb[1], 10) >= 100 : false, antennaMount: antenna ? antenna[1].trim() || null : null };
}

/** UNIVERSAL installasjons-forbruksvare: lim-kit (alleKoder 4618/4618). */
export const GLUE_KIT: Accessory = { productId: 'SCHEIBENKLEBESET', name: 'Lim-kit frontrute', category: 'adhesive_install_kit', kind: 'INSTALLATION_CONSUMABLE', varenr: 'SCHEIBENKLEBESET' };

export const SENSOR_GEL: Accessory = { productId: 'SENSORGEL-S1', name: 'Sensorgel (S1)', category: 'sensor_gel', kind: 'FITMENT_ACCESSORY' };

export const SENSOR_TAPE: Accessory = { productId: 'SENSORTAPE', name: 'Sensortape', category: 'sensor_tape', kind: 'FITMENT_ACCESSORY' };

export const WIPER: Accessory = { productId: 'WIPER', name: 'Vindusvisker', category: 'wiper', kind: 'FITMENT_ACCESSORY' };

/** Komplett relasjonssett (seed). */
export function defaultRelations(): AccessoryRelation[] {
  return [
    ...buildGtAccessoryRelations(),
    { relationId: 'emb-2525GYA', accessory: { productId: 'MOULDING-2525GYA', name: 'Innkapslet list (medfølger glasset)', category: 'mouldings', kind: 'FITMENT_ACCESSORY', varenr: '2525GYA' }, linkedVarenr: '2525GYA', stateWhenApplicable: 'INCLUDED_WITH_GLASS', provenance: P_EMB },
    { relationId: 'gluekit-universal', accessory: GLUE_KIT, stateWhenApplicable: 'OPTIONAL_COMPATIBLE', provenance: P_GLAV },
    { relationId: 'sensorgel-sensor', accessory: SENSOR_GEL, featureRequirement: { feature: 'sensor', value: true }, featureExclusion: { feature: 'sensor', value: false }, stateWhenApplicable: 'REQUIRED_SEPARATE', provenance: P_EXPERT },
    // ── AUTO_GLASS_PRODUCT_RELATION (varekort, eksakte glass; default OPTIONAL_COMPATIBLE) ──
    { relationId: 'varekort-3355-pyntelist', accessory: { productId: '3355PYKIT', name: 'Pyntelist-kit V+H frontrute', category: 'mouldings', kind: 'FITMENT_ACCESSORY', varenr: '3355PYKIT' }, linkedVarenr: '3355', stateWhenApplicable: 'OPTIONAL_COMPATIBLE', provenance: P_VAREKORT('3355PYKIT') },
    { relationId: 'varekort-2488-pyntelist', accessory: { productId: '2488ASGRT', name: 'Pyntelist topp frontrute', category: 'mouldings', kind: 'FITMENT_ACCESSORY', varenr: '2488ASGRT' }, linkedVarenr: '2488', stateWhenApplicable: 'OPTIONAL_COMPATIBLE', provenance: P_VAREKORT('2488ASGRT') },
    { relationId: 'varekort-2492-pyntelist', accessory: { productId: '2492ASGRT', name: 'Pyntelist topp', category: 'mouldings', kind: 'FITMENT_ACCESSORY', varenr: '2492ASGRT' }, linkedVarenr: '2492', stateWhenApplicable: 'OPTIONAL_COMPATIBLE', provenance: P_VAREKORT('2492ASGRT') },
    // Sensortape på varekortet KUN når det eksisterer for det eksakte glasset (Tom-verifisert 2026-08-18)
    { relationId: 'varekort-sensortape-eksempel', accessory: SENSOR_TAPE, linkedVarenr: '2306', stateWhenApplicable: 'OPTIONAL_COMPATIBLE', provenance: P_VAREKORT('SENSORTAPE') },
    // Vindusviskere: bevares som relasjon, men salesPolicy=DISABLED → aldri i kundeflyt
    { relationId: 'varekort-visker-eksempel', accessory: WIPER, linkedVarenr: '2492', stateWhenApplicable: 'OPTIONAL_COMPATIBLE', salesPolicy: 'DISABLED', provenance: P_VAREKORT('WIPER') },
  ];
}

/** Promotion-guard: AUTO_GLASS_PRODUCT_RELATION kan KUN bli REQUIRED_SEPARATE med eksplisitt bevis. */
export function canPromoteToRequired(rel: AccessoryRelation, evidence: PromotionEvidence | null): boolean {
  if (rel.provenance.authority !== 'SUPPLIER_CATALOGUE_RELATION') return false;
  if (!evidence) return false;
  if (evidence.kind === 'SOURCE_SEMANTICS' && !evidence.sourceRecord) return false;
  return true;
}
