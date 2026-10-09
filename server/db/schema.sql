-- Kutumb event-management add-on modules (PostgreSQL / Neon)
-- Safe to run multiple times. Every table is prefixed "kutumb_" so this can
-- safely share a Neon database/project with any other app without ever
-- colliding on a table name (e.g. a generic "users" or "orders" table).
--
-- This is intentionally separate from the existing JSON-file event system —
-- existing events/registrations keep working exactly as before. These
-- tables only come into play for an event that has ticketing explicitly
-- turned on (real payments, ticket tiers, waitlist, QR check-in), plus the
-- admin login/roles and settings/audit-log system.

CREATE TABLE IF NOT EXISTS kutumb_admin_users (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin', -- 'superadmin' | 'admin'
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS kutumb_audit_log (
  id SERIAL PRIMARY KEY,
  admin_user_id INTEGER REFERENCES kutumb_admin_users(id) ON DELETE SET NULL,
  admin_email TEXT,
  action TEXT NOT NULL,        -- e.g. 'event.update', 'member.delete'
  entity TEXT,                 -- e.g. 'diwali-2026'
  details TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_kutumb_audit_created ON kutumb_audit_log(created_at);

-- Replaces server/data/eventflyer/ and server/data/pastmedia/ as files on
-- disk. Actual image/video bytes live here now; kutumb_upcoming_events.
-- flyer_image and kutumb_past_event_media.src still store just the
-- filename, which is now a lookup key into this table (served via
-- GET /api/media/:filename) instead of a static-file path.
CREATE TABLE IF NOT EXISTS kutumb_media_files (
  id SERIAL PRIMARY KEY,
  filename TEXT UNIQUE NOT NULL,
  mimetype TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  data BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Key/value platform configuration (Stripe keys, etc). Secret values are
-- AES-256-GCM encrypted at rest using ENCRYPTION_KEY from .env.
CREATE TABLE IF NOT EXISTS kutumb_platform_settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  is_secret BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Ticket tiers for a given event. `event_id` is just the event's existing
-- slug/file id from the JSON event system (e.g. "diwali-and-multi-cultural-
-- event-2026") — there's no foreign key to a Postgres events table because
-- events themselves still live in the JSON files, unchanged.
CREATE TABLE IF NOT EXISTS kutumb_ticket_types (
  id SERIAL PRIMARY KEY,
  event_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  price_cents INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'AUD',
  quantity_total INTEGER NOT NULL DEFAULT 0, -- 0 = unlimited
  quantity_sold INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_kutumb_ticket_types_event ON kutumb_ticket_types(event_id);

CREATE TABLE IF NOT EXISTS kutumb_orders (
  id SERIAL PRIMARY KEY,
  event_id TEXT NOT NULL,
  buyer_name TEXT NOT NULL,
  buyer_email TEXT NOT NULL,
  buyer_phone TEXT,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | paid | refunded | cancelled
  subtotal_cents INTEGER NOT NULL DEFAULT 0,
  total_cents INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'AUD',
  stripe_session_id TEXT,
  stripe_payment_intent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_kutumb_orders_event ON kutumb_orders(event_id);
CREATE INDEX IF NOT EXISTS idx_kutumb_orders_status ON kutumb_orders(status);

CREATE TABLE IF NOT EXISTS kutumb_order_items (
  id SERIAL PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES kutumb_orders(id) ON DELETE CASCADE,
  ticket_type_id INTEGER NOT NULL REFERENCES kutumb_ticket_types(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price_cents INTEGER NOT NULL DEFAULT 0
);

-- One row per ticket (not per order — an order for 3 tickets makes 3 rows),
-- each with its own scannable QR token for check-in.
CREATE TABLE IF NOT EXISTS kutumb_attendees (
  id SERIAL PRIMARY KEY,
  order_item_id INTEGER NOT NULL REFERENCES kutumb_order_items(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL,
  name TEXT,
  email TEXT,
  qr_token TEXT UNIQUE NOT NULL,
  checked_in_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_kutumb_attendees_event ON kutumb_attendees(event_id);
CREATE INDEX IF NOT EXISTS idx_kutumb_attendees_qr ON kutumb_attendees(qr_token);

-- People who tried to register/buy after an event/ticket-type sold out.
CREATE TABLE IF NOT EXISTS kutumb_waitlist (
  id SERIAL PRIMARY KEY,
  event_id TEXT NOT NULL,
  ticket_type_id INTEGER REFERENCES kutumb_ticket_types(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  requested_qty INTEGER NOT NULL DEFAULT 1,
  notified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_kutumb_waitlist_event ON kutumb_waitlist(event_id);

-- ============================================================
-- Full data-layer migration: every JSON file's data now lives here.
-- Binary media (flyer images, past-event photos/videos, team photos) still
-- lives on disk under server/data/<folder> — only structured JSON *data*
-- moved into Postgres. Every table below fully replaces one JSON file.
-- ============================================================

CREATE TABLE IF NOT EXISTS kutumb_members (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  address TEXT,
  interests TEXT[] DEFAULT '{}',
  membership_number TEXT UNIQUE,
  qr_code TEXT, -- base64 data URL, generated at signup
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Duplicate members (same email AND name, different rows) were previously
-- only prevented by scattered application-level checks — and the generic
-- Database Tables admin editor had none at all, letting a duplicate slip
-- straight into the table. Before enforcing a real uniqueness constraint,
-- clean up any duplicates already sitting in the table: for each set of
-- rows sharing the same email+name (case-insensitive), keep only the
-- earliest-created one (lowest id) and remove the rest. This is safe to
-- run on every startup — once there are no duplicates left, it's a no-op.
-- Deliberately NOT email-alone: family members legitimately share one
-- household email under different names, and that's a valid case, not a
-- duplicate.
DELETE FROM kutumb_members a
USING kutumb_members b
WHERE a.id > b.id
  AND lower(a.email) = lower(b.email)
  AND lower(a.name) = lower(b.name);

-- Replaces the old plain (non-unique) email index with a real constraint
-- on the (email, name) pair, so that exact combination can never be
-- inserted twice again — via the signup form, the JSON importer, the
-- Database Tables editor, or any future code path, including a raw SQL
-- edit. Email alone is intentionally NOT unique, since one household email
-- covering several family members under different names is valid.
DROP INDEX IF EXISTS idx_kutumb_members_email;
DROP INDEX IF EXISTS idx_kutumb_members_email_unique;
CREATE INDEX IF NOT EXISTS idx_kutumb_members_email ON kutumb_members(lower(email));
CREATE UNIQUE INDEX IF NOT EXISTS idx_kutumb_members_email_name_unique ON kutumb_members(lower(email), lower(name));

-- Replaces the per-event JSON registration files (server/data/events/*.json).
-- One row per attendee registration; event identity is just the plain
-- event_name + event_year text pair, exactly like the old filenames were.
CREATE TABLE IF NOT EXISTS kutumb_event_registrations (
  id SERIAL PRIMARY KEY,
  event_name TEXT NOT NULL,
  event_year TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  adults INTEGER NOT NULL DEFAULT 0,
  children INTEGER NOT NULL DEFAULT 0,
  comments TEXT,
  registration_number TEXT,
  is_member BOOLEAN NOT NULL DEFAULT FALSE,
  membership_number TEXT,
  fee NUMERIC(10,2) NOT NULL DEFAULT 0,
  per_person_fee NUMERIC(10,2) NOT NULL DEFAULT 0,
  bank_transferred BOOLEAN NOT NULL DEFAULT FALSE,
  transaction_number TEXT,
  payment_status TEXT NOT NULL DEFAULT 'N/A',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_kutumb_evreg_event ON kutumb_event_registrations(event_name, event_year);
-- (Originally unique on every row; now only among non-cancelled rows so a
-- cancelled registrant can register again — see the reminders section below.
-- registration_status is added further down, so the partial index is created there.)
DROP INDEX IF EXISTS uq_kutumb_evreg_email_per_event;

-- Added for bank-statement payment reconciliation (see
-- server/lib/paymentReconciliation.js). Populated automatically when an
-- admin uploads a bank statement on the Event Registration page, and also
-- editable by hand from the existing "Modify Selected" panel.
ALTER TABLE kutumb_event_registrations ADD COLUMN IF NOT EXISTS payment_amount NUMERIC(10,2);
ALTER TABLE kutumb_event_registrations ADD COLUMN IF NOT EXISTS payment_date TIMESTAMPTZ;
ALTER TABLE kutumb_event_registrations ADD COLUMN IF NOT EXISTS payment_match_confidence TEXT;
ALTER TABLE kutumb_event_registrations ADD COLUMN IF NOT EXISTS payment_match_note TEXT;

-- "How did you hear about this event?" dropdown on the public registration
-- form. heard_about_other only holds a value when heard_about_source = 'Other'.
ALTER TABLE kutumb_event_registrations ADD COLUMN IF NOT EXISTS heard_about_source TEXT;
ALTER TABLE kutumb_event_registrations ADD COLUMN IF NOT EXISTS heard_about_other TEXT;

-- One row per "Upload Bank Statement" run on the Event Registration page.
-- `report` holds the full per-registration match detail and the list of
-- unmatched bank credits at the time of the run, so the "Download Excel
-- Report" button can regenerate that exact report later without needing
-- the bank statement re-uploaded or the DB re-queried.
CREATE TABLE IF NOT EXISTS kutumb_bank_reconciliations (
  id SERIAL PRIMARY KEY,
  event_name TEXT NOT NULL,
  event_year TEXT NOT NULL,
  uploaded_filename TEXT,
  run_by TEXT,
  run_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  summary JSONB NOT NULL DEFAULT '{}',
  report JSONB NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_kutumb_reconciliations_event ON kutumb_bank_reconciliations(event_name, event_year, run_at DESC);

-- Replaces server/data/upcomingevents/upcomingEvents.json
CREATE TABLE IF NOT EXISTS kutumb_upcoming_events (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  date_text TEXT,
  time_text TEXT,
  location TEXT,
  capacity INTEGER NOT NULL DEFAULT 0,
  member_fee NUMERIC(10,2) NOT NULL DEFAULT 0,
  non_member_fee NUMERIC(10,2) NOT NULL DEFAULT 0,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  published BOOLEAN NOT NULL DEFAULT FALSE,
  flyer_image TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Replaces server/data/pastevents/pastEventsData.json
CREATE TABLE IF NOT EXISTS kutumb_past_events (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  date_text TEXT,
  description TEXT,
  highlights TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS kutumb_past_event_media (
  id SERIAL PRIMARY KEY,
  past_event_id INTEGER NOT NULL REFERENCES kutumb_past_events(id) ON DELETE CASCADE,
  type TEXT NOT NULL, -- 'image' | 'video'
  src TEXT NOT NULL,  -- filename — looked up in kutumb_media_files
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_kutumb_pastmedia_event ON kutumb_past_event_media(past_event_id);

-- Replaces server/data/donations/donations.json
CREATE TABLE IF NOT EXISTS kutumb_donations (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT,
  membership_number TEXT,
  amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  bank_transferred BOOLEAN NOT NULL DEFAULT FALSE,
  transaction_number TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Replaces server/data/activities/activities.json (the activity catalogue
-- itself — images referenced here still live on disk under
-- server/data/activities/*.jpeg).
CREATE TABLE IF NOT EXISTS kutumb_activities (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  image1 TEXT,
  image2 TEXT,
  description TEXT,
  schedule TEXT,
  participation_options TEXT[] DEFAULT '{}',
  online_yoga TEXT[] DEFAULT '{}',
  in_person_yoga TEXT[] DEFAULT '{}',
  benefits TEXT[] DEFAULT '{}',
  sort_order INTEGER NOT NULL DEFAULT 0
);

-- Replaces the ad-hoc per-activity "<slug>-registration.json" files that
-- POST /api/activity-register used to create on disk.
CREATE TABLE IF NOT EXISTS kutumb_activity_registrations (
  id SERIAL PRIMARY KEY,
  activity_title TEXT NOT NULL,
  name TEXT,
  email TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}', -- everything else the form submitted
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_kutumb_actreg_email_per_activity ON kutumb_activity_registrations(activity_title, lower(email));

-- Replaces server/data/team/profile.json
CREATE TABLE IF NOT EXISTS kutumb_team_profiles (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT,
  phone TEXT,
  email TEXT,
  bio TEXT,
  image TEXT, -- filename under server/data/team
  sort_order INTEGER NOT NULL DEFAULT 0
);

-- ============================================================
-- Event Registration enhancements (filtered export, per-attendee QR
-- check-in, under-5 free children, coupons, payment-method tracking).
-- Purely additive — every existing kutumb_event_registrations row keeps
-- working exactly as before; new columns default to values that reproduce
-- the old behaviour when left unset.
-- ============================================================

-- Breaks the existing `children` count into an under-5 (free, when the
-- event allows it) and 5-and-over (charged) split. `children` itself is
-- kept as-is (still the total) so every existing query/report that reads
-- it keeps working unchanged.
ALTER TABLE kutumb_event_registrations ADD COLUMN IF NOT EXISTS children_under5 INTEGER NOT NULL DEFAULT 0;
ALTER TABLE kutumb_event_registrations ADD COLUMN IF NOT EXISTS children_5plus INTEGER NOT NULL DEFAULT 0;
-- The per-child fee actually charged at registration time (kept alongside
-- per_person_fee, which remains the per-adult rate), for accurate historical
-- records/exports even if event pricing changes later.
ALTER TABLE kutumb_event_registrations ADD COLUMN IF NOT EXISTS child_fee NUMERIC(10,2) NOT NULL DEFAULT 0;

-- How this registration is being / was paid for.
ALTER TABLE kutumb_event_registrations ADD COLUMN IF NOT EXISTS payment_method TEXT; -- 'bank_transfer' | 'card' | 'coupon' | NULL (free / not yet chosen)
ALTER TABLE kutumb_event_registrations ADD COLUMN IF NOT EXISTS coupon_code TEXT;
ALTER TABLE kutumb_event_registrations ADD COLUMN IF NOT EXISTS coupon_amount NUMERIC(10,2);

-- Explicit registration lifecycle, separate from payment_status (which the
-- existing UI already reads/writes as 'N/A' | 'Pending' | 'Paid'). This is
-- what makes "registered" and "confirmed" different for a paid event: a
-- new paid registration starts at pending_payment and only becomes
-- confirmed once payment_status flips to Paid (webhook, admin bank-transfer
-- verification, or a fully-covering coupon).
ALTER TABLE kutumb_event_registrations ADD COLUMN IF NOT EXISTS registration_status TEXT NOT NULL DEFAULT 'confirmed';
-- 'pending_payment' | 'confirmed' | 'payment_failed' | 'cancelled'

-- Links a registration to the Stripe-backed order created when it's paid
-- via RegistrationCheckoutModal, so the webhook / session-status check can
-- flip THIS registration's payment_status once Stripe confirms payment
-- (previously the Stripe order and the registration row were unconnected).
ALTER TABLE kutumb_orders ADD COLUMN IF NOT EXISTS registration_id INTEGER REFERENCES kutumb_event_registrations(id) ON DELETE SET NULL;

-- One row per individual attendee under a registration (the primary
-- registrant, each additional adult, and each child) — each with its own
-- scannable QR token and independent check-in status. This is what makes
-- "Pramod Singh registers himself + 1 adult + 1 child" become 3 separately
-- checkable people instead of one row for the whole registration.
CREATE TABLE IF NOT EXISTS kutumb_registration_attendees (
  id SERIAL PRIMARY KEY,
  registration_id INTEGER NOT NULL REFERENCES kutumb_event_registrations(id) ON DELETE CASCADE,
  event_name TEXT NOT NULL,
  event_year TEXT NOT NULL,
  name TEXT NOT NULL,               -- e.g. "Pramod Singh", "Additional Adult 1", "Child 1 (Under 5)"
  category TEXT NOT NULL,           -- 'primary_adult' | 'adult' | 'child_under5' | 'child_5plus'
  qr_token TEXT UNIQUE NOT NULL,    -- opaque random token — never the person's name/email
  checked_in_at TIMESTAMPTZ,
  checked_in_by TEXT,               -- admin email who scanned/checked them in
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_kutumb_regattendees_registration ON kutumb_registration_attendees(registration_id);
CREATE INDEX IF NOT EXISTS idx_kutumb_regattendees_qr ON kutumb_registration_attendees(qr_token);
CREATE INDEX IF NOT EXISTS idx_kutumb_regattendees_event ON kutumb_registration_attendees(event_name, event_year);

-- Under-5-free configuration + separate child pricing per event. NULL for
-- child_member_fee/child_non_member_fee means "no special child price
-- configured — fall back to the adult member/non-member fee", so existing
-- events with no configuration keep charging children the same as adults,
-- exactly as before.
ALTER TABLE kutumb_upcoming_events ADD COLUMN IF NOT EXISTS under5_free BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE kutumb_upcoming_events ADD COLUMN IF NOT EXISTS child_member_fee NUMERIC(10,2);
ALTER TABLE kutumb_upcoming_events ADD COLUMN IF NOT EXISTS child_non_member_fee NUMERIC(10,2);

-- Event-specific coupons. `amount` is the coupon's CURRENT remaining
-- balance — redeeming it only ever deducts what a booking actually still
-- owes (never more than the balance), so a $100 coupon spent on a $40
-- booking leaves $60 on the coupon, still 'active', for a later booking
-- against the same event. `original_amount` is fixed at creation and never
-- changes, purely so the admin console and emails can still show what the
-- coupon was originally worth. A coupon only flips to 'used' once its
-- balance reaches zero; the application layer refuses to apply an
-- already-void/expired/zero-balance coupon again. redeemed_by_registration_id
-- / redeemed_at reflect the most recent redemption only — with partial,
-- repeatable use this is a "last touched by" pointer, not a full history.
CREATE TABLE IF NOT EXISTS kutumb_event_coupons (
  id SERIAL PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  event_name TEXT NOT NULL,
  event_year TEXT NOT NULL,
  amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  qr_code TEXT,                       -- base64 data URL, generated at creation
  recipient_name TEXT,
  recipient_email TEXT,
  notes TEXT,                         -- applicable conditions / validity notes, free text
  valid_from TIMESTAMPTZ,
  valid_until TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'active', -- 'active' | 'used' | 'void'
  redeemed_by_registration_id INTEGER REFERENCES kutumb_event_registrations(id) ON DELETE SET NULL,
  redeemed_at TIMESTAMPTZ,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_kutumb_coupons_event ON kutumb_event_coupons(event_name, event_year);
ALTER TABLE kutumb_event_coupons ADD COLUMN IF NOT EXISTS original_amount NUMERIC(10,2);
-- Backfill: for any coupon created before this column existed, its original
-- face value is simply whatever `amount` holds right now (nothing had
-- partial-redemption behaviour yet, so amount was never partially spent).
UPDATE kutumb_event_coupons SET original_amount = amount WHERE original_amount IS NULL;

-- Temporary check-in login codes. Generated 5 at a time, on demand, for a
-- specific event's door volunteers to log in to the check-in scanner
-- (kutumb.org.au/checkin) without needing a real admin email/password.
-- Every code:
--   - only ever grants a check-in session (scan tickets / mark attendees
--     checked in for THIS event) - never full admin access, see
--     server/lib/auth.js's requireAdminOrCheckinSession,
--   - expires at the end of the event's day (not single-use - several
--     volunteers/devices can share the 5 codes across the day),
--   - is deleted outright once expired (a lazy delete the moment an expired
--     code is tried, plus a periodic sweep - see cleanupExpiredCheckinCodes
--     in registrationScheduler.js), so no stray login codes accumulate.
CREATE TABLE IF NOT EXISTS kutumb_checkin_codes (
  id SERIAL PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  event_name TEXT NOT NULL,
  event_year TEXT,
  event_date_text TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_kutumb_checkin_codes_expires ON kutumb_checkin_codes(expires_at);

-- Codes are now SINGLE-USE and tied to a named volunteer: the first person to
-- log in with a code must type their name; the code is then burned
-- (used_at set) and can never start another session. used_by_name records
-- who that was.
ALTER TABLE kutumb_checkin_codes ADD COLUMN IF NOT EXISTS used_at TIMESTAMPTZ;
ALTER TABLE kutumb_checkin_codes ADD COLUMN IF NOT EXISTS used_by_name TEXT;

-- Who checked each attendee in, and with which login code. checked_in_by
-- already exists on registration attendees (holds an admin email, or now a
-- volunteer's name for code logins); ticketed attendees get it too.
ALTER TABLE kutumb_registration_attendees ADD COLUMN IF NOT EXISTS checked_in_code TEXT;
ALTER TABLE kutumb_attendees ADD COLUMN IF NOT EXISTS checked_in_by TEXT;
ALTER TABLE kutumb_attendees ADD COLUMN IF NOT EXISTS checked_in_code TEXT;

-- ============================================================
-- Square / PayPal payment tracking for the Event Registration flow.
-- Deliberately separate from kutumb_orders (which is entangled with the
-- ticket-types/order-items ticketing system) — this is a lightweight
-- "pay this registration's remaining balance via provider X" record, one
-- row per checkout attempt, so a webhook or a return-page poll can find
-- the right registration and mark it paid idempotently.
-- ============================================================
CREATE TABLE IF NOT EXISTS kutumb_registration_payments (
  id SERIAL PRIMARY KEY,
  registration_id INTEGER NOT NULL REFERENCES kutumb_event_registrations(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,              -- 'square' | 'paypal'
  provider_reference TEXT NOT NULL,    -- Square order_id, or PayPal order id
  amount NUMERIC(10,2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'paid' | 'failed'
  raw_status TEXT,                     -- the provider's own status string, for troubleshooting
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_kutumb_regpayments_registration ON kutumb_registration_payments(registration_id);
CREATE INDEX IF NOT EXISTS idx_kutumb_regpayments_reference ON kutumb_registration_payments(provider, provider_reference);

-- ============================================================
-- Donations: same "Card / Square / PayPal / Bank Transfer" payment options
-- as event registrations. Bank transfer keeps working exactly as before
-- (self-reported by the donor); the new columns/table below only come into
-- play when a donor pays online instead.
-- ============================================================
ALTER TABLE kutumb_donations ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'Pending';
ALTER TABLE kutumb_donations ADD COLUMN IF NOT EXISTS payment_method TEXT;
-- Backfill: a donation already marked bank_transferred (the only "done"
-- signal that existed before this change) is treated as already Paid.
UPDATE kutumb_donations SET payment_status = 'Paid', payment_method = COALESCE(payment_method, 'bank_transfer')
  WHERE bank_transferred = TRUE AND payment_status = 'Pending';

CREATE TABLE IF NOT EXISTS kutumb_donation_payments (
  id SERIAL PRIMARY KEY,
  donation_id INTEGER NOT NULL REFERENCES kutumb_donations(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,              -- 'card' (Stripe) | 'square' | 'paypal'
  provider_reference TEXT NOT NULL,    -- Stripe session id, Square order_id, or PayPal order id
  amount NUMERIC(10,2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'paid' | 'failed'
  raw_status TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_kutumb_donpayments_donation ON kutumb_donation_payments(donation_id);
CREATE INDEX IF NOT EXISTS idx_kutumb_donpayments_reference ON kutumb_donation_payments(provider, provider_reference);

-- ============================================================
-- Per-attendee QR tickets, emailed once a registration is actually
-- confirmed (free at signup, or paid — card/Square/PayPal/coupon/admin
-- bank-transfer verification). tickets_sent_at is a one-way claim: several
-- different code paths can each flip a registration to "confirmed", so
-- this stops more than one of them from ever emailing the same tickets
-- twice (see sendEventTickets in server/lib/tickets.js).
-- ============================================================
ALTER TABLE kutumb_event_registrations ADD COLUMN IF NOT EXISTS tickets_sent_at TIMESTAMPTZ;

-- Opaque, unguessable token so the "pay now" link in the pending-payment
-- confirmation email can take someone straight to a page that pays THIS
-- one registration — without them needing to log in, and without the URL
-- being a guessable sequential id that would let anyone view or pay
-- someone else's registration just by incrementing a number.
ALTER TABLE kutumb_event_registrations ADD COLUMN IF NOT EXISTS pay_token TEXT UNIQUE;

-- One-way claim (same pattern as tickets_sent_at) so the "payment
-- required" reminder email — sent only once someone leaves the success
-- dialog still unpaid, see /api/events/registration/:id/send-payment-reminder
-- — can never go out twice for the same registration, even if the
-- beforeunload beacon and an explicit Close click both fire.
ALTER TABLE kutumb_event_registrations ADD COLUMN IF NOT EXISTS payment_email_sent_at TIMESTAMPTZ;

-- The actual name of each additional adult / child on a registration, so
-- tickets can be issued in each individual's own name rather than a
-- generic "Additional Adult 1" / "Child 1 (Under 5)" placeholder. Each is
-- a JSON array of strings, positionally matched to the adults /
-- children_under5 / children_5plus counts (see syncRegistrationAttendees
-- in server/lib/attendees.js, which falls back to the old generic naming
-- for any position left blank or for registrations created before this).
ALTER TABLE kutumb_event_registrations ADD COLUMN IF NOT EXISTS adult_names JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE kutumb_event_registrations ADD COLUMN IF NOT EXISTS children_under5_names JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE kutumb_event_registrations ADD COLUMN IF NOT EXISTS children_5plus_names JSONB NOT NULL DEFAULT '[]'::jsonb;

-- ============================================================
-- Repair: registrations showing payment_status = 'Paid' while still
-- registration_status = 'pending_payment' (a contradiction — Paid must mean
-- confirmed). Two old code paths caused it: a registrant typing a bank
-- transfer reference used to be marked Paid straight away, and bank-statement
-- reconciliation flipped payment_status without confirming the registration.
-- Both are fixed; this cleans up rows they already left behind. Idempotent —
-- once nothing matches, it changes nothing — so safe on every start.
--
--  1. Self-declared transfer, never verified (no amount recorded, no bank
--     match)  -> back to Pending. The reference and bank_transferred flag are
--     kept, so it still shows as "claimed, awaiting verification".
--  2. Matched to a bank credit that covers the fee -> Confirmed.
--  3. Matched to a bank credit that falls short of the fee -> Pending (the
--     recorded amount stays, so the shortfall is visible).
-- Tickets for rows repaired by step 2 go out the next time an admin re-saves
-- the registration's Payment Status (that path sends them once).
-- ============================================================
UPDATE kutumb_event_registrations
   SET payment_status = 'Pending'
 WHERE payment_status = 'Paid'
   AND registration_status = 'pending_payment'
   AND payment_amount IS NULL
   AND payment_match_confidence IS NULL;

UPDATE kutumb_event_registrations
   SET registration_status = 'confirmed',
       payment_method = COALESCE(payment_method, 'bank_transfer')
 WHERE payment_status = 'Paid'
   AND registration_status = 'pending_payment'
   AND payment_amount IS NOT NULL
   AND payment_amount >= fee;

UPDATE kutumb_event_registrations
   SET payment_status = 'Pending'
 WHERE payment_status = 'Paid'
   AND registration_status = 'pending_payment'
   AND COALESCE(payment_amount, 0) < fee;

-- ============================================================
-- Bank credit ledger — fed by the openfeed live NAB feed (openfeedClient.js),
-- the Bank File Drop Box and manual statement uploads.
-- Every credit pulled from the connected account is kept here once (keyed
-- by the bank-side transaction id), so re-syncing never double-counts, and
-- a credit already matched to a registration in ONE event is never offered
-- to another event's reconciliation (important when the same account
-- receives money for several events, donations and personal transfers).
-- ============================================================
CREATE TABLE IF NOT EXISTS kutumb_bank_transactions (
  id TEXT PRIMARY KEY,                       -- of_<openfeed id> | stmt_<hash>
  source TEXT NOT NULL DEFAULT 'upload',
  account_id TEXT,
  post_date TIMESTAMPTZ,
  amount NUMERIC(12,2) NOT NULL,
  description TEXT,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  allocated_registration_id INTEGER REFERENCES kutumb_event_registrations(id) ON DELETE SET NULL,
  allocated_event_name TEXT,
  allocated_event_year TEXT,
  allocated_at TIMESTAMPTZ,
  match_confidence TEXT,
  match_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_kutumb_banktxn_date ON kutumb_bank_transactions(post_date);
CREATE INDEX IF NOT EXISTS idx_kutumb_banktxn_unallocated ON kutumb_bank_transactions(post_date) WHERE allocated_registration_id IS NULL;

-- One row per file picked up from the Google Drive "bank statement drop"
-- folder (see server/lib/driveStatementWatcher.js). Keeps a copy of the
-- original file, since the file itself is removed from Drive afterwards.
-- (file_id, modified_time) is unique so a file is handled once per version.
CREATE TABLE IF NOT EXISTS kutumb_drive_imports (
  id SERIAL PRIMARY KEY,
  file_id TEXT NOT NULL,
  file_name TEXT,
  mime_type TEXT,
  modified_time TEXT NOT NULL,
  status TEXT NOT NULL,              -- 'imported' | 'error'
  message TEXT,
  summary JSONB,
  content BYTEA,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (file_id, modified_time)
);
CREATE INDEX IF NOT EXISTS idx_kutumb_drive_imports_time ON kutumb_drive_imports(processed_at DESC);

-- Who dropped the file (the file's Drive owner), so they get a result email.
ALTER TABLE kutumb_drive_imports ADD COLUMN IF NOT EXISTS uploaded_by TEXT;

-- ============================================================
-- Automatic registration emails (server/lib/registrationScheduler.js):
-- twice-weekly payment reminders, a final reminder 6 days before the event,
-- auto-cancellation 5 days before, and a welcome email the day before.
-- ============================================================
ALTER TABLE kutumb_event_registrations ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
ALTER TABLE kutumb_event_registrations ADD COLUMN IF NOT EXISTS cancel_reason TEXT;

-- A cancelled registration mustn't stop the same person registering again.
CREATE UNIQUE INDEX IF NOT EXISTS uq_kutumb_evreg_email_per_event_active
  ON kutumb_event_registrations(event_name, event_year, lower(email))
  WHERE registration_status <> 'cancelled';

-- One row per automatic email actually sent. period_key makes the
-- twice-weekly reminder once-per-day (its Sydney date); '' for one-offs.
CREATE TABLE IF NOT EXISTS kutumb_registration_notifications (
  id SERIAL PRIMARY KEY,
  registration_id INTEGER NOT NULL REFERENCES kutumb_event_registrations(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,            -- 'payment_reminder' | 'final_reminder' | 'cancelled' | 'welcome' | 'coupon_part_payment' | 'flagged_review'
  period_key TEXT NOT NULL DEFAULT '',
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (registration_id, kind, period_key)
);
CREATE INDEX IF NOT EXISTS idx_kutumb_regnotif_reg ON kutumb_registration_notifications(registration_id, kind);

-- Per-event switches for the automatic registration emails (ticked in
-- Admin → API Keys & Settings → Automatic Registration Emails).
ALTER TABLE kutumb_upcoming_events ADD COLUMN IF NOT EXISTS auto_reminders BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE kutumb_upcoming_events ADD COLUMN IF NOT EXISTS auto_cancel BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE kutumb_upcoming_events ADD COLUMN IF NOT EXISTS auto_welcome BOOLEAN NOT NULL DEFAULT TRUE;

-- ============================================================
-- Bank dashboard: EVERY line (money in and out) of the Kutumb NAB account
-- pulled through openfeed. amount is signed (+ credit, − debit). A line's
-- event is its manual tag if set, otherwise the event its credit was
-- reconciled to (kutumb_bank_transactions.allocated_event_*).
-- ============================================================
CREATE TABLE IF NOT EXISTS kutumb_bank_statement_lines (
  id TEXT PRIMARY KEY,                 -- of_<openfeed transactionId>
  source TEXT NOT NULL DEFAULT 'openfeed',
  account_id TEXT,
  txn_date DATE,                       -- Sydney calendar date
  posted_at TIMESTAMPTZ,
  amount NUMERIC(12,2) NOT NULL,
  description TEXT,
  reference TEXT,
  merchant_name TEXT,
  transaction_type TEXT,
  event_name TEXT,                     -- manual tag
  event_year TEXT,
  category TEXT,
  notes TEXT,
  tagged_by TEXT,
  tagged_at TIMESTAMPTZ,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_kutumb_bsl_date ON kutumb_bank_statement_lines(txn_date);
CREATE INDEX IF NOT EXISTS idx_kutumb_bsl_event ON kutumb_bank_statement_lines(event_name, event_year);
