-- 0039_auth_tables.sql — Autentisering, sesjoner, OTP, rate limiting, audit-logg
--
-- Opprettes KUN lokalt via `wrangler d1 migrations apply --local`.
-- Aldri kjørt mot staging eller produksjon (HOLD-regel, V3.8).
--
-- Tabellene erstatter D1Emulator i src/auth.ts når lokal D1 er tilkoblet.

-- Brukerregister: eksplisitt rolletildeling, ingen e-post-avledet ADMIN
CREATE TABLE IF NOT EXISTS auth_users (
  user_id    TEXT PRIMARY KEY,
  email      TEXT NOT NULL UNIQUE,
  role       TEXT NOT NULL CHECK (role IN ('ADMIN','REVIEWER','OPERATOR','CUSTOMER')),
  name       TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_auth_users_email ON auth_users(email);
CREATE INDEX IF NOT EXISTS idx_auth_users_role ON auth_users(role);

-- Sesjoner: HttpOnly-cookie-bakede, TTL-styrte, serverstyrt tilbakekalling
CREATE TABLE IF NOT EXISTS auth_sessions (
  session_id TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES auth_users(user_id) ON DELETE CASCADE,
  email      TEXT NOT NULL,
  role       TEXT NOT NULL,
  name       TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_activity INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires ON auth_sessions(expires_at);

-- OTP-koder: engangsbruk, tidsbegrenset, atomisk oppdatering
CREATE TABLE IF NOT EXISTS auth_otp_codes (
  email     TEXT NOT NULL,
  code      TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used      INTEGER NOT NULL DEFAULT 0 CHECK (used IN (0,1)),
  attempts  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (email)
);

CREATE INDEX IF NOT EXISTS idx_auth_otp_codes_expires ON auth_otp_codes(expires_at);

-- Rate limiting: per identitet (e-post/IP), ikke omgåsbar ved ny Worker-instans
CREATE TABLE IF NOT EXISTS auth_rate_limits (
  identity    TEXT PRIMARY KEY,
  count       INTEGER NOT NULL DEFAULT 0,
  window_start INTEGER NOT NULL
);

-- Audit-logg: rolleendringer, innlogginger, sikkerhetshendelser, saksendringer
-- Aldri logg OTP-koder eller sesjonshemmeligheter her
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id    TEXT,
  actor_email TEXT,
  action      TEXT NOT NULL,
  target      TEXT,
  details     TEXT,           -- JSON, aldri sensitive data
  ip          TEXT,
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_log_actor ON admin_audit_log(actor_id);
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_action ON admin_audit_log(action);
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_created ON admin_audit_log(created_at);
