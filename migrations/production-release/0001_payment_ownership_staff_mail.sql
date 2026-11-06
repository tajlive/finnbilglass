-- Additive release applied only after inspecting production columns and tables.
-- Existing inquiries remain unowned; no email-based backfill.

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

-- Bind guest or signed-in inquiry ownership only to the authenticated user ID.
-- Staging schema inspection confirmed beta_inquiries lacks customer_id and
-- auth_users.user_id is TEXT. Existing rows remain unowned; never infer from email.
ALTER TABLE beta_inquiries ADD COLUMN customer_id TEXT;
CREATE INDEX IF NOT EXISTS idx_beta_inquiries_customer_created
  ON beta_inquiries(customer_id, created_at DESC);

-- Store only Stripe's invoice identity. Customer URLs are retrieved on demand
-- after ownership, paid status, amount, currency, metadata and mode are checked.
ALTER TABLE quote_payment_orders ADD COLUMN stripe_invoice_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_quote_payment_orders_stripe_invoice
  ON quote_payment_orders(stripe_invoice_id)
  WHERE stripe_invoice_id IS NOT NULL;

-- 0055_staff_invites.sql — FinnBilGlass staff invitations (P0)

-- P0: Administrasjonsinvitasjoner. Kjør først i staging etter 0054.
-- Ingen eksisterende tabeller endres; auth_users er autoritativ for roller.
CREATE TABLE IF NOT EXISTS staff_invites (
  email TEXT PRIMARY KEY,
  role TEXT NOT NULL CHECK (role IN ('ADMIN','REVIEWER','OPERATOR','CUSTOMER')),
  status TEXT NOT NULL CHECK (status IN ('PENDING','ACCEPTED','REJECTED','INVITED','EMAIL_FAILED')),
  invited_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  provider_message_id TEXT,
  last_error_code TEXT
);

CREATE INDEX IF NOT EXISTS idx_staff_invites_status ON staff_invites (status, updated_at);
CREATE INDEX IF NOT EXISTS idx_staff_invites_email ON staff_invites(email);
CREATE INDEX IF NOT EXISTS idx_staff_invites_role ON staff_invites(role);

-- Serialiserer Access policy read-modify-write for requests fra *this* Worker.
CREATE TABLE IF NOT EXISTS staff_invite_locks (
  lock_key TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

-- Additive mail metadata, separate from legacy tables and immutable offer snapshots.
CREATE TABLE IF NOT EXISTS ops_mail_details (
 provider_id TEXT PRIMARY KEY, source TEXT NOT NULL, rfc_message_id TEXT,
 headers_json TEXT NOT NULL DEFAULT '{}', attachments_json TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS idx_ops_mail_rfc ON ops_mail_details(rfc_message_id);
CREATE TABLE IF NOT EXISTS ops_mail_sync_state (
channel TEXT PRIMARY KEY, last_success INTEGER, last_error TEXT, updated_at INTEGER NOT NULL,
history_id TEXT
);
