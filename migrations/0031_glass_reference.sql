-- Optional reference enrichment used by vin-resolver; no fitment claims seeded.
CREATE TABLE IF NOT EXISTS glass_reference (
  eurocode TEXT PRIMARY KEY NOT NULL,
  features_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(features_json))
);
