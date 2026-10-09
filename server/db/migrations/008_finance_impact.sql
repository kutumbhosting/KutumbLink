-- Phases 10 and 12: keep donation vs event-sales accounting explicit and capture impact.
ALTER TABLE kutumb_donations
  ADD COLUMN IF NOT EXISTS transaction_classification TEXT NOT NULL DEFAULT 'donation'
    CHECK (transaction_classification IN ('donation','fundraising'));
CREATE TABLE IF NOT EXISTS kutumb_event_impact_notes (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES kutumb_organisations(id) ON DELETE RESTRICT,
  event_id INTEGER NOT NULL REFERENCES kutumb_upcoming_events(id) ON DELETE CASCADE,
  measure TEXT NOT NULL,
  value NUMERIC(14,2),
  unit TEXT,
  source TEXT NOT NULL DEFAULT 'organisation_reported',
  notes TEXT,
  recorded_by_admin_id INTEGER REFERENCES kutumb_admin_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_impact_event ON kutumb_event_impact_notes(organisation_id,event_id,created_at DESC);
