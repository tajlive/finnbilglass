/**
 * learning-v1 — samlemodul: conflicts, metrics, candidates, fitment-boundary.
 */

// ── 14. Konflikt-håndtering ──
import type { KnowledgeConflict, KnowledgeItem } from './schema.js';
import { scopesOverlap } from './store.js';

let conflictCounter = 0;
export function nextConflictId(): string { return `conf-${Date.now()}-${++conflictCounter}`; }

/** Oppdag konflikt mellom ny kandidat og eksisterende ACTIVE-kunnskap. ALDRI overskriv. */
export function detectConflict(oldKnowledge: KnowledgeItem, newKnowledge: KnowledgeItem): KnowledgeConflict | null {
  if (oldKnowledge.lifecycle !== 'ACTIVE') return null;
  if (!scopesOverlap(oldKnowledge.scope, newKnowledge.scope)) return null;
  if (oldKnowledge.statement.trim().toLowerCase() === newKnowledge.statement.trim().toLowerCase()) return null;
  return {
    conflictId: nextConflictId(),
    oldKnowledgeId: oldKnowledge.knowledgeId,
    oldKnowledge,
    newCandidateId: newKnowledge.knowledgeId,
    newKnowledge,
    scopes: [oldKnowledge.scope, newKnowledge.scope],
    sources: [oldKnowledge.provenance.source, newKnowledge.provenance.source],
    authorities: [oldKnowledge.authority, newKnowledge.authority],
    examplesAffected: [...(oldKnowledge.examples ?? []), ...(newKnowledge.examples ?? [])].map((e) => e.vehicle ?? e.glass ?? 'n/a'),
    status: 'OPEN',
  };
}

export function resolveConflict(conflict: KnowledgeConflict, resolution: 'KEEP_OLD' | 'ADOPT_NEW' | 'REJECT_NEW', resolvedBy: string): KnowledgeConflict {
  if (conflict.status !== 'OPEN') throw new Error(`konflikt er allerede ${conflict.status}`);
  conflict.status = 'RESOLVED';
  conflict.resolution = resolution;
  conflict.resolvedBy = resolvedBy;
  conflict.resolvedAt = new Date().toISOString();
  return conflict;
}

// ── 12. Spørsmålseffektivitet ──
export interface QuestionMetrics {
  questionId: string;
  sessions: number;
  resolutionRate: number;          // andel sesjoner som nådde EXACT etter spørsmålet
  customerConfusionRate: number;   // andel med omformulering/korreksjon på spørsmålet
  answerCorrectionRate: number;
  photoFallbackRate: number;       // andel som endte med foto i stedet for svar
  manualHandoffRate: number;
  averageCandidateReduction: number;
  averageTurnsToResolution: number;
}

export function computeQuestionMetrics(rows: { questionId: string; resolvedExact: boolean; confused: boolean; corrected: boolean; photoFallback: boolean; handoff: boolean; candidateReduction: number; turns: number }[]): QuestionMetrics[] {
  const byQ = new Map<string, typeof rows>();
  for (const r of rows) {
    if (!byQ.has(r.questionId)) byQ.set(r.questionId, []);
    byQ.get(r.questionId)!.push(r);
  }
  const out: QuestionMetrics[] = [];
  for (const [questionId, rs] of byQ) {
    out.push({
      questionId,
      sessions: rs.length,
      resolutionRate: rs.filter((r) => r.resolvedExact).length / rs.length,
      customerConfusionRate: rs.filter((r) => r.confused).length / rs.length,
      answerCorrectionRate: rs.filter((r) => r.corrected).length / rs.length,
      photoFallbackRate: rs.filter((r) => r.photoFallback).length / rs.length,
      manualHandoffRate: rs.filter((r) => r.handoff).length / rs.length,
      averageCandidateReduction: rs.reduce((a, r) => a + r.candidateReduction, 0) / rs.length,
      averageTurnsToResolution: rs.reduce((a, r) => a + r.turns, 0) / rs.length,
    });
  }
  return out.sort((a, b) => b.sessions - a.sessions);
}

// ── 15. Automatisk kandidat-oppdagelse (CAPTURED — aldri automatisk aktivering) ──
export interface DiscoverySignal {
  kind: 'REPEATED_HANDOFF' | 'REPEATED_CORRECTION' | 'REPEATED_UNRESOLVED' | 'WRONG_GLASS_RETURN' | 'OPERATOR_CORRECTION' | 'FREQUENT_UNKNOWN_TERM';
  evidenceCount: number;
  threshold: number;
  trigger?: string | null;
}

export function discoverySignals(sessions: { handoff: boolean; corrections: string[]; unresolved: boolean; wrongGlass: boolean; unknownTerms: string[] }[]): DiscoverySignal[] {
  const out: DiscoverySignal[] = [];
  const handoffs = sessions.filter((s) => s.handoff).length;
  if (handoffs >= 3) out.push({ kind: 'REPEATED_HANDOFF', evidenceCount: handoffs, threshold: 3 });
  const corrections = sessions.flatMap((s) => s.corrections);
  if (corrections.length >= 3) out.push({ kind: 'REPEATED_CORRECTION', evidenceCount: corrections.length, threshold: 3, trigger: corrections[0] });
  const unresolved = sessions.filter((s) => s.unresolved).length;
  if (unresolved >= 3) out.push({ kind: 'REPEATED_UNRESOLVED', evidenceCount: unresolved, threshold: 3 });
  const wrongGlass = sessions.filter((s) => s.wrongGlass).length;
  if (wrongGlass >= 1) out.push({ kind: 'WRONG_GLASS_RETURN', evidenceCount: wrongGlass, threshold: 1 });
  const terms = new Map<string, number>();
  for (const t of sessions.flatMap((s) => s.unknownTerms)) terms.set(t, (terms.get(t) ?? 0) + 1);
  for (const [term, n] of terms) {
    if (n >= 3) out.push({ kind: 'FREQUENT_UNKNOWN_TERM', evidenceCount: n, threshold: 3, trigger: term });
  }
  return out;
}

// ── 11. Fitment-grense ──
/**
 * Hentet ekspert-prosa kan hjelpe agenten å forklare/tolke/spørre/veilede/klassifisere —
 * men KUN deterministisk fitment-policy kan sette EXACT/selectedGlass/verificationMode/orderable.
 * Denne funksjonen er den eneste broen: den aksepterer policy-avgjørelser, aldri prosa.
 */
export interface PolicyDecisionInput {
  fitmentStatus: 'EXACT' | 'AMBIGUOUS' | 'UNKNOWN';
  verificationMode: 'AUTHORITATIVE_DATA' | 'CUSTOMER_OBSERVATION' | 'MANUAL_VERIFICATION' | 'HEURISTIC_ONLY';
  selectedGlass: string | null;
  reasonCodes: string[];
}

export function applyPolicyDecision(current: PolicyDecisionInput | null, decision: PolicyDecisionInput | null): PolicyDecisionInput | null {
  // Kun deterministisk policy produserer decision — denne funksjonen validerer bare strukturen
  if (!decision) return current;
  const allowed = ['EXACT', 'AMBIGUOUS', 'UNKNOWN'];
  const allowedModes = ['AUTHORITATIVE_DATA', 'CUSTOMER_OBSERVATION', 'MANUAL_VERIFICATION', 'HEURISTIC_ONLY'];
  if (!allowed.includes(decision.fitmentStatus)) throw new Error(`ulovlig fitmentStatus: ${decision.fitmentStatus}`);
  if (!allowedModes.includes(decision.verificationMode)) throw new Error(`ulovlig verificationMode: ${decision.verificationMode}`);
  if (decision.fitmentStatus !== 'EXACT' && decision.selectedGlass !== null) throw new Error('selectedGlass kun tillatt ved EXACT');
  return decision;
}
