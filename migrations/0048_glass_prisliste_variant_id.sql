-- 0048: Produktvariant-identitet i glass_prisliste.
--
-- BAKGRUNN (målt 2026-11-04 mot PROSEKT API 16 MAI26.xls, 30 967 produktlinjer):
--   Tabellen hadde UNIQUE(varenr, varenavn). Ett varenr kan ha flere eurokoder
--   med SAMME varenavn, og da kollapset importen radene: 1 275 kildevarianter
--   med eurokode finnes ikke i basen, 363 av dem er frontruter (276 med pris).
--   Eksempel: varenr 8432AGAC har åtte varianter i kilden, men bare seks i basen
--   — «8432AGACHMV1E» (16 230 kr) og «8432AGACMV1L» (10 745 kr) forsvant.
--
-- LØSNING: variant_id = varenr + full eurokode (rader uten eurokode: varenr +
--   varenavn). Unik indeks på variant_id erstatter de to (varenr, varenavn)-
--   indeksene. Samme (varenr, eurokode) med ULIKT navn er en kildedata-konflikt:
--   radene beholdes begge, med deterministisk suffiks «#2», «#3» … slik at
--   konflikten er synlig i stedet for at data forsvinner.
--
-- TILBAKEFØRING:
--   1) Tabellen glass_prisliste_backup_0048 er en full kopi tatt FØR endringen.
--   2) Angre:  DROP TABLE glass_prisliste;
--              ALTER TABLE glass_prisliste_backup_0048 RENAME TO glass_prisliste;
--              (indeksene gjenopprettes med migrations/0002 + 0007 + 0032)
--   Backup-tabellen kan slettes når produksjonsverifiseringen er ferdig.

-- 1) Full kopi før inngrep (rollback-grunnlag).
CREATE TABLE IF NOT EXISTS glass_prisliste_backup_0048 AS SELECT * FROM glass_prisliste;

-- 2) Avhengige VIEW-er må bort før tabellen bygges på nytt. Uten dette feiler
--    migrasjonen med «no such table: main.glass_prisliste» (målt i staging
--    2026-11-04). View-en gjenopprettes uendret til slutt, nå med variant_id.
DROP VIEW IF EXISTS v_glass_med_typekode;

-- 3) Ny tabell: samme kolonner, uten UNIQUE(varenr, varenavn), med variant_id.
CREATE TABLE glass_prisliste_ny (
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

-- 4) Flytt alle rader og beregn variant_id.
--    Numeriske celleverdier ble importert som «41.0» / «3397110041.0»; de
--    normaliseres tilbake til heltall i NØKKELEN bare (ikke i kolonnene), slik
--    at en senere re-import fra XLS (som har «41») treffer samme variant.
INSERT INTO glass_prisliste_ny (id, varenr, varenavn, kommentar, pris, eurokode, alias_av, rad_type, created_at, variant_id)
SELECT id, varenr, varenavn, kommentar, pris, eurokode, alias_av, rad_type, created_at,
       CASE WHEN rn = 1 THEN base ELSE base || '#' || rn END
FROM (
  SELECT t.*, ROW_NUMBER() OVER (PARTITION BY base ORDER BY id) AS rn
  FROM (
    SELECT p.*,
      CASE
        WHEN eurokode IS NOT NULL AND TRIM(eurokode) <> '' THEN
          UPPER(CASE WHEN varenr LIKE '%.0' AND varenr NOT LIKE '%.%.0'
                     THEN SUBSTR(TRIM(varenr), 1, LENGTH(TRIM(varenr)) - 2)
                     ELSE TRIM(varenr) END) || ':' ||
          UPPER(CASE WHEN eurokode LIKE '%.0' AND eurokode NOT LIKE '%.%.0'
                     THEN SUBSTR(TRIM(eurokode), 1, LENGTH(TRIM(eurokode)) - 2)
                     ELSE TRIM(eurokode) END)
        ELSE UPPER(CASE WHEN varenr LIKE '%.0' AND varenr NOT LIKE '%.%.0'
                        THEN SUBSTR(TRIM(varenr), 1, LENGTH(TRIM(varenr)) - 2)
                        ELSE TRIM(varenr) END) || ':~' || UPPER(TRIM(COALESCE(varenavn, '')))
      END AS base
    FROM glass_prisliste p
  ) t
);

-- 5) Bytt tabell. Indeksene på den gamle tabellen forsvinner med den.
DROP TABLE glass_prisliste;
ALTER TABLE glass_prisliste_ny RENAME TO glass_prisliste;

-- 6) Identitet: én rad per produktvariant.
CREATE UNIQUE INDEX uq_glasspris_variant_id ON glass_prisliste(variant_id);

-- 7) Oppslagsindekser (samme sett som før, minus de to unike varenr/navn-indeksene
--    som var årsaken til varianttapet; (varenr, varenavn) beholdes som INDEKS).
CREATE INDEX idx_glasspris_varenr ON glass_prisliste(varenr);
CREATE INDEX idx_glasspris_eurokode ON glass_prisliste(eurokode);
CREATE INDEX idx_glasspris_rad_type ON glass_prisliste(rad_type);
CREATE INDEX idx_glasspris_alias ON glass_prisliste(alias_av) WHERE alias_av IS NOT NULL;
CREATE INDEX idx_glasspris_varenr_navn ON glass_prisliste(varenr, varenavn);
CREATE INDEX idx_glass_prisliste_type_varenr ON glass_prisliste (rad_type, varenr);
CREATE INDEX idx_glass_prisliste_type_eurokode ON glass_prisliste (rad_type, eurokode);
CREATE INDEX idx_glass_prisliste_variant_eurokode ON glass_prisliste (eurokode, variant_id);

-- 8) VIEW-en v_glass_med_typekode (fra 0020/0047) ble droppet i steg 2 fordi den
--    refererer tabellen. Den må gjenopprettes der glass_typekode finnes:
--    kjør migrations/0048b_view_typekode.sql etter denne filen i de miljøene.
--    (Produksjon har ikke glass_typekode — der finnes heller ingen view.)
