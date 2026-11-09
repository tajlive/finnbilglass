/**
 * Bounded, staging-only sweeper for Kustom orders whose callback may be missing.
 *
 * No provider POSTs and no automatic capture or refunds.
 * Production intentionally cannot execute this module until a separate release gate.
 */
import {
  kustomPollingAllowed, pollKnownKustomOrder,
  type PollResult
} from './kustom-reconcile-poll.js';
import type { KustomEnvironment } from './kustom-core.js';

type StagingPollEnv = KustomEnvironment & {
  KUSTOM_RECONCILIATION_ENABLED?: string;
};

type PollOne = (db: D1Database, env: StagingPollEnv, id: string) => Promise<PollResult>;

export type KustomSweepSummary = {
  checked: number;
  updated: number;
  authorized: number;
  paid: number;
  pending: number;
  manualReview: number;
  alreadyFinal: number;
  errors: number;
};

const MIN_AGE_MS = 2 * 60_000;
const BATCH_LIMIT = 5;

/**
 * Only the oldest five staging payment-link orders, older than two minutes,
 * with an existing Kustom order + HPP session can be reconciled.
 * No customer PII or provider order IDs are returned or logged.
 */
export async function sweepStaleKustomPayments(
  db: D1Database,
  env: StagingPollEnv,
  options: { now?: number; pollOne?: PollOne } = {}
): Promise<KustomSweepSummary> {
  if (env.ENVIRONMENT !== 'staging' || !kustomPollingAllowed(env)) {
    throw new Error('KUSTOM_SWEEP_DISABLED');
  }
  const now = options.now ?? Date.now();
  if (!Number.isSafeInteger(now) || now <= MIN_AGE_MS) {
    throw new Error('KUSTOM_SWEEP_INVALID_TIME');
  }
  const rows = await db.prepare(
    'SELECT p.id FROM quote_payment_orders p ' +
    'LEFT JOIN kustom_reconcile_attempts a ON a.payment_order_id=p.id ' +
    "WHERE p.payment_provider='kustom' AND p.status IN ('ACCEPTED','PAYMENT_LINK_SENT') " +
    'AND p.kustom_order_id IS NOT NULL AND p.kustom_hpp_session_id IS NOT NULL ' +
    'AND p.updated_at<=? ' +
    "AND (p.kustom_capture_state IS NULL OR p.kustom_capture_state IN ('AUTHORIZED','PENDING_REVIEW')) " +
    'AND (a.last_checked_at IS NULL OR a.last_checked_at<=?) ' +
    'ORDER BY COALESCE(a.last_checked_at,0),p.updated_at,p.id LIMIT ?'
  ).bind(now - MIN_AGE_MS, now - 15 * 60_000, BATCH_LIMIT).all<{id: string}>();
  const summary: KustomSweepSummary = {
    checked: 0, updated: 0, authorized: 0, paid: 0, pending: 0,
    manualReview: 0, alreadyFinal: 0, errors: 0
  };
  const pollOne = options.pollOne ?? pollKnownKustomOrder;
  for (const row of rows.results ?? []) {
    summary.checked += 1;
    let outcome: 'AUTHORIZED'|'PAID'|'PENDING'|'REVIEW_REQUIRED'|'ALREADY_FINAL'|'ERROR' = 'ERROR';
    try {
      const result = await pollOne(db, env, row.id);
      if (result.updated) summary.updated += 1;
      outcome = result.state;
      switch (result.state) {
        case 'AUTHORIZED': summary.authorized += 1; break;
        case 'PAID': summary.paid += 1; break;
        case 'PENDING': summary.pending += 1; break;
        case 'REVIEW_REQUIRED': summary.manualReview += 1; break;
        case 'ALREADY_FINAL': summary.alreadyFinal += 1; break;
        default: summary.errors += 1;
      }
    } catch {
      // A failed provider GET is recorded and retried in a later run,
      // never via a duplicate payment POST.
      summary.errors += 1;
    }
    // Bookkeeping is separate from quote.updated_at, so a PENDING/ERROR
    // result cannot starve every newer order in a bounded 5-row sweep.
    // Schema missing => fail-closed, no cron activation before migration.
    await db.prepare(
      'INSERT INTO kustom_reconcile_attempts ' +
      '(payment_order_id,last_checked_at,outcome,consecutive_errors) ' +
      'VALUES(?,?,?,?) ON CONFLICT(payment_order_id) DO UPDATE SET ' +
      'last_checked_at=excluded.last_checked_at,outcome=excluded.outcome,' +
      'consecutive_errors=CASE WHEN excluded.outcome=\'ERROR\' ' +
      'THEN kustom_reconcile_attempts.consecutive_errors+1 ELSE 0 END'
    ).bind(row.id,now,outcome,outcome==='ERROR'?1:0).run();
  }
  return summary;
}