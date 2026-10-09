import { pool } from "../db/pool.js";
import { sendEventPaymentConfirmationEmail } from "./mailer.js";
import { sendEventTickets } from "./tickets.js";

/** One row per checkout attempt, so a webhook/return-page poll can find the
 *  right registration to update. */
export async function recordPaymentAttempt(registrationId, provider, providerReference, amount) {
  const { rows } = await pool.query(
    `INSERT INTO kutumb_registration_payments (registration_id, provider, provider_reference, amount, status, organisation_id)
     SELECT r.id, $2, $3, $4, 'pending', r.organisation_id
     FROM kutumb_event_registrations r WHERE r.id = $1 RETURNING *`,
    [registrationId, provider, providerReference, amount]
  );
  return rows[0];
}

export async function findPaymentByReference(provider, providerReference) {
  const { rows } = await pool.query(
    "SELECT * FROM kutumb_registration_payments WHERE provider = $1 AND provider_reference = $2",
    [provider, providerReference]
  );
  return rows[0] || null;
}

export async function getPayment(paymentId) {
  const { rows } = await pool.query("SELECT * FROM kutumb_registration_payments WHERE id = $1", [paymentId]);
  return rows[0] || null;
}

/**
 * Marks one payment attempt — and, if it now fully or partially covers the
 * fee, the registration itself — as paid. Idempotent and race-safe: row
 * locks the payment first, so a webhook and a return-page poll that both
 * fire for the same payment can never double-count it (the second call
 * sees status already 'paid' and does nothing further).
 */
export async function markPaymentPaid(paymentId, rawStatus, transactionRef) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      "SELECT * FROM kutumb_registration_payments WHERE id = $1 FOR UPDATE",
      [paymentId]
    );
    const payment = rows[0];
    if (!payment) {
      await client.query("ROLLBACK");
      return null;
    }
    if (payment.status === "paid") {
      await client.query("COMMIT");
      return payment; // already handled by an earlier webhook/poll
    }

    await client.query(
      "UPDATE kutumb_registration_payments SET status = 'paid', raw_status = $1, updated_at = now() WHERE id = $2",
      [rawStatus || null, paymentId]
    );

    const { rows: regRows } = await client.query(
      "SELECT * FROM kutumb_event_registrations WHERE id = $1 FOR UPDATE",
      [payment.registration_id]
    );
    const registration = regRows[0];
    let fullyPaid = false;
    let updatedRegistration = null;
    if (registration) {
      const alreadyPaid = Number(registration.payment_amount) || 0;
      const newAmountPaid = alreadyPaid + Number(payment.amount);
      const fee = Number(registration.fee) || 0;
      fullyPaid = newAmountPaid >= fee;
      const { rows: updated } = await client.query(
        `UPDATE kutumb_event_registrations SET
           payment_amount = $1,
           payment_date = now(),
           payment_method = $2,
           transaction_number = COALESCE(transaction_number, $3),
           payment_status = CASE WHEN $4 THEN 'Paid' ELSE payment_status END,
           registration_status = CASE WHEN $4 THEN 'confirmed' ELSE registration_status END
         WHERE id = $5 RETURNING *`,
        [newAmountPaid, payment.provider, transactionRef || null, fullyPaid, registration.id]
      );
      updatedRegistration = updated[0];
    }

    await client.query("COMMIT");

    if (fullyPaid && updatedRegistration) {
      sendEventPaymentConfirmationEmail({
        to: updatedRegistration.email,
        name: updatedRegistration.name,
        eventName: updatedRegistration.event_name,
        registrationNumber: updatedRegistration.registration_number,
        fee: Number(updatedRegistration.fee),
        transactionNumber: transactionRef || `${payment.provider} payment`,
      }).catch((err) => console.error(`${payment.provider} payment confirmation email error:`, err));

      sendEventTickets(updatedRegistration.id).catch((err) => console.error("Ticket email error:", err));
    }

    return payment;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function markPaymentFailed(paymentId, rawStatus) {
  await pool.query(
    "UPDATE kutumb_registration_payments SET status = 'failed', raw_status = $1, updated_at = now() WHERE id = $2 AND status = 'pending'",
    [rawStatus || null, paymentId]
  );
}
