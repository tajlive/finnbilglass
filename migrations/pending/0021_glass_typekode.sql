-- glass_typekode: Typekode fra varekort (auto-glass.no) for presis plassering
-- Fremre/bakre dør, foran/bakre ventil — eneste kilde for dorLedd/ventilLedd
-- Separert fra glass_prisliste for sporbarhet og flerkilde-import (VAREKORT, PILKINGTON, GLAVISTA, MANUELL)
-- PLACERING: migrations/pending/ — IKKE i automatiske migrasjoner før godkjenning

CREATE TABLE IF NOT EXISTS glass_typekode (
    varenr          TEXT PRIMARY KEY REFERENCES glass_prisliste(varenr) ON DELETE CASCADE,
    typekode        TEXT NOT NULL,              -- original: 'DFF', 'DFB', 'DPF', 'DPB', 'DFFV', 'DFBV', 'DPFV', 'DPBV', 'SFB1', 'SPB1', 'SFB2', 'SPB2', 'SFB3', 'SPB3', 'F', 'B'
    typekode_desc   TEXT NOT NULL,              -- original: 'Dørrute fremre førerside', 'Ventil/siderute fremre førerside', etc.
    glassklasse     TEXT NOT NULL,              -- normalisert: 'frontrute' | 'bakrute' | 'dor' | 'side' | 'ventil' | 'ukjent'
    side            TEXT NOT NULL,              -- 'venstre' | 'hoyre' | 'begge' | null
    dor_ledd        TEXT,                       -- 'fremre' | 'bakre' | null (kun for dor)
    ventil_ledd     TEXT,                       -- 'foran' | 'bakre' | null (kun for ventil)
    kilde           TEXT NOT NULL DEFAULT 'VAREKORT',  -- VAREKORT | PILKINGTON | GLAVISTA | MANUELL
    kilde_url       TEXT,                       -- lenke til varekort
    hentet_dato     TEXT NOT NULL DEFAULT (datetime('now')),
    oppdatert       TEXT NOT NULL DEFAULT (datetime('now')),
    konflikt        TEXT,                       -- JSON: [{felt, kilde1_verdi, kilde2_verdi}] hvis navn/eurokode/typekode strider
    verifisert      INTEGER NOT NULL DEFAULT 0  -- 1 = manuelt verifisert (Tom), 0 = uverifisert
);

CREATE INDEX IF NOT EXISTS idx_glass_typekode_typekode ON glass_typekode(typekode);
CREATE INDEX IF NOT EXISTS idx_glass_typekode_glassklasse ON glass_typekode(glassklasse);
CREATE INDEX IF NOT EXISTS idx_glass_typekode_kilde ON glass_typekode(kilde);

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
    gt.typekode_desc,
    gt.glassklasse,
    gt.side,
    gt.dor_ledd,
    gt.ventil_ledd,
    gt.kilde AS typekode_kilde,
    gt.kilde_url,
    gt.hentet_dato AS typekode_hentet,
    gt.konflikt,
    gt.verifisert
FROM glass_prisliste gp
LEFT JOIN glass_typekode gt ON gp.varenr = gt.varenr
WHERE gp.rad_type = 'glass';