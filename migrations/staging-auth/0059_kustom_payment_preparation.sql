-- PREPARATION ONLY. Not automatically applied to staging or production.
-- Prerequisite: quote_payment_orders already exists and its actual schema has been checked.
-- Preserve historic Stripe columns and events. Never DROP historical payment records.
-- Requires reviewed migration tracking and D1 backup/restore evidence before execution.

ALTER TABLE quote_payment_orders ADD COLUMN payment_provider TEXT NOT NULL DEFAULT 'stripe';
ALTER TABLE quote_payment_orders ADD COLUMN kustom_order_id TEXT;
ALTER TABLE quote_payment_orders ADD COLUMN kustom_hpp_session_id TEXT;
ALTER TABLE quote_payment_orders ADD COLUMN kustom_hpp_url TEXT;
ALTER TABLE quote_payment_orders ADD COLUMN kustom_notification_token_hash TEXT;
ALTER TABLE quote_payment_orders ADD COLUMN kustom_checkout_create_started_at INTEGER;
ALTER TABLE quote_payment_orders ADD COLUMN kustom_authorized_at INTEGER;
ALTER TABLE quote_payment_orders ADD COLUMN kustom_acknowledged_at INTEGER;
ALTER TABLE quote_payment_orders ADD COLUMN kustom_capture_state TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_quote_payment_kustom_order
  ON quote_payment_orders(kustom_order_id) WHERE kustom_order_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_quote_payment_kustom_hpp
  ON quote_payment_orders(kustom_hpp_session_id) WHERE kustom_hpp_session_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS kustom_payment_events (
  event_id TEXT PRIMARY KEY,
  order_id TEXT,
  kustom_order_id TEXT,
  kustom_session_id TEXT,
  received_at INTEGER NOT NULL,
  processed_at INTEGER,
  state TEXT NOT NULL,
  error_code TEXT
);
CREATE INDEX IF NOT EXISTS idx_kustom_events_order ON kustom_payment_events(order_id);
