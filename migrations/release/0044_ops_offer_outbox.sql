-- PRODUCTION-REVIEWED ADDITIVE SCHEMA: immutable Resend offer outbox.
-- This release file SUPERSEDES the staging-only proposed/0044 artifact for production.
-- Apply ONLY after 0040 and 0041, verified D1 bookmark and schema review.
-- Follow migrations/release/README.md; never auto-apply.
CREATE TABLE IF NOT EXISTS ops_offer_outbox (
  offer_id TEXT PRIMARY KEY REFERENCES ops_manual_offers(offer_id),
  inquiry_id INTEGER NOT NULL REFERENCES beta_inquiries(id),
  request_id TEXT NOT NULL UNIQUE,
  recipient TEXT NOT NULL,
  subject TEXT NOT NULL,
  text_body TEXT NOT NULL,
  html_body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'QUEUED' CHECK(status IN ('QUEUED','SENDING','SENT','REVIEW')),
  provider_message_id TEXT,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  send_started_at INTEGER,
  updated_at INTEGER NOT NULL,
  CHECK(status!='SENT' OR provider_message_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_ops_offer_outbox_review ON ops_offer_outbox(status,updated_at);
CREATE TRIGGER IF NOT EXISTS ops_offer_outbox_payload_immutable
BEFORE UPDATE ON ops_offer_outbox
WHEN OLD.request_id!=NEW.request_id OR OLD.recipient!=NEW.recipient
 OR OLD.subject!=NEW.subject OR OLD.text_body!=NEW.text_body
 OR OLD.html_body!=NEW.html_body OR OLD.offer_id!=NEW.offer_id
 OR OLD.inquiry_id!=NEW.inquiry_id
BEGIN SELECT RAISE(ABORT,'OFFER_SEND_PAYLOAD_IMMUTABLE'); END;
