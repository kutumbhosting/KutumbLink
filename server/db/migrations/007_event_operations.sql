-- Phase 9: event-day operations. Existing check-in code/session system is reused.
CREATE TABLE IF NOT EXISTS kutumb_volunteer_applications (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES kutumb_organisations(id) ON DELETE RESTRICT,
  event_id INTEGER NOT NULL REFERENCES kutumb_upcoming_events(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  skills TEXT[] NOT NULL DEFAULT '{}',
  availability TEXT,
  accessibility_notes TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','declined','withdrawn')),
  assigned_shift TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS kutumb_event_checklist (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES kutumb_organisations(id) ON DELETE RESTRICT,
  event_id INTEGER NOT NULL REFERENCES kutumb_upcoming_events(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  is_done BOOLEAN NOT NULL DEFAULT FALSE,
  due_at TIMESTAMPTZ,
  assigned_to TEXT,
  notes TEXT,
  updated_by_admin_id INTEGER REFERENCES kutumb_admin_users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_volunteer_application_event ON kutumb_volunteer_applications(organisation_id,event_id,status);
CREATE INDEX IF NOT EXISTS idx_event_checklist_event ON kutumb_event_checklist(organisation_id,event_id,is_done);
