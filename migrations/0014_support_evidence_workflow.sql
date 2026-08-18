-- Manual support workflow. Append-only: status is derived from the latest event.
-- This table is intentionally separate from evidence_events: case handling is not fitment evidence.
CREATE TABLE IF NOT EXISTS evidence_case_review_events (
  event_id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL,
  previous_status TEXT NOT NULL CHECK (previous_status IN ('NEW','UNDER_REVIEW','NEEDS_CUSTOMER_INFO','CONFIRMED','REJECTED')),
  status TEXT NOT NULL CHECK (status IN ('NEW','UNDER_REVIEW','NEEDS_CUSTOMER_INFO','CONFIRMED','REJECTED')),
  created_at INTEGER NOT NULL,
  created_by TEXT NOT NULL,
  reason TEXT NOT NULL,
  checklist_json TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY (case_id) REFERENCES evidence_cases(case_id)
);
CREATE INDEX IF NOT EXISTS idx_evidence_case_review_events_case ON evidence_case_review_events (case_id, created_at DESC);

CREATE TABLE IF NOT EXISTS evidence_case_candidate_snapshots (
  case_id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  candidates_json TEXT NOT NULL,
  FOREIGN KEY (case_id) REFERENCES evidence_cases(case_id)
);
