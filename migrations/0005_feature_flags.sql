-- ============================================================================
-- 0005_feature_flags.sql — Kill switch-flag (KLA-301, G6)
-- ----------------------------------------------------------------------------
-- Deaktiverer funksjonalitet UTEN deploy: sett enabled=0 → systemet degraderer
-- trygt (PINPOINT→VERIFY, kilde hoppes over, modell deaktiveres).
-- ============================================================================

CREATE TABLE IF NOT EXISTS feature_flags (
  flag TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 1,
  note TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

INSERT OR IGNORE INTO feature_flags (flag, enabled, note) VALUES
  ('resolver_all', 1, 'Hovedbryter: hele resolverkjeden (L0-L3). 0 → alltid FALLBACK'),
  ('resolver_pinpoint', 1, 'PINPOINT-bryter: 0 → PINPOINT degraderes til VERIFY'),
  ('l1_ground_truth', 1, 'Kilde: L1 ground_truth'),
  ('l2_glass_catalog', 1, 'Kilde: L2 Pilkington glass_catalog'),
  ('l3_ktype', 1, 'Kilde: L3 ktype-register (tom inntil TecDoc-data)'),
  ('cv_model_placeholder', 0, 'CV-modell: 0 = ingen CV-signaler (standard inntil modell deployes)');
