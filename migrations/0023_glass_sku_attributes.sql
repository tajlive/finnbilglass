-- ============================================================================
-- 0023_glass_sku_attributes.sql — glavista-attributter for matcher (Oppgave 6a-2).
-- ----------------------------------------------------------------------------
-- Gjør glass-skus.json-attributtene (cameraBracket/rainLightSensor/acoustic/
-- heating/hud/antenna/tint fra glavista-props) tilgjengelige for matcher.ts
-- i Worker-runtime. Seedes fra data/glass-skus.json via
-- scripts/seed-glass-sku-attributter.mjs (batch 200 — SQLITE_TOOBIG-guard).
-- Kun kjente verdier lagres; null/UKJENT lagres ikke (aldri tolkes som false).
-- ============================================================================

CREATE TABLE IF NOT EXISTS glass_sku_attributes (
  eurocode TEXT PRIMARY KEY,
  attributes_json TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'glavista-index',
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_gsa_eurocode ON glass_sku_attributes(eurocode);
