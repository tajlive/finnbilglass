-- Bind guest or signed-in inquiry ownership only to the authenticated user ID.
-- Staging schema inspection confirmed beta_inquiries lacks customer_id and
-- auth_users.user_id is TEXT. Existing rows remain unowned; never infer from email.
ALTER TABLE beta_inquiries ADD COLUMN customer_id TEXT;
CREATE INDEX IF NOT EXISTS idx_beta_inquiries_customer_created
  ON beta_inquiries(customer_id, created_at DESC);
