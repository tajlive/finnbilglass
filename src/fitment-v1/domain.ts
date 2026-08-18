/**
 * fitment-v1 — Architecture v1 evidenstype- og -modell (TypeScript-port av A3-kjernen).
 * Kjøres PARALLELT med dagens resolver (shadow-mode). Endrer ingen prod-beslutninger.
 */

// ── Proveniens ──
export type SourceClass =
  | 'AUTHORITATIVE'
  | 'INDEPENDENT_CATALOG'
  | 'INTERNAL_CATALOG'
  | 'CUSTOMER_OBSERVATION'
  | 'MANUAL'
  | 'HEURISTIC';

export interface Provenance {
  source: string;
  sourceClass: SourceClass;
  sourceRecord?: string | null;
  observedAt?: string | null;
  datasetVersion?: string | null;
  notes?: string | null;
}

export function provenance(p: Provenance): Provenance {
  return { sourceRecord: null, observedAt: null, datasetVersion: null, notes: null, ...p };
}

// ── VehicleIdentity ──
export interface VehicleIdentity {
  registrationNumber: string;
  vin: string | null;
  make: string;
  model: string;
  modelYear: number | null;
  firstRegistrationDate: string | null;
  productionDate?: string | null;   // null = UNKNOWN — fabriker aldri
  bodyType?: string | null;
  engine?: string | null;
  variant?: string | null;
  provenance: Provenance[];
  identityResolved: boolean;
}

export function makeVehicleIdentity(v: Omit<VehicleIdentity, 'identityResolved'>): VehicleIdentity {
  return {
    ...v,
    identityResolved: Boolean(v.vin && v.make && v.model && v.modelYear &&
      v.provenance.some((p) => p.sourceClass === 'AUTHORITATIVE')),
  };
}

// ── ApplicationIdentity — adskilt fra VehicleIdentity; ukjente attributter forblir UKJENTE ──
export interface ProductionInterval { from: string | null; to: string | null }

export interface ApplicationIdentity {
  manufacturer: string | null;
  modelFamily: string | null;
  generation: string | null;
  body: string | null;
  productionInterval: ProductionInterval | null;
  engine: string | null;
  salesVariant: string | null;
  facelift: string | null;
  market: string | null;
  ktypes: KTypeIdentity[];
  providerApplicationIds: Record<string, string>;
  unknownAttributes: string[];
  provenance: Provenance[];
  isExact: boolean;
}

export function makeApplicationIdentity(a: Omit<ApplicationIdentity, 'isExact'>): ApplicationIdentity {
  return {
    ...a,
    isExact: Boolean(a.manufacturer && a.modelFamily && a.generation && a.productionInterval && a.unknownAttributes.length === 0),
  };
}

// ── KTypeIdentity — kanonisk namespacet; rå integer er ALDRI global join-nøkkel ──
export class KTypeIdentity {
  readonly provider: string;
  readonly namespace: string;
  readonly version: string;
  readonly id: number | string;

  constructor(p: { provider: string; namespace: string; version: string; id: number | string }) {
    if (!p.provider || !p.namespace || !p.version || p.id === undefined || p.id === null) {
      throw new Error('KTypeIdentity krever provider, namespace, version og id');
    }
    this.provider = p.provider;
    this.namespace = p.namespace;
    this.version = p.version;
    this.id = p.id;
  }
  key(): string { return `${this.provider}:${this.namespace}:${this.version}:${this.id}`; }
  equals(o: KTypeIdentity): boolean {
    return this.provider === o.provider && this.namespace === o.namespace && this.version === o.version && this.id === o.id;
  }
  static sameRawId(a: KTypeIdentity, b: KTypeIdentity): boolean { return a.id === b.id; }
}

// ── OEIdentity — rå immutabel, normalisert avledet ──
export interface OEIdentity {
  manufacturer: string | null;
  rawOE: string;
  normalizedOE: string;
  normalizationVersion: string;
  provenance: Provenance[];
}

// ── GlassIdentity — eurocode ≠ supplier-SKU ──
export interface SupplierSku { sku: string; supplier: string }

export interface GlassIdentity {
  eurocode: string | null;
  supplierSkus: SupplierSku[];
  supplier: string | null;
  r43Identifiers: string[];      // SEKUNDÆR metadata — aldri fitment-evidens
  features: string[];
  catalogueRefs: { ref: string; url?: string }[];
  provenance: Provenance[];
  label(): string;
}

// ── SourceRecord ──
export interface SourceRecord {
  id: string;
  provider: string;
  dataset: string;
  version: string;
  acquiredAt?: string | null;
  url?: string | null;
}

// ── EvidenceEdge — uten proveniens kan den ikke være autoritativ ──
export interface EvidenceEdge {
  from: string;
  to: string;
  source: string;
  sourceClass: SourceClass;
  sourceRecord: SourceRecord | null;
  independent: boolean;
  transformation: string | null;
  observedAt: string | null;
  datasetVersion: string | null;
  strength: string | null;
  supports: string[];
  excludes: string[];
  notes: string | null;
  readonly authoritative: boolean;
}

export function makeEvidenceEdge(e: Omit<EvidenceEdge, 'authoritative'>): EvidenceEdge {
  return { ...e, authoritative: e.sourceClass === 'AUTHORITATIVE' || e.sourceClass === 'INDEPENDENT_CATALOG' };
}

// ── FitmentResult ──
export type FitmentStatus = 'EXACT' | 'AMBIGUOUS' | 'UNKNOWN';
export type VerificationMode = 'AUTHORITATIVE_DATA' | 'CUSTOMER_OBSERVATION' | 'MANUAL_VERIFICATION' | 'HEURISTIC_ONLY';

export interface Candidate {
  glass: string;
  varenr: string | null;
  variant?: string | null;
  features: string[];
  glavista?: Record<string, unknown> | null;
  reasonCodes?: string[];
}

export interface FitmentQuestion {
  question: string;
  discriminates: string[];
}

export interface FitmentResult {
  fitmentStatus: FitmentStatus;
  verificationMode: VerificationMode;
  selectedGlass: Candidate | null;
  candidates: Candidate[];
  evidence: EvidenceEdge[];
  conflicts: string[];
  questions: FitmentQuestion[];
  reasonCodes: string[];
  auditId: string;
}
