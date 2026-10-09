-- Central Kutumb collection account with an organisation-level liability ledger.
-- Positive amounts are receipts; negative amounts are refunds, fees or transfers.
ALTER TABLE kutumb_donation_payments
  ADD COLUMN IF NOT EXISTS organisation_id INTEGER REFERENCES kutumb_organisations(id) ON DELETE RESTRICT;
UPDATE kutumb_donation_payments p SET organisation_id=d.organisation_id
FROM kutumb_donations d WHERE d.id=p.donation_id AND p.organisation_id IS NULL;

CREATE TABLE IF NOT EXISTS kutumb_settlement_ledger (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES kutumb_organisations(id) ON DELETE RESTRICT,
  entry_type TEXT NOT NULL CHECK (entry_type IN ('ticket_payment','donation_payment','ticket_refund','donation_refund','processor_fee','manual_transfer','adjustment')),
  amount NUMERIC(14,2) NOT NULL CHECK (amount <> 0),
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  provider_reference TEXT,
  note TEXT,
  recorded_by_admin_id INTEGER REFERENCES kutumb_admin_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (entry_type, source_type, source_id)
);
CREATE INDEX IF NOT EXISTS idx_settlement_ledger_org_date ON kutumb_settlement_ledger(organisation_id, created_at DESC);

CREATE TABLE IF NOT EXISTS kutumb_charity_transfers (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES kutumb_organisations(id) ON DELETE RESTRICT,
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  transferred_at DATE NOT NULL DEFAULT CURRENT_DATE,
  bank_reference TEXT NOT NULL,
  recipient_note TEXT,
  recorded_by_admin_id INTEGER REFERENCES kutumb_admin_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Backfill only provider-confirmed transactions. Donor-claimed bank transfers
-- remain outside this ledger until verified through bank reconciliation.
INSERT INTO kutumb_settlement_ledger (organisation_id,entry_type,amount,source_type,source_id,provider_reference,note,created_at)
SELECT organisation_id,'ticket_payment',total_cents::numeric/100,'ticket_order',id::text,stripe_payment_intent,'Backfilled confirmed ticket payment',created_at
FROM kutumb_orders WHERE status='paid' AND stripe_payment_intent IS NOT NULL AND total_cents > 0
ON CONFLICT (entry_type,source_type,source_id) DO NOTHING;
INSERT INTO kutumb_settlement_ledger (organisation_id,entry_type,amount,source_type,source_id,provider_reference,note,created_at)
SELECT p.organisation_id,'donation_payment',p.amount,'donation_payment',p.id::text,p.provider_reference,'Backfilled confirmed donation payment',p.created_at
FROM kutumb_donation_payments p WHERE p.status='paid' AND p.amount > 0
ON CONFLICT (entry_type,source_type,source_id) DO NOTHING;
