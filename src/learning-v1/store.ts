/**
 * learning-v1/store — kunnskapsbutikk med livssyklus-guarder.
 * Ingen konversasjons-avledet kunnskap blir ACTIVE automatisk.
 * LLM_INFERENCE kan ALDRI bli ACTIVE FITMENT_RULE.
 */
import type {
  AuthorityClass, KnowledgeClass, KnowledgeConflict, KnowledgeItem, KnowledgeProvenance, LifecycleState, KnowledgeScope,
} from './schema.js';
import { AUTHORITY_RANK, MIN_AUTHORITY_FOR_ACTIVE_FITMENT } from './schema.js';

let idCounter = 0;
export function nextKnowledgeId(): string { return `k-${Date.now()}-${++idCounter}`; }

const ALLOWED_TRANSITIONS: Record<LifecycleState, LifecycleState[]> = {
  CAPTURED: ['PROVISIONAL', 'REJECTED'],
  PROVISIONAL: ['REVIEWED', 'REJECTED', 'DEPRECATED'],
  REVIEWED: ['VERIFIED', 'REJECTED', 'DEPRECATED'],
  VERIFIED: ['ACTIVE', 'REJECTED', 'DEPRECATED'],
  ACTIVE: ['DEPRECATED', 'REJECTED'],
  DEPRECATED: ['REJECTED', 'VERIFIED'],
  REJECTED: [],
};

export class KnowledgeStore {
  private items = new Map<string, KnowledgeItem>();
  private byScopeIndex = new Map<string, string[]>();

  constructor(seed: KnowledgeItem[] = []) { for (const k of seed) this.add(k); }

  add(k: KnowledgeItem): void {
    if (this.items.has(k.knowledgeId)) throw new Error(`kunnskaps-ID finnes allerede: ${k.knowledgeId}`);
    this.assertLifecycleLegal(k);
    this.items.set(k.knowledgeId, k);
    this.indexByScope(k);
  }

  get(id: string): KnowledgeItem | null { return this.items.get(id) ?? null; }

  all(): KnowledgeItem[] { return [...this.items.values()]; }

  allVersionsOf(originalId: string): KnowledgeItem[] {
    const out: KnowledgeItem[] = [];
    for (const k of this.items.values()) {
      if (k.knowledgeId === originalId) out.push(k);
      else if (k.provenance.supersedes === originalId) out.push(k);
    }
    return out;
  }

  activeFitmentRules(): KnowledgeItem[] {
    return this.all().filter((k) => k.mayInfluenceCandidateElimination());
  }

  /** Legitim livssyklus-endring. Aldri ødelegg forrige versjon — ny versjon superseder. */
  transition(id: string, to: LifecycleState, opts: { by?: string; verificationMethod?: string } = {}): KnowledgeItem {
    const k = this.items.get(id);
    if (!k) throw new Error(`kunnskap finnes ikke: ${id}`);
    if (!ALLOWED_TRANSITIONS[k.lifecycle].includes(to)) {
      throw new Error(`ulovlig overgang ${k.lifecycle}→${to} for ${id}`);
    }
    if (to === 'ACTIVE' && k.class === 'FITMENT_RULE' && AUTHORITY_RANK[k.authority] < AUTHORITY_RANK[MIN_AUTHORITY_FOR_ACTIVE_FITMENT]) {
      throw new Error(`FITMENT_RULE med autoritet ${k.authority} kan ikke bli ACTIVE (krever minst ${MIN_AUTHORITY_FOR_ACTIVE_FITMENT})`);
    }
    if (k.class === 'FITMENT_RULE' && k.lifecycle !== 'VERIFIED' && to === 'ACTIVE') {
      throw new Error(`FITMENT_RULE må være VERIFIED før ACTIVE (nå: ${k.lifecycle})`);
    }
    const updated: KnowledgeItem = {
      ...k,
      lifecycle: to,
      provenance: {
        ...k.provenance,
        reviewedBy: opts.by ?? k.provenance.reviewedBy,
        verificationMethod: opts.verificationMethod ?? k.provenance.verificationMethod,
      },
    };
    this.items.set(id, updated);
    return updated;
  }

  /** Ny versjon av kunnskap — gammel beholdes (supersedes-peker). */
  revise(id: string, patch: Partial<Omit<KnowledgeItem, 'knowledgeId' | 'version' | 'provenance'>>, provenance: KnowledgeProvenance): KnowledgeItem {
    const old = this.items.get(id);
    if (!old) throw new Error(`kunnskap finnes ikke: ${id}`);
    const next: KnowledgeItem = {
      ...old,
      ...patch,
      knowledgeId: nextKnowledgeId(),
      version: old.version + 1,
      lifecycle: 'PROVISIONAL', // revisjon starter alltid på nytt i livssyklusen
      provenance: { ...provenance, supersedes: old.knowledgeId },
    };
    this.add(next);
    return next;
  }

  /** Kunnskapsklasse-finne: kun klasser som er lovlig for kandidat-eliminering. */
  private assertLifecycleLegal(k: KnowledgeItem): void {
    if (k.lifecycle === 'ACTIVE' && k.class === 'FITMENT_RULE' && AUTHORITY_RANK[k.authority] < AUTHORITY_RANK[MIN_AUTHORITY_FOR_ACTIVE_FITMENT]) {
      throw new Error(`Kan ikke opprette ACTIVE FITMENT_RULE med autoritet ${k.authority}`);
    }
    if (k.class === 'FITMENT_RULE' && k.lifecycle === 'ACTIVE' && k.provenance.origin === 'CONVERSATION') {
      throw new Error('Konversasjons-avledet FITMENT_RULE kan aldri starte som ACTIVE');
    }
  }

  private indexByScope(k: KnowledgeItem): void {
    const key = scopeKey(k.scope);
    const list = this.byScopeIndex.get(key) ?? [];
    list.push(k.knowledgeId);
    this.byScopeIndex.set(key, list);
  }
}

export function scopeKey(s: KnowledgeScope): string {
  return [s.make, s.modelFamily, s.generation, s.glassFamily, s.supplier, s.catalogueVersion].filter(Boolean).join('|');
}

export function scopesOverlap(a: KnowledgeScope, b: KnowledgeScope): boolean {
  const keys = ['make', 'modelFamily', 'generation', 'productionInterval', 'market', 'body', 'engine', 'application', 'glassFamily', 'supplier', 'catalogueVersion'] as const;
  for (const k of keys) {
    const av = a[k];
    const bv = b[k];
    if (av === undefined || bv === undefined) continue;
    if (JSON.stringify(av) !== JSON.stringify(bv)) return false;
  }
  return true;
}

export type { AuthorityClass, KnowledgeClass, KnowledgeItem, KnowledgeConflict, KnowledgeProvenance, LifecycleState, KnowledgeScope };
