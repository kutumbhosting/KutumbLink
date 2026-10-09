-- Fundraising toolkit: public auctions, paid memberships, online stores,
-- reusable donor segments, and consent-aware email campaigns.

ALTER TABLE kutumb_auction_items
  ADD COLUMN IF NOT EXISTS slug TEXT,
  ADD COLUMN IF NOT EXISTS minimum_increment NUMERIC(12,2) NOT NULL DEFAULT 1 CHECK (minimum_increment > 0),
  ADD COLUMN IF NOT EXISTS starts_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ends_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS winner_email TEXT,
  ADD COLUMN IF NOT EXISTS winner_token_hash TEXT,
  ADD COLUMN IF NOT EXISTS winner_token_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS stripe_session_id TEXT,
  ADD COLUMN IF NOT EXISTS stripe_payment_intent TEXT;
UPDATE kutumb_auction_items SET slug = 'auction-' || id WHERE slug IS NULL OR slug = '';
CREATE UNIQUE INDEX IF NOT EXISTS uq_kutumb_auction_slug ON kutumb_auction_items(slug);

CREATE TABLE IF NOT EXISTS kutumb_auction_bids (
  id BIGSERIAL PRIMARY KEY,
  auction_id BIGINT NOT NULL REFERENCES kutumb_auction_items(id) ON DELETE CASCADE,
  organisation_id INTEGER NOT NULL REFERENCES kutumb_organisations(id) ON DELETE RESTRICT,
  bidder_name TEXT NOT NULL,
  bidder_email TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  status TEXT NOT NULL DEFAULT 'leading' CHECK (status IN ('leading','outbid','won','lost','cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_kutumb_auction_bids_top ON kutumb_auction_bids(auction_id, amount DESC, created_at ASC);

CREATE TABLE IF NOT EXISTS kutumb_store_products (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES kutumb_organisations(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT,
  price NUMERIC(12,2) NOT NULL CHECK (price > 0),
  stock_on_hand INTEGER NOT NULL CHECK (stock_on_hand >= 0),
  stock_reserved INTEGER NOT NULL DEFAULT 0 CHECK (stock_reserved >= 0 AND stock_reserved <= stock_on_hand),
  requires_shipping BOOLEAN NOT NULL DEFAULT FALSE,
  shipping_fee NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (shipping_fee >= 0),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','paused','sold_out')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, slug)
);
CREATE INDEX IF NOT EXISTS idx_kutumb_store_products_public ON kutumb_store_products(organisation_id,status);

CREATE TABLE IF NOT EXISTS kutumb_store_orders (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES kutumb_organisations(id) ON DELETE RESTRICT,
  buyer_name TEXT NOT NULL,
  buyer_email TEXT NOT NULL,
  total_amount NUMERIC(12,2) NOT NULL CHECK (total_amount > 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','expired','refunded','cancelled')),
  stripe_session_id TEXT UNIQUE,
  stripe_payment_intent TEXT,
  shipping_details JSONB NOT NULL DEFAULT '{}'::jsonb,
  fulfilment_status TEXT NOT NULL DEFAULT 'unfulfilled' CHECK (fulfilment_status IN ('unfulfilled','fulfilled','cancelled','refunded')),
  inventory_released_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS kutumb_store_order_items (
  id BIGSERIAL PRIMARY KEY,
  order_id BIGINT NOT NULL REFERENCES kutumb_store_orders(id) ON DELETE CASCADE,
  product_id BIGINT NOT NULL REFERENCES kutumb_store_products(id) ON DELETE RESTRICT,
  product_name TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price NUMERIC(12,2) NOT NULL CHECK (unit_price > 0)
);
CREATE INDEX IF NOT EXISTS idx_kutumb_store_orders_org ON kutumb_store_orders(organisation_id,created_at DESC);

CREATE TABLE IF NOT EXISTS kutumb_membership_tiers (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES kutumb_organisations(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  billing_interval TEXT NOT NULL CHECK (billing_interval IN ('month','year')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','paused')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organisation_id,slug)
);
CREATE TABLE IF NOT EXISTS kutumb_paid_memberships (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES kutumb_organisations(id) ON DELETE RESTRICT,
  tier_id BIGINT NOT NULL REFERENCES kutumb_membership_tiers(id) ON DELETE RESTRICT,
  supporter_id BIGINT REFERENCES kutumb_supporters(id) ON DELETE SET NULL,
  member_name TEXT NOT NULL,
  member_email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','past_due','cancelled','expired')),
  stripe_session_id TEXT UNIQUE,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT UNIQUE,
  current_period_end TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_kutumb_paid_memberships_org ON kutumb_paid_memberships(organisation_id,status,created_at DESC);

CREATE TABLE IF NOT EXISTS kutumb_donor_segments (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES kutumb_organisations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  criteria JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by_admin_id INTEGER REFERENCES kutumb_admin_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organisation_id,name)
);
CREATE TABLE IF NOT EXISTS kutumb_email_campaigns (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES kutumb_organisations(id) ON DELETE CASCADE,
  segment_id BIGINT REFERENCES kutumb_donor_segments(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  subject TEXT NOT NULL,
  body_text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','scheduled','sending','sent','cancelled','failed')),
  send_at TIMESTAMPTZ,
  sent_count INTEGER NOT NULL DEFAULT 0,
  opened_count INTEGER NOT NULL DEFAULT 0,
  clicked_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  created_by_admin_id INTEGER REFERENCES kutumb_admin_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_kutumb_email_campaigns_due ON kutumb_email_campaigns(status,send_at);
CREATE TABLE IF NOT EXISTS kutumb_email_campaign_recipients (
  campaign_id BIGINT NOT NULL REFERENCES kutumb_email_campaigns(id) ON DELETE CASCADE,
  supporter_id BIGINT NOT NULL REFERENCES kutumb_supporters(id) ON DELETE RESTRICT,
  tracking_token TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed','unsubscribed')),
  sent_at TIMESTAMPTZ,
  opened_at TIMESTAMPTZ,
  clicked_at TIMESTAMPTZ,
  click_count INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  PRIMARY KEY (campaign_id,supporter_id)
);

-- Include the added checkout types in the organisation liability ledger.
ALTER TABLE kutumb_settlement_ledger DROP CONSTRAINT IF EXISTS kutumb_settlement_ledger_entry_type_check;
ALTER TABLE kutumb_settlement_ledger ADD CONSTRAINT kutumb_settlement_ledger_entry_type_check
  CHECK (entry_type IN ('ticket_payment','donation_payment','ticket_refund','donation_refund',
    'store_payment','store_refund','auction_payment','auction_refund','membership_payment','membership_refund',
    'processor_fee','manual_transfer','adjustment'));
