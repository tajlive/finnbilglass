-- Koble henvendelser til kundeidentitet (for «Min side» + server-side autorisasjon).
-- Nullbar: anonyme/legacy henvendelser (før innlogging fantes) har NULL.
ALTER TABLE beta_inquiries ADD COLUMN customer_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_beta_inquiries_customer ON beta_inquiries (customer_id);
