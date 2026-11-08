-- Adopt the already-provisioned staging-auth schema as the baseline for its own
-- migration stream. This is deliberately scoped to FINNBILGLASS_STAGING_AUTH.
-- Snapshot: 2026-11-06, 25 tables + 26 indexes, schema-only export SHA-256 below.
-- Historical per-file provenance is unavailable because remote d1_migrations
-- was empty. This row does not claim that the production/catalog migrations ran.
CREATE TABLE IF NOT EXISTS staging_auth_schema_baseline (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  schema_sha256 TEXT NOT NULL,
  table_count INTEGER NOT NULL,
  index_count INTEGER NOT NULL,
  captured_at TEXT NOT NULL,
  provenance TEXT NOT NULL
);
INSERT OR IGNORE INTO staging_auth_schema_baseline
  (id, schema_sha256, table_count, index_count, captured_at, provenance)
VALUES
  (1, '7962be909f26d07303bc9875e7ed0614ef92864da2c98991b8eaead672eae702',
   25, 26, '2026-11-06T07:25:00Z',
   'Adopted from read-only staging-auth schema export; prior migration journal was empty');
