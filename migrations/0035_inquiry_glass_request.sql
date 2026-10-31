-- Preserve the selected glass request and make customer retries idempotent.
ALTER TABLE beta_inquiries ADD COLUMN glass_request_json TEXT;
ALTER TABLE beta_inquiries ADD COLUMN client_request_id TEXT;
ALTER TABLE beta_inquiries ADD COLUMN request_fingerprint TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_beta_inquiries_client_request_id
  ON beta_inquiries(client_request_id) WHERE client_request_id IS NOT NULL;
