-- Staging-auth sandbox payment ledger only. Requires baseline 0001.
-- Apply only after the guarded Checkout/webhook/refund implementation is reviewed.
-- Preserve the glass-only quote amount separately from the complete customer total.
ALTER TABLE glass_quotes ADD COLUMN total_kr INTEGER
  CHECK (total_kr IS NULL OR (total_kr > 0 AND total_kr <= 10000000));

CREATE TABLE IF NOT EXISTS quote_payment_orders (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL UNIQUE,
  inquiry_id INTEGER NOT NULL REFERENCES beta_inquiries(id),
  quote_id INTEGER NOT NULL UNIQUE REFERENCES glass_quotes(id),
  quote_version INTEGER NOT NULL,
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0 AND amount_minor <= 1000000000),
  amount_breakdown_json TEXT NOT NULL CHECK (json_valid(amount_breakdown_json)),
  currency TEXT NOT NULL DEFAULT 'nok' CHECK (currency = 'nok'),
  acceptance_method TEXT NOT NULL CHECK (acceptance_method IN ('PHONE','EMAIL','IN_PERSON')),
  acceptance_note TEXT NOT NULL,
  accepted_at INTEGER NOT NULL,
  accepted_by TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACCEPTED'
    CHECK (status IN ('ACCEPTED','PAYMENT_LINK_SENT','PAID','PAYMENT_FAILED','REFUND_PENDING','PARTIALLY_REFUNDED','REFUNDED','CANCELLED','EXPIRED')),
  stripe_checkout_session_id TEXT UNIQUE,
  stripe_payment_intent_id TEXT UNIQUE,
  checkout_url TEXT,
  payment_link_sent_at INTEGER,
  paid_at INTEGER,
  refunded_minor INTEGER NOT NULL DEFAULT 0 CHECK (refunded_minor >= 0 AND refunded_minor <= amount_minor),
  created_at INTEGER NOT NULL,
  created_by TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_quote_payment_orders_inquiry
  ON quote_payment_orders(inquiry_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_quote_payment_orders_status
  ON quote_payment_orders(status, updated_at);

-- Only Stripe event identity/processing state is persisted; no raw payload or PII.
CREATE TABLE IF NOT EXISTS stripe_payment_events (
  event_id TEXT PRIMARY KEY,
  order_id TEXT REFERENCES quote_payment_orders(id),
  event_type TEXT NOT NULL,
  received_at INTEGER NOT NULL,
  processed_at INTEGER,
  processing_status TEXT NOT NULL DEFAULT 'RECEIVED'
    CHECK (processing_status IN ('RECEIVED','PROCESSED','IGNORED','RETRY')),
  error_code TEXT
);
CREATE INDEX IF NOT EXISTS idx_stripe_payment_events_order
  ON stripe_payment_events(order_id, received_at);

CREATE TABLE IF NOT EXISTS stripe_payment_refunds (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES quote_payment_orders(id),
  idempotency_key TEXT NOT NULL UNIQUE,
  stripe_refund_id TEXT UNIQUE,
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','SUCCEEDED','FAILED','CANCELLED')),
  requested_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_stripe_payment_refunds_order
  ON stripe_payment_refunds(order_id, created_at);
