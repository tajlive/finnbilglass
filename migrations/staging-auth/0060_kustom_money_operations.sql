-- PREPARATION ONLY. NOT AUTOMATICALLY APPLIED.
-- Full capture/refund only. Partial operations need separate design.
CREATE TABLE IF NOT EXISTS kustom_money_operations (
  operation_id TEXT PRIMARY KEY,
  payment_order_id TEXT NOT NULL
    REFERENCES quote_payment_orders(id),
  kustom_order_id TEXT NOT NULL,
  operation_type TEXT NOT NULL
    CHECK (operation_type IN ('capture','refund')),
  amount_minor INTEGER NOT NULL
    CHECK (amount_minor > 0),
  state TEXT NOT NULL DEFAULT 'RESERVED'
    CHECK (state IN (
      'RESERVED','SUBMITTED','UNKNOWN','RECONCILED','FAILED'
    )),
  reserved_at INTEGER NOT NULL,
  submitted_at INTEGER,
  reconciled_at INTEGER,
  provider_operation_id TEXT,
  error_code TEXT,
  UNIQUE(payment_order_id, operation_type)
);

CREATE INDEX IF NOT EXISTS idx_kustom_money_operations_state
  ON kustom_money_operations(state, reserved_at);
