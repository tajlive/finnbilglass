-- Arch aXN: commercial outcomes attach to existing inquiries, never fitment.
-- Append-only snapshots; unique version prevents lost updates from concurrent tabs.
CREATE TABLE IF NOT EXISTS inquiry_commercial_events (
  event_id TEXT PRIMARY KEY,
  inquiry_id INTEGER NOT NULL REFERENCES beta_inquiries(id),
  version INTEGER NOT NULL CHECK(version > 0),
  stage TEXT NOT NULL CHECK(stage IN ('OPEN','BOOKED','FULFILLED','PAID','LOST')),
  delivery TEXT NOT NULL CHECK(delivery IN ('UNKNOWN','GLASS_ONLY','PARTNER_INSTALL')),
  source TEXT NOT NULL CHECK(source IN ('WEB','PHONE','MANUAL','DEMO')),
  follow_up TEXT NOT NULL DEFAULT '',
  paid_on TEXT NOT NULL DEFAULT '',
  revenue_ore INTEGER NOT NULL CHECK(revenue_ore >= 0),
  direct_cost_ore INTEGER NOT NULL CHECK(direct_cost_ore >= 0),
  incremental INTEGER NOT NULL CHECK(incremental IN (0,1)),
  attribution TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL,
  actor TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(inquiry_id, version)
);
CREATE INDEX IF NOT EXISTS idx_commercial_inquiry ON inquiry_commercial_events(inquiry_id, version DESC);
