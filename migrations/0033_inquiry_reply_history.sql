-- Align inquiry history with the existing email/SMS reply handlers.
-- Wrangler applies the migration transactionally; preserve every history row.
PRAGMA defer_foreign_keys = true;

CREATE TABLE beta_inquiry_events_reply_upgrade (
  event_id TEXT PRIMARY KEY,
  inquiry_id INTEGER NOT NULL REFERENCES beta_inquiries(id),
  event_type TEXT NOT NULL CHECK (event_type IN ('created','status','note','assignment','reply')),
  previous_status TEXT,
  status TEXT,
  note TEXT,
  created_at INTEGER NOT NULL,
  created_by TEXT NOT NULL,
  meta_json TEXT DEFAULT '{}'
);

INSERT INTO beta_inquiry_events_reply_upgrade
  (event_id,inquiry_id,event_type,previous_status,status,note,created_at,created_by,meta_json)
SELECT event_id,inquiry_id,event_type,previous_status,status,note,created_at,created_by,meta_json
FROM beta_inquiry_events;

DROP TABLE beta_inquiry_events;
ALTER TABLE beta_inquiry_events_reply_upgrade RENAME TO beta_inquiry_events;
CREATE INDEX idx_beta_inquiry_events_inquiry
  ON beta_inquiry_events (inquiry_id,created_at DESC);
