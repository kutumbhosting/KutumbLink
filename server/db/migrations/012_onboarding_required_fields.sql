-- Capture the mandatory sign-up details collected on the charity join form.
ALTER TABLE kutumb_organisations ADD COLUMN IF NOT EXISTS region TEXT;
ALTER TABLE kutumb_organisations ADD COLUMN IF NOT EXISTS applicant_first_name TEXT;
ALTER TABLE kutumb_organisations ADD COLUMN IF NOT EXISTS applicant_last_name TEXT;
ALTER TABLE kutumb_organisations ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ;
