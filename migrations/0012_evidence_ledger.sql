-- 0012_evidence_ledger.sql
-- C8.1: Evidence Ledger — immutable append-only evidens- og fixture-lagring.
-- STAGING: kun staging-D1. Prod-D1 endres IKKE (ingen produksjonsendring).
-- Prinsipper: append-only (aldri UPDATE/DELETE på events), REJECTED beholdes (audit trail),
-- kun hash av kjennemerke/VIN (personvern), status-gate CAPTURED → VERIFIED (læring ≠ sannhet).

CREATE TABLE IF NOT EXISTS evidence_events (
  id                  TEXT PRIMARY KEY,
  vehicle_identity_hash TEXT NOT NULL,
  registration_hash   TEXT,
  created_at          INTEGER NOT NULL,
  source_type         TEXT NOT NULL CHECK (source_type IN ('CUSTOMER','OE_IMAGE','INSTALLATION','MONTOR','SYSTEM')),
  evidence_type       TEXT NOT NULL CHECK (evidence_type IN ('CAMERA','RAIN_SENSOR','OE','ACOUSTIC','HEATED','ANTENNA','COATED','TINT','SHADE_BAND','OTHER')),
  value               TEXT NOT NULL,
  confidence          INTEGER NOT NULL DEFAULT 100 CHECK (confidence BETWEEN 0 AND 100),
  status              TEXT NOT NULL DEFAULT 'CAPTURED' CHECK (status IN ('CAPTURED','CONFIRMED','VERIFIED','REJECTED')),
  created_by          TEXT NOT NULL CHECK (created_by IN ('customer','installer','ai','system')),
  session_id          TEXT,
  candidate_varenr    TEXT,
  supersedes          TEXT,
  notes               TEXT
);
CREATE INDEX IF NOT EXISTS idx_evidence_vehicle ON evidence_events (vehicle_identity_hash, created_at);
CREATE INDEX IF NOT EXISTS idx_evidence_type ON evidence_events (evidence_type, status);

CREATE TABLE IF NOT EXISTS installation_fixtures (
  fixture_id          TEXT PRIMARY KEY,
  vehicle_identity_hash TEXT NOT NULL,
  candidate_varenr    TEXT NOT NULL,
  eurokode            TEXT,
  outcome             TEXT NOT NULL CHECK (outcome IN ('INSTALLED_SUCCESSFULLY','WRONG_GLASS')),
  installer_id        TEXT,
  confirmed_at        INTEGER NOT NULL,
  status              TEXT NOT NULL DEFAULT 'CAPTURED' CHECK (status IN ('CAPTURED','VERIFIED','REJECTED')),
  source_order_id     TEXT,
  notes               TEXT
);
CREATE INDEX IF NOT EXISTS idx_fixtures_vehicle ON installation_fixtures (vehicle_identity_hash, outcome);
CREATE INDEX IF NOT EXISTS idx_fixtures_candidate ON installation_fixtures (candidate_varenr, status);
