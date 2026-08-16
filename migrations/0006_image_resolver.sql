-- ============================================================================
-- 0006_image_resolver.sql — AI bilde-resolver audit/intake (KLA-301)
-- ----------------------------------------------------------------------------
-- AI-bilder brukes som evidens, ikke som sannhetskilde. Selve avgjørelsen skjer
-- fortsatt i evidence-fusion med OEM/VIN/build/katalogdata.
-- ============================================================================

CREATE TABLE IF NOT EXISTS image_intake (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  query_ref TEXT NOT NULL,
  source TEXT NOT NULL,                       -- customer/licensed_catalog/internal_b2b/research
  role TEXT NOT NULL,                         -- corner_marking/mirror_area/full_glass/sensor_detail/catalog_image
  r2_path TEXT,
  source_url TEXT,
  mime TEXT,
  width INTEGER,
  height INTEGER,
  sha256 TEXT NOT NULL,
  license_ref TEXT NOT NULL DEFAULT 'customer-upload',
  consent_ref TEXT,
  retention_until TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (query_ref, role, sha256)
);
CREATE INDEX IF NOT EXISTS idx_image_intake_query ON image_intake(query_ref);
CREATE INDEX IF NOT EXISTS idx_image_intake_hash ON image_intake(sha256);

CREATE TABLE IF NOT EXISTS image_observations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  image_intake_id INTEGER NOT NULL REFERENCES image_intake(id),
  model_version TEXT NOT NULL,
  observation_json TEXT NOT NULL,             -- ImageObservation, komplett og reproduserbar
  warnings_json TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (image_intake_id, model_version)
);
CREATE INDEX IF NOT EXISTS idx_image_observations_image ON image_observations(image_intake_id);

-- Kobler observasjoner til glass_evidence uten å duplisere selve signalformatet.
CREATE TABLE IF NOT EXISTS image_evidence_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  image_observation_id INTEGER NOT NULL REFERENCES image_observations(id),
  glass_evidence_id INTEGER NOT NULL REFERENCES glass_evidence(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (image_observation_id, glass_evidence_id)
);

CREATE TABLE IF NOT EXISTS image_resolution_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  query_ref TEXT NOT NULL,
  request_json TEXT NOT NULL,
  response_json TEXT NOT NULL,
  outcome TEXT NOT NULL,
  confidence REAL NOT NULL,
  resolver_version TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_image_resolution_audit_ref ON image_resolution_audit(query_ref);
CREATE INDEX IF NOT EXISTS idx_image_resolution_audit_outcome ON image_resolution_audit(outcome);
