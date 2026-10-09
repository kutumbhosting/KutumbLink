-- Phase 1: additive organisation foundation. Existing Kutumb rows are
-- assigned to the initial Kutumb organisation (id 1); no data is deleted.
CREATE TABLE IF NOT EXISTS kutumb_organisations (
  id SERIAL PRIMARY KEY,
  legal_name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  abn TEXT,
  charity_status TEXT NOT NULL DEFAULT 'unverified',
  dgr_status TEXT NOT NULL DEFAULT 'unknown',
  acnc_registration_number TEXT,
  causes TEXT[] NOT NULL DEFAULT '{}',
  contact_email TEXT,
  contact_phone TEXT,
  logo_url TEXT,
  website TEXT,
  address_line1 TEXT,
  address_line2 TEXT,
  suburb TEXT,
  state TEXT,
  postcode TEXT,
  country TEXT NOT NULL DEFAULT 'Australia',
  is_verified BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by_admin_id INTEGER REFERENCES kutumb_admin_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS kutumb_organisation_users (
  id SERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES kutumb_organisations(id) ON DELETE RESTRICT,
  admin_user_id INTEGER NOT NULL REFERENCES kutumb_admin_users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner','admin','event_manager','finance_manager','volunteer_manager','checkin_staff','read_only')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  invited_by_admin_id INTEGER REFERENCES kutumb_admin_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, admin_user_id)
);
CREATE INDEX IF NOT EXISTS idx_kutumb_org_users_user ON kutumb_organisation_users(admin_user_id, is_active);
CREATE INDEX IF NOT EXISTS idx_kutumb_org_users_org ON kutumb_organisation_users(organisation_id, role);

INSERT INTO kutumb_organisations (legal_name, slug, charity_status, causes, contact_email, state, country, is_verified)
VALUES ('Kutumb', 'kutumb', 'unverified', ARRAY['Community'], 'info@kutumb.org.au', 'NSW', 'Australia', FALSE)
ON CONFLICT (slug) DO NOTHING;

ALTER TABLE kutumb_audit_log ADD COLUMN IF NOT EXISTS organisation_id INTEGER REFERENCES kutumb_organisations(id) ON DELETE SET NULL;

-- Records whose ownership is direct or can be determined by a parent event.
-- Initial data is assigned to Kutumb. Organisation APIs set an explicit
-- organisation_id for records they create.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'kutumb_members','kutumb_event_registrations','kutumb_bank_reconciliations',
    'kutumb_upcoming_events','kutumb_past_events','kutumb_past_event_media',
    'kutumb_donations','kutumb_activities','kutumb_activity_registrations',
    'kutumb_team_profiles','kutumb_ticket_types','kutumb_orders','kutumb_order_items',
    'kutumb_attendees','kutumb_waitlist','kutumb_event_coupons',
    'kutumb_registration_attendees','kutumb_checkin_codes','kutumb_registration_payments',
    'kutumb_donation_payments','kutumb_bank_transactions','kutumb_drive_imports',
    'kutumb_registration_notifications','kutumb_bank_statement_lines','kutumb_media_files'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS organisation_id INTEGER REFERENCES kutumb_organisations(id) ON DELETE RESTRICT', t);
    EXECUTE format('UPDATE %I SET organisation_id = 1 WHERE organisation_id IS NULL', t);
    EXECUTE format('ALTER TABLE %I ALTER COLUMN organisation_id SET DEFAULT 1', t);
    EXECUTE format('ALTER TABLE %I ALTER COLUMN organisation_id SET NOT NULL', t);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I(organisation_id)', 'idx_' || t || '_organisation', t);
  END LOOP;
END $$;

-- Existing Kutumb administrators remain usable and become members of the
-- default organisation. New organisation accounts use the separate
-- organisation_user platform role and are not granted legacy global access.
INSERT INTO kutumb_organisation_users (organisation_id, admin_user_id, role)
SELECT 1, id, CASE WHEN role IN ('superadmin','platform_admin') THEN 'owner' ELSE 'admin' END
FROM kutumb_admin_users
WHERE role IN ('admin','platform_admin','superadmin')
ON CONFLICT (organisation_id, admin_user_id) DO NOTHING;
