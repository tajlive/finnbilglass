-- 0042: marker testsaker slik at de holdes utenfor NEW-køen og påminnelser,
-- men beholdes i historikken (ingen sletting). Ekte kundehenvendelser røres ikke.
ALTER TABLE beta_inquiries ADD COLUMN is_test INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_beta_inquiries_reelle ON beta_inquiries(status, is_test, created_at);
