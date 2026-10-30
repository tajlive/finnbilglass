-- ============================================================================
-- 0027_quality_events_fk_fix.sql — fiks FK etter 0022-rebuilden.
-- ----------------------------------------------------------------------------
-- 0022 (glass_marking-rebuild) brukte RENAME-sekvens; SQLite oppdaterte da
-- evidence_case_image_quality_events sin FOREIGN KEY (image_id) til å peke på
-- evidence_case_images_old. Rebuild med riktig FK-mål (evidence_case_images).
-- Foreldreløse rader (image_id kun i _old) hoppes over — de ligger i _old-backup.
-- ============================================================================

CREATE TABLE IF NOT EXISTS evidence_case_image_quality_events_new (
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
CREATE INDEX IF NOT EXISTS idx_quality_new_image ON evidence_case_image_quality_events_new(image_id);
CREATE INDEX IF NOT EXISTS idx_quality_new_case ON evidence_case_image_quality_events_new(case_id);

INSERT INTO evidence_case_image_quality_events_new
  SELECT * FROM evidence_case_image_quality_events
  WHERE image_id IN (SELECT image_id FROM evidence_case_images);

ALTER TABLE evidence_case_image_quality_events RENAME TO evidence_case_image_quality_events_old;
ALTER TABLE evidence_case_image_quality_events_new RENAME TO evidence_case_image_quality_events;
-- _old beholdes som backup (D1 tillater ikke FK-blokkert tabell-sletting).
