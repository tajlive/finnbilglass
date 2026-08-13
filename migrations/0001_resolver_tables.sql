-- ============================================================================
-- 0001_resolver_tables.sql — OE/VIN Pinpoint resolver (finnbilglass)
-- ----------------------------------------------------------------------------
-- Lokale kopier av resolver-data (alternativ A): ingen runtime-avhengighet
-- til B2B-databasen. Data importeres repeterbart via scripts/import-resolver-data.mjs
-- med metadata i resolver_meta (source_version / source_updated_at / imported_at).
-- ============================================================================

-- Metadata for dataimport (versjonert, repeterbar)
CREATE TABLE IF NOT EXISTS resolver_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Verifiserte kjøretøy → frontrute-kode (auto-glass.no, fra B2B ground_truth).
-- Verdier i frontrute_eurocode er auto-glass.no-artikkelnr som finnes i
-- autoglass_prisliste.varenr (92 % dekning verifisert 2026-08-13).
CREATE TABLE IF NOT EXISTS ground_truth (
  make TEXT NOT NULL,
  model TEXT NOT NULL,
  year INTEGER NOT NULL,
  frontrute_eurocode TEXT NOT NULL,
  verified_by TEXT,
  confidence REAL DEFAULT 0.85,
  source TEXT,
  PRIMARY KEY (make, model, year, frontrute_eurocode)
);
CREATE INDEX IF NOT EXISTS idx_ground_truth_vehicle ON ground_truth(make, model, year);

-- Resolver-katalog: glass-produkter med kjøretøy-tilknytning.
-- Kolonner speiler B2B glass_catalog (Pilkington-dump / enriched live-eksport).
CREATE TABLE IF NOT EXISTS glass_catalog (
  eurocode TEXT NOT NULL,
  article_number TEXT,
  category TEXT,
  supplier TEXT,
  brand TEXT,
  model TEXT,
  year_from INTEGER,
  year_to INTEGER,
  adas INTEGER DEFAULT 0,
  rain_sensor INTEGER DEFAULT 0,
  heated INTEGER DEFAULT 0,
  acoustic INTEGER DEFAULT 0,
  antenna INTEGER DEFAULT 0,
  hud INTEGER DEFAULT 0,
  shade INTEGER DEFAULT 0,
  camera INTEGER DEFAULT 0,
  lane_assist INTEGER DEFAULT 0,
  price REAL,
  stock_status INTEGER DEFAULT 0,
  oem_numbers TEXT,
  dimensions TEXT,
  description TEXT,
  prefix4 TEXT,
  ktype TEXT,
  source TEXT,
  brand_original TEXT,
  PRIMARY KEY (eurocode, brand, model, source)
);
CREATE INDEX IF NOT EXISTS idx_glass_catalog_brand_model ON glass_catalog(brand, model);
CREATE INDEX IF NOT EXISTS idx_glass_catalog_category ON glass_catalog(category);
CREATE INDEX IF NOT EXISTS idx_glass_catalog_ktype ON glass_catalog(ktype);
CREATE INDEX IF NOT EXISTS idx_glass_catalog_eurocode ON glass_catalog(eurocode);

-- TecDoc ktype-register: merke/modell/år → ktype (fra B2B ktype_registry / ground_truth_rows).
CREATE TABLE IF NOT EXISTS ktype_registry (
  ktype TEXT NOT NULL,
  brand TEXT NOT NULL,
  model TEXT NOT NULL,
  year_from INTEGER,
  year_to INTEGER,
  source TEXT,
  PRIMARY KEY (ktype)
);
CREATE INDEX IF NOT EXISTS idx_ktype_registry_vehicle ON ktype_registry(brand, model);

-- VIN → ktype (fra B2B vin_ktype_map; fylles ved live-eksport — tom lokalt).
CREATE TABLE IF NOT EXISTS vin_ktype_map (
  vin TEXT NOT NULL,
  ktype TEXT NOT NULL,
  regnr_hash TEXT,
  make TEXT,
  model TEXT,
  year INTEGER,
  confidence REAL,
  source TEXT,
  PRIMARY KEY (vin)
);

-- OE-nummer → eurocode (fra glass_catalog.oem_numbers; fylles ved live-eksport).
CREATE TABLE IF NOT EXISTS oe_eurocode_mapping (
  oe_number TEXT NOT NULL COLLATE NOCASE,
  eurocode TEXT NOT NULL,
  brand TEXT,
  model TEXT,
  category TEXT,
  source TEXT,
  PRIMARY KEY (oe_number, eurocode, source)
);
CREATE INDEX IF NOT EXISTS idx_oe_mapping_eurocode ON oe_eurocode_mapping(eurocode);
