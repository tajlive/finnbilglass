-- glass_typekode: Typekode fra varekort (auto-glass.no) for presis plassering
-- Fremre/bakre dør, foran/bakre ventil — eneste kilde for dorLedd/ventilLedd
-- Separert fra glass_prisliste for sporbarhet og flerkilde-import (varekort, Pilkington, Glavista)

CREATE TABLE IF NOT EXISTS glass_typekode (
    varenr      TEXT PRIMARY KEY REFERENCES glass_prisliste(varenr) ON DELETE CASCADE,
    typekode    TEXT NOT NULL,              -- f.eks. "Dørrute fremre førerside", "Ventilrute bakre høyre"
    kilde       TEXT NOT NULL DEFAULT 'VAREKORT',  -- VAREKORT | PILKINGTON | GLAVISTA | MANUELL
    hentet_dato TEXT NOT NULL DEFAULT (datetime('now')),  -- ISO8601
    oppdatert   TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(varenr, kilde)
);

-- Indeks for hurtig oppslag på typekode-innhold
CREATE INDEX IF NOT EXISTS idx_glass_typekode_typekode ON glass_typekode(typekode);

-- Visning for enkel joining med prisliste
CREATE VIEW IF NOT EXISTS v_glass_med_typekode AS
SELECT
    gp.id,
    gp.varenr,
    gp.varenavn,
    gp.kommentar,
    gp.pris,
    gp.eurokode,
    gp.alias_av,
    gp.rad_type,
    gp.created_at,
    gt.typekode,
    gt.kilde AS typekode_kilde,
    gt.hentet_dato AS typekode_hentet
FROM glass_prisliste gp
LEFT JOIN glass_typekode gt ON gp.varenr = gt.varenr
WHERE gp.rad_type = 'glass';