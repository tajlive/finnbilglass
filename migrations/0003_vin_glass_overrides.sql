-- ============================================================================
-- 0003_vin_glass_overrides.sql — eksakte VIN-fasitoverstyringer
-- ----------------------------------------------------------------------------
-- Brukes kun for manuelt verifiserte fasitbiler der lokal B2B-seed mangler
-- kjøretøy→glass-mapping, men SVV gir eksakt VIN. Dette er smalere enn
-- make/model/year-overstyring og bevarer doktrinen: false positive > fallback.
-- ============================================================================

CREATE TABLE IF NOT EXISTS vin_glass_overrides (
  vin TEXT NOT NULL,
  eurocode TEXT NOT NULL,
  make TEXT,
  model TEXT,
  year INTEGER,
  verified_by TEXT,
  confidence REAL DEFAULT 0.95,
  source TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (vin, eurocode)
);

CREATE INDEX IF NOT EXISTS idx_vin_glass_overrides_vin ON vin_glass_overrides(vin);
