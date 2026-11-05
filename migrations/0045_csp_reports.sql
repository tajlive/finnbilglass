-- 0045: CSP-bruddrapporter (report-only-fase).
-- Lagrer KUN minimerte data: direktiv, vert for blokkert ressurs, sidesti uten
-- query-parametre, og antall. Aldri full URL, tokens eller persondata.
CREATE TABLE IF NOT EXISTS csp_reports (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  direktiv       TEXT NOT NULL,
  blokkert_vert  TEXT NOT NULL DEFAULT '',
  side_sti       TEXT NOT NULL DEFAULT '',
  antall         INTEGER NOT NULL DEFAULT 1,
  forst_sett    INTEGER NOT NULL,
  sist_sett     INTEGER NOT NULL,
  UNIQUE (direktiv, blokkert_vert, side_sti)
);
CREATE INDEX IF NOT EXISTS idx_csp_reports_sist ON csp_reports(sist_sett);
