-- Staging-only catalogue repair.
--
-- The importer historically populated autoglass_prisliste while the public
-- Worker reads glass_prisliste. Keep the production table contract intact and
-- make a local staging copy from the already imported catalogue. This file is
-- deliberately stored outside the production migrations directory.

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

CREATE INDEX IF NOT EXISTS idx_glass_prisliste_type_varenr
  ON glass_prisliste (rad_type, varenr);
CREATE INDEX IF NOT EXISTS idx_glass_prisliste_type_eurokode
  ON glass_prisliste (rad_type, eurokode);

INSERT OR IGNORE INTO glass_prisliste
  (varenr, varenavn, kommentar, pris, eurokode, alias_av, rad_type, created_at)
SELECT
  varenr, varenavn, kommentar, pris, eurokode, alias_av, rad_type, created_at
FROM autoglass_prisliste;
