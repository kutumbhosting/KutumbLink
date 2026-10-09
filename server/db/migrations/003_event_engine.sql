-- Phase 4: additive event ticket controls. Legacy event and registration
-- records retain their keys and prices; these options only affect ticketing.
ALTER TABLE kutumb_upcoming_events
  ADD COLUMN IF NOT EXISTS event_type TEXT NOT NULL DEFAULT 'community',
  ADD COLUMN IF NOT EXISTS event_mode TEXT NOT NULL DEFAULT 'in_person',
  ADD COLUMN IF NOT EXISTS accessibility_notes TEXT,
  ADD COLUMN IF NOT EXISTS faqs JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE kutumb_ticket_types
  ADD COLUMN IF NOT EXISTS sales_start_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sales_end_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS early_bird_price_cents INTEGER,
  ADD COLUMN IF NOT EXISTS early_bird_end_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS is_private BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS max_per_order INTEGER NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS min_per_order INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS pricing_mode TEXT NOT NULL DEFAULT 'fixed' CHECK (pricing_mode IN ('fixed','pay_what_you_feel')),
  ADD COLUMN IF NOT EXISTS minimum_price_cents INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS maximum_price_cents INTEGER,
  ADD COLUMN IF NOT EXISTS group_min_quantity INTEGER,
  ADD COLUMN IF NOT EXISTS group_price_cents INTEGER;

ALTER TABLE kutumb_orders
  ADD COLUMN IF NOT EXISTS discount_code TEXT,
  ADD COLUMN IF NOT EXISTS discount_cents INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ticket_email_sent_at TIMESTAMPTZ;

ALTER TABLE kutumb_attendees
  ADD COLUMN IF NOT EXISTS ticket_status TEXT NOT NULL DEFAULT 'active'
    CHECK (ticket_status IN ('active','refunded','cancelled'));

CREATE TABLE IF NOT EXISTS kutumb_ticket_refunds (
  id BIGSERIAL PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES kutumb_orders(id) ON DELETE RESTRICT,
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  provider_reference TEXT,
  reason TEXT,
  processed_by INTEGER REFERENCES kutumb_admin_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS kutumb_event_codes (
  id BIGSERIAL PRIMARY KEY,
  event_id TEXT NOT NULL,
  organisation_id INTEGER NOT NULL DEFAULT 1,
  code TEXT NOT NULL,
  code_type TEXT NOT NULL CHECK (code_type IN ('discount','access')),
  discount_type TEXT CHECK (discount_type IN ('fixed','percent')),
  discount_value NUMERIC(10,2),
  max_redemptions INTEGER,
  redemption_count INTEGER NOT NULL DEFAULT 0,
  valid_from TIMESTAMPTZ,
  valid_until TIMESTAMPTZ,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by INTEGER REFERENCES kutumb_admin_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (discount_value IS NULL OR discount_value >= 0),
  CHECK (discount_type <> 'percent' OR discount_value <= 100)
);
CREATE INDEX IF NOT EXISTS idx_kutumb_event_codes_event ON kutumb_event_codes(event_id, active);
CREATE UNIQUE INDEX IF NOT EXISTS uq_kutumb_event_code_ci ON kutumb_event_codes(event_id, lower(code));

-- Optional simple reserved seating. General Admission does not need rows here.
CREATE TABLE IF NOT EXISTS kutumb_event_seats (
  id BIGSERIAL PRIMARY KEY,
  event_id TEXT NOT NULL,
  organisation_id INTEGER NOT NULL DEFAULT 1,
  section_name TEXT NOT NULL DEFAULT 'Main',
  row_label TEXT NOT NULL,
  seat_label TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available','reserved','sold','blocked')),
  attendee_id INTEGER REFERENCES kutumb_attendees(id) ON DELETE SET NULL,
  UNIQUE(event_id, section_name, row_label, seat_label)
);
CREATE INDEX IF NOT EXISTS idx_kutumb_event_seats_availability ON kutumb_event_seats(event_id,status);

CREATE TABLE IF NOT EXISTS kutumb_event_seating_settings (
  event_id TEXT PRIMARY KEY,
  organisation_id INTEGER NOT NULL DEFAULT 1,
  preset TEXT NOT NULL CHECK (preset IN ('tables','reserved_seats')),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
