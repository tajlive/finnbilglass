/**
 * conversation-v1/api — STAGING-API for den konversasjonelle assistenten.
 * Kun tilgjengelig når env ASSISTANT_ENABLED === 'staging'|'true' (prod default: AV).
 * Ingen rå DB-tilgang til LLM. Prompt-injection-barriere: kundetekst er UNTRUSTED INPUT.
 */
import type { Channel } from './session.js';
import { FitmentSession, generateSessionId } from './session.js';
import * as T from './tools.js';
import { policyPhrase, stateLabel } from './policy.js';
import { EvidenceCapture } from './evidence-capture.js';
import type { LedgerStore } from '../learning-v1/evidence-ledger.js';

export const ASSISTANT_SESSION_TTL_MS = 30 * 60 * 1000;   // 30 min inaktivitet
export const MAX_MESSAGE_CHARS = 4096;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_PHOTOS_PER_SESSION = 5;
export const MAX_TOOL_CALLS_PER_TURN = 10;
export const MAX_TURNS_BEFORE_HANDOFF = 30;
export const RATE_LIMIT_WINDOW_MS = 60_000;
export const RATE_LIMIT_MAX_PER_IP = 30;

interface RateBucket { count: number; resetAt: number }

export class AssistantApi {
  private sessions = new Map<string, FitmentSession>();
  private rate = new Map<string, RateBucket>();
  private duplicatePhotos = new Map<string, string>(); // imageId → sessionId (duplisert-foto-håndtering)
  /** C8: AI-agenten som kunnskapsinnsamler — samtaleobservasjoner fanges deterministisk. */
  readonly evidenceCapture: EvidenceCapture;

  constructor(opts: { ttlMs?: number; ledger?: LedgerStore } = {}) {
    this.ttlMs = opts.ttlMs ?? ASSISTANT_SESSION_TTL_MS;
    this.evidenceCapture = new EvidenceCapture(undefined, opts.ledger ?? null);
  }
  private readonly ttlMs: number;

  // ── abuse-guards ──
  rateLimit(ip: string): { ok: boolean; retryAfterMs?: number } {
    const now = Date.now();
    const b = this.rate.get(ip);
    if (!b || b.resetAt <= now) { this.rate.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS }); return { ok: true }; }
    b.count += 1;
    if (b.count > RATE_LIMIT_MAX_PER_IP) return { ok: false, retryAfterMs: b.resetAt - now };
    return { ok: true };
  }

  private getSession(id: string): FitmentSession | null {
    const s = this.sessions.get(id);
    if (!s) return null;
    if (Date.now() - s.lastActivityAt > this.ttlMs) {
      this.sessions.delete(id);
      return null;
    }
    return s;
  }

  /** Injiser en hydrert sesjon (D1-persistens: last inn før hver request). */
  loadSession(s: FitmentSession): void { this.sessions.set(s.fitmentSessionId, s); }

  /** Hent sesjon uten TTL-sjekk (for persistens etter mutasjon). */
  peek(id: string): FitmentSession | null { return this.sessions.get(id) ?? null; }

  // ── POST /api/assistant/session ──
  createSession(channel: Channel, opts: { ip?: string; maxTurnsBeforeHandoff?: number } = {}): { ok: boolean; sessionId?: string; stateLabel?: string; error?: string } {
    const lim = this.rateLimit(opts.ip ?? 'unknown');
    if (!lim.ok) return { ok: false, error: `RATE_LIMITED retry_after=${lim.retryAfterMs}` };
    const s = new FitmentSession({ channel, maxTurnsBeforeHandoff: opts.maxTurnsBeforeHandoff ?? MAX_TURNS_BEFORE_HANDOFF });
    this.sessions.set(s.fitmentSessionId, s);
    return { ok: true, sessionId: s.fitmentSessionId, stateLabel: stateLabel(s) };
  }

  // ── POST /api/assistant/message (kundetekst — UNTRUSTED) ──
  message(sessionId: string, text: string, opts: { ip?: string } = {}): { ok: boolean; reply?: string; stateLabel?: string; error?: string } {
    const lim = this.rateLimit(opts.ip ?? 'unknown');
    if (!lim.ok) return { ok: false, error: `RATE_LIMITED retry_after=${lim.retryAfterMs}` };
    const s = this.getSession(sessionId);
    if (!s) return { ok: false, error: 'SESSION_NOT_FOUND_OR_EXPIRED' };
    if (s.handoffState) return { ok: true, reply: 'Saken er sendt til manuell kontroll.', stateLabel: stateLabel(s) };
    if (typeof text !== 'string' || text.length === 0) return { ok: false, error: 'EMPTY_MESSAGE' };
    if (text.length > MAX_MESSAGE_CHARS) return { ok: false, error: 'MESSAGE_TOO_LONG' };
    if (s.turnCount >= s.maxTurnsBeforeHandoff) {
      T.requestManualReview(s, 'maks antall turer nådd (abuse-guard)');
      return { ok: true, reply: 'Jeg sender saken til manuell kontroll.', stateLabel: stateLabel(s) };
    }
    s.turnCount += 1;
    s.customerRequest = s.customerRequest ?? text.slice(0, 280);

    // Ventende identifikator-bekreftelse (echo-back) har forrang — ja/nei-parsing
    if (s.pendingConfirmations.length > 0) {
      const pending = s.pendingConfirmations[0];
      const answer = text.trim().toLowerCase();
      if (['ja', 'stemmer', 'bekreft', 'riktig', 'yes', 'ok'].includes(answer)) {
        const r = T.confirmIdentifierTool(s, pending.parsed, { confirmed: true });
        if (r.ok) {
          T.resolveFitment(s); // deterministisk: evidens → fitment (kun via policy)
          const next = T.getNextQuestion(s);
          return { ok: true, reply: next ? next.customerFriendlyMeaning : policyPhrase(s), stateLabel: stateLabel(s) };
        }
      }
      if (['nei', 'stemmer ikke', 'feil', 'no'].includes(answer)) {
        T.confirmIdentifierTool(s, pending.parsed, { confirmed: false });
        const next = T.getNextQuestion(s);
        return { ok: true, reply: `Beklager feillesningen. ${next ? next.customerFriendlyMeaning : policyPhrase(s)}`, stateLabel: stateLabel(s) };
      }
    }

    // Resolver-spørsmål-svar (lastQuestion, system=false, YES_NO-modus).
    // Kun ja/nei-svar aksepteres her; alt annet faller gjennom til identifikator-parsing.
    // IDENTIFIER/PHOTO-modus lar fritekst falle gjennom uansett.
    const yesNo = text.trim().toLowerCase();
    const isYesNo = ['ja', 'nei', 'yes', 'no', 'stemmer', 'stemmer ikke'].includes(yesNo);
    if (s.lastQuestion && !s.lastQuestion.system && s.lastQuestion.preferredModality === 'YES_NO' && isYesNo) {
      T.submitObservation(s, s.lastQuestion.questionId, text, { modality: s.channel });
      T.resolveFitment(s);
      const next = T.getNextQuestion(s);
      return { ok: true, reply: next ? next.customerFriendlyMeaning : policyPhrase(s), stateLabel: stateLabel(s) };
    }

    // Frittstående regnr/OE i tekst — tolket via identifikator-pipeline (aldri direkte autoritativt)
    // Beholder mellomrom slik at ordgrenser fungerer: «trenger frontrute til SU 18018» → SU18018
    const regnrMatch = text.toUpperCase().match(/\b[A-ZÆØÅ]{2}\s?\d{5}\b/);
    if (regnrMatch && !s.vehicleIdentity) {
      const r = T.identifyVehicle(s, regnrMatch[0].replace(/\s+/g, ''));
      if (r.ok && r.known) {
        T.bootstrapCandidates(s);
        const next = T.getNextQuestion(s);
        return { ok: true, reply: `Fant bilen: ${r.vehicle!.make} ${r.vehicle!.model} (${r.vehicle!.registrationNumber}). ${next?.customerFriendlyMeaning ?? policyPhrase(s)}`, stateLabel: stateLabel(s) };
      }
      if (r.ok && !r.known) {
        T.requestManualReview(s, 'ukjent kjøretøy');
        return { ok: true, reply: policyPhrase(s), stateLabel: stateLabel(s) };
      }
    }
    const oeMatch = text.toUpperCase().replace(/\s+/g, '').match(/\b\d[A-Z0-9]{8,14}\b/);
    if (oeMatch && s.vehicleIdentity) {
      this.evidenceCapture.captureOeTyped(s, oeMatch[0]); // C8: kundeobservasjon (svak, oppgraderes ved echo)
      const r = T.submitIdentifierCandidate(s, oeMatch[0], 'OE', { modality: 'TYPED' });
      if (r.ok && r.echoBack) return { ok: true, reply: `Jeg leste ${r.echoBack}. Stemmer det?`, stateLabel: stateLabel(s) };
    }
    return { ok: true, reply: policyPhrase(s), stateLabel: stateLabel(s) };
  }

  // ── POST /api/assistant/observation (strukturert — for tester og UI-knapper) ──
  observation(sessionId: string, questionId: string, value: string | boolean): { ok: boolean; reply?: string; error?: string } {
    const s = this.getSession(sessionId);
    if (!s) return { ok: false, error: 'SESSION_NOT_FOUND_OR_EXPIRED' };
    this.evidenceCapture.captureFeature(s, questionId, value, null); // C8: kundeobservasjon
    const r = T.submitObservation(s, questionId, value, { modality: s.channel });
    if (!r.ok) return { ok: false, error: r.error };
    T.resolveFitment(s);
    const next = T.getNextQuestion(s);
    return { ok: true, reply: next?.customerFriendlyMeaning ?? policyPhrase(s) };
  }

  // ── POST /api/assistant/photo ──
  photo(sessionId: string, payload: { sourceImageId?: string; imageBytes?: number; observations?: { key: string; value: string | boolean; visionConfidence: number }[]; r43?: { rawText: string; normalizedCandidate: string; visionConfidence: number }[]; oes?: { rawText: string; normalizedCandidate: string; visionConfidence: number }[] }): { ok: boolean; reply?: string; requiresConfirmation?: string[]; stateLabel?: string; error?: string } {
    const s = this.getSession(sessionId);
    if (!s) return { ok: false, error: 'SESSION_NOT_FOUND_OR_EXPIRED' };
    if (typeof payload.imageBytes === 'number' && payload.imageBytes > MAX_IMAGE_BYTES) return { ok: false, error: 'IMAGE_TOO_LARGE' };
    if (s.photos.length >= MAX_PHOTOS_PER_SESSION) return { ok: false, error: 'MAX_PHOTOS_REACHED' };
    const imageId = payload.sourceImageId ?? 'img-' + Math.random().toString(36).slice(2);
    if (this.duplicatePhotos.has(imageId)) return { ok: false, error: 'DUPLICATE_PHOTO_ALREADY_RECEIVED' };
    this.duplicatePhotos.set(imageId, sessionId);
    const r = T.submitPhotoObservationsTool(s, { sourceImageId: imageId, observations: payload.observations, r43: payload.r43, oes: payload.oes });
    if (r.requiresConfirmation.length > 0) {
      const pend = r.requiresConfirmation[0];
      return { ok: true, requiresConfirmation: r.requiresConfirmation, reply: `Jeg leste ${formatEcho(pend)}. Stemmer det?`, stateLabel: stateLabel(s) };
    }
    if (r.rejectedOEs.length > 0) {
      const next = T.getNextQuestion(s);
      return { ok: true, reply: next?.customerFriendlyMeaning ?? 'Bildet var ikke tydelig nok. Kan du ta et nytt?', stateLabel: stateLabel(s) };
    }
    const next = T.getNextQuestion(s);
    return { ok: true, reply: next?.customerFriendlyMeaning ?? policyPhrase(s), stateLabel: stateLabel(s) };
  }

  // ── POST /api/assistant/identifier-confirmation ──
  identifierConfirmation(sessionId: string, parsedValue: string, confirmed: boolean): { ok: boolean; reply?: string; error?: string } {
    const s = this.getSession(sessionId);
    if (!s) return { ok: false, error: 'SESSION_NOT_FOUND_OR_EXPIRED' };
    const r = T.confirmIdentifierTool(s, parsedValue, { confirmed });
    if (!r.ok) return { ok: false, error: r.error };
    if (confirmed) {
      this.evidenceCapture.captureOeConfirmed(s, parsedValue, null); // C8: echo-bekreftet OE = høyeste kundeobservasjon
      T.resolveFitment(s);
    }
    if (!confirmed) {
      const next = T.getNextQuestion(s);
      return { ok: true, reply: `Beklager feillesningen. ${next?.customerFriendlyMeaning ?? policyPhrase(s)}` };
    }
    const next = T.getNextQuestion(s);
    return { ok: true, reply: next?.customerFriendlyMeaning ?? policyPhrase(s) };
  }

  // ── GET /api/assistant/session/:id/state (public view — ingen VIN, ingen intern audit) ──
  state(sessionId: string): { ok: boolean; state?: ReturnType<FitmentSession['state']>; stateLabel?: string; error?: string } {
    const s = this.getSession(sessionId);
    if (!s) return { ok: false, error: 'SESSION_NOT_FOUND_OR_EXPIRED' };
    return { ok: true, state: s.state(true), stateLabel: stateLabel(s) };
  }

  // ── POST /api/assistant/handoff ──
  handoff(sessionId: string, reason: string): { ok: boolean; packet?: unknown; error?: string } {
    const s = this.getSession(sessionId);
    if (!s) return { ok: false, error: 'SESSION_NOT_FOUND_OR_EXPIRED' };
    const r = T.requestManualReview(s, reason);
    return r.ok && r.handoff ? { ok: true, packet: r.handoff } : { ok: false, error: 'HANDOFF_FAILED' };
  }

  // ── POST /api/assistant/quote (create_orderable_quote / get_price_estimate) ──
  quote(sessionId: string, kind: 'orderable' | 'estimate'): { ok: boolean; quote?: unknown; estimate?: unknown; error?: string } {
    const s = this.getSession(sessionId);
    if (!s) return { ok: false, error: 'SESSION_NOT_FOUND_OR_EXPIRED' };
    if (kind === 'estimate') {
      const r = T.getPriceEstimate(s);
      return r.ok ? { ok: true, estimate: r.estimate } : { ok: false, error: r.error };
    }
    const r = T.createOrderableQuote(s);
    return r.ok ? { ok: true, quote: r.quote } : { ok: false, error: r.error };
  }

  sessionExists(sessionId: string): boolean { return this.getSession(sessionId) !== null; }
  sessionCount(): number { return this.sessions.size; }
  listSessionIds(): string[] { return [...this.sessions.keys()]; }
}

function formatEcho(p: string): string {
  return p.split('').join('-');
}

export { generateSessionId, FitmentSession };
