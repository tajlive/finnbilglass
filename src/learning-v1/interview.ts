/**
 * learning-v1/interview — Expert Interview Mode.
 * Systemet intervjuer Tom emnevis; svar → KnowledgeCandidates (aldri umiddelbar sannhet).
 */
import type { AuthorityClass, KnowledgeClass, KnowledgeScope } from './schema.js';
import { KnowledgeStore } from './store.js';
import { teach, type TeachingEvent } from './teacher.js';

export const INTERVIEW_TOPICS = [
  { topic: 'windshield-terminology', label: 'Frontrute-terminologi', class: 'TERMINOLOGY' as KnowledgeClass, suggestedAuthority: 'VERIFIED_EXPERT_RULE' as AuthorityClass },
  { topic: 'eurocode-semantics', label: 'Eurokode-semantikk', class: 'CATALOGUE_SEMANTICS' as KnowledgeClass, suggestedAuthority: 'VERIFIED_EXPERT_RULE' as AuthorityClass },
  { topic: 'supplier-codes', label: 'Leverandørkoder (Glavista/Pilkington/AGC)', class: 'CATALOGUE_SEMANTICS' as KnowledgeClass, suggestedAuthority: 'SUPPLIER_DATA' as AuthorityClass },
  { topic: 'camera-sensor-config', label: 'Kamera/sensor-konfigurasjoner', class: 'DOMAIN_KNOWLEDGE' as KnowledgeClass, suggestedAuthority: 'VERIFIED_EXPERT_RULE' as AuthorityClass },
  { topic: 'coatings', label: 'Belegg (coated)', class: 'PRODUCT_KNOWLEDGE' as KnowledgeClass, suggestedAuthority: 'VERIFIED_EXPERT_RULE' as AuthorityClass },
  { topic: 'heating', label: 'Varmeelementer', class: 'PRODUCT_KNOWLEDGE' as KnowledgeClass, suggestedAuthority: 'VERIFIED_EXPERT_RULE' as AuthorityClass },
  { topic: 'antenna', label: 'Antenne', class: 'PRODUCT_KNOWLEDGE' as KnowledgeClass, suggestedAuthority: 'VERIFIED_EXPERT_RULE' as AuthorityClass },
  { topic: 'hud', label: 'HUD', class: 'PRODUCT_KNOWLEDGE' as KnowledgeClass, suggestedAuthority: 'VERIFIED_EXPERT_RULE' as AuthorityClass },
  { topic: 'mouldings', label: 'Pyntelister/lister', class: 'PRODUCT_KNOWLEDGE' as KnowledgeClass, suggestedAuthority: 'VERIFIED_EXPERT_RULE' as AuthorityClass },
  { topic: 'ordering-workflow', label: 'Ordrearbeidsflyt', class: 'ORDERING_KNOWLEDGE' as KnowledgeClass, suggestedAuthority: 'VERIFIED_EXPERT_RULE' as AuthorityClass },
  { topic: 'customer-misunderstandings', label: 'Kundemisforståelser', class: 'CUSTOMER_SERVICE_GUIDANCE' as KnowledgeClass, suggestedAuthority: 'EXPERT_TEACHING_PROVISIONAL' as AuthorityClass },
  { topic: 'common-mistakes', label: 'Vanlige feil', class: 'DOMAIN_KNOWLEDGE' as KnowledgeClass, suggestedAuthority: 'VERIFIED_EXPERT_RULE' as AuthorityClass },
  { topic: 'installation', label: 'Monteringshensyn', class: 'INSTALLATION_KNOWLEDGE' as KnowledgeClass, suggestedAuthority: 'VERIFIED_EXPERT_RULE' as AuthorityClass },
  { topic: 'supplier-workflow', label: 'Leverandørarbeidsflyt', class: 'ORDERING_KNOWLEDGE' as KnowledgeClass, suggestedAuthority: 'VERIFIED_EXPERT_RULE' as AuthorityClass },
] as const;

export interface InterviewSession {
  interviewId: string;
  teacher: string;
  topic: string;
  startedAt: string;
  answers: { statement: string; scope: KnowledgeScope; reason?: string | null }[];
}

export function startInterview(teacher: string, topic: string): InterviewSession {
  const known = INTERVIEW_TOPICS.find((t) => t.topic === topic);
  if (!known) throw new Error(`ukjent intervju-tema: ${topic}`);
  return { interviewId: `iv-${Date.now()}`, teacher, topic, startedAt: new Date().toISOString(), answers: [] };
}

export function answerInterview(store: KnowledgeStore, session: InterviewSession, answer: { statement: string; scope: KnowledgeScope; reason?: string | null }): { candidateCount: number; conflicts: number } {
  const topicDef = INTERVIEW_TOPICS.find((t) => t.topic === session.topic)!;
  session.answers.push(answer);
  const event: TeachingEvent = {
    teacher: session.teacher,
    statement: answer.statement,
    reason: answer.reason ?? null,
    scope: answer.scope,
    affectedKnowledgeClass: topicDef.class,
    proposedAuthority: topicDef.suggestedAuthority,
    source: `expert-interview:${session.topic}`,
  };
  const res = teach(store, event);
  return { candidateCount: 1, conflicts: res.conflicts.length };
}
