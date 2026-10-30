-- ============================================================================
-- 0025_ai_observasjon_review.sql — operatør-gjennomgang av AI-observasjoner.
-- ----------------------------------------------------------------------------
-- Append-only: operatøren godkjenner (→ evidens) eller avviser en AI-observasjon
-- av et opplastet bilde (opplaering_bilde). Ingen UPDATE/DELETE — hver
-- gjennomgang er en ny rad med ansvarlig + tidspunkt. Godkjenning skriver
-- også en evidence_events-rad (status VERIFIED) i review-koden.
-- ============================================================================

CREATE TABLE IF NOT EXISTS ai_observasjon_review (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bilde_id INTEGER NOT NULL,            -- opplaering_bilde.id
  decision TEXT NOT NULL CHECK (decision IN ('godkjenn','avvis','request_image')),
  notat TEXT,
  actor TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_aor_bilde ON ai_observasjon_review(bilde_id);
CREATE INDEX IF NOT EXISTS idx_aor_created ON ai_observasjon_review(created_at);
