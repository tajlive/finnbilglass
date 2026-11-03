-- 0047: Typekode-register (glassplassering per varenummer).
-- Kilden er auto-glass.no-katalogen (products-autoglass-no.csv, felt type_code
-- + type_code_desc). Tabellen er additiv: ingen eksisterende tabell endres.
-- Idempotent: varenr er primærnøkkel, ny import oppdaterer samme rad.
CREATE TABLE IF NOT EXISTS glass_typekode (
  varenr              TEXT PRIMARY KEY,
  typekode            TEXT NOT NULL,
  typekode_beskrivelse TEXT,
  kilde               TEXT NOT NULL DEFAULT 'autoglass-no',
  kildefil            TEXT,
  hentet_at           INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_glass_typekode_kode ON glass_typekode(typekode);

-- Bekvemmelighetsview: prisliste + typekode + utledet plassering.
CREATE VIEW IF NOT EXISTS v_glass_med_typekode AS
SELECT p.varenr, p.varenavn, p.eurokode, p.pris, p.rad_type,
       t.typekode, t.typekode_beskrivelse, t.kilde AS typekode_kilde
  FROM glass_prisliste p
  LEFT JOIN glass_typekode t ON UPPER(t.varenr) = UPPER(p.varenr);
