#!/usr/bin/env python3
"""Prøver 0047 + 0049 + typekode-importen mot en isolert kopi av produksjons-D1.

Bygger /tmp/prod-kopi.db med produksjonens faktiske skjema for glass_prisliste
og alle produksjonsradene, kjører migrasjonene og importen, og måler
view-spørringen som ellers treffer D1-CPU-grensen.

Ingen produksjonsendring. Skriver resultatet til stdout.
"""
import csv
import json
import os
import sqlite3
import time

DB = '/tmp/prod-kopi.db'
PROD = json.load(open('/tmp/prod-rader.json'))[0]['results']
IMPORT = '/tmp/typekode-import.csv'

DDL = '''CREATE TABLE "glass_prisliste" (
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
);'''

if os.path.exists(DB):
    os.remove(DB)

con = sqlite3.connect(DB)
con.execute(DDL)
con.executemany(
    'INSERT INTO glass_prisliste (varenr, varenavn, kommentar, pris, eurokode, alias_av, rad_type, variant_id)'
    ' VALUES (?,?,?,?,?,?,?,?)',
    [(r['varenr'], r.get('varenavn'), r.get('kommentar'), r.get('pris'), r.get('eurokode'),
      r.get('alias_av'), r.get('rad_type') or 'glass', r.get('variant_id')) for r in PROD])
con.commit()
n_pris = con.execute('SELECT COUNT(*) FROM glass_prisliste').fetchone()[0]
print(f'isolert kopi: {n_pris} produksjonsrader')

# ── 0047 ────────────────────────────────────────────────────────────────────
con.executescript('''
CREATE TABLE IF NOT EXISTS glass_typekode (
  varenr              TEXT PRIMARY KEY,
  typekode            TEXT NOT NULL,
  typekode_beskrivelse TEXT,
  kilde               TEXT NOT NULL DEFAULT 'autoglass-no',
  kildefil            TEXT,
  hentet_at           INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_glass_typekode_kode ON glass_typekode(typekode);
CREATE VIEW IF NOT EXISTS v_glass_med_typekode AS
SELECT p.varenr, p.varenavn, p.eurokode, p.pris, p.rad_type,
       t.typekode, t.typekode_beskrivelse, t.kilde AS typekode_kilde
  FROM glass_prisliste p
  LEFT JOIN glass_typekode t ON UPPER(t.varenr) = UPPER(p.varenr);
''')
print('0047 kjørt: tabell + view opprettet')

# ── import ──────────────────────────────────────────────────────────────────
rader = list(csv.DictReader(open(IMPORT)))
naa = int(time.time())
con.executemany(
    'INSERT INTO glass_typekode (varenr, typekode, typekode_beskrivelse, kilde, kildefil, hentet_at)'
    ' VALUES (?,?,?,?,?,?) ON CONFLICT(varenr) DO NOTHING',
    [(r['varenr'], r['typekode'], r['typekode_beskrivelse'], 'autoglass-no',
      'typekode-avstemming-20261104', naa) for r in rader])
con.commit()
n_tk = con.execute('SELECT COUNT(*) FROM glass_typekode').fetchone()[0]
print(f'import: {len(rader)} rader sendt inn, {n_tk} i tabellen')

# ── view-spørring FØR 0049 (skal være treg) ─────────────────────────────────
def tid(sql):
    t0 = time.time()
    try:
        n = con.execute(sql).fetchone()[0]
        return time.time() - t0, n
    except Exception as e:
        return time.time() - t0, f'FEIL: {e}'

# ── 0049 ────────────────────────────────────────────────────────────────────
con.executescript('''
CREATE INDEX IF NOT EXISTS idx_glass_typekode_varenr_upper
  ON glass_typekode(UPPER(varenr));
''')
con.commit()
print('0049 kjørt: uttrykksindeks opprettet')

etter, n_etter = tid('SELECT COUNT(*) FROM v_glass_med_typekode')
print(f'view etter 0049:  {etter:.2f}s  ({n_etter} rader)')

koblet = con.execute(
    'SELECT COUNT(*) FROM v_glass_med_typekode WHERE typekode IS NOT NULL').fetchone()[0]
print(f'rader med typekode: {koblet} av {n_etter} ({100*koblet/n_etter:.1f} %)')

print('\nplassering per typekode i view-et:')
for kode, n in con.execute(
        'SELECT typekode, COUNT(*) FROM v_glass_med_typekode '
        'WHERE typekode IS NOT NULL GROUP BY typekode ORDER BY 2 DESC'):
    print(f'   {kode:6} {n}')

con.close()
print(f'\nisolert kopi ligger i {DB} (ingen produksjonsendring)')
