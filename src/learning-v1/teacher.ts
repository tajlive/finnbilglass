/**
 * learning-v1/teacher — Expert Teacher Mode (staging-only for Tom).
 * Hver undervisningshendelse → KnowledgeCandidate. Endrer ALDRI prod-policy umiddelbart.
 */
import type { AuthorityClass, KnowledgeCandidate, KnowledgeClass, KnowledgeItem, KnowledgeScope } from './schema.js';
import { KnowledgeStore } from './store.js';
import { nextKnowledgeId, scopesOverlap } from './store.js';
import { makeKnowledgeItem } from './schema.js';

let candidateCounter = 0;
export function nextCandidateId(): string { return `cand-${Date.now()}-${++candidateCounter}`; }

export interface TeachingEvent {
  teacher: string;
  sourceSessionId?: string | null;
  statement: string;
  reason?: string | null;
  scope: KnowledgeScope;
  examples?: KnowledgeItem['examples'];
  counterexamples?: KnowledgeItem['examples'];
  affectedKnowledgeClass: KnowledgeClass;
  proposedAuthority: AuthorityClass;
  source?: string;
}

export interface TeachingResult {
  candidate: KnowledgeCandidate;
  conflicts: { conflictId: string; oldKnowledgeId: string; reason: string }[];
}

/**
 * Registrer undervisningshendelse → KnowledgeCandidate (CAPTURED/PROVISIONAL).
 * Hvis kandidaten konflikter med ACTIVE-kunnskap i overlappende scope:
 * opprett KnowledgeConflict — ALDRI overskriv.
 */
export function teach(store: KnowledgeStore, event: TeachingEvent): TeachingResult {
  const conflicts = findConflicts(store, event);
  const candidate: KnowledgeCandidate = {
    candidateId: nextCandidateId(),
    teacher: event.teacher,
    timestamp: new Date().toISOString(),
    sourceSessionId: event.sourceSessionId ?? null,
    statement: event.statement,
    reason: event.reason ?? null,
    scope: event.scope,
    examples: event.examples ?? [],
    counterexamples: event.counterexamples ?? [],
    affectedKnowledgeClass: event.affectedKnowledgeClass,
    proposedAuthority: event.proposedAuthority,
    status: 'PROVISIONAL',
    source: event.source ?? 'expert-teacher-mode',
    conflictIds: conflicts.map((c) => c.conflictId),
    createdAt: new Date().toISOString(),
  };
  // Kandidaten lagres som PROVISIONAL kunnskap (ikke ACTIVE; ikke umiddelbar sannhet)
  const item = makeKnowledgeItem({
    knowledgeId: nextKnowledgeId(),
    version: 1,
    class: event.affectedKnowledgeClass,
    lifecycle: 'PROVISIONAL',
    authority: event.proposedAuthority,
    statement: event.statement,
    reason: event.reason ?? null,
    scope: event.scope,
    examples: event.examples ?? [],
    counterexamples: event.counterexamples ?? [],
    provenance: {
      origin: 'EXPERT_TEACHING',
      author: event.teacher,
      source: event.source ?? 'expert-teacher-mode',
      createdAt: new Date().toISOString(),
      sourceReference: event.sourceSessionId ?? null,
    },
    relatedQuestionType: null,
    sourceSessionId: event.sourceSessionId ?? null,
  });
  store.add(item);
  return { candidate, conflicts: conflicts.map((c) => ({ conflictId: c.conflictId, oldKnowledgeId: c.oldKnowledgeId, reason: c.reason })) };
}

function findConflicts(store: KnowledgeStore, event: TeachingEvent): { conflictId: string; oldKnowledgeId: string; reason: string }[] {
  const out: { conflictId: string; oldKnowledgeId: string; reason: string }[] = [];
  for (const k of store.all()) {
    if (k.lifecycle !== 'ACTIVE') continue;
    if (!scopesOverlap(k.scope, event.scope)) continue;
    if (sameStatement(k.statement, event.statement)) continue;
    out.push({ conflictId: `conf-${Date.now()}-${out.length + 1}`, oldKnowledgeId: k.knowledgeId, reason: `ny undervisning («${event.statement.slice(0, 60)}…») konflikter med ACTIVE «${k.statement.slice(0, 60)}…» i overlappende scope` });
  }
  return out;
}

function sameStatement(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}
