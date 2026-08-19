-- ============================================================================
-- 0021_manual_review_overrides.sql — operatør-godkjente SKU-avgjørelser (Oppgave 4).
-- ----------------------------------------------------------------------------
-- Skrives ved manuell godkjenning i ops-center («godkjenn SKU») og leses
-- automatisk av matcher.ts ved neste like case → reduserer candidateCount til 1.
-- Append-only i praksis: nye rader for nye avgjørelser; gyldighet styres av
-- valid_from/valid_to. Alle skrivinger logges også i evidence_events
-- (hard regel 5: kilde, tidspunkt, godkjent_av).
-- ============================================================================

CREATE TABLE IF NOT EXISTS manual_review_overrides (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vin_prefix TEXT,                     -- VIN-prefiks (min. 4 tegn) eller NULL
  make TEXT NOT NULL,                  -- merke (UPPER)
  model_series TEXT,                   -- modellserie («TRANSPORTER T5») eller NULL
  valid_from TEXT,                     -- gyldighetsperiode (ISO-dato) eller NULL = alltid
  valid_to TEXT,                       -- gyldighetsperiode (ISO-dato) eller NULL = åpen
  attributes_json TEXT,                -- bekreftede attributter {hud:false,...}
  approved_sku TEXT NOT NULL,          -- godkjent SKU (varenr eller GLAVISTA:<nr>)
  eurocode TEXT,                       -- eurokode for approved_sku når kjent
  source TEXT NOT NULL DEFAULT 'manual_review',
  approved_by TEXT NOT NULL,
  approved_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  notes TEXT
);
CREATE INDEX IF NOT EXISTS idx_mro_match ON manual_review_overrides(make, model_series);
CREATE INDEX IF NOT EXISTS idx_mro_vin ON manual_review_overrides(vin_prefix);
