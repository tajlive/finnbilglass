-- Store only Stripe's invoice identity. Customer URLs are retrieved on demand
-- after ownership, paid status, amount, currency, metadata and mode are checked.
ALTER TABLE quote_payment_orders ADD COLUMN stripe_invoice_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_quote_payment_orders_stripe_invoice
  ON quote_payment_orders(stripe_invoice_id)
  WHERE stripe_invoice_id IS NOT NULL;
