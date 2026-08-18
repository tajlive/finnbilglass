/**
 * fitment-v1/policy/kernel — Evidence Kernel v1 (TypeScript-port av A3-kjernen).
 * Bygger evidensgraf: VehicleIdentity → ApplicationIdentity → kandidater → Glavista-korroborasjon → gate.
 */
import type {
  ApplicationIdentity, Candidate, EvidenceEdge, FitmentResult, Provenance, VehicleIdentity,
} from '../domain.js';
import { makeEvidenceEdge, makeVehicleIdentity, provenance } from '../domain.js';
import { GlavistaAdapter, GLAVISTA_SOURCE_RECORD } from '../adapters/glavista.js';
import { findCatalogCandidates, INTERNAL_CATALOG_SOURCE, type CatalogRow } from '../adapters/catalog.js';
import { evaluateExactGate, evaluateObservationGate } from './gate.js';

let auditCounter = 0;
export function nextAuditId(): string { return `audit-${Date.now()}-${++auditCounter}`; }

export interface VehicleLookupInput {
  registrationNumber: string;
  vin?: string | null;
  make: string;
  model: string;
  modelYear?: number | null;
  firstRegistrationDate?: string | null;
  bodyType?: string | null;
  svvSource?: string;
  observedAt?: string;
}

export function familyName(make: string, model: string): string {
  const m = String(model || '').toUpperCase();
  if (m.includes('TRANSPORTER') || m.includes('MULTIVAN')) return 'Transporter T5';
  if (m.includes('CLA')) return 'CLA (C117)';
  if (m.includes('A-CLASS')) return 'A-Class (W176)';
  if (m.includes('GLA')) return 'GLA (X156)';
  return `${String(make || '')} ${String(model || '')}`.trim();
}

export class EvidenceKernel {
  private glavista: GlavistaAdapter;
  private catalog: (v: { make: string; model: string }) => CatalogRow[];

  constructor(opts: { glavistaAdapter?: GlavistaAdapter; catalog?: (v: { make: string; model: string }) => CatalogRow[] } = {}) {
    this.glavista = opts.glavistaAdapter ?? new GlavistaAdapter();
    this.catalog = opts.catalog ?? findCatalogCandidates;
  }

  resolve(v: VehicleLookupInput): FitmentResult {
    const edges: EvidenceEdge[] = [];
    const vehicle: VehicleIdentity = makeVehicleIdentity({
      registrationNumber: v.registrationNumber,
      vin: v.vin ?? null,
      make: v.make,
      model: v.model,
      modelYear: v.modelYear ?? null,
      firstRegistrationDate: v.firstRegistrationDate ?? null,
      bodyType: v.bodyType ?? null,
      provenance: [provenance({ source: v.svvSource ?? 'SVV enkeltoppslag', sourceClass: 'AUTHORITATIVE', observedAt: v.observedAt ?? '2026-08-18' })],
    });

    const application: ApplicationIdentity = {
      manufacturer: vehicle.make,
      modelFamily: familyName(vehicle.make, vehicle.model),
      generation: null,
      body: null,
      productionInterval: null,
      engine: null,
      salesVariant: null,
      facelift: null,
      market: 'EU',
      ktypes: [],
      providerApplicationIds: {},
      unknownAttributes: ['generation', 'body', 'productionInterval', 'engine', 'salesVariant', 'facelift'],
      provenance: [],
      isExact: false,
    };

    const catalogRows = this.catalog({ make: vehicle.make, model: vehicle.model });

    const candidates: Candidate[] = catalogRows.map((cc) => {
      const glass = this.glavista.lookupByEurocode(cc.eurokode);
      edges.push(makeEvidenceEdge({
        from: 'APPLICATION', to: cc.eurokode,
        source: 'Intern katalog (auto-glass.no prisliste)', sourceClass: 'INTERNAL_CATALOG',
        sourceRecord: INTERNAL_CATALOG_SOURCE, independent: false,
        transformation: 'familie-match (make+model-token)', strength: '1:n',
        supports: [cc.varenr], excludes: [], notes: cc.notes ?? null, observedAt: null, datasetVersion: null,
      }));
      if (glass) {
        for (const oe of glass.oes) {
          edges.push(makeEvidenceEdge({
            from: `OE:${oe}`, to: cc.eurokode,
            source: 'Glavista-scrape', sourceClass: 'INDEPENDENT_CATALOG',
            sourceRecord: GLAVISTA_SOURCE_RECORD, independent: true,
            transformation: 'OE→eurokode via Glavista-indeks', strength: 'n:1',
            supports: [cc.eurokode], excludes: [], notes: null, observedAt: null, datasetVersion: null,
          }));
        }
      }
      return {
        glass: cc.eurokode, varenr: cc.varenr, variant: cc.variant ?? null,
        features: cc.features, glavista: glass ? {
          eurocode: glass.eurocode, oes: glass.oes, features: glass.features,
          r43: glass.r43Identifiers, allKoder: glass.allKoder, calibration: glass.calibration,
          brand: glass.brand, model: glass.model,
        } : null,
        reasonCodes: ['CATALOG_CANDIDATE'],
      };
    });

    const questions = buildQuestions(candidates);
    const gate = evaluateExactGate({
      vehicleIdentityResolved: vehicle.identityResolved,
      applicationEdgeAuthoritative: false,
      oeGlassEdgeAuthoritativeOrIndependent: candidates.some((c) => c.glavista),
      materialConflicts: [],
      candidateCount: candidates.length,
    });

    const status = candidates.length === 0 ? 'UNKNOWN' : (gate.authoritativeDataExact ? 'EXACT' : 'AMBIGUOUS');
    const mode = candidates.length === 0 ? 'HEURISTIC_ONLY' : (gate.authoritativeDataExact ? 'AUTHORITATIVE_DATA' : 'HEURISTIC_ONLY');

    return {
      fitmentStatus: status,
      verificationMode: mode,
      selectedGlass: null,
      candidates,
      evidence: edges,
      conflicts: [],
      questions,
      reasonCodes: gate.reasonCodes,
      auditId: nextAuditId(),
    };
  }

  resolveWithObservation(v: VehicleLookupInput, observations: { type: 'OE'; value: string; reliable: boolean; notes?: string }[], opts: { observedAt?: string } = {}): FitmentResult {
    const base = this.resolve(v);
    const obsEdges: EvidenceEdge[] = observations.map((o) => makeEvidenceEdge({
      from: 'OBSERVATION', to: `OE:${o.value}`,
      source: 'Kundeobservasjon (fysisk avlesning)', sourceClass: 'CUSTOMER_OBSERVATION',
      sourceRecord: null, independent: true, transformation: null, strength: null,
      supports: [], excludes: [], notes: o.notes ?? null, observedAt: opts.observedAt ?? '2026-08-18', datasetVersion: null,
    }));

    let remaining = base.candidates;
    let narrowedByEvidence = false;
    const oeValues = observations.map((o) => o.value);
    if (oeValues.length > 0) {
      const oeHits = new Set<string>();
      for (const oe of oeValues) {
        const { results } = this.glavista.lookupByOE(oe);
        for (const r of results) {
          oeHits.add(r.eurocode);
          obsEdges.push(makeEvidenceEdge({
            from: `OE:${oe}`, to: r.eurocode,
            source: 'Glavista-scrape', sourceClass: 'INDEPENDENT_CATALOG',
            sourceRecord: GLAVISTA_SOURCE_RECORD, independent: true,
            transformation: 'OE→eurokode', strength: 'n:1',
            supports: [r.eurocode], excludes: [], notes: null, observedAt: null, datasetVersion: null,
          }));
        }
      }
      if (oeHits.size > 0) {
        narrowedByEvidence = true;
        const catalogHits = base.candidates.filter((c) => oeHits.has(c.glass));
        const glavistaOnly: Candidate[] = [...oeHits]
          .filter((euro) => !base.candidates.some((c) => c.glass === euro))
          .map((euro) => {
            const g = this.glavista.lookupByEurocode(euro);
            return { glass: euro, varenr: null, variant: null, features: g?.features ?? [], glavista: g ? {
              eurocode: g.eurocode, oes: g.oes, features: g.features, r43: g.r43Identifiers, allKoder: g.allKoder, calibration: g.calibration, brand: g.brand, model: g.model,
            } : null, reasonCodes: ['GLAVISTA_ONLY_IDENTITY'] };
          });
        remaining = [...catalogHits, ...glavistaOnly];
      }
    }

    const gate = evaluateObservationGate({ narrowedByEvidence, observations, remainingCandidates: remaining });
    const fitmentStatus = gate.passed ? 'EXACT' : 'AMBIGUOUS';
    const verificationMode = gate.passed ? 'CUSTOMER_OBSERVATION' : (narrowedByEvidence ? 'CUSTOMER_OBSERVATION' : 'HEURISTIC_ONLY');

    return {
      fitmentStatus,
      verificationMode,
      selectedGlass: gate.passed ? remaining[0] : null,
      candidates: remaining,
      evidence: [...base.evidence, ...obsEdges],
      conflicts: [],
      questions: gate.passed ? [] : buildQuestions(remaining),
      reasonCodes: [...base.reasonCodes, ...gate.reasonCodes],
      auditId: nextAuditId(),
    };
  }
}

/** Spørsmål som skiller gjenværende kandidater — generert fra feature-forskjeller. */
export function buildQuestions(candidates: Candidate[]): { question: string; discriminates: string[] }[] {
  const qs: { question: string; discriminates: string[] }[] = [];
  if (candidates.length <= 1) return qs;
  const has = (c: Candidate, f: string) => c.features?.includes(f) || (c.glavista as { features?: string[] } | null)?.features?.includes(f);
  const anyHas = (f: string) => candidates.some((c) => has(c, f));
  const anyNotHas = (f: string) => candidates.some((c) => !has(c, f));
  const Q: [string, string][] = [
    ['rainSensor', 'Har bilen regnsensor på frontruten?'],
    ['camera', 'Har bilen kamera (ADAS) i frontrutens område?'],
    ['antenna', 'Har bilen antenne i frontruten?'],
    ['coated', 'Er frontruten coated (solskjermende belegg)?'],
    ['heated', 'Har frontruten varmeelementer?'],
    ['acoustic', 'Er frontruten akustisk (støydempende)?'],
  ];
  for (const [f, q] of Q) {
    if (anyHas(f) && anyNotHas(f)) qs.push({ question: q, discriminates: [f] });
  }
  qs.push({ question: 'Kan du lese OE-nummeret (f.eks. 7H0 845 101 H) på glasskanten av den EKSISTERENDE frontruten?', discriminates: ['OE'] });
  return qs;
}

export type { Provenance };
