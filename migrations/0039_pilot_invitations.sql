-- Pilot-invitasjoner (P0): server-side adgangskontroll for begrenset pilot.
--
-- Hver invitasjon er en sikker, tilfeldig kode (43 tegn, URL-safe base64 av 32
-- tilfeldige byte) som genereres av /ops og verifiseres atomisk av Worker-en.
-- Koden — ikke regnr/kontakt — er adgangsnøkkelen, slik at den ikke kan gjettes
-- eller deles på en måte som gir uvedkommende adgang.
--
-- Én gang per invitasjon: status går unused → used atomisk ved første gyldige
-- innsending. Retry håndteres av Idempotency-Key (før invitasjonssjekken).

CREATE TABLE IF NOT EXISTS pilot_invitations (
  invite_code TEXT PRIMARY KEY,
  status      TEXT NOT NULL DEFAULT 'unused'
                CHECK (status IN ('unused','used','revoked')),
  created_at  INTEGER NOT NULL,
  used_at     INTEGER,
  revoked_at  INTEGER,
  created_by  TEXT,
  note        TEXT
);

CREATE INDEX IF NOT EXISTS idx_pilot_invitations_status
  ON pilot_invitations (status);
