-- Staging-only catalogue repair.
--
-- The staging catalog database already has glass_prisliste, while the legacy
-- autoglass_prisliste source table is absent. Keep this migration idempotent
-- and scoped to staging; do not copy from a table that is not present.

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
  variant_id TEXT
);
