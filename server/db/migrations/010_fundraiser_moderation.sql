-- Prevent anonymous fundraiser submissions from becoming public without
-- charity review. Existing published pages remain published.
ALTER TABLE kutumb_fundraising_pages DROP CONSTRAINT IF EXISTS kutumb_fundraising_pages_status_check;
ALTER TABLE kutumb_fundraising_pages ADD CONSTRAINT kutumb_fundraising_pages_status_check
  CHECK (status IN ('draft','pending','published','rejected','closed'));
CREATE INDEX IF NOT EXISTS idx_fundraiser_review_queue ON kutumb_fundraising_pages(organisation_id,status,created_at DESC);
