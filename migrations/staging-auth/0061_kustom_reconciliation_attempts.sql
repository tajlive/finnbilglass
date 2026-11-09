-- STAGING PREPARATION ONLY. Never apply to production automatically.
-- Read-only Kustom provider polling bookkeeping. No money movement or provider POST.
-- Apply only after D1 backup, schema/ledger verification and staging approval.
CREATE TABLE IF NOT EXISTS kustom_reconcile_attempts (
  payment_order_id TEXT PRIMARY KEY
    REFERENCES quote_payment_orders(id) ON DELETE CASCADE,
  last_checked_at INTEGER NOT NULL,
  outcome TEXT NOT NULL
    CHECK(outcome IN ('AUTHORIZED','PAID','PENDING','REVIEW_REQUIRED','ALREADY_FINAL','ERROR')),
  consecutive_errors INTEGER NOT NULL DEFAULT 0
    CHECK(consecutive_errors >= 0)
);

CREATE INDEX IF NOT EXISTS idx_kustom_reconcile_attempts_checked
  ON kustom_reconcile_attempts(last_checked_at);
