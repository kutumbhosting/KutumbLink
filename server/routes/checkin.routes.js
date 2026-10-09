import { Router } from "express";
import { pool } from "../db/pool.js";
import { requireAdmin, requireKutumbAdminOrCheckinSession } from "../lib/auth.js";
import { logAudit } from "../lib/audit.js";
import {
  generateCheckinCodes,
  listCheckinCodeBatches,
  updateCheckinCodeExpiry,
  deleteCheckinCodeBatch,
} from "../lib/checkinCodes.js";
import { sendCheckinCodesEmail } from "../lib/mailer.js";

const router = Router();

// Who is performing this check-in? A code session records the volunteer's
// typed name plus the code they logged in with; a real admin session records
// the admin's email (code is null).
function checkinActor(req) {
  if (req.admin?.scope === "checkin_code") {
    return { by: req.admin.name || "Unknown volunteer", code: req.admin.checkinCode || null };
  }
  return { by: req.admin?.email || null, code: null };
}

// A temporary check-in code's session (see server/lib/auth.js) is allowed
// through every route in this file — scanning tickets and viewing the
// attendee list is exactly what those codes are for. Generating new codes
// (below) is deliberately re-guarded with the stricter requireAdmin, since
// that's an admin-only action, not something a check-in session itself
// should be able to do.
router.use(requireKutumbAdminOrCheckinSession);

// Generates 5 fresh single-use login codes for one event and emails them to
// info@kutumb.org.au. Admin-only (not usable from a check-in-code session).
router.post("/generate-codes", requireAdmin, async (req, res) => {
  try {
    const { eventName, eventYear, eventDateText } = req.body || {};
    if (!eventName) return res.status(400).json({ message: "eventName is required" });

    const { codes, expiresAt } = await generateCheckinCodes({
      eventName,
      eventYear,
      eventDateText,
      createdBy: req.admin?.email,
    });

    const sent = await sendCheckinCodesEmail({
      to: "info@kutumb.org.au",
      eventName,
      eventYear,
      eventDateText,
      codes,
      expiresAt,
    });

    await logAudit(req.admin, "checkin.generate_codes", eventName, { count: codes.length, expiresAt, emailSent: sent.sent });

    res.json({ codes, expiresAt, emailSent: sent.sent, emailError: sent.sent ? undefined : sent.error });
  } catch (err) {
    console.error("GENERATE CHECKIN CODES ERROR:", err);
    res.status(500).json({ message: "Failed to generate check-in codes" });
  }
});

// Lists every currently-issued batch of door-volunteer codes, across all
// events, for the management table on the admin Check-in page. Admin-only.
router.get("/codes", requireAdmin, async (req, res) => {
  try {
    const batches = await listCheckinCodeBatches();
    res.json(batches);
  } catch (err) {
    console.error("LIST CHECKIN CODES ERROR:", err);
    res.status(500).json({ message: "Failed to load check-in codes" });
  }
});

// Edits a batch's expiry date/time (e.g. an event overran). eventName/
// eventYear are sent in the body rather than the URL since event names can
// contain characters ('/', etc.) that don't survive as a path segment.
router.put("/codes/update-expiry", requireAdmin, async (req, res) => {
  try {
    const { eventName, eventYear, expiresAt } = req.body || {};
    if (!eventName || !expiresAt) return res.status(400).json({ message: "eventName and expiresAt are required" });

    const count = await updateCheckinCodeExpiry({ eventName, eventYear, expiresAt });
    if (!count) return res.status(404).json({ message: "No codes found for this event" });

    await logAudit(req.admin, "checkin.codes.update_expiry", eventName, { eventYear, expiresAt });
    res.json({ message: "Updated", expiresAt });
  } catch (err) {
    console.error("UPDATE CHECKIN CODES ERROR:", err);
    res.status(500).json({ message: "Failed to update the expiry date" });
  }
});

// Deletes an entire batch of codes for an event immediately.
router.post("/codes/delete", requireAdmin, async (req, res) => {
  try {
    const { eventName, eventYear } = req.body || {};
    if (!eventName) return res.status(400).json({ message: "eventName is required" });

    const count = await deleteCheckinCodeBatch({ eventName, eventYear });
    await logAudit(req.admin, "checkin.codes.delete", eventName, { eventYear, count });
    res.json({ message: "Deleted", count });
  } catch (err) {
    console.error("DELETE CHECKIN CODES ERROR:", err);
    res.status(500).json({ message: "Failed to delete the codes" });
  }
});

// Every attendee, from BOTH the Stripe-ticketing system (kutumb_attendees)
// and the main Event Registration table's individual attendees
// (kutumb_registration_attendees), normalized into one shape so the
// Check-in page can show/scan either kind side by side. `id` is prefixed
// per source so the two tables' own numeric ids can never collide.
router.get("/:eventId/attendees", async (req, res) => {
  const { rows: ticketed } = await pool.query(
    `SELECT a.id, a.name, a.email, a.qr_token, a.checked_in_at, a.checked_in_by, a.checked_in_code, tt.name AS ticket_type_name
     FROM kutumb_attendees a
     JOIN kutumb_order_items oi ON oi.id = a.order_item_id
     JOIN kutumb_ticket_types tt ON tt.id = oi.ticket_type_id
     WHERE a.event_id = $1
     ORDER BY a.name`,
    [req.params.eventId]
  );

  // Registration attendees are keyed by event_name (not the ticketing
  // system's slug), so match case-insensitively against every event whose
  // slugified title equals :eventId.
  const { rows: regAttendees } = await pool.query(
    `SELECT ra.id, ra.name, ra.category, ra.qr_token, ra.checked_in_at, ra.checked_in_by, ra.checked_in_code,
            r.email, r.registration_number, r.payment_status, r.registration_status
     FROM kutumb_registration_attendees ra
     JOIN kutumb_event_registrations r ON r.id = ra.registration_id
     WHERE lower(replace(regexp_replace(r.event_name, '[^a-zA-Z0-9\\s-]', '', 'g'), ' ', '-')) = lower($1)
     ORDER BY ra.name`,
    [req.params.eventId]
  );

  const merged = [
    ...ticketed.map((a) => ({
      id: `tkt:${a.id}`,
      name: a.name,
      email: a.email,
      ticket_type_name: a.ticket_type_name,
      checked_in_at: a.checked_in_at,
      checked_in_by: a.checked_in_by,
      checked_in_code: a.checked_in_code,
      source: "ticket",
    })),
    ...regAttendees.map((a) => ({
      id: `reg:${a.id}`,
      name: a.name,
      email: a.email,
      ticket_type_name:
        a.category === "primary_adult" ? "Registrant"
        : a.category === "adult" ? "Additional Adult"
        : a.category === "child_under5" ? "Child (Under 5)"
        : "Child (5+)",
      checked_in_at: a.checked_in_at,
      checked_in_by: a.checked_in_by,
      checked_in_code: a.checked_in_code,
      registrationNumber: a.registration_number,
      paymentStatus: a.payment_status,
      registrationStatus: a.registration_status,
      source: "registration",
    })),
  ];

  res.json(merged);
});

async function findByToken(qrToken) {
  const { rows: reg } = await pool.query(
    `SELECT ra.*, r.registration_number, r.payment_status, r.registration_status, r.event_name, r.event_year
     FROM kutumb_registration_attendees ra
     JOIN kutumb_event_registrations r ON r.id = ra.registration_id
     WHERE ra.qr_token = $1`,
    [qrToken]
  );
  if (reg[0]) return { source: "registration", row: reg[0] };

  const { rows: tkt } = await pool.query("SELECT * FROM kutumb_attendees WHERE qr_token = $1 AND ticket_status = 'active'", [qrToken]);
  if (tkt[0]) return { source: "ticket", row: tkt[0] };

  return null;
}

// Marks one attendee (either source) checked in — but ONLY if they aren't
// already, atomically. The check ("is this person already checked in?")
// and the write happen as a single UPDATE ... WHERE checked_in_at IS NULL,
// not a separate SELECT followed by an UPDATE. That matters: two scans of
// the exact same QR code arriving close together (two check-in stations, a
// flaky connection retrying, someone tapping twice, or the same ticket
// photographed and reused) must never both succeed. With a read-then-write
// pattern, both requests can read "not checked in yet" before either write
// lands, and both go through. A single conditional UPDATE doesn't have
// that gap — Postgres serializes concurrent writes to the same row, so
// whichever request's UPDATE reaches the database first wins and flips the
// row; the second one's WHERE clause no longer matches (checked_in_at is
// no longer null) and it updates zero rows, which is what we check below.
// `override: true` is the only way to check someone in again after that —
// a deliberate admin action, not something that can happen by accident.
async function markCheckedIn({ source, id, checkedInBy, checkedInCode, override }) {
  if (source === "registration") {
    const query = override
      ? `UPDATE kutumb_registration_attendees SET checked_in_at = now(), checked_in_by = $1, checked_in_code = $3
         WHERE id = $2 RETURNING *`
      : `UPDATE kutumb_registration_attendees SET checked_in_at = now(), checked_in_by = $1, checked_in_code = $3
         WHERE id = $2 AND checked_in_at IS NULL RETURNING *`;
    const { rows } = await pool.query(query, [checkedInBy, id, checkedInCode]);
    return rows[0] || null;
  }

  const query = override
    ? `UPDATE kutumb_attendees SET checked_in_at = now(), checked_in_by = $2, checked_in_code = $3 WHERE id = $1 RETURNING *`
    : `UPDATE kutumb_attendees SET checked_in_at = now(), checked_in_by = $2, checked_in_code = $3 WHERE id = $1 AND checked_in_at IS NULL RETURNING *`;
  const { rows } = await pool.query(query, [id, checkedInBy, checkedInCode]);
  return rows[0] || null;
}

// Scan a QR token (from either source). `override: true` lets an
// authorised admin deliberately re-check-in someone already checked in
// (e.g. correcting an accidental duplicate scan) instead of silently
// blocking every re-scan.
router.post("/scan", async (req, res) => {
  const { qrToken, override } = req.body;
  if (!qrToken) return res.status(400).json({ message: "qrToken is required" });

  const found = await findByToken(qrToken);
  if (!found) return res.status(404).json({ message: "No ticket/attendee found for this QR code" });
  const { source, row } = found;

  const actor = checkinActor(req);
  const updated = await markCheckedIn({ source, id: row.id, checkedInBy: actor.by, checkedInCode: actor.code, override });

  if (!updated) {
    // The conditional UPDATE matched nothing — someone (possibly a
    // concurrent scan of this same code) already checked this row in.
    // Re-fetch the current state so the "already checked in at ..."
    // message reflects reality even if it was a race, not just a re-scan.
    const current = await findByToken(qrToken);
    const currentRow = current?.row || row;
    return res.status(409).json({
      message: `Already checked in at ${new Date(currentRow.checked_in_at).toLocaleTimeString()}`,
      attendee: currentRow,
      source,
      canOverride: true,
    });
  }

  await logAudit(req.admin, "checkin.scan", source === "registration" ? row.event_name : row.event_id, {
    attendeeId: row.id,
    registrationNumber: source === "registration" ? row.registration_number : undefined,
    override: !!override,
    checkedInBy: actor.by,
    code: actor.code,
  });

  res.json({
    message: "Checked in",
    attendee:
      source === "registration"
        ? { ...updated, registration_number: row.registration_number, payment_status: row.payment_status, registration_status: row.registration_status }
        : updated,
    source,
  });
});

// Manual check-in from the attendee list, id is "tkt:<id>" or "reg:<id>".
// Same atomic guard as /scan, and the same override escape hatch — the
// attendee list normally hides the "Check in" button once someone is
// already checked in, but the guard here is what actually enforces it
// server-side against a stale list, a double-click, or two admins acting
// on the same row at once.
router.post("/manual/:attendeeId", async (req, res) => {
  const raw = req.params.attendeeId;
  const [prefix, idStr] = raw.includes(":") ? raw.split(":") : ["tkt", raw];
  const id = Number(idStr);
  const source = prefix === "reg" ? "registration" : "ticket";
  const override = !!req.body?.override;

  const actor = checkinActor(req);
  const updated = await markCheckedIn({ source, id, checkedInBy: actor.by, checkedInCode: actor.code, override });

  if (!updated) {
    // Either the attendee doesn't exist, or (far more likely) they're
    // already checked in — tell those apart so the admin isn't shown a
    // misleading "not found" for someone who simply beat them to it.
    const table = source === "registration" ? "kutumb_registration_attendees" : "kutumb_attendees";
    const { rows: existing } = await pool.query(`SELECT * FROM ${table} WHERE id = $1`, [id]);
    if (!existing[0]) return res.status(404).json({ message: "Attendee not found" });
    return res.status(409).json({
      message: `Already checked in at ${new Date(existing[0].checked_in_at).toLocaleTimeString()}`,
      attendee: existing[0],
      source,
      canOverride: true,
    });
  }

  await logAudit(req.admin, "checkin.manual", source === "registration" ? updated.event_name : updated.event_id, {
    attendeeId: id,
    override,
    checkedInBy: actor.by,
    code: actor.code,
  });
  res.json({ message: "Checked in", attendee: updated });
});

export default router;
