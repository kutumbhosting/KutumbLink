-- Phase 7: optional event fundraising modules. Disabled by default.
ALTER TABLE kutumb_upcoming_events
  ADD COLUMN IF NOT EXISTS optional_modules JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS kutumb_sponsor_packages (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES kutumb_organisations(id) ON DELETE RESTRICT,
  event_id INTEGER NOT NULL REFERENCES kutumb_upcoming_events(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  amount NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  benefits JSONB NOT NULL DEFAULT '[]'::jsonb,
  capacity INTEGER CHECK (capacity IS NULL OR capacity >= 0),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS kutumb_event_sponsors (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES kutumb_organisations(id) ON DELETE RESTRICT,
  event_id INTEGER NOT NULL REFERENCES kutumb_upcoming_events(id) ON DELETE CASCADE,
  package_id BIGINT REFERENCES kutumb_sponsor_packages(id) ON DELETE SET NULL,
  sponsor_name TEXT NOT NULL,
  contact_email TEXT,
  amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  payment_status TEXT NOT NULL DEFAULT 'lead' CHECK (payment_status IN ('lead','invoiced','paid','cancelled')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS kutumb_auction_items (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES kutumb_organisations(id) ON DELETE RESTRICT,
  event_id INTEGER NOT NULL REFERENCES kutumb_upcoming_events(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  starting_bid NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (starting_bid >= 0),
  winning_amount NUMERIC(12,2),
  winning_bidder TEXT,
  payment_status TEXT NOT NULL DEFAULT 'not_applicable' CHECK (payment_status IN ('not_applicable','due','paid','refunded')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','open','closed','awarded','cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS kutumb_event_addons (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES kutumb_organisations(id) ON DELETE RESTRICT,
  event_id INTEGER NOT NULL REFERENCES kutumb_upcoming_events(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  quantity INTEGER CHECK (quantity IS NULL OR quantity >= 0),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','closed'))
);
CREATE INDEX IF NOT EXISTS idx_sponsor_packages_event ON kutumb_sponsor_packages(organisation_id,event_id,status);
CREATE INDEX IF NOT EXISTS idx_event_sponsors_event ON kutumb_event_sponsors(organisation_id,event_id,payment_status);
CREATE INDEX IF NOT EXISTS idx_auction_event ON kutumb_auction_items(organisation_id,event_id,status);
