-- 0019_oem_probe_queue.sql
-- OEM VIN→OE akseptansetest kø (Tom-korrigert 2026-08-25)
-- VIN er personopplysning (SVV-kjørertøydata-API) — lagres IKKE i tabellen.
-- Kun vin_hash = SHA256(VIN || pepper) lagres for ekstern referanse.
-- Rå VIN håndteres kun i minnet under manuell test, aldri i DB/Git.

CREATE TABLE IF NOT EXISTS oem_probe_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  probe_id TEXT NOT NULL UNIQUE,               -- f.eks. 'tesla-20250825-001'
  vin_hash TEXT NOT NULL,                      -- SHA256(VIN || pepper) — kun identifikator
  make TEXT NOT NULL,
  model TEXT NOT NULL,
  year INTEGER,
  portal TEXT NOT NULL,                        -- 'Tesla Parts', 'BMW AOS', 'VIDA', etc.
  oe_part TEXT,                                -- OE delnummer fra portal
  supersession_json TEXT,                      -- JSON array av supersession-kjede
  oe_unique INTEGER,                           -- 1 = entydig OE, 0 = avhenger av utstyr
  eurocode_match TEXT,                         -- Eurocode fra oe_eurocode_mapping join
  crosswalk_status TEXT,                       -- 'exact' | 'ambiguous' | 'missing'
  cost_eur REAL,
  latency_ms INTEGER,
  vilkar_lagring_ok INTEGER,                   -- 1/0/null
  status TEXT DEFAULT 'pending',               -- 'pending' | 'queried' | 'completed' | 'failed'
  queried_at INTEGER,
  decision TEXT,                               -- 'exact' | 'verify' | 'fallback'
  notes TEXT,
  created_at INTEGER DEFAULT (strftime('%s','now')*1000)
);

CREATE INDEX IF NOT EXISTS idx_oem_probe_portal ON oem_probe_queue(portal);
CREATE INDEX IF NOT EXISTS idx_oem_probe_status ON oem_probe_queue(status);
CREATE INDEX IF NOT EXISTS idx_oem_probe_vin_hash ON oem_probe_queue(vin_hash);