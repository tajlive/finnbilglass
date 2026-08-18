/**
 * accessory-v1/schema — tilbehørs-applikabilitet: 6 stater, 12 kategorier, proveniens.
 * Aldri implisitt «passer sannsynligvis».
 */
export const ACCESSORY_STATES = ['INCLUDED_WITH_GLASS', 'REQUIRED_SEPARATE', 'OPTIONAL_COMPATIBLE', 'NOT_APPLICABLE', 'AMBIGUOUS', 'UNKNOWN'] as const;
export type AccessoryState = (typeof ACCESSORY_STATES)[number];

export const ACCESSORY_CATEGORIES = [
  'clips', 'mouldings', 'trim_strip', 'sensor_gel', 'sensor_bracket', 'camera_bracket',
  'adas_component', 'adhesive_install_kit', 'primer', 'spacers', 'retainers', 'rubber_seals', 'other_glass_specific',
] as const;
export type AccessoryCategory = (typeof ACCESSORY_CATEGORIES)[number];

export interface Accessory {
  productId: string;
  name: string;
  category: AccessoryCategory;
  kind: 'FITMENT_ACCESSORY' | 'INSTALLATION_CONSUMABLE';
  varenr?: string | null;
  eurocode?: string | null;
}

export interface AccessoryRelationProvenance {
  source: 'GT_AUTO_PRISLISTE' | 'GLAVISTA_ALLEKODER' | 'VAREKORT' | 'EXPERT_TEACHING' | 'INSTALLATION' | 'CATALOGUE_COMMENT';
  sourceRecord: string;
  authority: 'SUPPLIER_DATA' | 'VERIFIED_REAL_WORLD_INSTALLATION' | 'VERIFIED_EXPERT_RULE' | 'EXPERT_TEACHING_PROVISIONAL';
  note?: string | null;
}

export interface AccessoryRelation {
  relationId: string;
  accessory: Accessory;
  /** Koblingsnøkkel: eurokode (glass/glassfamilie), varenr, eller feature-betingelse */
  linkedEurocode?: string | null;
  linkedVarenr?: string | null;
  featureRequirement?: { feature: string; value: boolean } | null; // f.eks. sensor=true
  /** Bestemt tilstand når koblingen er oppfylt */
  stateWhenApplicable: 'REQUIRED_SEPARATE' | 'OPTIONAL_COMPATIBLE' | 'INCLUDED_WITH_GLASS';
  featureExclusion?: { feature: string; value: boolean } | null;   // f.eks. sensor=false → NOT_APPLICABLE
  provenance: AccessoryRelationProvenance;
}

export interface AccessoryApplicability {
  accessory: Accessory;
  state: AccessoryState;
  reason: string;
  provenance: AccessoryRelationProvenance;
  duplicateOfGlassComponent?: boolean; // true hvis INKLUDERT i glasset
  requiresInstallerConfirmation?: boolean;
}

export interface AccessoryEngineInput {
  vehicleIdentity: { make: string; model: string; modelYear: number | null } | null;
  applicationIdentity: { applicationId: string; evidenceClass: string } | null;
  selectedGlass: { glass: string; varenr: string | null } | null;
  glassFeatures: Record<string, string | boolean | null>;
  fitmentStatus: 'EXACT' | 'AMBIGUOUS' | 'UNKNOWN' | null;
  verificationMode: string | null;
}
