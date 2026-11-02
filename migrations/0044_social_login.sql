-- 0044: Felles sosial innlogging (Google / Microsoft / Facebook).
-- Én kundekonto per person; hver leverandør lagrer sin egen stabile subject.
ALTER TABLE auth_users ADD COLUMN microsoft_sub TEXT;
ALTER TABLE auth_users ADD COLUMN facebook_sub TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_auth_users_microsoft_sub ON auth_users(microsoft_sub) WHERE microsoft_sub IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_auth_users_facebook_sub  ON auth_users(facebook_sub)  WHERE facebook_sub  IS NOT NULL;

-- Kortlivede OAuth-tilstander: state, PKCE-verifier og nonce. Slettes etter bruk.
CREATE TABLE IF NOT EXISTS oauth_states (
  state         TEXT PRIMARY KEY,
  provider      TEXT NOT NULL,
  code_verifier TEXT NOT NULL,
  nonce         TEXT,
  opprettet     INTEGER NOT NULL,
  utloper       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_oauth_states_utloper ON oauth_states(utloper);

-- Venter på bekreftelse før sosial identitet kobles til en eksisterende konto.
-- Aldri automatisk kobling på lik e-post: kunden må bekrefte med engangskode.
CREATE TABLE IF NOT EXISTS oauth_pending_links (
  token     TEXT PRIMARY KEY,
  provider  TEXT NOT NULL,
  subject   TEXT NOT NULL,
  epost     TEXT,
  navn      TEXT,
  opprettet INTEGER NOT NULL,
  utloper   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_oauth_pending_links_utloper ON oauth_pending_links(utloper);
