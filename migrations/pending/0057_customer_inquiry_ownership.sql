-- Customer portal ownership. Guest inquiries remain unowned until the customer
-- authenticates; never infer ownership from the user-entered contact field.
ALTER TABLE beta_inquiries ADD COLUMN customer_id TEXT;
CREATE INDEX IF NOT EXISTS idx_beta_inquiries_customer_created
  ON beta_inquiries(customer_id, created_at DESC);
