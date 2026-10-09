// server/lib/reconciliationRun.js
//
// One reconciliation run for one event, independent of WHERE the bank
// credits came from. Used by both:
//   • POST /api/events/reconcile            — uploaded statement file
//   • the ledger (openfeed live NAB feed / Bank File Drop Box) via bankLedger.js
//
// Matches credits to registrations (paymentReconciliation.reconcile),
// flips Pending → Paid/confirmed where a credit covers the fee, emails
// confirmations/tickets, saves the run to kutumb_bank_reconciliations and
// returns the same JSON payload the admin UI already renders.

import { pool } from "../db/pool.js";
import { reconcile, groupAllocationsByRegistration } from "./paymentReconciliation.js";
import { sendEventPaymentConfirmationEmail } from "./mailer.js";
import { sendEventTickets } from "./tickets.js";

export function dbRowToRegistration(r) {
  return {
    id: r.id,
    eventName: r.event_name,
    eventYear: r.event_year,
    name: r.name,
    email: r.email,
    phone: r.phone,
    adults: r.adults,
    children: r.children,
    comments: r.comments,
    registrationNumber: r.registration_number,
    isMember: r.is_member,
    membershipNumber: r.membership_number,
    fee: Number(r.fee),
    perPersonFee: Number(r.per_person_fee),
    bankTransferred: r.bank_transferred,
    transactionNumber: r.transaction_number,
    paymentStatus: r.payment_status,
    registrationStatus: r.registration_status,
    paymentAmount: r.payment_amount !== null ? Number(r.payment_amount) : null,
    couponAmount: r.coupon_amount !== null && r.coupon_amount !== undefined ? Number(r.coupon_amount) : 0,
    paymentDate: r.payment_date,
    paymentMatchConfidence: r.payment_match_confidence,
    paymentMatchNote: r.payment_match_note,
    createdAt: r.created_at,
  };
}


/**
 * @param {{ eventName:string, eventYear:string,
 *           transactions:Array<{date:Date|null, amount:number, details:string, id?:string}>,
 *           sourceLabel:string, admin?:any }} args
 */
export async function runReconciliation({ eventName, eventYear, transactions, sourceLabel, admin }) {
  const { rows: dbRows } = await pool.query(
    "SELECT * FROM kutumb_event_registrations WHERE event_name = $1 AND event_year = $2 ORDER BY created_at",
    [eventName, eventYear]
  );
  if (dbRows.length === 0) {
    const err = new Error("No registrations found for this event");
    err.status = 404;
    throw err;
  }
  const registrations = dbRows.map(dbRowToRegistration);

  // A cancelled registration never claims a bank credit — a late payment
  // from a cancelled registrant shows up as unmatched for an admin to handle.
  const { allocations, unmatchedCredits } = reconcile(
    registrations.filter((r) => r.registrationStatus !== "cancelled"),
    transactions
  );
  const grouped = groupAllocationsByRegistration(allocations, (reg) => reg.id);

  // ── Apply updates. A bank credit that fully covers the fee is a VERIFIED
  // payment, so in one statement the registration becomes Paid AND
  // Confirmed, with its payment method set (previously only payment_status
  // changed, leaving a row showing "Paid" yet still "Pending Payment", with
  // no tickets). A credit that covers only part of the fee records the
  // amount, date and match but leaves the registration Pending — the same
  // convention card/coupon part-payments use — so a short payment never
  // confirms a registration or releases tickets by itself; an admin can
  // still mark it Paid by hand. Never overwrites a manually-entered
  // transaction number, and re-running the same statement can't double
  // count (amount/date are only filled when empty).
  const updatedRows = [];
  for (const reg of registrations) {
    const match = grouped.get(reg.id);
    if (!match) continue;

    const wasPaid = reg.paymentStatus === "Paid";
    const fee = Number(reg.fee) || 0;
    // Coupon part-payment + bank transfer for the balance: the only money on
    // file so far is the coupon and no bank credit has been matched before,
    // so this credit is the balance and is ADDED to the coupon amount (the
    // old COALESCE rule would have kept just the coupon and left the
    // registration Pending forever). Once matched, payment_match_confidence
    // is set, so re-running the same statement can't add it twice.
    const couponOnlySoFar =
      reg.couponAmount > 0 &&
      (reg.paymentAmount ?? 0) <= reg.couponAmount + 0.001 &&
      !reg.paymentMatchConfidence;
    const amountRecorded = couponOnlySoFar
      ? Math.round(((reg.paymentAmount ?? 0) + match.amount) * 100) / 100
      : reg.paymentAmount !== null ? reg.paymentAmount : match.amount;
    const coversFee = amountRecorded >= fee;
    const newStatus = wasPaid || coversFee ? "Paid" : reg.paymentStatus;

    const { rows } = await pool.query(
      `UPDATE kutumb_event_registrations SET
         payment_status = $1,
         registration_status = CASE WHEN $1 = 'Paid' THEN 'confirmed' ELSE registration_status END,
         payment_method = CASE WHEN $8 THEN 'bank_transfer'
                               WHEN $1 = 'Paid' THEN COALESCE(payment_method, 'bank_transfer')
                               ELSE payment_method END,
         payment_amount = CASE WHEN $8 THEN $9 ELSE COALESCE(payment_amount, $2) END,
         payment_date = COALESCE(payment_date, $3),
         payment_match_confidence = $4,
         payment_match_note = $5,
         transaction_number = CASE WHEN transaction_number IS NULL OR transaction_number = ''
                                    THEN $6 ELSE transaction_number END,
         bank_transferred = TRUE
       WHERE id = $7
       RETURNING *`,
      [newStatus, match.amount, match.date, match.confidence, match.reason, match.bankReference, reg.id, couponOnlySoFar, amountRecorded]
    );
    const finalRow = dbRowToRegistration(rows[0]);
    updatedRows.push({
      email: reg.email,
      name: reg.name,
      previousStatus: reg.paymentStatus,
      newStatus: finalRow.paymentStatus,
      amount: match.amount,
      confidence: match.confidence,
      partial: !wasPaid && !coversFee,
    });

    // Only when this run is what confirmed it. sendEventTickets has its
    // own one-time claim, so it's safe even if another path got there first.
    if (finalRow.registrationStatus === "confirmed" && reg.registrationStatus !== "confirmed") {
      sendEventPaymentConfirmationEmail({
        to: finalRow.email,
        name: finalRow.name,
        eventName: finalRow.eventName,
        registrationNumber: finalRow.registrationNumber,
        fee: finalRow.fee,
        transactionNumber: finalRow.transactionNumber || "Bank transfer",
      }).catch((err) => console.error("Reconciliation payment confirmation email error:", err));
      sendEventTickets(finalRow.id).catch((err) => console.error("Reconciliation ticket email error:", err));
    }
  }

  // Re-fetch fresh rows for the report (guarantees we reflect exactly
  // what's now in the DB, including rows that had no match at all).
  const { rows: freshDbRows } = await pool.query(
    "SELECT * FROM kutumb_event_registrations WHERE event_name = $1 AND event_year = $2 ORDER BY created_at",
    [eventName, eventYear]
  );
  const reportRows = freshDbRows.map(dbRowToRegistration).map((r) => {
    const match = grouped.get(r.id);
    return { ...r, bankReference: match ? match.bankReference : "" };
  });

  const dates = transactions.map((t) => t.date).filter(Boolean);
  const dateRange =
    dates.length > 0
      ? `${new Date(Math.min(...dates.map((d) => d.getTime()))).toLocaleDateString("en-AU")} – ${new Date(
          Math.max(...dates.map((d) => d.getTime()))
        ).toLocaleDateString("en-AU")}`
      : null;

  const summary = {
    totalRegistrations: registrations.length,
    totalTransactionsInFile: transactions.length,
    newlyMatched: updatedRows.filter((u) => u.previousStatus !== "Paid" && u.newStatus === "Paid").length,
    partialPayments: updatedRows.filter((u) => u.partial).length,
    alreadyPaid: registrations.filter((r) => r.paymentStatus === "Paid").length,
    stillUnpaid: reportRows.filter((r) => r.paymentStatus !== "Paid").length,
    amountMatched: reportRows.reduce((s, r) => s + (Number(r.paymentAmount) || 0), 0),
    unmatchedCreditsCount: unmatchedCredits.length,
    unmatchedCreditsValue: unmatchedCredits.reduce((s, u) => s + u.transaction.amount, 0),
    dateRange,
  };

  const reportPayload = {
    eventName,
    eventYear,
    uploadedFilename: sourceLabel,
    dateRange,
    rows: reportRows,
    unmatchedCredits,
  };

  const { rows: savedRun } = await pool.query(
    `INSERT INTO kutumb_bank_reconciliations (event_name, event_year, uploaded_filename, run_by, summary, report)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, run_at`,
    [
      eventName,
      eventYear,
      sourceLabel,
      admin?.email || admin?.name || null,
      JSON.stringify(summary),
      JSON.stringify(reportPayload),
    ]
  );

  return {
    allocations,
    message: `Reconciled ${transactions.length} bank credit(s) against ${registrations.length} registration(s): ${summary.newlyMatched} newly marked Paid${summary.partialPayments ? `, ${summary.partialPayments} part-payment(s) left Pending` : ""}.`,
    reconciliationId: savedRun[0].id,
    summary,
    updated: updatedRows,
    unmatchedCredits: unmatchedCredits.map((u) => ({
      date: u.transaction.date,
      amount: u.transaction.amount,
      details: u.transaction.raw,
      classification: u.classification,
    })),
  };
}
