-- Evidence image quality gate. Append-only: image quality is recorded as events
-- and never updates the original customer image metadata.
CREATE TABLE IF NOT EXISTS evidence_case_image_quality_events (
  event_id TEXT PRIMARY KEY,
  image_id TEXT NOT NULL,
  case_id TEXT NOT NULL,
  quality_class TEXT NOT NULL CHECK (quality_class IN ('PASS','REVIEW','REJECT')),
  reason_codes_json TEXT NOT NULL DEFAULT '[]',
  width INTEGER,
  height INTEGER,
  byte_length INTEGER NOT NULL,
  mime TEXT NOT NULL,
  analysis_version TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  created_by TEXT NOT NULL,
  FOREIGN KEY (image_id) REFERENCES evidence_case_images(image_id),
  FOREIGN KEY (case_id) REFERENCES evidence_cases(case_id)
);

CREATE INDEX IF NOT EXISTS idx_evidence_case_image_quality_image
  ON evidence_case_image_quality_events (image_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_evidence_case_image_quality_case
  ON evidence_case_image_quality_events (case_id, quality_class, created_at DESC);
