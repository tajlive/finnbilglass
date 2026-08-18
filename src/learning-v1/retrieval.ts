/**
 * learning-v1/retrieval — kontekst-filtrert kunnskapshenting.
 * Henter KUN relevant kunnskap for nåværende kjøretøy/applikasjon/glassfamilie/
 * spørsmålstype/kundeintensjon. Dumper ALDRI hele kunnskapsbasen inn i LLM-kontekst.
 * Proveniens følger alltid med.
 */
import type { KnowledgeItem, KnowledgeScope } from './schema.js';
import { KnowledgeStore, scopesOverlap } from './store.js';

export interface RetrievalContext {
  vehicle?: { make?: string; modelFamily?: string; generation?: string | null; modelYear?: number | null } | null;
  application?: string | null;
  glassFamily?: string | null;
  questionType?: string | null;
  customerIntent?: string | null;
  supplier?: string | null;
  market?: string | null;
  maxResults?: number;
}

export interface RetrievedKnowledge {
  knowledge: KnowledgeItem;
  relevance: number; // 0..1
  provenance: { origin: string; author: string; source: string; sourceReference: string | null; createdAt: string };
}

/** Relevans-skår: eksplisitt scope-match > klassetilpasning > spørsmålstype. */
export function retrieve(store: KnowledgeStore, ctx: RetrievalContext): RetrievedKnowledge[] {
  const max = ctx.maxResults ?? 8;
  const scored: RetrievedKnowledge[] = [];
  const vehicleScope: KnowledgeScope = {
    make: ctx.vehicle?.make ?? undefined,
    modelFamily: ctx.vehicle?.modelFamily ?? undefined,
    generation: ctx.vehicle?.generation ?? undefined,
    market: ctx.market ?? undefined,
    supplier: ctx.supplier ?? undefined,
    glassFamily: ctx.glassFamily ?? undefined,
  };
  for (const k of store.all()) {
    if (k.lifecycle === 'REJECTED' || k.lifecycle === 'DEPRECATED') continue;
    let score = 0;
    if (scopesOverlap(k.scope, vehicleScope)) score += 0.5;
    if (k.scope.glassFamily && k.scope.glassFamily === ctx.glassFamily) score += 0.3;
    if (k.relatedQuestionType && k.relatedQuestionType === ctx.questionType) score += 0.2;
    if (ctx.customerIntent && k.tags?.some((t) => ctx.customerIntent!.toLowerCase().includes(t.toLowerCase()))) score += 0.15;
    if (score === 0) continue;
    scored.push({
      knowledge: k,
      relevance: Math.min(1, score),
      provenance: {
        origin: k.provenance.origin,
        author: k.provenance.author,
        source: k.provenance.source,
        sourceReference: k.provenance.sourceReference ?? null,
        createdAt: k.provenance.createdAt,
      },
    });
  }
  return scored.sort((a, b) => b.relevance - a.relevance).slice(0, max);
}

/** Kun ACTIVE FITMENT_RULE kan påvirke kandidat-eliminering — via deterministisk policy, ikke prosa. */
export function activeFitmentRulesFor(store: KnowledgeStore, ctx: RetrievalContext): KnowledgeItem[] {
  const vehicleScope: KnowledgeScope = {
    make: ctx.vehicle?.make ?? undefined,
    modelFamily: ctx.vehicle?.modelFamily ?? undefined,
    generation: ctx.vehicle?.generation ?? undefined,
    market: ctx.market ?? undefined,
  };
  return store.activeFitmentRules().filter((k) => scopesOverlap(k.scope, vehicleScope));
}
