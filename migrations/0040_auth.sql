-- Autentisering og tilgangsstyring (P0, før pilot gjenåpnes).
--
-- Spor B (kunder): passordfri innlogging (magic link) + sikker økt + «Min side».
-- Spor A (ansatte): roller + revisjonslogg for Operations Center.
-- Invitasjon (0039) knyttes til kundeidentitet (e-post) på serversiden.

-- Kunder — identitet (kun e-post, ingen passord).
-- Invitasjonsbindingen ligger i pilot_invitations.used_by_email (0039), ikke her.
CREATE TABLE IF NOT EXISTS customers (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  email      TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);

-- Magic-link-tokens (passordfri innlogging). Rå token sendes på e-post;
-- kun SHA-256-hashen lagres. Én gangs bruk, 15 minutters utløp.
CREATE TABLE IF NOT EXISTS login_tokens (
  token_hash  TEXT PRIMARY KEY,
  email       TEXT NOT NULL,
  invite_code TEXT,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  used_at     INTEGER
);
CREATE INDEX IF NOT EXISTS idx_login_tokens_email ON login_tokens (email);

-- Økter. session_id = tilfeldig 32-byte token; cookie HttpOnly+Secure+SameSite.
CREATE TABLE IF NOT EXISTS sessions (
  session_id  TEXT PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_customer ON sessions (customer_id);

-- Ansattroller for Operations Center.
CREATE TABLE IF NOT EXISTS admin_roles (
  email      TEXT PRIMARY KEY,
  role       TEXT NOT NULL CHECK (role IN ('administrator','saksbehandler','lesetilgang')),
  created_at INTEGER NOT NULL
);

-- Revisjonslogg for sensitive operasjoner (append-only).
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_email TEXT NOT NULL,
  action     TEXT NOT NULL,
  target     TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON admin_audit_log (created_at);

-- Rate limit for innloggingsforsøk (brute-force/utsendelsesvern).
CREATE TABLE IF NOT EXISTS auth_rate_limits (
  ip           TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count        INTEGER NOT NULL
);
