import { pool } from "../db/pool.js";
import { getAttendeesForRegistration, syncRegistrationAttendees } from "./attendees.js";
import { sendEventTicketsEmail } from "./mailer.js";
import { slugify } from "./slugify.js";
import { generateQrPngBuffer, buildEventTicketsPdf } from "./membershipCard.js";

/**
 * Sends the QR ticket email for a registration — one ticket per attendee
 * (the registrant, each additional adult, each child) — but only once,
 * and only for a registration that's actually confirmed.
 *
 * Called from every place a registration can become "confirmed": free at
 * signup, card/Square/PayPal payment, a fully-covering coupon, or an
 * admin's bank-transfer verification. Those are independent code paths
 * (webhooks, return-page polls, admin edits can all race or overlap), so
 * this claims the send atomically — `tickets_sent_at IS NULL` in the WHERE
 * clause means only the first caller to reach this for a given
 * registration ever gets a non-empty result back, and every other/later
 * caller is a safe no-op. Safe to call speculatively; it only actually
 * emails anyone the first time.
 */
export async function sendEventTickets(registrationId) {
  try {
    const { rows: claimed } = await pool.query(
      `UPDATE kutumb_event_registrations
       SET tickets_sent_at = now()
       WHERE id = $1 AND registration_status = 'confirmed' AND tickets_sent_at IS NULL
       RETURNING *`,
      [registrationId]
    );
    const registration = claimed[0];
    if (!registration) return; // not confirmed yet, or tickets already sent

    let attendeeRows = await getAttendeesForRegistration(registrationId);
    if (attendeeRows.length === 0) {
      // A registration created outside the normal signup flow (legacy or
      // imported rows) can have no per-person QR rows yet. The claim above has
      // already landed, so bailing out here would mean tickets are marked
      // sent but never go out — build the attendee list from the
      // registration's headcount instead (idempotent), then carry on.
      await syncRegistrationAttendees(pool, registration);
      attendeeRows = await getAttendeesForRegistration(registrationId);
    }
    if (attendeeRows.length === 0) {
      console.error(`No attendees found for registration ${registrationId} — skipping ticket email`);
      return;
    }

    const attendees = await Promise.all(
      attendeeRows.map(async (a) => ({
        name: a.name,
        category: a.category,
        qrPngBuffer: await generateQrPngBuffer(a.qr_token),
      }))
    );

    const ticketsPdfBuffer = await buildEventTicketsPdf({
      eventName: registration.event_name,
      eventDate: null,
      registrationNumber: registration.registration_number,
      attendees,
    });

    await sendEventTicketsEmail({
      to: registration.email,
      name: registration.name,
      eventName: registration.event_name,
      registrationNumber: registration.registration_number,
      attendees,
      ticketsPdfBuffer,
    });
  } catch (err) {
    // Best-effort, same as every other confirmation email in this app —
    // a ticket-email failure must never break the payment/registration
    // flow that triggered it. tickets_sent_at is left set (the claim
    // already landed) so a transient failure doesn't cause a retry loop;
    // an admin can always be asked to trigger a manual resend if needed.
    console.error(`Failed to send tickets for registration ${registrationId}:`, err);
  }
}

/** Send the existing QR/PDF ticket email for a paid ticket-engine order once. */
export async function sendTicketOrderTickets(orderId) {
  try {
    const { rows: claimed } = await pool.query(
      `UPDATE kutumb_orders SET ticket_email_sent_at=now()
       WHERE id=$1 AND status='paid' AND ticket_email_sent_at IS NULL RETURNING *`, [orderId]
    );
    const order = claimed[0];
    if (!order) return;
    const { rows: eventRows } = await pool.query("SELECT title,date_text FROM kutumb_upcoming_events");
    const event = eventRows.find((row) => slugify(row.title) === order.event_id);
    const { rows } = await pool.query(
      `SELECT a.name,a.qr_token,tt.name AS ticket_type_name FROM kutumb_attendees a
       JOIN kutumb_order_items oi ON oi.id=a.order_item_id JOIN kutumb_ticket_types tt ON tt.id=oi.ticket_type_id
       WHERE oi.order_id=$1 AND a.ticket_status='active' ORDER BY a.id`, [orderId]
    );
    if (!rows.length) return;
    const attendees = await Promise.all(rows.map(async (a) => ({ name: a.name || order.buyer_name, category: a.ticket_type_name, qrPngBuffer: await generateQrPngBuffer(a.qr_token) })));
    const eventName = event?.title || order.event_id;
    const pdf = await buildEventTicketsPdf({ eventName, eventDate: event?.date_text || null, registrationNumber: `Order ${order.id}`, attendees });
    await sendEventTicketsEmail({ to: order.buyer_email, name: order.buyer_name, eventName, eventDate: event?.date_text || null, registrationNumber: `Order ${order.id}`, attendees, ticketsPdfBuffer: pdf });
  } catch (err) { console.error(`Failed to send tickets for ticket order ${orderId}:`, err); }
}

/**
 * Builds the QR tickets PDF for a confirmed registration without sending
 * anything or touching tickets_sent_at — used to re-attach the tickets to
 * the day-before welcome email (so nobody has to dig out the original).
 * Returns null if there are no attendees.
 */
export async function buildTicketsPdfForRegistration(registration, eventDate = null) {
  let attendeeRows = await getAttendeesForRegistration(registration.id);
  if (attendeeRows.length === 0) {
    await syncRegistrationAttendees(pool, registration);
    attendeeRows = await getAttendeesForRegistration(registration.id);
  }
  if (attendeeRows.length === 0) return null;
  const attendees = await Promise.all(
    attendeeRows.map(async (a) => ({
      name: a.name,
      category: a.category,
      qrPngBuffer: await generateQrPngBuffer(a.qr_token),
    }))
  );
  return buildEventTicketsPdf({
    eventName: registration.event_name,
    eventDate,
    registrationNumber: registration.registration_number,
    attendees,
  });
}
