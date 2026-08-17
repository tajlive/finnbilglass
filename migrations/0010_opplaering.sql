-- ============================================================================
-- 0010_opplaering.sql — Opplæringsdata: ALLE valg, inntasting og bilder.
-- ----------------------------------------------------------------------------
-- Formål (Tom 2026-08-17): lagre hver eneste interaksjon på finnbilglass.no
-- for opplæring av matcher/resolver/vision-modellene. Kundenes faktiske valg
-- er fasit-signaler — spesielt utstyrs-svar (regnsensor/antenne/coated) som
-- løser 75 % av VERIFY-usikkerheten, og bildene som avslører innlesingsfeil.
--
-- Kobling: session_id (fra frontend, localStorage) binder hele kundereisen:
-- søk → bekreft → utstyrs-svar → tilbehør → 43R-verifisering. Bilder lagres
-- i R2 (finnbilglass-opplaering); D1 holder kun metadata + AI-lesing + fasit.
-- ============================================================================

-- Hver brukerhendelse: inntasting, valg, bekreftelser, svar.
CREATE TABLE IF NOT EXISTS opplaering_hendelse (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT,                       -- kundereise-id (localStorage, uuid)
  hendelse TEXT NOT NULL,                -- sok_regnr / sok_vin / foto_skilt / bekreft_ja / bekreft_nei /
                                         -- spm_svar / tilbehor_valg / verify_apne / verify_foto /
                                         -- verify_manuell / verify_bekreft / verify_feil / nytt_sok
  data TEXT,                             -- JSON: inntasting/valg (f.eks. {"key":"sensor","verdi":true})
  bil_kontekst TEXT,                     -- JSON: {regnr, vin, merke, modell, aar, import}
  resolver_utfall TEXT,                  -- PINPOINT / VERIFY / FALLBACK / null
  ip TEXT,
  ua TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_opplaering_session ON opplaering_hendelse(session_id);
CREATE INDEX IF NOT EXISTS idx_opplaering_hendelse ON opplaering_hendelse(hendelse);
CREATE INDEX IF NOT EXISTS idx_opplaering_created ON opplaering_hendelse(created_at);

-- Bildene kunden laster opp (skilt-foto + 43R-foto) — selve bildet i R2,
-- metadata her: hva AI-en leste, med hvilken tillit, og utfallet.
CREATE TABLE IF NOT EXISTS opplaering_bilde (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT,
  type TEXT NOT NULL,                    -- skilt / verify43r
  r2_key TEXT NOT NULL,                  -- skilt/<session>/<ts>.jpg
  mime TEXT,
  lesing TEXT,                           -- JSON: {regnr|r43, confidence, raatekst}
  fasit TEXT,                            -- JSON: hva kunden til slutt bekreftet (hvis kjent)
  utfall TEXT,                           -- ok / ikke_funnet / feil
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_opplaering_bilde_session ON opplaering_bilde(session_id);
CREATE INDEX IF NOT EXISTS idx_opplaering_bilde_type ON opplaering_bilde(type);
CREATE INDEX IF NOT EXISTS idx_opplaering_bilde_created ON opplaering_bilde(created_at);
