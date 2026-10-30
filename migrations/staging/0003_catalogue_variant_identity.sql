-- Staging only. Run transactionally after backup and review.
PRAGMA defer_foreign_keys=ON;

CREATE TABLE glass_prisliste_v3 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  varenr TEXT NOT NULL,
  varenavn TEXT,
  kommentar TEXT,
  pris REAL,
  eurokode TEXT,
  alias_av TEXT,
  rad_type TEXT NOT NULL DEFAULT 'glass',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(varenr, varenavn, eurokode, rad_type)
);

CREATE TABLE glass_prisliste_migration_sequence_guard (
  seq INTEGER NOT NULL
);

INSERT INTO glass_prisliste_migration_sequence_guard(seq)
SELECT seq FROM sqlite_sequence WHERE name='glass_prisliste';

INSERT INTO glass_prisliste_v3
  (id, varenr, varenavn, kommentar, pris,
   eurokode, alias_av, rad_type, created_at)
SELECT id, varenr, varenavn, kommentar, pris,
       eurokode, alias_av, rad_type, created_at
FROM glass_prisliste;

DROP TABLE glass_prisliste;
ALTER TABLE glass_prisliste_v3 RENAME TO glass_prisliste;

INSERT INTO sqlite_sequence(name, seq)
SELECT 'glass_prisliste', seq
FROM glass_prisliste_migration_sequence_guard
WHERE NOT EXISTS (
  SELECT 1 FROM sqlite_sequence WHERE name='glass_prisliste'
);

UPDATE sqlite_sequence
SET seq = MAX(
  seq,
  (SELECT seq FROM glass_prisliste_migration_sequence_guard)
)
WHERE name='glass_prisliste'
AND EXISTS (
  SELECT 1 FROM glass_prisliste_migration_sequence_guard
);

DROP TABLE glass_prisliste_migration_sequence_guard;

CREATE INDEX idx_glass_prisliste_type_varenr
ON glass_prisliste(rad_type, varenr);

CREATE INDEX idx_glass_prisliste_type_eurokode
ON glass_prisliste(rad_type, eurokode);
