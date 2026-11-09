-- 0046: Pristilbud fra Operations Center.
-- Hvert tilbud lagres som egen versjon (append-only): ingen overskriving,
-- full sporbarhet på hvem som godkjente, hvilken pris og hva som ble sendt.
CREATE TABLE IF NOT EXISTS glass_quotes (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  inquiry_id      INTEGER NOT NULL,
  versjon         INTEGER NOT NULL,
  varenr          TEXT,
  eurokode        TEXT,
  oe_nummer       TEXT,
  beskrivelse     TEXT,
  pris_kr         INTEGER NOT NULL,
  pris_type       TEXT NOT NULL CHECK (pris_type IN ('VEILEDENDE','BEKREFTET')),
  leveringstid    TEXT,
  tillegg_json    TEXT,
  gyldig_til      TEXT,
  begrunnelse     TEXT,
  opprettet_av    TEXT NOT NULL,
  opprettet_at    INTEGER NOT NULL,
  sendt_at        INTEGER,
  sendt_av        TEXT,
  brevo_melding_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_glass_quotes_sak ON glass_quotes(inquiry_id, versjon);

-- Valgt glass på en sak (manuelt valg av saksbehandler, med begrunnelse).
CREATE TABLE IF NOT EXISTS case_glass_choice (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  inquiry_id   INTEGER NOT NULL,
  varenr       TEXT,
  eurokode     TEXT,
  oe_nummer    TEXT,
  utfall        TEXT NOT NULL,
  begrunnelse  TEXT NOT NULL,
  valgt_av     TEXT NOT NULL,
  valgt_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_case_glass_choice_sak ON case_glass_choice(inquiry_id, valgt_at);
