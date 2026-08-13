-- Finnbilglass: glass-katalog (Autoglass AS prisliste, PROSEKT API 16.05.2026)
-- Gjenbruk av Autoglass-katalogen for B2C-salg. Kilde: Eduard Eikeland.
-- rad_type: glass | tilbehor | frakt | emballasje | alias
-- alias_av: «BRUK/USE X»-peker → erstatnings-varenummer

CREATE TABLE IF NOT EXISTS autoglass_prisliste (
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

CREATE INDEX IF NOT EXISTS idx_ap_varenr ON autoglass_prisliste(varenr);
CREATE INDEX IF NOT EXISTS idx_ap_eurokode ON autoglass_prisliste(eurokode);
CREATE INDEX IF NOT EXISTS idx_ap_rad_type ON autoglass_prisliste(rad_type);
CREATE INDEX IF NOT EXISTS idx_ap_alias ON autoglass_prisliste(alias_av) WHERE alias_av IS NOT NULL;
