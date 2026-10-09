-- Phase 11: privacy-minimal first-party event view and UTM attribution.
CREATE TABLE IF NOT EXISTS kutumb_event_page_views (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES kutumb_organisations(id) ON DELETE RESTRICT,
  event_id INTEGER NOT NULL REFERENCES kutumb_upcoming_events(id) ON DELETE CASCADE,
  source TEXT,
  medium TEXT,
  campaign TEXT,
  viewed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_event_views_org_event_date ON kutumb_event_page_views(organisation_id,event_id,viewed_at DESC);
