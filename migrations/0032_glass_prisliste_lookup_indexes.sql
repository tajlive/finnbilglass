-- Avoid full scans for resolver lookups. Without both indexes, SQLite cannot
-- efficiently execute the rad_type='glass' AND (varenr=? OR eurokode=?) query
-- and may scan all ~30k catalogue rows for each candidate.
CREATE INDEX IF NOT EXISTS idx_glass_prisliste_type_varenr
  ON glass_prisliste (rad_type, varenr);

CREATE INDEX IF NOT EXISTS idx_glass_prisliste_type_eurokode
  ON glass_prisliste (rad_type, eurokode);

-- Refresh planner statistics so existing OR queries use both selective indexes
-- instead of scanning all rows matching rad_type. Verified on remote D1.
ANALYZE glass_prisliste;
