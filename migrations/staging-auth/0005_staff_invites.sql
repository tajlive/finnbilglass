-- 0055_staff_invites.sql — FinnBilGlass staff invitations (P0)

-- P0: Administrasjonsinvitasjoner. Kjør først i staging etter 0054.
-- Ingen eksisterende tabeller endres; auth_users er autoritativ for roller.
CREATE TABLE IF NOT EXISTS staff_invites (
  email TEXT PRIMARY KEY,
  role TEXT NOT NULL CHECK (role IN ('ADMIN','REVIEWER','OPERATOR','CUSTOMER')),
  status TEXT NOT NULL CHECK (status IN ('PENDING','ACCEPTED','REJECTED','INVITED','EMAIL_FAILED')),
  invited_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  provider_message_id TEXT,
  last_error_code TEXT
);

CREATE INDEX IF NOT EXISTS idx_staff_invites_status ON staff_invites (status, updated_at);
CREATE INDEX IF NOT EXISTS idx_staff_invites_email ON staff_invites(email);
CREATE INDEX IF NOT EXISTS idx_staff_invites_role ON staff_invites(role);

-- Serialiserer Access policy read-modify-write for requests fra *this* Worker.
CREATE TABLE IF NOT EXISTS staff_invite_locks (
  lock_key TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
