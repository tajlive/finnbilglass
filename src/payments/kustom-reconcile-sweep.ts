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
    "SELECT id FROM quote_payment_orders WHERE payment_provider='kustom' " +
    "AND status IN ('ACCEPTED','PAYMENT_LINK_SENT') " +
    'AND kustom_order_id IS NOT NULL AND kustom_hpp_session_id IS NOT NULL ' +
    'AND updated_at<=? ' +
    "AND (kustom_capture_state IS NULL OR kustom_capture_state IN ('AUTHORIZED','PENDING_REVIEW')) " +
    'ORDER BY updated_at ASC,id ASC LIMIT ?'
  ).bind(now - MIN_AGE_MS, BATCH_LIMIT).all<{id: string}>();
  const summary: KustomSweepSummary = {
    checked: 0, updated: 0, authorized: 0, paid: 0, pending: 0,
    manualReview: 0, alreadyFinal: 0, errors: 0
  };
  const pollOne = options.pollOne ?? pollKnownKustomOrder;
  for (const row of rows.results ?? []) {
    summary.checked += 1;
    try {
      const result = await pollOne(db, env, row.id);
      if (result.updated) summary.updated += 1;
      switch (result.state) {
        case 'AUTHORIZED': summary.authorized += 1; break;
        case 'PAID': summary.paid += 1; break;
        case 'PENDING': summary.pending += 1; break;
        case 'REVIEW_REQUIRED': summary.manualReview += 1; break;
        case 'ALREADY_FINAL': summary.alreadyFinal += 1; break;
        default: summary.errors += 1;
      }
    } catch {
      // A failure is counted and reported by the cron entrypoint. Never attempt
      // to re-create a checkout or issue a money POST as a recovery action.
      summary.errors += 1;
    }
  }
  return summary;
}