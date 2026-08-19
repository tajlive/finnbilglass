-- 0019_inquiry_rate_limit.sql
-- G12: abuse-beskyttelse på POST /api/inquiry (beta er live i prod, mottar PII).
-- Enkel D1-basert rate-limiter: maks N henvendelser per IP per vindu (10 min).

CREATE TABLE IF NOT EXISTS inquiry_rate_limits (
  ip TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 0
);
