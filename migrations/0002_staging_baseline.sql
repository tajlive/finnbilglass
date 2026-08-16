-- ============================================================================
-- 0002_staging_baseline.sql — staging-DB-baseline (ikke prod!)
-- ----------------------------------------------------------------------------
-- Staging-DB (finnbilglass-db-staging) trenger samme basis-tabeller som prod
-- for at Worker-koden skal kunne kjøre uendret:
--   glass_prisliste (pris-SSoT; data importeres repeterbart fra prod-eksport)
--   regnr_logg / sok_logg (søkelogging)
-- Prod-data migreres IKKE hit automatisk — kun via eksplisitt import-script.
-- ============================================================================

CREATE TABLE IF NOT EXISTS glass_prisliste (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  varenr TEXT NOT NULL,
  varenavn TEXT,
  kommentar TEXT,
  pris REAL,
  eurokode TEXT,
  alias_av TEXT,
  rad_type TEXT NOT NULL DEFAULT 'glass',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(varenr, varenavn)
);

CREATE TABLE IF NOT EXISTS regnr_logg (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  regnr TEXT NOT NULL,
  regnr_norm TEXT,
  ua TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sok_logg (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  regnr TEXT,
  regnr_norm TEXT,
  ip TEXT,
  land TEXT,
  by TEXT,
  asn TEXT,
  ua TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
