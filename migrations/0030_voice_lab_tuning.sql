ALTER TABLE voice_sessions ADD COLUMN scenario TEXT NOT NULL DEFAULT 'glasskade';
ALTER TABLE voice_sessions ADD COLUMN style TEXT NOT NULL DEFAULT 'varm';
ALTER TABLE voice_sessions ADD COLUMN prompt_version TEXT NOT NULL DEFAULT 'fbg-no-v2';
