-- Phase 2/3: additive onboarding, verification evidence and organisation-scoped
-- supporter identities. Existing records and payment IDs remain untouched.
ALTER TABLE kutumb_organisations
  ADD COLUMN IF NOT EXISTS public_name TEXT,
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS verification_status TEXT NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS onboarding_submitted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS public_profile_enabled BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE kutumb_organisations DROP CONSTRAINT IF EXISTS kutumb_organisations_verification_status_check;
ALTER TABLE kutumb_organisations ADD CONSTRAINT kutumb_organisations_verification_status_check
  CHECK (verification_status IN ('draft','submitted','under_review','needs_information','verified','approved','rejected','suspended'));

CREATE TABLE IF NOT EXISTS kutumb_organisation_verification_history (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES kutumb_organisations(id) ON DELETE RESTRICT,
  actor_admin_id INTEGER REFERENCES kutumb_admin_users(id) ON DELETE SET NULL,
  actor_email TEXT,
  from_status TEXT,
  to_status TEXT NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_org_verification_history_org ON kutumb_organisation_verification_history(organisation_id, created_at DESC);

CREATE TABLE IF NOT EXISTS kutumb_organisation_verification_documents (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES kutumb_organisations(id) ON DELETE RESTRICT,
  uploaded_by_admin_id INTEGER REFERENCES kutumb_admin_users(id) ON DELETE SET NULL,
  label TEXT NOT NULL,
  document_url TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_org_verification_documents_org ON kutumb_organisation_verification_documents(organisation_id, created_at DESC);

CREATE TABLE IF NOT EXISTS kutumb_organisation_campaigns (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES kutumb_organisations(id) ON DELETE RESTRICT,
  title TEXT NOT NULL,
  description TEXT,
  goal_amount NUMERIC(12,2),
  currency TEXT NOT NULL DEFAULT 'AUD' CHECK (currency='AUD'),
  fundraising_url TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','closed')),
  created_by_admin_id INTEGER REFERENCES kutumb_admin_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_org_campaign_public ON kutumb_organisation_campaigns(organisation_id,status,created_at DESC);

CREATE TABLE IF NOT EXISTS kutumb_supporters (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES kutumb_organisations(id) ON DELETE RESTRICT,
  display_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  source TEXT NOT NULL DEFAULT 'activity',
  merged_into_id BIGINT REFERENCES kutumb_supporters(id) ON DELETE RESTRICT,
  email_opt_out BOOLEAN NOT NULL DEFAULT FALSE,
  sms_opt_out BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_kutumb_supporter_org_email_name
  ON kutumb_supporters(organisation_id, lower(email), lower(display_name));
CREATE INDEX IF NOT EXISTS idx_kutumb_supporter_org_name ON kutumb_supporters(organisation_id, lower(display_name));

CREATE TABLE IF NOT EXISTS kutumb_supporter_merge_log (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES kutumb_organisations(id) ON DELETE RESTRICT,
  source_supporter_id BIGINT NOT NULL,
  target_supporter_id BIGINT NOT NULL,
  merged_by_admin_id INTEGER REFERENCES kutumb_admin_users(id) ON DELETE SET NULL,
  details JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (source_supporter_id <> target_supporter_id)
);

CREATE TABLE IF NOT EXISTS kutumb_supporter_login_links (
  id BIGSERIAL PRIMARY KEY,
  supporter_id BIGINT NOT NULL REFERENCES kutumb_supporters(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_supporter_login_links_expiry ON kutumb_supporter_login_links(expires_at);

ALTER TABLE kutumb_members ADD COLUMN IF NOT EXISTS supporter_id BIGINT REFERENCES kutumb_supporters(id) ON DELETE RESTRICT;
ALTER TABLE kutumb_event_registrations ADD COLUMN IF NOT EXISTS supporter_id BIGINT REFERENCES kutumb_supporters(id) ON DELETE RESTRICT;
ALTER TABLE kutumb_donations ADD COLUMN IF NOT EXISTS supporter_id BIGINT REFERENCES kutumb_supporters(id) ON DELETE RESTRICT;
ALTER TABLE kutumb_orders ADD COLUMN IF NOT EXISTS supporter_id BIGINT REFERENCES kutumb_supporters(id) ON DELETE RESTRICT;
ALTER TABLE kutumb_attendees ADD COLUMN IF NOT EXISTS supporter_id BIGINT REFERENCES kutumb_supporters(id) ON DELETE RESTRICT;
ALTER TABLE kutumb_activity_registrations ADD COLUMN IF NOT EXISTS supporter_id BIGINT REFERENCES kutumb_supporters(id) ON DELETE RESTRICT;

-- Create a safe organisation-local person identity from matching email + name.
-- Household email addresses remain distinct where names differ.
CREATE OR REPLACE FUNCTION kutumb_link_supporter_identity() RETURNS trigger AS $$
DECLARE
  row_data JSONB := to_jsonb(NEW);
  old_data JSONB;
  person_email TEXT;
  person_name TEXT;
  person_phone TEXT;
  person_id BIGINT;
BEGIN
  person_email := NULLIF(lower(trim(COALESCE(row_data->>'email', row_data->>'buyer_email'))), '');
  person_name := NULLIF(trim(COALESCE(row_data->>'name', row_data->>'buyer_name')), '');
  person_phone := NULLIF(trim(COALESCE(row_data->>'phone', row_data->>'buyer_phone')), '');
  IF TG_OP = 'UPDATE' THEN
    old_data := to_jsonb(OLD);
    IF lower(COALESCE(old_data->>'email', old_data->>'buyer_email','')) = COALESCE(person_email,'')
      AND lower(COALESCE(old_data->>'name', old_data->>'buyer_name','')) = lower(COALESCE(person_name,''))
      AND COALESCE(old_data->>'organisation_id','') = COALESCE(row_data->>'organisation_id','') THEN
      RETURN NEW;
    END IF;
    NEW.supporter_id := NULL;
  ELSIF COALESCE(row_data->>'supporter_id','') <> '' THEN
    RETURN NEW;
  END IF;
  IF person_email IS NULL OR person_name IS NULL THEN
    RETURN NEW;
  END IF;
  INSERT INTO kutumb_supporters (organisation_id, display_name, email, phone, source)
  VALUES (NEW.organisation_id, person_name, person_email, person_phone, TG_ARGV[0])
  ON CONFLICT (organisation_id, (lower(email)), (lower(display_name))) DO UPDATE
    SET phone = COALESCE(kutumb_supporters.phone, EXCLUDED.phone), updated_at = now()
  RETURNING id INTO person_id;
  NEW.supporter_id := person_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE item TEXT[];
BEGIN
  -- The same trigger safely links records created by the existing ticketing,
  -- event-registration, member, donation and activity journeys.
  FOREACH item SLICE 1 IN ARRAY ARRAY[
    ARRAY['kutumb_members','membership'],
    ARRAY['kutumb_event_registrations','event_registration'],
    ARRAY['kutumb_donations','donation'],
    ARRAY['kutumb_orders','ticket_order'],
    ARRAY['kutumb_attendees','ticket_attendance'],
    ARRAY['kutumb_activity_registrations','activity_registration']
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', 'trg_supporter_identity_' || item[1], item[1]);
    EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION kutumb_link_supporter_identity(%L)',
      'trg_supporter_identity_' || item[1], item[1], item[2]);
  END LOOP;
END $$;

-- Backfill existing rows in place, without merging/deleting any source record.
DO $$
DECLARE item TEXT[];
BEGIN
  FOREACH item SLICE 1 IN ARRAY ARRAY[
    ARRAY['kutumb_members','name','email'],
    ARRAY['kutumb_event_registrations','name','email'],
    ARRAY['kutumb_donations','name','email'],
    ARRAY['kutumb_orders','buyer_name','buyer_email'],
    ARRAY['kutumb_attendees','name','email'],
    ARRAY['kutumb_activity_registrations','name','email']
  ] LOOP
    EXECUTE format(
      'INSERT INTO kutumb_supporters (organisation_id, display_name, email, source)
       SELECT DISTINCT ON (organisation_id, lower(%1$I), lower(%2$I)) organisation_id, trim(%1$I), lower(trim(%2$I)), %3$L
       FROM %4$I WHERE NULLIF(trim(%1$I), '''') IS NOT NULL AND NULLIF(trim(%2$I), '''') IS NOT NULL
       ORDER BY organisation_id, lower(%1$I), lower(%2$I), id
       ON CONFLICT (organisation_id, (lower(email)), (lower(display_name))) DO NOTHING',
       item[2], item[3], item[1], item[1]);
    EXECUTE format(
      'UPDATE %1$I source SET supporter_id = supporter.id
       FROM kutumb_supporters supporter
       WHERE source.supporter_id IS NULL AND supporter.organisation_id = source.organisation_id
         AND lower(supporter.email) = lower(source.%2$I) AND lower(supporter.display_name) = lower(source.%3$I)',
       item[1], item[3], item[2]);
  END LOOP;
END $$;

CREATE INDEX IF NOT EXISTS idx_kutumb_members_supporter ON kutumb_members(supporter_id);
CREATE INDEX IF NOT EXISTS idx_kutumb_event_reg_supporter ON kutumb_event_registrations(supporter_id);
CREATE INDEX IF NOT EXISTS idx_kutumb_donations_supporter ON kutumb_donations(supporter_id);
CREATE INDEX IF NOT EXISTS idx_kutumb_orders_supporter ON kutumb_orders(supporter_id);
CREATE INDEX IF NOT EXISTS idx_kutumb_attendees_supporter ON kutumb_attendees(supporter_id);
CREATE INDEX IF NOT EXISTS idx_kutumb_activity_reg_supporter ON kutumb_activity_registrations(supporter_id);
