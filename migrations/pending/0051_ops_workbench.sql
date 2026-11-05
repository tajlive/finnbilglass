-- Additive workbench. Apply to inquiry DB (staging-auth in staging), not catalogue.
CREATE TABLE IF NOT EXISTS ops_work_state (
 inquiry_id INTEGER PRIMARY KEY REFERENCES beta_inquiries(id), version INTEGER NOT NULL DEFAULT 0,
 assigned_to TEXT NOT NULL DEFAULT '', next_action TEXT NOT NULL DEFAULT '', due_at INTEGER,
 sales TEXT NOT NULL DEFAULT 'NEW', payment TEXT NOT NULL DEFAULT 'NOT_AGREED',
 delivery TEXT NOT NULL DEFAULT 'NOT_ORDERED', supplier TEXT NOT NULL DEFAULT '',
 supplier_ref TEXT NOT NULL DEFAULT '', tracking_url TEXT NOT NULL DEFAULT '',
 delivery_address TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL, updated_by TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ops_work_events (
 id TEXT PRIMARY KEY, inquiry_id INTEGER NOT NULL REFERENCES beta_inquiries(id),
 kind TEXT NOT NULL, body TEXT NOT NULL, actor TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ops_work_events_case ON ops_work_events(inquiry_id,created_at);
CREATE TABLE IF NOT EXISTS ops_offers (
 id TEXT PRIMARY KEY, inquiry_id INTEGER NOT NULL REFERENCES beta_inquiries(id), version INTEGER NOT NULL,
 request_id TEXT NOT NULL UNIQUE, snapshot_json TEXT NOT NULL, expires_at INTEGER NOT NULL,
 status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','SENT','ACCEPTED','WITHDRAWN')),
 created_at INTEGER NOT NULL, created_by TEXT NOT NULL, sent_at INTEGER, accepted_at INTEGER,
 UNIQUE(inquiry_id,version)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ops_one_accepted ON ops_offers(inquiry_id) WHERE status='ACCEPTED';
CREATE TABLE IF NOT EXISTS ops_messages (
 id TEXT PRIMARY KEY, inquiry_id INTEGER REFERENCES beta_inquiries(id), offer_id TEXT REFERENCES ops_offers(id),
 request_id TEXT NOT NULL UNIQUE, direction TEXT NOT NULL, recipient TEXT NOT NULL, subject TEXT NOT NULL,
 body TEXT NOT NULL, status TEXT NOT NULL, provider_id TEXT UNIQUE,
 actor TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, error TEXT, send_reserved_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_ops_messages_case ON ops_messages(inquiry_id,created_at);
CREATE INDEX IF NOT EXISTS idx_ops_messages_status ON ops_messages(status,created_at);
CREATE TABLE IF NOT EXISTS ops_mail_events (
 id TEXT PRIMARY KEY, provider_id TEXT NOT NULL, event_type TEXT NOT NULL, occurred_at INTEGER NOT NULL,
 payload_json TEXT NOT NULL, processed INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_ops_mail_provider ON ops_mail_events(provider_id,occurred_at);
