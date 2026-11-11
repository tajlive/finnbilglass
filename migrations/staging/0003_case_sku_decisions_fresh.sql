-- Fresh isolated STAGING only: create the SKU decision ledger without
-- rebuilding the evidence image table (legacy migration 0022 is destructive).
-- No customer records and no generated fitment authority.
CREATE TABLE IF NOT EXISTS case_sku_decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id TEXT NOT NULL,
  decision_type TEXT NOT NULL CHECK (decision_type IN
    ('approve_sku','request_better_image','choose_alternative_sku','reject')),
  sku TEXT,
  eurocode TEXT,
  reason TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  meta_json TEXT DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_csd_case ON case_sku_decisions (case_id, created_at);
