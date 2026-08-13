-- 0006_b2b_sync.sql — UNIQUE-index for idempotent B2B-sync + ktype_matches-tabell.
-- Forutsetning: glass_catalog har 33 215 unike eurokoder (verifisert), prisliste UNIQUE(varenr,varenavn).

CREATE TABLE IF NOT EXISTS ktype_matches (
  ktype TEXT NOT NULL,
  eurocode TEXT NOT NULL,
  count INTEGER DEFAULT 0,
  PRIMARY KEY (ktype, eurocode)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_glass_catalog_eurocode ON glass_catalog(eurocode);
CREATE UNIQUE INDEX IF NOT EXISTS uq_prisliste_varenr_navn ON autoglass_prisliste(varenr, varenavn);
