import { pool } from "../db/pool.js";
import { sendDonationThankYouEmail } from "./mailer.js";

export async function recordDonationPaymentAttempt(donationId, provider, providerReference, amount) {
  const { rows } = await pool.query(
    `INSERT INTO kutumb_donation_payments (donation_id, provider, provider_reference, amount, status, organisation_id)
     SELECT d.id, $2, $3, $4, 'pending', d.organisation_id
     FROM kutumb_donations d WHERE d.id = $1 RETURNING *`,
    [donationId, provider, providerReference, amount]
  );
  return rows[0];
}

export async function findDonationPaymentByReference(provider, providerReference) {
  const { rows } = await pool.query(
    "SELECT * FROM kutumb_donation_payments WHERE provider = $1 AND provider_reference = $2",
    [provider, providerReference]
  );
  return rows[0] || null;
}

export async function getDonationPayment(paymentId) {
  const { rows } = await pool.query("SELECT * FROM kutumb_donation_payments WHERE id = $1", [paymentId]);
  return rows[0] || null;
}

/**
 * Marks one donation payment attempt — and the donation itself — as paid.
 * Idempotent and race-safe (row-locked), same pattern as
 * registrationPayments.js's markPaymentPaid: a webhook and a return-page
 * poll firing for the same payment can never double-send the confirmation
 * email or double-process anything.
 */
export async function markDonationPaymentPaid(paymentId, rawStatus, transactionRef) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      "SELECT * FROM kutumb_donation_payments WHERE id = $1 FOR UPDATE",
      [paymentId]
    );
    const payment = rows[0];
    if (!payment) {
      await client.query("ROLLBACK");
      return null;
    }
    if (payment.status === "paid") {
      await client.query("COMMIT");
      return payment; // already handled
    }

    await client.query(
      "UPDATE kutumb_donation_payments SET status = 'paid', raw_status = $1, updated_at = now() WHERE id = $2",
      [rawStatus || null, paymentId]
    );

    const { rows: donRows } = await client.query(
      `UPDATE kutumb_donations SET
         payment_status = 'Paid',
         payment_method = $1,
         transaction_number = COALESCE(transaction_number, $2)
       WHERE id = $3 RETURNING *`,
      [payment.provider, transactionRef || null, payment.donation_id]
    );

    if (Number(payment.amount) > 0 && donRows[0]) {
      await client.query(
        `INSERT INTO kutumb_settlement_ledger (organisation_id,entry_type,amount,source_type,source_id,provider_reference,note)
         VALUES ($1,'donation_payment',$2,'donation_payment',$3,$4,'Donation received into the Kutumb account')
         ON CONFLICT (entry_type,source_type,source_id) DO NOTHING`,
        [payment.organisation_id || donRows[0].organisation_id || 1, Number(payment.amount), String(payment.id), transactionRef || payment.provider_reference || null]
      );
    }

    await client.query("COMMIT");

    const donation = donRows[0];
    if (donation) {
      sendDonationThankYouEmail({
        to: donation.email,
        name: donation.name,
        amount: Number(donation.amount),
        membershipNumber: donation.membership_number,
        paid: true,
        bankTransferred: false,
        transactionNumber: transactionRef || `${payment.provider} payment`,
      }).catch((err) => console.error("Donation payment confirmation email error:", err));
    }

    return payment;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function markDonationPaymentFailed(paymentId, rawStatus) {
  await pool.query(
    "UPDATE kutumb_donation_payments SET status = 'failed', raw_status = $1, updated_at = now() WHERE id = $2 AND status = 'pending'",
    [rawStatus || null, paymentId]
  );
}
