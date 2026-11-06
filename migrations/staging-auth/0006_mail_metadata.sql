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
