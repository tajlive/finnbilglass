/**
 * learning-v1/teacher-ui — STAGING-ONLY Expert/Teacher-grensesnitt for Tom.
 * IKKE deployet i C3 (NO production deployment). Aktiveres på staging-worker
 * sammen med C2-assistenten (env ASSISTANT_ENABLED) i en senere valideringsrunde.
 *
 * Funksjoner for Tom:
 *  - inspisere en sesjon
 *  - korrigere et agentsvar + forklare HVORFOR
 *  - undervise terminologi/katalog-semantikk
 *  - undervise hvordan glass-profesjonelle identifiserer variant
 *  - markere unntak, gi eksempel-/mot-eksempel-biler
 *  - foreslå bedre kundespørsmål
 * Hver hendelse → KnowledgeCandidate. Prod-policy endres ALDRI umiddelbart.
 */
import { KnowledgeStore } from './store.js';
import { teach, type TeachingEvent } from './teacher.js';
import { INTERVIEW_TOPICS, startInterview, answerInterview } from './interview.js';

export interface TeacherApiOptions {
  store: KnowledgeStore;
}

export class TeacherApi {
  private store: KnowledgeStore;
  private interviews = new Map<string, ReturnType<typeof startInterview>>();

  constructor(opts: TeacherApiOptions) { this.store = opts.store; }

  /** 13. Inspiser sesjon (samlet visning for Tom). */
  inspectSession(sessionView: unknown): { ok: true; session: unknown } {
    return { ok: true, session: sessionView };
  }

  /** 13. Korriger agentsvar + forklar hvorfor → KnowledgeCandidate. */
  correctAgentAnswer(event: Omit<TeachingEvent, 'teacher'> & { teacher?: string }): ReturnType<typeof teach> {
    return teach(this.store, { ...event, teacher: event.teacher ?? 'Tom Arne Jensen' });
  }

  /** 13/4. Undervis terminologi/katalog-semantikk (eksplisitt scope påkrevd). */
  teachKnowledge(event: TeachingEvent): ReturnType<typeof teach> {
    if (!event.scope || Object.keys(event.scope).length === 0) {
      throw new Error('scope er påkrevd — aldri globalisér fra én bil');
    }
    return teach(this.store, event);
  }

  /** 13. Marker kjent unntak. */
  markException(event: TeachingEvent): ReturnType<typeof teach> {
    return teach(this.store, { ...event, affectedKnowledgeClass: 'KNOWN_EXCEPTION' });
  }

  /** 19. Expert Interview — start nytt tema. */
  startInterview(teacher: string, topic: string): ReturnType<typeof startInterview> {
    const iv = startInterview(teacher, topic);
    this.interviews.set(iv.interviewId, iv);
    return iv;
  }

  answerInterview(interviewId: string, answer: { statement: string; scope: Parameters<typeof answerInterview>[2]['scope']; reason?: string | null }): { candidateCount: number; conflicts: number } {
    const iv = this.interviews.get(interviewId);
    if (!iv) throw new Error(`intervju finnes ikke: ${interviewId}`);
    return answerInterview(this.store, iv, answer);
  }

  listTopics(): typeof INTERVIEW_TOPICS { return INTERVIEW_TOPICS; }

  candidates(): { status: string; class: string; statement: string }[] {
    return this.store.all().map((k) => ({ status: k.lifecycle, class: k.class, statement: k.statement.slice(0, 80) }));
  }
}
