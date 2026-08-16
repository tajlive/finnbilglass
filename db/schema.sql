-- Finnbilglass D1-schema (MVP v1) — finnbilglass-db
-- Drop-ship: kunde → finnbilglass.no → leverandør → kunde/verksted

-- Avtale-verksteder (fastprisavtale for skifte av bilglass)
CREATE TABLE IF NOT EXISTS montorer (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  navn TEXT NOT NULL,
  by TEXT NOT NULL,
  adresse TEXT,
  fastpris_skifte_eks_mva INTEGER NOT NULL DEFAULT 2000,  -- 2000 + mva, inkl. lim + garanti
  inkl_lim INTEGER NOT NULL DEFAULT 1,
  inkl_garanti INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'test',  -- test | aktiv | inaktiv
  opprettet TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Kundeforsendelse/ordre
CREATE TABLE IF NOT EXISTS ordre (
  id TEXT PRIMARY KEY,                 -- UUID
  kunde_navn TEXT,
  kunde_epost TEXT NOT NULL,
  kunde_telefon TEXT,
  bilnummer TEXT,                      -- kjennemerke
  bil_merke TEXT,
  bil_modell TEXT,
  bil_arsmodell TEXT,
  varenummer TEXT NOT NULL,            -- glass (varenummer)
  glass_pris_eks_mva INTEGER,
  tilbehor JSON,                       -- [{varenummer, navn, pris_eks_mva}]
  frakt_pris INTEGER,
  montering_pris INTEGER,              -- 2500 (2000+mva) når levering til verksted
  total_pris_inkl_mva INTEGER,
  leverings_modus TEXT NOT NULL,       -- 'kunde' | 'verksted'
  montor_id INTEGER REFERENCES montorer(id),
  leverings_adresse TEXT,
  betalings_status TEXT NOT NULL DEFAULT 'venter',  -- venter | betalt | refundert
  betalings_metode TEXT,               -- vipps | klarna | kort
  ordre_status TEXT NOT NULL DEFAULT 'mottatt',     -- mottatt | til_leverandor | sendt | levert | avbrutt
  leverandor_ref TEXT,                 -- intern leverandør-referanse
  sporingsnummer TEXT,
  skade_sjekk INTEGER NOT NULL DEFAULT 0,           -- 1 = glass sjekket ved levering (før signering)
  opprettet TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ordre_epost ON ordre(kunde_epost);
CREATE INDEX IF NOT EXISTS idx_ordre_status ON ordre(ordre_status);
CREATE INDEX IF NOT EXISTS idx_ordre_bilnummer ON ordre(bilnummer);
