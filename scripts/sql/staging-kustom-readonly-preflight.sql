-- FINNBILGLASS: READ-ONLY STAGING SCHEMA PREFLIGHT
-- Run only against the verified STAGING D1 binding with `--remote`.
-- No ALTER, INSERT, UPDATE, DELETE, DROP, migrations or financial actions.
SELECT name, type FROM sqlite_master
WHERE type IN ('table','view')
  AND name IN (
    'beta_inquiries','beta_inquiry_events','glass_quotes',
    'quote_payment_orders','kustom_payment_events',
    'kustom_money_operations','kustom_reconcile_attempts',
    'auth_users','auth_sessions','staff_invites','d1_migrations'
  )
ORDER BY type, name;

SELECT name, tbl_name, sql FROM sqlite_master
WHERE type='index' AND name IN (
  'uq_quote_payment_kustom_order','uq_quote_payment_kustom_hpp',
  'idx_kustom_events_order','idx_kustom_reconcile_attempts_checked',
  'idx_kustom_money_operations_state'
)
ORDER BY name;

PRAGMA table_info('quote_payment_orders');
PRAGMA table_info('kustom_payment_events');
PRAGMA table_info('kustom_money_operations');
PRAGMA table_info('kustom_reconcile_attempts');
PRAGMA table_info('auth_users');
PRAGMA table_info('auth_sessions');
