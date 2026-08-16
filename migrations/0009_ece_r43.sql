-- ============================================================================
-- 0009_ece_r43.sql — ECE R43-approval-mapping (43R → glass)
-- ----------------------------------------------------------------------------
-- Kilde for fysisk verifisering: kunden leser/fotograferer 43R-nummeret på
-- det gamle glasset → vi slår opp mot mappingen → PINPOINT-BEKREFTET.
-- Ett 43R-nummer kan dekke FLERE koder (glassfamilie) → rad per kode.
-- Mapping bygges fra: kunde-innslag (crowdsourcing), Glavista/Pilkington/
-- Saint-Gobain-kataloger, TÜV Certipedia/KBA.
-- ============================================================================

CREATE TABLE IF NOT EXISTS ece_r43 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  r43_nummer TEXT NOT NULL,          -- normalisert: siffer uten 43R-prefiks/landkode (f.eks. '004592')
  landkode TEXT,                     -- E1/E2/... hvis kjent (valgfri disambiguering)
  eurokode TEXT,                     -- kanonisk eurokode (varenr-felt i prislista)
  varenr TEXT,                       -- salgbart FinnBilGlass-varenr
  merke TEXT,
  modell TEXT,
  kilde TEXT NOT NULL DEFAULT 'customer',  -- customer/glavista/pilkington/saint-gobain/certipedia/manual
  bekreftet INTEGER NOT NULL DEFAULT 0,    -- 1 = verifisert mot fysisk glass (kunde-innslag)
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (r43_nummer, eurokode)
);
CREATE INDEX IF NOT EXISTS idx_ece_r43_nummer ON ece_r43(r43_nummer);
CREATE INDEX IF NOT EXISTS idx_ece_r43_eurokode ON ece_r43(eurokode);

-- Logg for verifiseringsforsøk (læring + anti-counterfeit).
CREATE TABLE IF NOT EXISTS r43_sok_logg (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  r43_nummer TEXT NOT NULL,
  treff INTEGER NOT NULL DEFAULT 0,          -- antall koder funnet
  kilde TEXT NOT NULL DEFAULT 'manual',      -- manual/photo
  query_ref TEXT,
  ip TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_r43_sok_nummer ON r43_sok_logg(r43_nummer);
CREATE INDEX IF NOT EXISTS idx_r43_sok_created ON r43_sok_logg(created_at);
