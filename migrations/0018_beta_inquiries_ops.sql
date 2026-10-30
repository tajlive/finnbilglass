-- 0018_beta_inquiries_ops.sql
-- Ops-flate-modning P0: gjør beta-henvendelser behandlingsbare i /ops.
-- Status + ansvarlig + oppdatert-tid på selve henvendelsen (denormalisert for liste/sortering).
-- Append-only tidslinje (speil av evidence_case_review_events) — status + notater i én tabell.

ALTER TABLE beta_inquiries ADD COLUMN status TEXT NOT NULL DEFAULT 'NEW'
  CHECK (status IN ('NEW','CONTACTED','NEEDS_INFO','OFFERED','CONFIRMED','CLOSED','REJECTED'));
ALTER TABLE beta_inquiries ADD COLUMN assigned_to TEXT;
ALTER TABLE beta_inquiries ADD COLUMN updated_at INTEGER;
-- G9: frosset kundereise-snapshot (merke/modell/år/VIN/resolver-utfall/vist pris) ved innsending.
ALTER TABLE beta_inquiries ADD COLUMN vehicle_json TEXT;

CREATE TABLE IF NOT EXISTS beta_inquiry_events (
  event_id TEXT PRIMARY KEY,
  inquiry_id INTEGER NOT NULL REFERENCES beta_inquiries(id),
  event_type TEXT NOT NULL CHECK (event_type IN ('created','status','note','assignment')),
  previous_status TEXT,
  status TEXT,
  note TEXT,
  created_at INTEGER NOT NULL,
  created_by TEXT NOT NULL,
  meta_json TEXT DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_beta_inquiry_events_inquiry
  ON beta_inquiry_events (inquiry_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_beta_inquiries_status
  ON beta_inquiries (status, created_at DESC);
