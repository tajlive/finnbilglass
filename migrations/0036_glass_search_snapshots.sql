-- Short-lived internal context for a glass lookup. Never expose table reads publicly.
CREATE TABLE IF NOT EXISTS glass_search_snapshots (
  search_id TEXT PRIMARY KEY,
  regnr_norm TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  glass_request_json TEXT NOT NULL,
  vehicle_json TEXT NOT NULL,
  candidate_ids_json TEXT NOT NULL DEFAULT '[]',
  catalog_version TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_glass_search_expiry ON glass_search_snapshots(expires_at);

CREATE TABLE IF NOT EXISTS api_rate_limits (
  bucket_key TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_api_rate_limits_window ON api_rate_limits(window_start);
