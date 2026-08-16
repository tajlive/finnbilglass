-- Finnbilglass: glass-katalog (intern prisliste)
-- rad_type: glass | tilbehor | frakt | emballasje | alias
-- alias_av: «BRUK/USE X»-peker → erstatnings-varenummer

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

CREATE INDEX IF NOT EXISTS idx_glasspris_varenr ON glass_prisliste(varenr);
CREATE INDEX IF NOT EXISTS idx_glasspris_eurokode ON glass_prisliste(eurokode);
CREATE INDEX IF NOT EXISTS idx_glasspris_rad_type ON glass_prisliste(rad_type);
CREATE INDEX IF NOT EXISTS idx_glasspris_alias ON glass_prisliste(alias_av) WHERE alias_av IS NOT NULL;
