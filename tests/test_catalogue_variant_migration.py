import sqlite3
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SQL = (ROOT / "migrations/staging/0003_catalogue_variant_identity.sql").read_text()

SCHEMA = """
CREATE TABLE glass_prisliste (
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
CREATE INDEX idx_glass_prisliste_type_varenr
ON glass_prisliste(rad_type,varenr);
CREATE INDEX idx_glass_prisliste_type_eurokode
ON glass_prisliste(rad_type,eurokode);
"""

COLUMNS = "id,varenr,varenavn,kommentar,pris,eurokode,alias_av,rad_type,created_at"

def new_db():
    db = sqlite3.connect(":memory:")
    db.execute("PRAGMA foreign_keys=ON")
    db.executescript(SCHEMA)
    return db

def rows(db):
    return db.execute(
        f"SELECT {COLUMNS} FROM glass_prisliste ORDER BY id"
    ).fetchall()

def migrate(db):
    try:
        db.executescript("BEGIN;\n" + SQL + "\nCOMMIT;")
    except BaseException:
        if db.in_transaction:
            db.rollback()
        raise

class CatalogueMigrationTests(unittest.TestCase):
    def test_preserves_existing_rows(self):
        db = new_db()
        db.execute("""
          INSERT INTO glass_prisliste
          (id,varenr,varenavn,kommentar,pris,eurokode,rad_type)
          VALUES (1,'A','Frontrute','Test',1250.5,'E1','glass')
        """)
        db.commit()
        before = rows(db)
        migrate(db)
        self.assertEqual(before, rows(db))
        self.assertEqual(db.execute("PRAGMA integrity_check").fetchone()[0], "ok")
        self.assertEqual(db.execute("PRAGMA foreign_key_check").fetchall(), [])
        names = {r[1] for r in db.execute("PRAGMA index_list(glass_prisliste)")}
        self.assertIn("idx_glass_prisliste_type_varenr", names)
        self.assertIn("idx_glass_prisliste_type_eurokode", names)
        db.close()

    def test_variants_and_duplicates(self):
        db = new_db()
        migrate(db)
        for code in ("E1", "E2"):
            db.execute(
                "INSERT INTO glass_prisliste(varenr,varenavn,eurokode) VALUES ('A','Frontrute',?)",
                (code,)
            )
        with self.assertRaises(sqlite3.IntegrityError):
            db.execute(
                "INSERT INTO glass_prisliste(varenr,varenavn,eurokode) VALUES ('A','Frontrute','E1')"
            )
        db.close()

    def test_null_values(self):
        db = new_db()
        db.execute(
            "INSERT INTO glass_prisliste(varenr,varenavn) VALUES ('A',NULL)"
        )
        db.commit()
        migrate(db)
        db.execute(
            "INSERT INTO glass_prisliste(varenr,varenavn) VALUES ('A',NULL)"
        )
        self.assertEqual(len(rows(db)), 2)
        db.close()

    def test_autoincrement_after_deletion(self):
        db = new_db()
        db.execute(
            "INSERT INTO glass_prisliste(id,varenr) VALUES (999,'OLD')"
        )
        db.execute("DELETE FROM glass_prisliste WHERE id=999")
        db.commit()
        migrate(db)
        db.execute(
            "INSERT INTO glass_prisliste(varenr) VALUES ('NEW')"
        )
        self.assertGreater(rows(db)[0][0], 999)
        db.close()

    def test_rollback_and_large_catalogue(self):
        db = new_db()
        db.executemany(
            "INSERT INTO glass_prisliste(varenr,varenavn,pris) VALUES (?,?,?)",
            ((f"V{i}", f"Glass {i}", i/10) for i in range(29629))
        )
        db.commit()
        before = rows(db)
        migrate(db)
        self.assertEqual(before, rows(db))
        db.close()

        db = new_db()
        db.execute(
            "INSERT INTO glass_prisliste(varenr) VALUES ('SAFE')"
        )
        db.execute("CREATE TABLE glass_prisliste_v3(dummy INTEGER)")
        db.commit()
        before = rows(db)
        with self.assertRaises(sqlite3.OperationalError):
            migrate(db)
        self.assertEqual(before, rows(db))
        db.close()

if __name__ == "__main__":
    unittest.main()
