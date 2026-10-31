-- ============================================================================
-- handling-c-schema.sql — Handling C: de tre manglende 0019-indeksene + 0034
-- ----------------------------------------------------------------------------
-- KUN for isolert database eller produksjon etter separat Tom-godkjenning.
-- Idempotent: alle objekter er IF NOT EXISTS. Dobbeltkjøring er en no-op.
-- Ingen BEGIN/COMMIT — D1 støtter det ikke gjennom wrangler d1 execute.
--
-- Del 1: 0019_oem_probe_queue fikk aldri indeksene sine. Tabellen finnes i
--        produksjon, men de to indeksene som eksisterer ligger på _old-tabellen.
-- Del 2: 0034_glass_catalog_multi — to tabeller som ikke finnes i produksjon.
-- ============================================================================

-- ── Del 1: 0019-indeksene ──────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_oem_probe_portal   ON oem_probe_queue(portal);
CREATE INDEX IF NOT EXISTS idx_oem_probe_status   ON oem_probe_queue(status);
CREATE INDEX IF NOT EXISTS idx_oem_probe_vin_hash ON oem_probe_queue(vin_hash);

-- Additive normalized catalogue for verified non-windshield glass applications.
-- No rows are imported by this migration; license and fitment verification remain explicit gates.
CREATE TABLE IF NOT EXISTS glass_catalog_items (
  item_id TEXT PRIMARY KEY,
  supplier TEXT NOT NULL,
  supplier_item_key TEXT NOT NULL,
  part_number TEXT NOT NULL,
  manufacturer TEXT,
  glass_kind TEXT NOT NULL CHECK (glass_kind IN ('windshield','door','side','rear','roof')),
  position_json TEXT NOT NULL,
  attributes_json TEXT NOT NULL DEFAULT '{}',
  source_id TEXT NOT NULL,
  source_version TEXT NOT NULL,
  source_record_ref TEXT NOT NULL,
  license_ref TEXT NOT NULL,
  public_use_allowed INTEGER NOT NULL DEFAULT 0 CHECK (public_use_allowed IN (0,1)),
  classification TEXT NOT NULL DEFAULT 'proposed' CHECK (classification IN ('verified','proposed','unknown','rejected')),
  verified_by TEXT,
  verified_at TEXT,
  evidence_ref TEXT,
  is_current INTEGER NOT NULL DEFAULT 1 CHECK (is_current IN (0,1)),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (supplier, supplier_item_key)
);
CREATE INDEX IF NOT EXISTS idx_glass_catalog_search
  ON glass_catalog_items(glass_kind, classification, public_use_allowed, is_current, item_id);

CREATE TABLE IF NOT EXISTS glass_vehicle_applications (
  application_id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES glass_catalog_items(item_id),
  make_key TEXT NOT NULL,
  model_key TEXT NOT NULL,
  generation_key TEXT,
  year_from INTEGER,
  year_to INTEGER,
  body_variant TEXT,
  door_count INTEGER,
  market TEXT NOT NULL DEFAULT 'NO',
  source_id TEXT NOT NULL,
  source_version TEXT NOT NULL,
  source_record_ref TEXT NOT NULL,
  classification TEXT NOT NULL DEFAULT 'proposed' CHECK (classification IN ('verified','proposed','unknown','rejected')),
  verified_by TEXT,
  verified_at TEXT,
  evidence_ref TEXT,
  is_current INTEGER NOT NULL DEFAULT 1 CHECK (is_current IN (0,1)),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (year_from IS NULL OR year_to IS NULL OR year_from <= year_to)
);
CREATE INDEX IF NOT EXISTS idx_glass_application_vehicle
  ON glass_vehicle_applications(make_key, model_key, generation_key, year_from, year_to, classification, is_current);
CREATE INDEX IF NOT EXISTS idx_glass_application_item ON glass_vehicle_applications(item_id, classification);

-- Verified public catalogue rows must carry bounded, explicit fitment and provenance.
CREATE TRIGGER IF NOT EXISTS trg_glass_item_verified_guard_insert
BEFORE INSERT ON glass_catalog_items
WHEN NEW.classification = 'verified' AND (NEW.public_use_allowed != 1 OR NEW.license_ref = '' OR NEW.license_ref = 'internal-autoglass' OR NEW.verified_by IS NULL OR NEW.verified_at IS NULL OR NEW.evidence_ref IS NULL)
BEGIN SELECT RAISE(ABORT, 'verified glass item requires documented public rights and verification evidence'); END;
CREATE TRIGGER IF NOT EXISTS trg_glass_item_verified_guard_update
BEFORE UPDATE OF classification, public_use_allowed, license_ref, verified_by, verified_at, evidence_ref ON glass_catalog_items
WHEN NEW.classification = 'verified' AND (NEW.public_use_allowed != 1 OR NEW.license_ref = '' OR NEW.license_ref = 'internal-autoglass' OR NEW.verified_by IS NULL OR NEW.verified_at IS NULL OR NEW.evidence_ref IS NULL)
BEGIN SELECT RAISE(ABORT, 'verified glass item requires documented public rights and verification evidence'); END;
CREATE TRIGGER IF NOT EXISTS trg_glass_application_verified_guard_insert
BEFORE INSERT ON glass_vehicle_applications
WHEN NEW.classification = 'verified' AND (NEW.generation_key IS NULL OR NEW.year_from IS NULL OR NEW.year_to IS NULL OR NEW.body_variant IS NULL OR NEW.verified_by IS NULL OR NEW.verified_at IS NULL OR NEW.evidence_ref IS NULL)
BEGIN SELECT RAISE(ABORT, 'verified vehicle application requires generation, bounded years, body variant and evidence'); END;
CREATE TRIGGER IF NOT EXISTS trg_glass_application_verified_guard_update
BEFORE UPDATE OF classification, generation_key, year_from, year_to, body_variant, verified_by, verified_at, evidence_ref ON glass_vehicle_applications
WHEN NEW.classification = 'verified' AND (NEW.generation_key IS NULL OR NEW.year_from IS NULL OR NEW.year_to IS NULL OR NEW.body_variant IS NULL OR NEW.verified_by IS NULL OR NEW.verified_at IS NULL OR NEW.evidence_ref IS NULL)
BEGIN SELECT RAISE(ABORT, 'verified vehicle application requires generation, bounded years, body variant and evidence'); END;

-- ── Del 2 slutt ─────────────────────────────────────────────────────────
