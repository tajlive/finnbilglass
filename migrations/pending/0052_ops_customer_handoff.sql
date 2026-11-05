-- Case-scoped customer details for CRM and future invoice handoff. No invoice issuance.
CREATE TABLE IF NOT EXISTS ops_case_customer (
 inquiry_id INTEGER PRIMARY KEY REFERENCES beta_inquiries(id),
 version INTEGER NOT NULL DEFAULT 0, details_json TEXT NOT NULL,
 updated_at INTEGER NOT NULL, updated_by TEXT NOT NULL
);
