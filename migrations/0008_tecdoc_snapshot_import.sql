-- ============================================================================
-- 0008_tecdoc_snapshot_import.sql — Lisensiert TecAlliance-import (KLA-307)
-- ----------------------------------------------------------------------------
-- Holder selve importbeviset atskilt fra produkt- og kjøretøykoblingene i
-- canonical master. En rad opprettes kun etter at importscriptet har godtatt
-- manifestets lisensreferanse og råfil-fingeravtrykk.
-- ============================================================================

CREATE TABLE IF NOT EXISTS tecdoc_import_runs (
  import_id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES source_katalog(source_id),
  source_version TEXT NOT NULL,
  license_ref TEXT NOT NULL,
  raw_fingerprint TEXT NOT NULL,
  manifest_json TEXT NOT NULL,
  parts_received INTEGER NOT NULL DEFAULT 0,
  vehicles_received INTEGER NOT NULL DEFAULT 0,
  records_rejected INTEGER NOT NULL DEFAULT 0,
  mode TEXT NOT NULL CHECK (mode IN ('dry_run', 'staging')),
  imported_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (source_id, raw_fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_tecdoc_import_runs_source ON tecdoc_import_runs(source_id);
