-- Idempotens for kundehenvendelser (P0 før pilot).
--
-- Problemet: en dobbeltklikk eller en nettverksretry på POST /api/inquiry
-- laget to saker i /ops. Rate limiting er abuse-vern, ikke dedupe.
--
-- Løsningen: klienten sender Idempotency-Key per innsending. Nøkkelen
-- reserveres med en PRIMARY KEY-innsetting FØR henvendelsen opprettes, slik
-- at to samtidige kall kolliderer atomisk i D1. Ingen transaksjon trengs.
--
-- Personvern: nøkkelen er en klient-generert UUID. request_hash er sha256 av
-- den kanoniske request-bodyen — rå navn/telefon/e-post lagres ALDRI her.

CREATE TABLE IF NOT EXISTS inquiry_idempotency (
  idem_key     TEXT PRIMARY KEY,
  request_hash TEXT NOT NULL,
  inquiry_id   INTEGER,
  state        TEXT NOT NULL DEFAULT 'PENDING'
                 CHECK (state IN ('PENDING','DONE')),
  created_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_inquiry_idempotency_created
  ON inquiry_idempotency (created_at);
