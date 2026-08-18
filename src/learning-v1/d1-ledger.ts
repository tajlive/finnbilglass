/**
 * learning-v1/d1-ledger — C8.1: D1-adapter for Evidence Ledger + in-memory store for tester.
 * D1EvidenceLedger brukes i Worker (env.FINNBILGLASS_DB); MemoryLedgerStore for enhetstester
 * og «restart-simulering» (ny instans mot samme store = data overlever restart).
 */
import type { LedgerEvent, LedgerStore, FixtureRecord } from './evidence-ledger.js';

/** Minimal D1-grensesnitt (kompatibel med @cloudflare/workers-types D1Database). */
export interface DbLike {
  prepare(sql: string): PreparedStatement;
}
export interface PreparedStatement {
  bind(...args: unknown[]): Prepared;
}
export interface Prepared {
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
}

const EV_SQL = `INSERT INTO evidence_events (id, vehicle_identity_hash, registration_hash, created_at, source_type, evidence_type, value, confidence, status, created_by, session_id, candidate_varenr, supersedes, notes)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
const FX_SQL = `INSERT INTO installation_fixtures (fixture_id, vehicle_identity_hash, candidate_varenr, eurokode, outcome, installer_id, confirmed_at, status, source_order_id, notes)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

function toEvent(r: Record<string, unknown>): LedgerEvent {
  return {
    id: String(r.id), vehicleIdentityHash: String(r.vehicle_identity_hash), registrationHash: r.registration_hash as string | null,
    createdAt: Number(r.created_at), sourceType: r.source_type as LedgerEvent['sourceType'], evidenceType: r.evidence_type as LedgerEvent['evidenceType'],
    value: String(r.value), confidence: Number(r.confidence), status: r.status as LedgerEvent['status'], createdBy: r.created_by as LedgerEvent['createdBy'],
    sessionId: r.session_id as string | null, candidateVarenr: r.candidate_varenr as string | null, supersedes: r.supersedes as string | null, notes: r.notes as string | null,
  };
}
function toFixture(r: Record<string, unknown>): FixtureRecord {
  return {
    fixtureId: String(r.fixture_id), vehicleIdentityHash: String(r.vehicle_identity_hash), candidateVarenr: String(r.candidate_varenr),
    eurokode: r.eurokode as string | null, outcome: r.outcome as FixtureRecord['outcome'], installerId: r.installer_id as string | null,
    confirmedAt: Number(r.confirmed_at), status: r.status as FixtureRecord['status'], sourceOrderId: r.source_order_id as string | null, notes: r.notes as string | null,
  };
}

export class D1EvidenceLedger implements LedgerStore {
  constructor(private readonly db: DbLike) {}
  async appendEvent(ev: LedgerEvent): Promise<void> {
    await this.db.prepare(EV_SQL).bind(
      ev.id, ev.vehicleIdentityHash, ev.registrationHash, ev.createdAt, ev.sourceType, ev.evidenceType, ev.value,
      ev.confidence, ev.status, ev.createdBy, ev.sessionId, ev.candidateVarenr, ev.supersedes, ev.notes,
    ).run();
  }
  async eventsForVehicle(hash: string): Promise<LedgerEvent[]> {
    const { results } = await this.db.prepare('SELECT * FROM evidence_events WHERE vehicle_identity_hash = ? ORDER BY created_at').bind(hash).all<Record<string, unknown>>();
    return results.map(toEvent);
  }
  async upsertFixture(fx: FixtureRecord): Promise<void> {
    await this.db.prepare(FX_SQL).bind(fx.fixtureId, fx.vehicleIdentityHash, fx.candidateVarenr, fx.eurokode, fx.outcome, fx.installerId, fx.confirmedAt, fx.status, fx.sourceOrderId, fx.notes).run();
  }
  async fixturesForVehicle(hash: string): Promise<FixtureRecord[]> {
    const { results } = await this.db.prepare('SELECT * FROM installation_fixtures WHERE vehicle_identity_hash = ? ORDER BY confirmed_at').bind(hash).all<Record<string, unknown>>();
    return results.map(toFixture);
  }
  async allEvents(): Promise<LedgerEvent[]> {
    const { results } = await this.db.prepare('SELECT * FROM evidence_events').bind().all<Record<string, unknown>>();
    return results.map(toEvent);
  }
}

/** In-memory store (enhetstester + restart-simulering). Eksekverer samme SQL-semantikk som D1. */
export class MemoryLedgerStore implements LedgerStore {
  events: LedgerEvent[] = [];
  fixtures: FixtureRecord[] = [];
  async appendEvent(ev: LedgerEvent): Promise<void> { this.events.push(ev); }
  async eventsForVehicle(hash: string): Promise<LedgerEvent[]> { return this.events.filter((e) => e.vehicleIdentityHash === hash).sort((a, b) => a.createdAt - b.createdAt); }
  async upsertFixture(fx: FixtureRecord): Promise<void> {
    const i = this.fixtures.findIndex((f) => f.fixtureId === fx.fixtureId);
    if (i >= 0) this.fixtures[i] = fx; else this.fixtures.push(fx);
  }
  async fixturesForVehicle(hash: string): Promise<FixtureRecord[]> { return this.fixtures.filter((f) => f.vehicleIdentityHash === hash).sort((a, b) => a.confirmedAt - b.confirmedAt); }
  async allEvents(): Promise<LedgerEvent[]> { return this.events; }
}
