-- ============================================================================
-- 0017_beta_inquiries.sql — Beta-henvendelser («Få tilbud og bekreftelse»).
-- ----------------------------------------------------------------------------
-- Kunden ber om tilbud/bekreftelse fra resultat-skjermen. Kun mottak + lagring.
-- Ingen prisberegning, ingen ordrebekreftelse, ingen automatisk beslutning.
-- Henvendelsen leses manuelt av support (D1 / /ops).
-- ============================================================================

CREATE TABLE IF NOT EXISTS beta_inquiries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  regnr TEXT,                       -- kjennemerke (forhåndsutfylt, låst i UI)
  navn TEXT NOT NULL,               -- kundens navn
  kontakt TEXT NOT NULL,            -- telefon eller e-post (validert server-side)
  melding TEXT,                     -- valgfri melding (maks 500 tegn)
  session_id TEXT,                  -- kundereise-id (localStorage)
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_beta_inquiries_created ON beta_inquiries(created_at);
