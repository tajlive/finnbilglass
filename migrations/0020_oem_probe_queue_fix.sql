-- 0020_oem_probe_queue_fix.sql
-- Fix: VIN er personopplysning — kun vin_hash lagres, ingen rå VIN kolonne

CREATE TABLE IF NOT EXISTS oem_probe_queue_v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  probe_id TEXT NOT NULL UNIQUE,
  vin_hash TEXT NOT NULL,
  make TEXT NOT NULL,
  model TEXT NOT NULL,
  year INTEGER,
  portal TEXT NOT NULL,
  oe_part TEXT,
  supersession_json TEXT,
  oe_unique INTEGER,
  eurocode_match TEXT,
  crosswalk_status TEXT,
  cost_eur REAL,
  latency_ms INTEGER,
  vilkar_lagring_ok INTEGER,
  status TEXT DEFAULT 'pending',
  queried_at INTEGER,
  decision TEXT,
  notes TEXT,
  created_at INTEGER DEFAULT (strftime('%s','now')*1000)
);

CREATE INDEX IF NOT EXISTS idx_oem_probe_v2_portal ON oem_probe_queue_v2(portal);
CREATE INDEX IF NOT EXISTS idx_oem_probe_v2_status ON oem_probe_queue_v2(status);
CREATE INDEX IF NOT EXISTS idx_oem_probe_v2_vin_hash ON oem_probe_queue_v2(vin_hash);

-- Migrer eksisterende data (uten vin-kolonne)
INSERT INTO oem_probe_queue_v2 (probe_id, vin_hash, make, model, year, portal, status)
SELECT probe_id, vin_hash, make, model, year, portal, status
FROM oem_probe_queue;

DROP TABLE oem_probe_queue;
ALTER TABLE oem_probe_queue_v2 RENAME TO oem_probe_queue;