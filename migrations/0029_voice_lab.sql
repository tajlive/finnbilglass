CREATE TABLE IF NOT EXISTS voice_sessions (
  session_id TEXT PRIMARY KEY,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  status TEXT NOT NULL DEFAULT 'STARTED',
  model TEXT NOT NULL,
  voice TEXT NOT NULL,
  duration_ms INTEGER,
  result TEXT,
  error_code TEXT
);

CREATE INDEX IF NOT EXISTS idx_voice_sessions_started_at ON voice_sessions(started_at DESC);

CREATE TABLE IF NOT EXISTS voice_drafts (
  session_id TEXT PRIMARY KEY,
  regnr TEXT,
  navn TEXT,
  kontakt TEXT,
  sted TEXT,
  skade TEXT,
  onsket_tid TEXT,
  confirmed INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(session_id) REFERENCES voice_sessions(session_id)
);
