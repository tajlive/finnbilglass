-- ============================================================================
-- ledger-backfill-15.sql — Handling B: rekonsilier d1_migrations
-- ----------------------------------------------------------------------------
-- KUN for produksjons-D1 etter eksplisitt Tom-godkjenning.
-- Kjøres via: wrangler d1 execute finnbilglass-db --remote --file=<denne filen>
--
-- INGEN BEGIN/COMMIT. Cloudflare D1 støtter ikke eksplisitt
-- transaksjonsstyring gjennom `wrangler d1 execute` — hele filen sendes som
-- én batch, som D1 selv gjør atomisk. Å skrive BEGIN ville feile.
--
-- Idempotent: INSERT OR IGNORE mot UNIQUE(name). Re-kjøring er en no-op.
--
-- De 15 migrasjonene er anvendt i produksjon (skjemaevidens i
-- migrations/_status.json) men mangler ledger-rad. De tre som IKKE skal med:
--   0019_oem_probe_queue   delvis anvendt (tabell finnes, 3 indekser mangler)
--   0020_oem_probe_queue_fix  BLOCKED_DESTRUCTIVE (sletter tabellen)
--   0034_glass_catalog_multi  PENDING (ikke anvendt)
--
-- Forventet etter kjøring: 18 → 33 rader, 0 duplikater.
-- ============================================================================

INSERT OR IGNORE INTO d1_migrations (name) VALUES
  ('0018_beta_inquiries_ops.sql'),
  ('0019_inquiry_rate_limit.sql'),
  ('0021_manual_review_overrides.sql'),
  ('0022_glass_marking_and_sku_decisions.sql'),
  ('0023_glass_sku_attributes.sql'),
  ('0024_opplaering_thumbnail.sql'),
  ('0025_ai_observasjon_review.sql'),
  ('0026_evidence_thumbnail.sql'),
  ('0027_quality_events_fk_fix.sql'),
  ('0028_inquiry_commercial.sql'),
  ('0029_voice_lab.sql'),
  ('0030_voice_lab_tuning.sql'),
  ('0031_glass_reference.sql'),
  ('0032_glass_prisliste_lookup_indexes.sql'),
  ('0033_inquiry_reply_history.sql');
