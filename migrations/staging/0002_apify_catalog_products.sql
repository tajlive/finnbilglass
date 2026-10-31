-- Apify Catalog Products table for staging
-- Stores scraped Glavista products from Apify Actor for staging validation.
--
-- PRICE POLICY (Tom: "Alltid fakta"):
--   Glavista publishes a SUGGESTED RETAIL PRICE in EUR. That is not a Norwegian
--   selling price. We therefore store what the source actually says:
--     pris        -> NOK only, NULL when no verified NOK price exists
--     pris_eur    -> amount exactly as published by Glavista
--     pris_valuta -> currency of the source figure ('EUR' | 'NOK')
--     pris_kilde  -> provenance, e.g. 'glavista_suggested_retail'
--   Never put a EUR figure into `pris` and never convert without a dated FX rate.
--
-- IDENTITY: a catalog row is not tied to a vehicle. `vin_hash` is empty ('') for
--   catalog products — a fabricated VIN hash would be a lie. eurocode is the key.

CREATE TABLE IF NOT EXISTS apify_catalog_products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    probe_id TEXT NOT NULL,
    vin_hash TEXT NOT NULL DEFAULT '',
    eurocode TEXT NOT NULL,
    ktype TEXT NOT NULL,
    varenr TEXT NOT NULL,
    varenavn TEXT,
    eurokode TEXT,
    pris REAL,                    -- NOK only; NULL = unknown
    pris_eur REAL,                -- source EUR figure
    pris_valuta TEXT,             -- 'EUR' | 'NOK' | NULL
    pris_kilde TEXT,              -- provenance of the price
    brand_title TEXT,
    category TEXT,
    url TEXT,
    alias_av TEXT,
    glavista_nr TEXT,
    oe_numbers TEXT,              -- JSON array of OE numbers
    features TEXT,                -- JSON object
    properties TEXT,              -- JSON object
    cert TEXT,                    -- JSON array
    koder TEXT,                   -- JSON array
    tilbehor TEXT,                -- JSON array
    source TEXT NOT NULL DEFAULT 'apify-glavista',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(probe_id, vin_hash, eurocode, ktype)
);

CREATE INDEX IF NOT EXISTS idx_apify_catalog_eurocode ON apify_catalog_products(eurocode);
CREATE INDEX IF NOT EXISTS idx_apify_catalog_probe ON apify_catalog_products(probe_id);
CREATE INDEX IF NOT EXISTS idx_apify_catalog_brand ON apify_catalog_products(brand_title);
