-- 0009_assistant_sessions.sql
-- STAGING: sesjonspersistens for den konversasjonelle fitment-assistenten (conversation-v1).
-- Kun brukt av staging-worker (env ASSISTANT_ENABLED). Prod-D1 endres IKKE.
CREATE TABLE IF NOT EXISTS assistant_sessions (
  session_id    TEXT PRIMARY KEY,
  payload       TEXT NOT NULL,
  last_activity INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_assistant_sessions_activity ON assistant_sessions (last_activity);
