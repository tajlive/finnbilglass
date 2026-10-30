-- ============================================================================
-- 0024_opplaering_thumbnail.sql — thumbnail av opplastede bilder (Oppgave 7).
-- ----------------------------------------------------------------------------
-- thumb_r2_key peker på en nedskalert JPEG-thumbnail (320px) i samme R2-bucket,
-- generert klientside og lagret ved siden av full-bildet. Gir raskere lasting
-- i /ops/sku uten å hente fulloppløsningsbildet. Nullbar — eldre rader har
-- ingen thumbnail. ALTER TABLE ADD COLUMN krever ingen tabell-rebuild (D1).
-- ============================================================================

ALTER TABLE opplaering_bilde ADD COLUMN thumb_r2_key TEXT;
