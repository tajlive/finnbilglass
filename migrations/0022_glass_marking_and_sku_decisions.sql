-- ============================================================================
-- 0022_glass_marking_and_sku_decisions.sql (Oppgave 3)
-- ----------------------------------------------------------------------------
-- 1) Ny bildetype 'glass_marking' (nærbilde av glassmerking nederste hjørne).
--    SQLite kan ikke endre CHECK — tabellen rebuildes, data bevares.
-- 2) case_sku_decisions: append-only beslutningslogg for operatør-handlinger
--    (godkjenn SKU / be om bedre bilde / velg alternativ SKU / avslå).
-- ============================================================================

-- 1. Rebuild evidence_case_images med utvidet bildetype-sett
--    RENAME-sekvens (ikke DROP): DROP av foreldre-tabellen blokkeres av FK fra
--    evidence_case_image_quality_events (0016) når foreign_keys=ON (D1).
--    SQLite oppdaterer barnets FK-referanse automatisk ved RENAME.
CREATE TABLE IF NOT EXISTS evidence_case_images_new (
  image_id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL,
  image_type TEXT NOT NULL CHECK (image_type IN ('plate','windshield','mirror_sensor','glass_marking','interior_optional')),
  r2_key TEXT NOT NULL UNIQUE,
  mime TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (case_id) REFERENCES evidence_cases(case_id)
);
INSERT OR IGNORE INTO evidence_case_images_new (image_id, case_id, image_type, r2_key, mime, created_at)
  SELECT image_id, case_id, image_type, r2_key, mime, created_at FROM evidence_case_images;
ALTER TABLE evidence_case_images RENAME TO evidence_case_images_old;
ALTER TABLE evidence_case_images_new RENAME TO evidence_case_images;
DROP TABLE IF EXISTS evidence_case_images_old;
CREATE INDEX IF NOT EXISTS idx_evidence_case_images_case ON evidence_case_images (case_id, created_at);

-- 2. Append-only beslutningslogg for SKU-handlinger
CREATE TABLE IF NOT EXISTS case_sku_decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id TEXT NOT NULL,                 -- inquiry_id eller evidence case_id
  decision_type TEXT NOT NULL CHECK (decision_type IN
    ('approve_sku','request_better_image','choose_alternative_sku','reject')),
  sku TEXT,                              -- valgt/godkjent SKU (varenr eller GLAVISTA:<nr>)
  eurocode TEXT,
  reason TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  meta_json TEXT DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_csd_case ON case_sku_decisions (case_id, created_at);
