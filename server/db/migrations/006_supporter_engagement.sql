-- Phase 8: consent evidence, communication preferences and attribution.
ALTER TABLE kutumb_supporters
  ADD COLUMN IF NOT EXISTS email_consent BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS sms_consent BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS consent_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS consent_source TEXT;
ALTER TABLE kutumb_donations
  ADD COLUMN IF NOT EXISTS attribution_source TEXT,
  ADD COLUMN IF NOT EXISTS attribution_medium TEXT,
  ADD COLUMN IF NOT EXISTS attribution_campaign TEXT,
  ADD COLUMN IF NOT EXISTS attribution_referrer TEXT;
CREATE INDEX IF NOT EXISTS idx_supporter_consent ON kutumb_supporters(organisation_id,email_consent,email_opt_out);
CREATE INDEX IF NOT EXISTS idx_donation_attribution ON kutumb_donations(organisation_id,attribution_campaign,created_at DESC);
