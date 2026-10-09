-- Phase 6: connect existing AUD donations to charities, events and campaigns.
-- Existing payment providers and donation rows are retained.
ALTER TABLE kutumb_organisation_campaigns
  ADD COLUMN IF NOT EXISTS slug TEXT,
  ADD COLUMN IF NOT EXISTS story TEXT,
  ADD COLUMN IF NOT EXISTS image_url TEXT,
  ADD COLUMN IF NOT EXISTS internal_giving_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS starts_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ends_at TIMESTAMPTZ;
UPDATE kutumb_organisation_campaigns SET slug = 'campaign-' || id WHERE slug IS NULL OR slug='';
CREATE UNIQUE INDEX IF NOT EXISTS uq_kutumb_campaign_slug ON kutumb_organisation_campaigns(slug);

CREATE TABLE IF NOT EXISTS kutumb_fundraising_teams (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES kutumb_organisations(id) ON DELETE RESTRICT,
  campaign_id BIGINT NOT NULL REFERENCES kutumb_organisation_campaigns(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  goal_amount NUMERIC(12,2),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','closed')),
  created_by_admin_id INTEGER REFERENCES kutumb_admin_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS kutumb_fundraising_pages (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES kutumb_organisations(id) ON DELETE RESTRICT,
  campaign_id BIGINT REFERENCES kutumb_organisation_campaigns(id) ON DELETE RESTRICT,
  event_id TEXT,
  supporter_id BIGINT REFERENCES kutumb_supporters(id) ON DELETE RESTRICT,
  team_id BIGINT REFERENCES kutumb_fundraising_teams(id) ON DELETE SET NULL,
  display_name TEXT NOT NULL,
  contact_email TEXT,
  title TEXT NOT NULL,
  story TEXT,
  slug TEXT NOT NULL UNIQUE,
  goal_amount NUMERIC(12,2),
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft','published','closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_kutumb_fundraiser_org ON kutumb_fundraising_pages(organisation_id,status,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_kutumb_fundraiser_campaign ON kutumb_fundraising_pages(campaign_id,status);

ALTER TABLE kutumb_donations
  ADD COLUMN IF NOT EXISTS event_id TEXT,
  ADD COLUMN IF NOT EXISTS campaign_id BIGINT REFERENCES kutumb_organisation_campaigns(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS fundraising_page_id BIGINT REFERENCES kutumb_fundraising_pages(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS team_id BIGINT REFERENCES kutumb_fundraising_teams(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS is_anonymous BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS donor_message TEXT,
  ADD COLUMN IF NOT EXISTS tax_classification TEXT NOT NULL DEFAULT 'not_claimed'
    CHECK (tax_classification IN ('not_claimed','charity_dgr_claim','non_deductible'));
CREATE INDEX IF NOT EXISTS idx_kutumb_donations_campaign ON kutumb_donations(campaign_id,payment_status);
CREATE INDEX IF NOT EXISTS idx_kutumb_donations_event ON kutumb_donations(event_id,payment_status);
CREATE INDEX IF NOT EXISTS idx_kutumb_donations_page ON kutumb_donations(fundraising_page_id,payment_status);
