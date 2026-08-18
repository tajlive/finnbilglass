-- Evidence Capture v0.1.  The image ledger is append-only: an image or its
-- metadata is never updated/deleted. Support status is represented by new
-- status events, never by modifying the case or image record.
CREATE TABLE IF NOT EXISTS evidence_cases (
  case_id TEXT PRIMARY KEY,
  registration_hash TEXT NOT NULL,
  vehicle_identity_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  session_id TEXT,
  status TEXT NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW','REVIEWING','NEEDS_MORE_DATA','COMPLETE'))
);
CREATE INDEX IF NOT EXISTS idx_evidence_cases_created ON evidence_cases (created_at DESC);

CREATE TABLE IF NOT EXISTS evidence_case_images (
  image_id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL,
  image_type TEXT NOT NULL CHECK (image_type IN ('plate','windshield','mirror_sensor','interior_optional')),
  r2_key TEXT NOT NULL UNIQUE,
  mime TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (case_id) REFERENCES evidence_cases(case_id)
);
CREATE INDEX IF NOT EXISTS idx_evidence_case_images_case ON evidence_case_images (case_id, created_at);

CREATE TABLE IF NOT EXISTS evidence_case_status_events (
  event_id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('NEW','REVIEWING','NEEDS_MORE_DATA','COMPLETE')),
  created_at INTEGER NOT NULL,
  created_by TEXT NOT NULL,
  FOREIGN KEY (case_id) REFERENCES evidence_cases(case_id)
);
CREATE INDEX IF NOT EXISTS idx_evidence_case_status_case ON evidence_case_status_events (case_id, created_at);
