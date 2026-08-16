-- ============================================================================
-- 0004_canonical_glass_master.sql — Canonical glass master (KLA-301, FASE 1)
-- ----------------------------------------------------------------------------
-- Versjonert, ikke-destruktiv modell: alle endringer lager nye rader
-- (version+1, is_current=0 på gammel). Historikk beholdes alltid.
-- D1/SQLite-kompatibel. Ingen rader slettes av pipelinen — kun deaktiveres.
-- ============================================================================

-- Kilderegister: alle eksterne data MÅ ha provenance.
CREATE TABLE IF NOT EXISTS source_katalog (
  source_id TEXT PRIMARY KEY,                 -- f.eks. 'b2b-glass-catalog-2026-08'
  source TEXT NOT NULL,                       -- f.eks. 'pilkington-dump', 'tecdoc', 'buycarparts-research'
  source_url TEXT,
  source_version TEXT,
  fetched_at TEXT NOT NULL,
  source_updated_at TEXT,
  license_ref TEXT NOT NULL,                  -- f.eks. 'internal-autoglass', 'tecdoc-contract-X', 'none'
  raw_fingerprint TEXT NOT NULL,              -- SHA-256 av råfil
  confidence REAL NOT NULL DEFAULT 0.5,
  notes TEXT
);

-- Hovedenhet: ett glass (identitet, ikke features).
CREATE TABLE IF NOT EXISTS glass_master (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  canonical_key TEXT NOT NULL,                -- stabil nøkkel: 'EUR:'+normalisert eurocode
  eurocode TEXT,                              -- faktisk format 6-17 tegn; identitet, IKKE features
  category TEXT NOT NULL DEFAULT 'frontrute', -- frontrute/bakrute/siderute
  brand TEXT,                                 -- produsent/merke (Pilkington, AGC, ...)
  market TEXT NOT NULL DEFAULT 'NO',          -- NO/EØS/INT
  lhd_rhd TEXT NOT NULL DEFAULT 'LHD',        -- LHD/RHD/BEGGE
  supersession_of TEXT,                       -- erstatter (gammel kode)
  superseded_by TEXT,                         -- erstattes av (ny kode)
  status TEXT NOT NULL DEFAULT 'active',      -- active/superseded/obsolete
  version INTEGER NOT NULL DEFAULT 1,
  is_current INTEGER NOT NULL DEFAULT 1,
  source_id TEXT REFERENCES source_katalog(source_id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (canonical_key, version)
);
CREATE INDEX IF NOT EXISTS idx_glass_master_eurocode ON glass_master(eurocode) WHERE is_current=1;
CREATE INDEX IF NOT EXISTS idx_glass_master_key ON glass_master(canonical_key);

-- Identifikatorer (flere per glass, alle typer).
CREATE TABLE IF NOT EXISTS glass_identifiers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  glass_id INTEGER NOT NULL REFERENCES glass_master(id),
  id_type TEXT NOT NULL,                      -- EUROCODE/OEM/SUPPLIER/TRADE/GTIN_EAN/KTYPE/ARTICLE
  id_value TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0.8,
  is_current INTEGER NOT NULL DEFAULT 1,
  first_seen TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_seen TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (glass_id, id_type, id_value)
);
CREATE INDEX IF NOT EXISTS idx_glass_idents_value ON glass_identifiers(id_type, id_value) WHERE is_current=1;

-- Features: én rad per feature per versjon — aldri innbakt i identitet/eurocode.
CREATE TABLE IF NOT EXISTS glass_features (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  glass_id INTEGER NOT NULL REFERENCES glass_master(id),
  feature TEXT NOT NULL,                      -- rain_sensor/light_sensor/heated/hud/camera/adas/
                                              -- antenna/acoustic/solar_coated/mirror_bracket/
                                              -- vin_window/panoramic/sunstrip/ceramic_field
  value TEXT NOT NULL,                        -- 'true'/'false'/'unknown'
  confidence REAL NOT NULL DEFAULT 0.5,
  evidence_ref TEXT,                          -- → glass_evidence.id eller source_id
  version INTEGER NOT NULL DEFAULT 1,
  is_current INTEGER NOT NULL DEFAULT 1,
  source_id TEXT REFERENCES source_katalog(source_id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (glass_id, feature, version)
);
CREATE INDEX IF NOT EXISTS idx_glass_features_current ON glass_features(glass_id) WHERE is_current=1;

-- Kjøretøy-tilknytning: år, ktype, build codes, VIN-mønster, marked.
CREATE TABLE IF NOT EXISTS glass_vehicle_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  glass_id INTEGER NOT NULL REFERENCES glass_master(id),
  make TEXT NOT NULL,
  model TEXT,
  year_from INTEGER,
  year_to INTEGER,
  ktype TEXT,
  build_codes TEXT,                           -- kommaseparert, f.eks. '4G1,4G5'
  vin_pattern TEXT,                           -- VDS/WMI-mønster når kjent
  market TEXT NOT NULL DEFAULT 'NO',
  confidence REAL NOT NULL DEFAULT 0.5,
  is_current INTEGER NOT NULL DEFAULT 1,
  version INTEGER NOT NULL DEFAULT 1,
  source_id TEXT REFERENCES source_katalog(source_id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (glass_id, make, model, year_from, ktype, version)
);
CREATE INDEX IF NOT EXISTS idx_glass_vlinks_vehicle ON glass_vehicle_links(make, model) WHERE is_current=1;
CREATE INDEX IF NOT EXISTS idx_glass_vlinks_ktype ON glass_vehicle_links(ktype) WHERE is_current=1;

-- Media: kun godkjente kilder. Lisens + attribution obligatorisk for visning.
CREATE TABLE IF NOT EXISTS glass_media (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  glass_id INTEGER NOT NULL REFERENCES glass_master(id),
  media_role TEXT NOT NULL,                   -- full_glass/sensor_detail/marking/diagram/logo
  r2_path TEXT,                               -- R2-nøkkel (ingen hotlink i prod)
  mime TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  sha256 TEXT NOT NULL,
  phash TEXT,                                 -- perceptual hash for dedup
  license_ref TEXT NOT NULL,
  attribution TEXT,
  source_url TEXT,
  source_id TEXT REFERENCES source_katalog(source_id),
  version INTEGER NOT NULL DEFAULT 1,
  is_current INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (glass_id, media_role, sha256)
);
CREATE INDEX IF NOT EXISTS idx_glass_media_glass ON glass_media(glass_id) WHERE is_current=1;

-- Evidens: hvert signal med verdi, confidence, retning og forklaring.
CREATE TABLE IF NOT EXISTS glass_evidence (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  glass_id INTEGER,                           -- NULL = query-nivå-evidence
  evidence_type TEXT NOT NULL,                -- oem_build/vin_ktype/ocr_eurocode/ocr_oem/
                                              -- feature_data/image_feature/visual_similarity/
                                              -- manual_verification
  value TEXT NOT NULL,
  confidence REAL NOT NULL,
  direction TEXT NOT NULL,                    -- 'positive'/'negative'/'unknown'
  input_hash TEXT,                            -- SHA-256 av input (bilde/OCR-tekst)
  model_version TEXT,
  explanation TEXT,
  source_id TEXT REFERENCES source_katalog(source_id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_glass_evidence_glass ON glass_evidence(glass_id);

-- Resolusjons-audit: hver eneste avgjørelse, med alle signaler.
CREATE TABLE IF NOT EXISTS resolution_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  query_ref TEXT NOT NULL,                    -- sporbar nøkkel (logg/ordre/forespørsel)
  vin TEXT,
  regnr TEXT,
  make TEXT,
  model TEXT,
  year INTEGER,
  outcome TEXT NOT NULL,                      -- PINPOINT/VERIFY/FALLBACK/MANUAL_REVIEW
  chosen_glass_id INTEGER REFERENCES glass_master(id),
  candidate_glass_ids TEXT,                   -- JSON-array
  signals_json TEXT NOT NULL,                 -- full signal-liste (JSON)
  engine_version TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_resolution_audit_ref ON resolution_audit(query_ref);
CREATE INDEX IF NOT EXISTS idx_resolution_audit_outcome ON resolution_audit(outcome);
