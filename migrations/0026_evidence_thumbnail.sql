-- ============================================================================
-- 0026_evidence_thumbnail.sql — thumbnail for evidence_case_images (Oppgave 7).
-- ----------------------------------------------------------------------------
-- Gjenbruker main sin thumb_r2_key-mekanisme (fra opplaering_bilde) for
-- evidence_case_images: nedskalert JPEG-thumbnail lagres ved siden av
-- full-bildet i R2. Nullbar — eldre rader har ingen thumbnail. ALTER ADD
-- COLUMN krever ingen tabell-rebuild (D1).
-- ============================================================================

ALTER TABLE evidence_case_images ADD COLUMN thumb_r2_key TEXT;
