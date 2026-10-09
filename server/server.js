import "dotenv/config";
import crypto from "crypto";
import express from "express";
import cookieParser from "cookie-parser";
import fs from "fs";
import path from "path";
import cors from "cors";
import multer from "multer";
import { fileURLToPath } from "url";
import fileManagerRoutes from "./routes/filemanager.js";
import manualsRoutes, { servePublicManual, PUBLIC_MANUAL_PATH } from "./routes/manuals.routes.js";
import pastEventsRouter from "./routes/pastEventsRoute.js";
import { getNextMembershipNumber } from "./lib/counters.js";
import { getNextRegistrationNumber, resolveEventCode } from "./lib/registrationNumber.js";
import { CANCELLED_MESSAGE, startRegistrationScheduler } from "./lib/registrationScheduler.js";
import { generateQrDataUrl, generateQrPngBuffer, buildCardPdf } from "./lib/membershipCard.js";
import {
  sendMembershipConfirmationEmail,
  sendEventConfirmationEmail,
  sendEventPaymentConfirmationEmail,
  sendBankTransferReceivedEmail,
  sendDonationThankYouEmail,
  checkEmailConfig,
  sendTestEmail,
  sendBulkEmail,
} from "./lib/mailer.js";
import { sendWhatsAppDocument } from "./lib/whatsapp.js";
import { parseEventEndDate, sortPastEventsDescending } from "./lib/eventDates.js";
import { requireAdmin, requireSuperAdmin } from "./lib/auth.js";
import { getPaymentMethodSettings, getSetting } from "./lib/settings.js";
import { getStripe } from "./lib/stripeClient.js";
import { getPublicBaseUrl, getConfiguredPublicBaseUrl, isLocalUrl } from "./lib/publicUrl.js";
import {
  recordDonationPaymentAttempt,
  findDonationPaymentByReference,
  getDonationPayment,
  markDonationPaymentPaid,
  markDonationPaymentFailed,
} from "./lib/donationPayments.js";
import { pool } from "./db/pool.js";
import adminAuthRoutes from "./routes/adminAuth.routes.js";
import organisationsRoutes from "./routes/organisations.routes.js";
import fundraisingRoutes from "./routes/fundraising.routes.js";
import fundraisingToolsRoutes, { processDueFundraisingEmails } from "./routes/fundraisingTools.routes.js";
import supporterPortalRoutes from "./routes/supporterPortal.routes.js";
import adminConsoleRoutes from "./routes/adminConsole.routes.js";
import dbTablesRoutes from "./routes/dbTables.routes.js";
import ticketingRoutes, { stripeWebhookHandler } from "./routes/ticketing.routes.js";
import squareRoutes, { squareWebhookHandler } from "./routes/square.routes.js";
import paypalRoutes from "./routes/paypal.routes.js";
import checkinRoutes from "./routes/checkin.routes.js";
import mediaRoutes from "./routes/media.routes.js";
import reconciliationRoutes from "./routes/reconciliation.routes.js";
import registrationEmailsRoutes from "./routes/registrationEmails.routes.js";
import openfeedRoutes from "./routes/openfeed.routes.js";
import bankDashboardRoutes from "./routes/bankDashboard.routes.js";
import { startOpenfeedAutoSync } from "./lib/openfeedSync.js";
import { startDriveWatcher } from "./lib/driveStatementWatcher.js";
import couponsRoutes from "./routes/coupons.routes.js";
import registrationExtrasRoutes from "./routes/registrationExtras.routes.js";
import { syncRegistrationAttendees } from "./lib/attendees.js";
import { sendEventTickets } from "./lib/tickets.js";
import { recordPaymentAttempt, markPaymentPaid, getPayment } from "./lib/registrationPayments.js";
import { slugify } from "./lib/slugify.js";
import { DATA_ROOT } from "./lib/dataRoot.js";
import { importMembersDropIn } from "./lib/importMembersDropIn.js";
import { generateEmailDraft } from "./lib/aiDraft.js";

const app = express();
const reverseGeocodeCache = new Map();
let reverseGeocodeQueue = Promise.resolve();
let nextReverseGeocodeAt = 0;

app.use(cors());

// Stripe webhook needs the RAW body to verify its signature, so it must be
// registered before express.json() parses the body for every other route.
app.post("/api/ticketing/webhook", express.raw({ type: "application/json" }), stripeWebhookHandler);
app.post("/api/square/webhook", express.raw({ type: "application/json" }), squareWebhookHandler);

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

/* -----------------------------
   🎟️  New event-management modules (admin login, Stripe ticketing,
   QR check-in) — Postgres-backed, entirely additive to the JSON site below.
------------------------------ */
app.use("/api/admin-auth", adminAuthRoutes);
app.use("/api/supporter-portal", supporterPortalRoutes);
app.use("/api/organisations", organisationsRoutes);
app.use("/api/fundraising", fundraisingRoutes);
app.use("/api/fundraising-tools", fundraisingToolsRoutes);
app.use("/api/admin-console", adminConsoleRoutes);
app.use("/api/db-tables", dbTablesRoutes);
app.use("/api/ticketing", ticketingRoutes);
app.use("/api/checkin", checkinRoutes);
app.use("/api/events/reconcile", reconciliationRoutes);
app.use("/api/registration-emails", registrationEmailsRoutes);
app.use("/api/openfeed", openfeedRoutes);
app.use("/api/bank-dashboard", bankDashboardRoutes);

// PUBLIC: the two Google Drive drop boxes linked from the site footer, plus
// suggested event folder names for the media drop box. Folder access itself
// is controlled by each folder's Google Drive sharing, not by the site.
app.get("/api/drop-box-links", async (req, res) => {
  try {
    const bankId = (await getSetting("gdrive_folder_id")) || "1wo2VFMi_2zZQSeQbJgFBSqBXS5enTCME";
    const mediaId = (await getSetting("media_dropbox_folder_id")) || "1xWnGVgBdTIuBFD2Gj8JjT0y0QgMJijJf";
    const { rows: upcoming } = await pool.query(
      "SELECT title, date_text FROM kutumb_upcoming_events WHERE published = TRUE ORDER BY id DESC LIMIT 6"
    );
    const { rows: past } = await pool.query(
      "SELECT title, date_text FROM kutumb_past_events ORDER BY created_at DESC LIMIT 6"
    );
    const withYear = (e) => {
      const title = String(e.title || "").trim();
      const yr = String(e.date_text || "").match(/\d{4}/)?.[0];
      return yr && !title.includes(yr) ? `${title} ${yr}` : title;
    };
    const suggestedFolderNames = [...new Set([...upcoming, ...past].map(withYear).filter(Boolean))].slice(0, 8);
    res.json({
      bankFolderUrl: `https://drive.google.com/drive/folders/${bankId}`,
      mediaFolderUrl: `https://drive.google.com/drive/folders/${mediaId}`,
      suggestedFolderNames,
    });
  } catch (err) {
    console.error("DROP BOX LINKS ERROR:", err);
    res.status(500).json({ message: "Couldn't load links" });
  }
});
app.use("/api/coupons", couponsRoutes);
app.use("/api/manuals", manualsRoutes);
// Public "User Manual" (Membership & Event Booking Guide) — no login; linked
// from the website footer. Registered before the static/SPA fallback.
app.get(PUBLIC_MANUAL_PATH, servePublicManual);
app.use("/api/events", registrationExtrasRoutes);
app.use("/api/square", squareRoutes);
app.use("/api/paypal", paypalRoutes);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);



// Flyer images and past-event photos/videos live in Postgres
// (kutumb_media_files), served dynamically instead of as static files.
app.use("/api/media", mediaRoutes);
app.use("/api/pastevents", pastEventsRouter);

const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 8080}`;

/* -----------------------------
   🧼 HELPERS
------------------------------ */

const year = (text) => {
  const match = text?.match(/\d{4}/);
  return match ? match[0] : "unknown";
};

/* -----------------------------
   🗄️  AUTO-ARCHIVE EXPIRED EVENTS
   Moves any upcoming event whose date has passed into Past Events.
------------------------------ */
async function archiveExpiredUpcomingEvents() {
  try {
    const { rows: events } = await pool.query("SELECT * FROM kutumb_upcoming_events");
    if (events.length === 0) return;

    const now = new Date();
    const expired = events.filter((event) => {
      const endDate = parseEventEndDate(event.date_text);
      return endDate && endDate.getTime() < now.getTime();
    });
    if (expired.length === 0) return;

    for (const event of expired) {
      const eventId = slugify(event.title);
      const eventYear = event.date_text ? String(year(event.date_text)) : "unknown";

      const { rows: regRows } = await pool.query(
        "SELECT adults, children FROM kutumb_event_registrations WHERE lower(event_name) = lower($1) AND event_year = $2 AND registration_status <> 'cancelled'",
        [event.title, eventYear]
      );
      const attendeesCount = regRows.reduce((sum, r) => sum + 1 + (Number(r.adults) || 0) + (Number(r.children) || 0), 0);

      const { rows: existingPast } = await pool.query(
        "SELECT * FROM kutumb_past_events WHERE title = $1 AND date_text = $2",
        [event.title, event.date_text]
      );

      let pastEventId;
      if (existingPast.length > 0) {
        pastEventId = existingPast[0].id;
        await pool.query(
          "UPDATE kutumb_past_events SET description = COALESCE(NULLIF(description, ''), $1) WHERE id = $2",
          [event.description || "", pastEventId]
        );
      } else {
        const { rows: inserted } = await pool.query(
          "INSERT INTO kutumb_past_events (title, date_text, description, highlights) VALUES ($1,$2,$3,'') RETURNING id",
          [event.title, event.date_text, event.description || ""]
        );
        pastEventId = inserted[0].id;
      }

      // Carry the flyer image across into the past-media library so it
      // still renders on the Past Events page — this is now a database row
      // copy (duplicate the bytes under a new filename) rather than a
      // filesystem copy, since both live in kutumb_media_files.
      if (event.flyer_image) {
        const destName = `archived-${eventId}-${event.flyer_image}`;
        const { rows: existingMedia } = await pool.query(
          "SELECT id FROM kutumb_past_event_media WHERE past_event_id = $1 AND src = $2",
          [pastEventId, destName]
        );

        if (existingMedia.length === 0) {
          const { rows: srcFile } = await pool.query(
            "SELECT mimetype, size_bytes, data FROM kutumb_media_files WHERE filename = $1",
            [event.flyer_image]
          );
          if (srcFile.length > 0) {
            try {
              await pool.query(
                `INSERT INTO kutumb_media_files (filename, mimetype, size_bytes, data)
                 VALUES ($1,$2,$3,$4) ON CONFLICT (filename) DO NOTHING`,
                [destName, srcFile[0].mimetype, srcFile[0].size_bytes, srcFile[0].data]
              );
              await pool.query(
                "INSERT INTO kutumb_past_event_media (past_event_id, type, src, sort_order) VALUES ($1,'image',$2,999)",
                [pastEventId, destName]
              );
            } catch (copyErr) {
              console.error("Archive media copy failed:", copyErr);
            }
          }
        }
      }

      await pool.query("DELETE FROM kutumb_upcoming_events WHERE id = $1", [event.id]);
      console.log(`📦 Auto-archived expired event "${event.title}" (${event.date_text}) to Past Events`);
    }
  } catch (err) {
    console.error("ARCHIVE EVENTS ERROR:", err);
  }
}

app.get("/ping", (req, res) => {
  res.send("pong");
});

/* -----------------------------
   ✅ REGISTER EVENT
------------------------------ */
app.post("/api/events", async (req, res) => {
  const {
    eventName, eventDate, name, email, phone, comments,
    adults,
    // New: split children into under-5 (free, when the event allows it) and
    // 5-and-over (charged). Older/unmigrated clients that still only send
    // `children` are treated as all-5-plus, i.e. exactly the old behaviour.
    children, childrenUnder5, children5Plus,
    // The actual name of each additional adult / child, positionally
    // matched to the counts above — e.g. adultNames[0] is the first
    // additional adult's name. Sanitized to plain, trimmed strings here so
    // nothing unexpected (wrong type, excess length) reaches the database
    // or a ticket PDF; any missing/blank entry is just an empty string,
    // and syncRegistrationAttendees falls back to a generic label for it.
    adultNames, childrenUnder5Names, children5PlusNames,
    // "How did you hear about this event?" — one of a fixed set of options,
    // plus a free-text detail that's only meaningful (and only required)
    // when heardAboutSource is "Other".
    heardAboutSource, heardAboutOther,
  } = req.body;

  if (!eventName || !name || !email || !phone) {
    return res.status(400).json({ message: "Name, email and phone are required" });
  }

  const HEARD_ABOUT_OPTIONS = [
    "Kutumb WhatsApp communication",
    "Kutumb Yoga Group",
    "Kutumb Facebook",
    "Kutumb Instagram",
    "Other",
  ];
  if (!heardAboutSource || !HEARD_ABOUT_OPTIONS.includes(heardAboutSource)) {
    return res.status(400).json({ message: "Please tell us how you heard about this event" });
  }
  const sanitizedHeardAboutOther =
    heardAboutSource === "Other" ? String(heardAboutOther || "").trim().slice(0, 500) : null;
  if (heardAboutSource === "Other" && !sanitizedHeardAboutOther) {
    return res.status(400).json({ message: "Please provide details for \"Other\"" });
  }

  const sanitizeNames = (arr, count) =>
    Array.from({ length: count }, (_, i) =>
      typeof arr?.[i] === "string" ? arr[i].trim().slice(0, 200) : ""
    );

  const numChildrenUnder5 = Number(childrenUnder5) || 0;
  const numChildren5Plus = children5Plus !== undefined ? Number(children5Plus) || 0 : Number(children) || 0;
  const numChildrenTotal = numChildrenUnder5 + numChildren5Plus;
  const numAdults = Number(adults) || 0;

  const sanitizedAdultNames = sanitizeNames(adultNames, numAdults);
  const sanitizedChildrenUnder5Names = sanitizeNames(childrenUnder5Names, numChildrenUnder5);
  const sanitizedChildren5PlusNames = sanitizeNames(children5PlusNames, numChildren5Plus);

  let eventYear = year(eventDate);

  const { rows: eventMetaRows } = await pool.query(
    "SELECT * FROM kutumb_upcoming_events WHERE lower(title) = lower($1)",
    [eventName]
  );
  const eventMeta = eventMetaRows[0] || null;

  // If the event this registration is for can't be found — the title sent
  // by the browser doesn't match any row in kutumb_upcoming_events, e.g.
  // it was renamed or unpublished after the person loaded the page — we
  // must NOT silently fall through: every fee/capacity value below
  // defaults to 0 when eventMeta is null, which would register the person
  // for free with no capacity limit at all. Reject instead, so they can
  // refresh and register against the current event.
  if (!eventMeta) {
    return res.status(404).json({
      message: "We couldn't find that event — it may have been updated. Please refresh the page and try registering again.",
    });
  }

  const client = await pool.connect();
  let lockError = null;
  let newRegistration = null;
  let applicableFee = 0;
  let perPersonFee = 0;
  let childFeeApplied = 0;
  let matchedMember = null;

  try {
    await client.query("BEGIN");
    // Serializes the whole read-check-write cycle per event, exactly like
    // the old file lock did — two people registering for the very last
    // spot at nearly the same moment can no longer both read "1 spot left"
    // before either write lands and both get in. Everything below runs
    // inside one transaction, keyed to this specific event by name+year.
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext($1))",
      [`kutumb_event_reg_${eventName.toLowerCase()}_${eventYear}`]
    );
    // Ticket checkout also locks this event row, so legacy registrations and
    // ticket orders share one capacity guard even when they run concurrently.
    if (eventMeta?.id) await client.query("SELECT id FROM kutumb_upcoming_events WHERE id=$1 FOR UPDATE", [eventMeta.id]);

    const existsCheck = await client.query(
      "SELECT id FROM kutumb_event_registrations WHERE event_name = $1 AND event_year = $2 AND lower(email) = lower($3) AND registration_status <> 'cancelled'",
      [eventName, eventYear, email]
    );
    if (existsCheck.rows.length > 0) {
      lockError = { status: 409, message: "Already registered" };
    } else {
      const capacity = Number(eventMeta?.capacity || 0);
      const memberFee = Number(eventMeta?.member_fee || 0);
      const nonMemberFee = Number(eventMeta?.non_member_fee || 0);
      // Under-5-free + separate child pricing (falls back to the adult
      // rate when an event hasn't configured its own child price, so an
      // event nobody has touched charges children exactly as before).
      const under5Free = eventMeta?.under5_free !== false;
      const childMemberFee = eventMeta?.child_member_fee != null ? Number(eventMeta.child_member_fee) : memberFee;
      const childNonMemberFee = eventMeta?.child_non_member_fee != null ? Number(eventMeta.child_non_member_fee) : nonMemberFee;

      const { rows: existingRegs } = await client.query(
        "SELECT adults, children, registration_number, registration_status FROM kutumb_event_registrations WHERE event_name = $1 AND event_year = $2",
        [eventName, eventYear]
      );
      const registrationPlaces = existingRegs.filter((r) => r.registration_status !== "cancelled").reduce((sum, r) => sum + 1 + (Number(r.adults) || 0) + (Number(r.children) || 0), 0);
      const { rows: ticketSalesRows } = await client.query("SELECT COALESCE(SUM(quantity_sold),0)::int AS count FROM kutumb_ticket_types WHERE event_id=$1", [slugify(eventName)]);
      const used = registrationPlaces + Number(ticketSalesRows[0]?.count || 0);
      const requested = (Number(adults) || 0) + numChildrenTotal;

      if (capacity > 0 && used + requested > capacity) {
        lockError = { status: 400, message: "Not enough spots available" };
      } else {
        const { rows: memberRows } = await client.query(
          "SELECT * FROM kutumb_members WHERE lower(email) = lower($1)",
          [email]
        );
        matchedMember = memberRows[0] || null;
        const isMember = !!matchedMember?.membership_number;

        // Event-prefixed (e.g. UTS26-R0012) so the number is unique across
        // all events and safe to use as the bank transfer reference.
        const eventCode = await resolveEventCode(client, eventName, eventYear);
        const registrationNumber = getNextRegistrationNumber(
          existingRegs.map((r) => ({ registrationNumber: r.registration_number })),
          eventCode
        );
        perPersonFee = isMember ? memberFee : nonMemberFee;
        childFeeApplied = isMember ? childMemberFee : childNonMemberFee;
        const totalAdults = 1 + (Number(adults) || 0);
        // Under-5 children are free when the event allows it; everyone else
        // (5+ children always, or every child if the event has under-5-free
        // turned off) is charged the child rate.
        const chargeableChildren = under5Free ? numChildren5Plus : numChildrenTotal;
        applicableFee = perPersonFee * totalAdults + childFeeApplied * chargeableChildren;

        // Paid registrations start life as "pending_payment" and only become
        // "confirmed" once payment actually clears (bank-transfer admin
        // verification, a fully-covering coupon, or Stripe's own webhook /
        // session-status confirmation) — a submitted form is no longer, by
        // itself, a confirmed registration for a paid event.
        const registrationStatus = applicableFee > 0 ? "pending_payment" : "confirmed";

        const payToken = crypto.randomBytes(20).toString("hex");
        const { rows: inserted } = await client.query(
          `INSERT INTO kutumb_event_registrations
             (event_name, event_year, name, email, phone, adults, children, children_under5, children_5plus, child_fee,
              comments, registration_number, is_member, membership_number, fee, per_person_fee,
              bank_transferred, transaction_number, payment_status, registration_status, pay_token,
              adult_names, children_under5_names, children_5plus_names, heard_about_source, heard_about_other, organisation_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,FALSE,NULL,$17,$18,$19,$20,$21,$22,$23,$24,$25) RETURNING *`,
          [
            eventName, eventYear, name, email, phone, numAdults, numChildrenTotal, numChildrenUnder5, numChildren5Plus, childFeeApplied,
            comments || null, registrationNumber, isMember, matchedMember?.membership_number || null,
            applicableFee, perPersonFee, applicableFee > 0 ? "Pending" : "N/A", registrationStatus, payToken,
            JSON.stringify(sanitizedAdultNames), JSON.stringify(sanitizedChildrenUnder5Names), JSON.stringify(sanitizedChildren5PlusNames),
            heardAboutSource, sanitizedHeardAboutOther, eventMeta.organisation_id || 1,
          ]
        );
        newRegistration = inserted[0];
        await syncRegistrationAttendees(client, newRegistration);
      }
    }

    if (lockError) {
      await client.query("ROLLBACK");
    } else {
      await client.query("COMMIT");
    }
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("EVENT REGISTRATION ERROR:", err);
    client.release();
    return res.status(500).json({ message: "Registration failed" });
  } finally {
    client.release();
  }

  if (lockError) {
    return res.status(lockError.status).json({ message: lockError.message });
  }

  // ── Attach the event's flyer image to the confirmation email, if any ────
  let flyerBuffer = null;
  let flyerFilename = null;
  if (eventMeta?.flyer_image) {
    const { rows: flyerRows } = await pool.query("SELECT data FROM kutumb_media_files WHERE filename = $1", [eventMeta.flyer_image]);
    if (flyerRows.length > 0) {
      flyerBuffer = flyerRows[0].data;
      flyerFilename = eventMeta.flyer_image;
    }
  }

  // ── Send a simple success confirmation email (text mention of membership
  // number if applicable - no card, no QR, no PDF) ────────────────────────
  //
  // For a FREE registration this fires immediately, same as always — the
  // registration is already confirmed, nothing else is going to happen.
  //
  // For a PAID registration, this is deliberately held back. The success
  // dialog the browser is about to show offers to pay right there — an
  // email saying "payment required, here's a link" the instant they've
  // already submitted the form, while they're still looking at that exact
  // payment UI, is redundant at best and confusing at worst (a "please
  // pay" email arriving while they're mid-payment). It's sent instead
  // from /api/events/registration/:id/send-payment-reminder, triggered by
  // the client when the dialog is closed/abandoned still unpaid — i.e.
  // only when it's actually useful. If they pay right there instead, they
  // get the "Payment Confirmed" email from that path, and this one never
  // needs to go out at all.
  if (applicableFee <= 0) {
    sendEventConfirmationEmail({
      to: email,
      name,
      eventName,
      eventDate,
      registrationNumber: newRegistration.registration_number,
      fee: applicableFee,
      membershipNumber: matchedMember?.membership_number || null,
      flyerBuffer,
      flyerFilename,
    }).catch((err) => console.error("Event email error:", err));
  }

  // Free events are confirmed immediately, so their QR tickets go out
  // right away too. Paid events start "pending_payment" — sendEventTickets
  // no-ops here and instead fires later, from whichever payment path
  // (card/Square/PayPal, coupon, or admin bank-transfer verification)
  // actually confirms the registration.
  sendEventTickets(newRegistration.id).catch((err) => console.error("Ticket email error:", err));

  res.status(201).json({
    message: "Registration successful",
    id: newRegistration.id,
    registrationNumber: newRegistration.registration_number,
    registrationStatus: newRegistration.registration_status,
    isMember: !!matchedMember,
    membershipNumber: matchedMember?.membership_number || null,
    qrCode: matchedMember?.qr_code || null,
    fee: applicableFee,
    perPersonFee,
    childFee: childFeeApplied,
    adults: Number(adults) || 0,
    children: numChildrenTotal,
    childrenUnder5: numChildrenUnder5,
    children5Plus: numChildren5Plus,
    name,
    email,
    phone,
    eventName,
    eventDate,
    eventYear,
  });
});

/* -----------------------------
   ✅ REGISTER MEMBER
------------------------------ */
app.post("/api/members", async (req, res) => {
  const client = await pool.connect();
  try {
    const { name, email, phone, address, interests } = req.body;

    // Name, email and phone are compulsory
    if (!name?.trim() || !email?.trim() || !phone?.trim()) {
      client.release();
      return res.status(400).json({ message: "Name, email and phone are required" });
    }

    const normalizedName = name.trim().toLowerCase();
    const normalizedEmail = email.trim().toLowerCase();

    await client.query("BEGIN");
    // Serializes membership-number generation across concurrent signups so
    // two people signing up at the same instant can never be handed the
    // same number (the equivalent problem to the event-capacity race, just
    // for a generated sequence instead of a headcount).
    await client.query("SELECT pg_advisory_xact_lock(hashtext('kutumb_members_seq'))");

    const dupCheck = await client.query(
      // Email alone is intentionally not unique — one household email can
      // legitimately cover several family members under different names.
      // The (name, email) pair together is what must be unique.
      "SELECT id FROM kutumb_members WHERE lower(name) = $1 AND lower(email) = $2",
      [normalizedName, normalizedEmail]
    );
    if (dupCheck.rows.length > 0) {
      await client.query("ROLLBACK");
      client.release();
      return res.status(409).json({ message: "This name and email combination is already a registered member" });
    }

    const { rows: existingRows } = await client.query("SELECT membership_number FROM kutumb_members");
    const existingForCounter = existingRows.map((r) => ({ membershipNumber: r.membership_number }));
    const membershipNumber = getNextMembershipNumber(existingForCounter);

    const qrDataUrl = await generateQrDataUrl(membershipNumber);
    const qrPngBuffer = await generateQrPngBuffer(membershipNumber);

    await client.query(
      `INSERT INTO kutumb_members (name, email, phone, address, interests, membership_number, qr_code)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [name, email, phone, address || null, interests || [], membershipNumber, qrDataUrl]
    );
    await client.query("COMMIT");

    // Build the same PDF card shown in the popup / download button, so the
    // email carries the actual membership card, not just the QR code.
    const cardPdfBuffer = await buildCardPdf({
      title: "Kutumb Membership Card",
      membershipNumber,
      name,
      email,
      phone,
      qrPngBuffer,
    });

    // Send confirmation email - failures are logged but never block registration
    sendMembershipConfirmationEmail({
      to: email,
      name,
      membershipNumber,
      qrPngBuffer,
      cardPdfBuffer,
    }).catch((err) => console.error("Membership email error:", err));

    res.status(201).json({
      message: "Member registered",
      membershipNumber,
      qrCode: qrDataUrl,
      name,
      email,
      phone,
    });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    // Belt-and-suspenders: the check above should already catch this, but
    // if a duplicate email somehow still reaches the insert (a concurrent
    // request, or a future code path that doesn't check first), the
    // database's own unique constraint on email is the actual backstop —
    // surface it as the same friendly message rather than a raw 500.
    if (err.code === "23505" && err.constraint === "idx_kutumb_members_email_name_unique") {
      return res.status(409).json({ message: "This name and email combination is already a registered member" });
    }
    console.error("POST /members error:", err);
    res.status(500).json({ message: "Server error" });
  } finally {
    client.release();
  }
});

/* -----------------------------
   🪪 MEMBERSHIP CARD PDF (download / WhatsApp source)
------------------------------ */
app.get("/api/members/:membershipNumber/card.pdf", async (req, res) => {
  try {
    const { membershipNumber } = req.params;
    const { rows } = await pool.query("SELECT * FROM kutumb_members WHERE membership_number = $1", [membershipNumber]);
    const member = rows[0];
    if (!member) return res.status(404).json({ message: "Member not found" });

    const qrPngBuffer = await generateQrPngBuffer(member.membership_number);
    const pdfBuffer = await buildCardPdf({
      title: "Kutumb Membership Card",
      membershipNumber: member.membership_number,
      name: member.name,
      email: member.email,
      phone: member.phone,
      qrPngBuffer,
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="kutumb-membership-${member.membership_number}.pdf"`
    );
    res.send(pdfBuffer);
  } catch (err) {
    console.error("CARD PDF ERROR:", err);
    res.status(500).json({ message: "Failed to generate card" });
  }
});

/* -----------------------------
   📲 SEND MEMBERSHIP CARD VIA WHATSAPP
------------------------------ */
app.post("/api/members/send-whatsapp", requireSuperAdmin, async (req, res) => {
  try {
    const { membershipNumber, whatsappNumber } = req.body;
    if (!membershipNumber || !whatsappNumber) {
      return res.status(400).json({ message: "Membership number and WhatsApp number are required" });
    }

    const { rows } = await pool.query("SELECT * FROM kutumb_members WHERE membership_number = $1", [membershipNumber]);
    const member = rows[0];
    if (!member) return res.status(404).json({ message: "Member not found" });

    const pdfUrl = `${PUBLIC_BASE_URL}/api/members/${membershipNumber}/card.pdf`;

    const result = await sendWhatsAppDocument({
      to: whatsappNumber,
      pdfUrl,
      filename: `kutumb-membership-${membershipNumber}.pdf`,
      caption: `Kutumb Membership Card - ${member.name} (${membershipNumber})`,
    });

    if (!result.sent) {
      return res.status(502).json({ message: result.error || "WhatsApp send failed" });
    }

    res.json({ message: "Card sent via WhatsApp" });
  } catch (err) {
    console.error("SEND WHATSAPP ERROR:", err);
    res.status(500).json({ message: "Server error" });
  }
});

/* -----------------------------
   📊 GET ALL REGISTRATIONS (ADMIN) — one flat list across every event,
   replacing the old two-step "list files, then fetch each" dance now that
   there are no files to list.
------------------------------ */
app.get("/api/all-registrations", requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT * FROM kutumb_event_registrations ORDER BY created_at DESC");
    res.json(
      rows.map((r) => ({
        id: r.id,
        eventName: r.event_name,
        eventYear: r.event_year,
        name: r.name,
        email: r.email,
        phone: r.phone,
        adults: r.adults,
        children: r.children,
        childrenUnder5: r.children_under5,
        children5Plus: r.children_5plus,
        childFee: r.child_fee !== null ? Number(r.child_fee) : 0,
        comments: r.comments,
        heardAboutSource: r.heard_about_source,
        heardAboutOther: r.heard_about_other,
        registrationNumber: r.registration_number,
        isMember: r.is_member,
        membershipNumber: r.membership_number,
        fee: Number(r.fee),
        perPersonFee: Number(r.per_person_fee),
        bankTransferred: r.bank_transferred,
        transactionNumber: r.transaction_number,
        paymentStatus: r.payment_status,
        registrationStatus: r.registration_status,
        paymentMethod: r.payment_method,
        couponCode: r.coupon_code,
        couponAmount: r.coupon_amount !== null ? Number(r.coupon_amount) : null,
        paymentAmount: r.payment_amount !== null ? Number(r.payment_amount) : null,
        paymentDate: r.payment_date,
        paymentMatchConfidence: r.payment_match_confidence,
        paymentMatchNote: r.payment_match_note,
        createdAt: r.created_at,
      }))
    );
  } catch (err) {
    console.error("ALL REGISTRATIONS ERROR:", err);
    res.status(500).json([]);
  }
});

/* -----------------------------
   💳 RECORD PAYMENT FOR AN EVENT REGISTRATION
   Public/self-service on purpose: this is called straight from the
   registration success dialog on the public Events page, by whoever just
   registered — they aren't logged in as an admin. It's scoped safely by
   requiring an exact match on eventName + eventYear + email, and only ever
   flips the record to "Paid" when a transaction number is actually supplied.
------------------------------ */
// PUBLIC: looks up one registration by its opaque pay_token — this is what
// powers the "Pay Now" link in the pending-payment confirmation email,
// landing on the standalone /pay/:token page rather than requiring the
// person to dig back through the site to find their registration again.
// Keyed by an unguessable token (not the numeric id), the same model as
// qr_token for attendees — no login required, but also no way to browse to
// someone else's registration.
app.get("/api/events/registration/by-token/:token", async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT * FROM kutumb_event_registrations WHERE pay_token = $1",
      [req.params.token]
    );
    const reg = rows[0];
    if (!reg) return res.status(404).json({ message: "Registration not found" });

    // Registrations don't store the event date themselves — best-effort
    // look it up from the event so the pay page can show it too.
    const { rows: eventRows } = await pool.query(
      "SELECT date_text FROM kutumb_upcoming_events WHERE lower(title) = lower($1)",
      [reg.event_name]
    );

    const totalFee = Number(reg.fee) || 0;
    const amountPaid = Number(reg.payment_amount) || 0;

    res.json({
      id: reg.id,
      eventName: reg.event_name,
      eventDate: eventRows[0]?.date_text || null,
      eventYear: reg.event_year,
      registrationNumber: reg.registration_number,
      name: reg.name,
      email: reg.email,
      adults: reg.adults,
      children: reg.children,
      // The amount still owed right now — not necessarily the original
      // fee, e.g. if a coupon partially covered it already.
      fee: Math.max(totalFee - amountPaid, 0),
      totalFee,
      paymentStatus: reg.payment_status,
      registrationStatus: reg.registration_status,
      cancelled: reg.registration_status === "cancelled",
      cancelledMessage: reg.registration_status === "cancelled" ? CANCELLED_MESSAGE : null,
    });
  } catch (err) {
    console.error("REGISTRATION BY TOKEN ERROR:", err);
    res.status(500).json({ message: "Server error" });
  }
});

/* ============================================================
   PUBLIC: pay a registration's remaining balance by card — a dedicated
   Stripe Checkout session for exactly what's owed on THIS registration.
   Deliberately NOT routed through the ticketing/ticket-types system
   (kutumb_orders/kutumb_ticket_types) the way the old RegistrationCheckoutModal
   was: that system has no concept of "this registration's fee" — it prices
   off a shared per-event "General" ticket type, whose price is set once,
   the first time anyone pays with it, and never changes after. Every
   subsequent registration for that event (a different headcount, a
   different member/non-member rate) would silently be charged that first
   price instead of its own — that's what caused $20 owed to charge $60.
   Uses the same pattern as Square/PayPal's registration payments instead
   (registrationPayments.js, kutumb_registration_payments — the remaining
   balance is computed here, server-side, from the registration itself).
   ============================================================ */
app.post("/api/events/registration/:id/checkout-card", async (req, res) => {
  try {
    const registrationId = Number(req.params.id);
    const { rows } = await pool.query("SELECT * FROM kutumb_event_registrations WHERE id = $1", [registrationId]);
    const registration = rows[0];
    if (!registration) return res.status(404).json({ message: "Registration not found" });
    if (registration.registration_status === "cancelled") {
      return res.status(410).json({ message: CANCELLED_MESSAGE });
    }

    const fee = Number(registration.fee) || 0;
    const alreadyPaid = Number(registration.payment_amount) || 0;
    const remaining = Math.max(fee - alreadyPaid, 0);
    if (remaining <= 0) {
      return res.status(400).json({ message: "This registration has no remaining balance to pay" });
    }

    const stripe = await getStripe();
    if (!stripe) {
      return res.status(503).json({ message: "Card payments aren't configured yet. Ask the admin to add a Stripe secret key in the Admin Console." });
    }

    const baseUrl = await getPublicBaseUrl(req);

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: registration.email,
      line_items: [
        {
          price_data: {
            currency: "aud",
            product_data: { name: `${registration.event_name} registration — ${registration.name}` },
            unit_amount: Math.round(remaining * 100),
          },
          quantity: 1,
        },
      ],
      success_url: `${baseUrl}/checkout/return?provider=registration-card&registrationId=${registrationId}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/checkout/return?provider=registration-card&registrationId=${registrationId}&cancelled=1`,
      metadata: { registrationCardPayment: "1", registrationId: String(registrationId) },
    });

    await recordPaymentAttempt(registrationId, "card", session.id, remaining);
    res.json({ url: session.url });
  } catch (err) {
    console.error("REGISTRATION CARD CHECKOUT ERROR:", err);
    res.status(500).json({ message: "Could not start card checkout" });
  }
});

// Fallback for the /checkout/return page, in case the webhook hasn't
// landed yet — same pattern as the donation and Square equivalents.
app.get("/api/events/registration/:id/card-status", async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT * FROM kutumb_registration_payments WHERE registration_id = $1 AND provider = 'card' ORDER BY created_at DESC LIMIT 1",
      [req.params.id]
    );
    const payment = rows[0];
    if (!payment) return res.status(404).json({ message: "No card payment found for this registration" });

    if (payment.status === "pending") {
      const stripe = await getStripe();
      if (stripe) {
        try {
          const session = await stripe.checkout.sessions.retrieve(payment.provider_reference);
          if (session.payment_status === "paid") {
            await markPaymentPaid(payment.id, session.payment_status, session.payment_intent);
          }
        } catch (err) {
          console.error("REGISTRATION CARD STATUS CHECK ERROR:", err);
        }
      }
    }

    const refreshed = await getPayment(payment.id);
    res.json({ status: refreshed?.status || payment.status, registrationId: payment.registration_id });
  } catch (err) {
    console.error("REGISTRATION CARD STATUS ERROR:", err);
    res.status(500).json({ message: "Could not check payment status" });
  }
});

// PUBLIC: sends the "Registration Received — Payment Required" email
// (with its "Pay Now" link) for one still-pending registration. Called
// from the browser when the success dialog is dismissed — closed, or the
// tab/window itself is closed — while payment still hasn't happened; see
// the long comment on the immediate-email decision in POST /api/events.
// Never sends more than once (payment_email_sent_at is a one-way claim,
// same idea as tickets_sent_at), and is a silent no-op — not an error —
// for a registration that's already paid, already emailed, or that never
// owed anything in the first place, so the client can fire this
// speculatively without checking any of that itself first.
app.post("/api/events/registration/:id/send-payment-reminder", async (req, res) => {
  try {
    const registrationId = Number(req.params.id);
    const { rows } = await pool.query(
      `UPDATE kutumb_event_registrations
       SET payment_email_sent_at = now()
       WHERE id = $1 AND registration_status = 'pending_payment' AND payment_email_sent_at IS NULL
       RETURNING *`,
      [registrationId]
    );
    const registration = rows[0];
    if (!registration) return res.json({ sent: false });

    const baseUrl = await getPublicBaseUrl(req);
    // Registrations don't store the event date themselves — best-effort
    // look it up, same as the by-token endpoint above.
    const { rows: eventRows } = await pool.query(
      "SELECT date_text FROM kutumb_upcoming_events WHERE lower(title) = lower($1)",
      [registration.event_name]
    );
    // Anything already paid (e.g. a coupon applied before leaving the
    // payment window) is shown, and the email asks only for the balance.
    const totalFee = Number(registration.fee) || 0;
    const amountPaid = Number(registration.payment_amount) || 0;
    const couponAmount = Number(registration.coupon_amount) || 0;
    const couponOnlyPartial =
      amountPaid > 0 && amountPaid < totalFee && couponAmount > 0 && amountPaid <= couponAmount + 0.001;
    sendEventConfirmationEmail({
      to: registration.email,
      name: registration.name,
      eventName: registration.event_name,
      eventDate: eventRows[0]?.date_text || null,
      registrationNumber: registration.registration_number,
      fee: totalFee,
      amountPaid,
      couponAmount,
      couponCode: registration.coupon_code,
      membershipNumber: registration.membership_number,
      payToken: registration.pay_token,
      baseUrl,
    })
      .then(async (result) => {
        // This email already thanks them for the coupon part payment and
        // asks for the balance, so the scheduler's separate ~30-minute
        // "Thank you for your part payment" email would be a duplicate.
        if (result?.sent && couponOnlyPartial) {
          await pool.query(
            `INSERT INTO kutumb_registration_notifications (registration_id, kind, period_key, sent_at)
             VALUES ($1, 'coupon_part_payment', '', now()) ON CONFLICT DO NOTHING`,
            [registration.id]
          );
        }
      })
      .catch((err) => console.error("Payment reminder email error:", err));

    res.json({ sent: true });
  } catch (err) {
    console.error("SEND PAYMENT REMINDER ERROR:", err);
    // Still 200 here on purpose — this can be called via navigator.sendBeacon
    // on tab close, which never sees the response anyway, and the client's
    // explicit-close path already treats this as fire-and-forget.
    res.status(200).json({ sent: false });
  }
});

app.post("/api/events/record-payment", async (req, res) => {
  try {
    const { registrationId, eventName, eventYear, email, bankTransferred, transactionNumber } = req.body;
    if (!registrationId && (!eventName || !eventYear || !email)) {
      return res.status(400).json({ message: "Missing required fields" });
    }
    // Nothing to record unless they're saying a transfer has been made.
    if (!bankTransferred) return res.json({ message: "No payment recorded", status: "none" });
    const txn = String(transactionNumber || "").trim();
    if (!txn) {
      return res.status(400).json({ message: "Transaction number is required when bank transfer is marked as done" });
    }

    // Prefer the exact registration id (sent by the payment panel); fall back
    // to event + year + email, taking the newest if there's more than one.
    const { rows: found } = registrationId
      ? await pool.query("SELECT * FROM kutumb_event_registrations WHERE id = $1", [Number(registrationId)])
      : await pool.query(
          `SELECT * FROM kutumb_event_registrations
           WHERE event_name = $1 AND event_year = $2 AND lower(email) = lower($3)
           ORDER BY (registration_status = 'cancelled') ASC, created_at DESC LIMIT 1`,
          [eventName, eventYear, email]
        );
    const existing = found[0];
    if (!existing) return res.status(404).json({ message: "Registration not found" });
    if (existing.registration_status === "cancelled") {
      return res.status(410).json({ message: CANCELLED_MESSAGE });
    }

    // Never downgrade or overwrite a registration that's already paid.
    if (existing.payment_status === "Paid" || existing.registration_status === "confirmed") {
      return res.json({ message: "This registration is already paid", status: "already_paid" });
    }

    // A transaction number typed in by the registrant is a CLAIM, not proof.
    // Record it, but leave payment_status 'Pending' and registration_status
    // 'pending_payment' — they only change once the transfer is verified: an
    // admin sets Payment Status = Paid, or the bank-statement reconciliation
    // matches it (both flip status, method and confirmation together, and
    // send the tickets). Marking it Paid here is what used to leave a
    // registration showing "Paid" but "Pending Payment" at once, with no
    // amount, date or method, and no tickets.
    const { rows } = await pool.query(
      `UPDATE kutumb_event_registrations
       SET bank_transferred = TRUE, transaction_number = $1
       WHERE id = $2
       RETURNING *`,
      [txn, existing.id]
    );
    const updatedEntry = rows[0];

    // Acknowledge receipt (once per distinct reference) — but say plainly that
    // it isn't confirmed yet, rather than "Payment Confirmed".
    if (existing.transaction_number !== txn) {
      sendBankTransferReceivedEmail({
        to: updatedEntry.email,
        name: updatedEntry.name,
        eventName: updatedEntry.event_name,
        registrationNumber: updatedEntry.registration_number,
        fee: Number(updatedEntry.fee),
        transactionNumber: txn,
      }).catch((err) => console.error("Bank transfer received email error:", err));
    }

    res.json({ message: "Transfer details recorded — pending verification", status: "pending_verification" });
  } catch (err) {
    console.error("RECORD PAYMENT ERROR:", err);
    res.status(500).json({ message: "Server error" });
  }
});

app.post("/api/events/update", requireAdmin, async (req, res) => {
  try {
    const { eventName, eventYear, email, updatedData } = req.body;
    if (!eventName || !eventYear || !email) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    // A "Paid" status must always be backed by a transaction number — the
    // same rule the public registration-success dialog enforces when the
    // registrant records their own bank transfer. This stops the admin
    // console from marking something Paid with nothing to show for it.
    const txnProvided = updatedData?.transactionNumber !== undefined;
    const trimmedTxn = txnProvided ? String(updatedData.transactionNumber || "").trim() : "";
    if (updatedData?.paymentStatus === "Paid" && !trimmedTxn) {
      return res.status(400).json({ message: "A transaction number is required to mark this registration as Paid" });
    }

    // Amount Paid / Date Paid are usually filled in automatically by the
    // "Upload Bank Statement" reconciliation, but can also be corrected by
    // hand here — e.g. if a match needs a manual fix.
    const amountProvided = updatedData?.paymentAmount !== undefined;
    const dateProvided = updatedData?.paymentDate !== undefined;

    // The admin edit panel always sends childrenUnder5 + children5Plus
    // together whenever the headcount is touched, so `children` (the total)
    // is recomputed here rather than trusted separately — the two can
    // never drift apart.
    const childrenUnder5Provided = updatedData?.childrenUnder5 !== undefined;
    const children5PlusProvided = updatedData?.children5Plus !== undefined;
    const childrenSplitProvided = childrenUnder5Provided || children5PlusProvided;
    const childrenUnder5Value = childrenUnder5Provided ? Number(updatedData.childrenUnder5) || 0 : 0;
    const children5PlusValue = children5PlusProvided ? Number(updatedData.children5Plus) || 0 : 0;

    const paymentMethodProvided = updatedData?.paymentMethod !== undefined;

    const { rows } = await pool.query(
      `UPDATE kutumb_event_registrations SET
         name = COALESCE($1, name),
         phone = COALESCE($2, phone),
         adults = COALESCE($3, adults),
         children = CASE WHEN $17 THEN $18 ELSE COALESCE($4, children) END,
         children_under5 = CASE WHEN $19 THEN $20 ELSE children_under5 END,
         children_5plus = CASE WHEN $21 THEN $22 ELSE children_5plus END,
         comments = COALESCE($5, comments),
         fee = COALESCE($6, fee),
         payment_status = COALESCE($7, payment_status),
         payment_method = CASE WHEN $23 THEN $24 ELSE payment_method END,
         cancelled_at = CASE WHEN $7 = 'Paid' THEN NULL ELSE cancelled_at END,
         registration_status = CASE
           WHEN $7 = 'Paid' THEN 'confirmed'
           WHEN $7 IS NOT NULL AND $7 <> 'Paid' AND registration_status = 'confirmed' AND COALESCE($6, fee) > 0 THEN 'pending_payment'
           ELSE registration_status
         END,
         transaction_number = CASE WHEN $8 THEN NULLIF($9, '') ELSE transaction_number END,
         bank_transferred = CASE WHEN $8 THEN ($9 <> '') ELSE bank_transferred END,
         payment_amount = CASE WHEN $13 THEN $14 ELSE payment_amount END,
         payment_date = CASE WHEN $15 THEN $16 ELSE payment_date END
       WHERE id = (
         -- The active registration for this email; a cancelled one only if
         -- there's no active one (so an admin can still reinstate it).
         SELECT id FROM kutumb_event_registrations
          WHERE event_name = $10 AND event_year = $11 AND lower(email) = lower($12)
          ORDER BY (registration_status = 'cancelled') ASC, created_at DESC LIMIT 1
       )
       RETURNING *`,
      [
        updatedData?.name, updatedData?.phone,
        updatedData?.adults !== undefined ? Number(updatedData.adults) : null,
        updatedData?.children !== undefined ? Number(updatedData.children) : null,
        updatedData?.comments, updatedData?.fee !== undefined ? Number(updatedData.fee) : null,
        updatedData?.paymentStatus,
        txnProvided, trimmedTxn,
        eventName, eventYear, email,
        amountProvided, amountProvided ? Number(updatedData.paymentAmount) || null : null,
        dateProvided, dateProvided ? (updatedData.paymentDate || null) : null,
        childrenSplitProvided, childrenUnder5Value + children5PlusValue,
        childrenUnder5Provided, childrenUnder5Value,
        children5PlusProvided, children5PlusValue,
        paymentMethodProvided, updatedData?.paymentMethod || null,
      ]
    );

    if (rows.length === 0) return res.status(404).json({ message: "Registration not found" });

    // Keep the individual per-attendee QR list in sync whenever the
    // headcount changed (already-checked-in attendees are never removed).
    if (updatedData?.adults !== undefined || childrenSplitProvided) {
      await syncRegistrationAttendees(pool, rows[0]).catch((err) =>
        console.error("Attendee sync after admin edit failed:", err)
      );
    }

    // Covers admin bank-transfer verification (Payment Status → Paid),
    // which is the one "becomes confirmed" path that doesn't already send
    // tickets elsewhere. sendEventTickets's own one-time claim makes this
    // a safe no-op on every other edit to an already-confirmed/already-
    // ticketed registration, so it's fine to just call it here unconditionally
    // rather than working out whether *this* edit was the transition.
    if (rows[0].registration_status === "confirmed") {
      sendEventTickets(rows[0].id).catch((err) => console.error("Ticket email error:", err));
    }

    res.json({ message: "Event registration updated successfully" });
  } catch (err) {
    console.error("EVENT UPDATE ERROR:", err);
    res.status(500).json({ message: "Update failed" });
  }
});

/* -----------------------------
   ✅ DELETE EVENT REGISTRATIONS
------------------------------ */
app.post("/api/events/delete", requireAdmin, async (req, res) => {
  try {
    const { eventName, eventYear, emails } = req.body;
    if (!eventName || !eventYear || !emails?.length) {
      return res.status(400).json({ message: "Missing data" });
    }

    await pool.query(
      "DELETE FROM kutumb_event_registrations WHERE event_name = $1 AND event_year = $2 AND lower(email) = ANY($3)",
      [eventName, eventYear, emails.map((e) => e.toLowerCase())]
    );
    res.json({ message: "Deleted successfully" });
  } catch (err) {
    console.error("EVENT DELETE ERROR:", err);
    res.status(500).json({ message: "Delete failed" });
  }
});

/* -----------------------------
   📧 BULK EMAIL TO EVENT REGISTRANTS (ADMIN)
   Sends the same subject/message to a chosen set of registrants for one
   event — e.g. everyone whose payment is still Pending for "Kutumb Utsav".
   Accepts an explicit recipients list (built client-side from whatever
   rows the admin has selected or filtered to in the Event Registration
   table), OR a paymentStatus filter so the server can pull the matching
   set itself straight from the DB (handy for "email everyone Pending",
   even rows not currently loaded/visible on the client).
   Reuses sendBulkEmail, which personalizes each email with "Dear <name>,"
   using the registrant's own name.
------------------------------ */
async function excludeEmailOptOuts(recipients, organisationId = 1) {
  const { rows } = await pool.query(
    "SELECT DISTINCT lower(email) AS email FROM kutumb_supporters WHERE organisation_id=$1 AND email_opt_out=TRUE",
    [organisationId]
  );
  const optedOut = new Set(rows.map((row) => row.email));
  const filtered = recipients.filter((recipient) => !optedOut.has(String(recipient.email).toLowerCase()));
  return { recipients: filtered, skipped: recipients.length - filtered.length };
}

app.post("/api/events/send-bulk-email", requireAdmin, async (req, res) => {
  try {
    const { eventName, eventYear, subject, message, recipients: recipientsInput, paymentStatus } = req.body;

    if (!eventName || !eventYear) {
      return res.status(400).json({ message: "Missing event" });
    }
    if (!subject?.trim() || !message?.trim()) {
      return res.status(400).json({ message: "Subject and message are required" });
    }

    // Every event email always states the recipient's Kutumb membership
    // number (if they're a registered member) and, if this event still has
    // a payment pending for them, the exact amount owed — regardless of
    // what the admin typed in the message, so it's never accidentally left
    // out of a payment-reminder email.
    const withPendingAmount = (r) => {
      const fee = Number(r.fee) || 0;
      const paid = Number(r.paymentAmount) || 0;
      return { email: r.email, name: r.name || "", membershipNumber: r.membershipNumber || null, pendingAmount: Math.max(fee - paid, 0) };
    };

    let recipients;
    if (Array.isArray(recipientsInput) && recipientsInput.length > 0) {
      recipients = recipientsInput.filter((r) => r?.email).map(withPendingAmount);
    } else if (paymentStatus) {
      // e.g. paymentStatus: "Pending" — email everyone still owing for this event.
      const { rows } = await pool.query(
        `SELECT name, email, membership_number, fee, payment_amount FROM kutumb_event_registrations
         WHERE event_name = $1 AND event_year = $2 AND payment_status = $3`,
        [eventName, eventYear, paymentStatus]
      );
      recipients = rows
        .filter((r) => r.email)
        .map((r) => withPendingAmount({ email: r.email, name: r.name, membershipNumber: r.membership_number, fee: r.fee, paymentAmount: r.payment_amount }));
    } else {
      return res.status(400).json({ message: "No recipients selected" });
    }

    // De-duplicate (case-insensitive) — a family sharing one email registered
    // as multiple rows would otherwise get the same email twice.
    const seen = new Set();
    recipients = recipients.filter(({ email }) => {
      const key = email.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    if (recipients.length === 0) {
      return res.status(400).json({ message: "No recipients to send to" });
    }

    const filtered = await excludeEmailOptOuts(recipients);
    recipients = filtered.recipients;
    if (recipients.length === 0) return res.status(400).json({ message: "All selected recipients have opted out of non-essential email." });
    const results = await sendBulkEmail({ recipients, subject: subject.trim(), message });
    res.json({
      message: `Sent to ${results.sent} of ${results.total} recipient(s)${results.failed ? `, ${results.failed} failed` : ""}.`,
      skippedOptOuts: filtered.skipped,
      ...results,
    });
  } catch (err) {
    console.error("EVENT BULK EMAIL ERROR:", err);
    res.status(500).json({ message: "Failed to send bulk email" });
  }
});

/* -----------------------------
   📊 GET SINGLE EVENT (by name + year)
------------------------------ */
app.get("/api/events/:eventName/:eventYear", requireAdmin, async (req, res) => {
  const { eventName, eventYear } = req.params;
  const { rows } = await pool.query(
    "SELECT * FROM kutumb_event_registrations WHERE event_name = $1 AND event_year = $2 ORDER BY created_at",
    [eventName, eventYear]
  );
  res.json(rows);
});

/* -----------------------------
   💳 PAYMENT METHODS (public)
   Which payment options the registration-success page should offer —
   toggled by an admin under Settings & Access → Payment Methods.
------------------------------ */
app.get("/api/payment-methods", async (req, res) => {
  try {
    // Never let a browser, proxy, or CDN cache this — it reflects a toggle
    // an admin can flip at any time, and a stale cached response is exactly
    // what would make a newly-enabled payment method look like it's "not
    // coming" on the donate/registration forms.
    res.set("Cache-Control", "no-store");
    res.json(await getPaymentMethodSettings());
  } catch (err) {
    console.error("PAYMENT METHODS ERROR:", err);
    // Fail safe to the existing default behaviour rather than breaking the
    // registration success page if this lookup has a problem.
    res.json({ bankTransfer: true, card: false });
  }
});

/* -----------------------------
   🔎 LOOK UP A MEMBER BY NAME + EMAIL
   Used to live-populate the membership number field on the event
   registration and donation forms as the person types.
------------------------------ */
app.get("/api/members/lookup", async (req, res) => {
  try {
    const email = (req.query.email || "").toString().trim().toLowerCase();
    if (!email) return res.json({ found: false });

    const { rows } = await pool.query("SELECT * FROM kutumb_members WHERE lower(email) = $1", [email]);
    const match = rows[0];
    if (!match?.membership_number) return res.json({ found: false });

    res.json({
      found: true,
      membershipNumber: match.membership_number,
      name: match.name,
    });
  } catch (err) {
    console.error("MEMBER LOOKUP ERROR:", err);
    res.status(500).json({ found: false });
  }
});

/* -----------------------------
   👥 GET ALL MEMBERS
------------------------------ */
app.get("/api/members", requireSuperAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT * FROM kutumb_members ORDER BY created_at DESC");
    res.json(
      rows.map((m) => ({
        name: m.name,
        email: m.email,
        phone: m.phone,
        address: m.address,
        interests: m.interests || [],
        membershipNumber: m.membership_number,
        qrCode: m.qr_code,
        createdAt: m.created_at,
      }))
    );
  } catch (err) {
    console.error("GET /members error:", err);
    res.status(500).json([]);
  }
});

/* -----------------------------
   ✅ DELETE MEMBER
------------------------------ */
app.post("/api/members/delete", requireSuperAdmin, async (req, res) => {
  try {
    const { membershipNumbers } = req.body;
    if (!membershipNumbers || !Array.isArray(membershipNumbers) || !membershipNumbers.length) {
      return res.status(400).json({ message: "No membership numbers provided" });
    }

    // Deletes by membership number, not email — email is intentionally not
    // unique (family members can share one household email), so deleting
    // by email would wipe out every member on that email at once.
    await pool.query("DELETE FROM kutumb_members WHERE membership_number = ANY($1)", [membershipNumbers]);
    res.json({ message: "Members deleted" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Delete failed" });
  }
});

/* -----------------------------
   ✅ UPDATE MEMBER
------------------------------ */
app.post("/api/members/update", requireSuperAdmin, async (req, res) => {
  try {
    const { membershipNumber, updatedData } = req.body;
    if (!membershipNumber) return res.status(400).json({ message: "Membership number required" });

    let interests = updatedData?.interests;
    if (typeof interests === "string") {
      interests = interests.split(",").map((i) => i.trim()).filter(Boolean);
    }

    const newEmail = updatedData?.email?.trim();
    const newName = updatedData?.name?.trim();

    // If either name or email is changing, make sure the resulting
    // (name, email) pair isn't already used by a *different* member —
    // matching the same uniqueness rule enforced by the database
    // constraint, checked here first for a friendlier error message.
    if (newEmail && newName) {
      const dupCheck = await pool.query(
        `SELECT id FROM kutumb_members
         WHERE lower(email) = lower($1) AND lower(name) = lower($2) AND membership_number <> $3`,
        [newEmail, newName, membershipNumber]
      );
      if (dupCheck.rows.length > 0) {
        return res.status(409).json({ message: "That name and email combination is already used by another member" });
      }
    }

    const { rows } = await pool.query(
      `UPDATE kutumb_members SET
         name = COALESCE($1, name),
         email = COALESCE(NULLIF($2, ''), email),
         phone = COALESCE($3, phone),
         address = COALESCE($4, address),
         interests = COALESCE($5, interests)
       WHERE membership_number = $6
       RETURNING *`,
      [updatedData?.name, newEmail || null, updatedData?.phone, updatedData?.address, interests || null, membershipNumber]
    );

    if (rows.length === 0) return res.status(404).json({ message: "Member not found" });
    res.json({ message: "Member updated successfully" });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ message: "That name and email combination is already used by another member" });
    }
    console.error(err);
    res.status(500).json({ message: "Update failed" });
  }
});

/* -----------------------------
   ✅ UPCOMING EVENTS
------------------------------ */
app.get("/api/location-provider/reverse", async (req, res) => {
  const lat = Number(req.query.lat);
  const lon = Number(req.query.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return res.status(400).json({ message: "A valid location is required." });
  }
  const cacheKey = `${lat.toFixed(3)},${lon.toFixed(3)}`;
  const cached = reverseGeocodeCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return res.json(cached.result);

  const lookup = reverseGeocodeQueue.then(async () => {
    const delay = Math.max(0, nextReverseGeocodeAt - Date.now());
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    nextReverseGeocodeAt = Date.now() + 1000;
    const provider = process.env.GEOCODING_REVERSE_URL || "https://nominatim.openstreetmap.org/reverse";
    const url = new URL(provider);
    url.search = new URLSearchParams({ format: "jsonv2", lat: String(lat), lon: String(lon), zoom: "10", addressdetails: "1" }).toString();
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": `KutumbLink/1.0 (${process.env.LEGAL_CONTACT_EMAIL || "support@kutumblink.com.au"})`,
        Referer: process.env.PUBLIC_BASE_URL || "https://kutumblink.com.au/",
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error(`Reverse geocoder responded ${response.status}`);
    const result = await response.json();
    reverseGeocodeCache.set(cacheKey, { result, expiresAt: Date.now() + 5 * 60 * 1000 });
    if (reverseGeocodeCache.size > 2000) reverseGeocodeCache.delete(reverseGeocodeCache.keys().next().value);
    return result;
  });
  reverseGeocodeQueue = lookup.then(() => undefined, () => undefined);
  try {
    const result = await lookup;
    res.set("Cache-Control", "private, max-age=300").json(result);
  } catch (error) {
    console.error("Location lookup failed:", error.message);
    res.status(502).json({ message: "Location lookup is temporarily unavailable." });
  }
});

app.get("/api/upcoming-events", async (req, res) => {
  try {
    await archiveExpiredUpcomingEvents();

    const debug = req.query.debug === "true";

    const { rows: events } = await pool.query(
      `SELECT e.*,o.public_name AS charity_public_name,o.slug AS charity_slug,o.causes AS charity_causes,
              o.public_profile_enabled
       FROM kutumb_upcoming_events e
       LEFT JOIN kutumb_organisations o ON o.id=e.organisation_id ORDER BY e.id`
    );

    const enriched = await Promise.all(
      events.map(async (event) => {
        const eventYear = event.date_text ? String(year(event.date_text)) : "unknown";
        const { rows: regRows } = await pool.query(
          "SELECT adults, children FROM kutumb_event_registrations WHERE lower(event_name) = lower($1) AND event_year = $2 AND registration_status <> 'cancelled'",
          [event.title, eventYear]
        );
        const totalRegistered = regRows.reduce((sum, r) => sum + 1 + (Number(r.adults) || 0) + (Number(r.children) || 0), 0);
        const capacity = Number(event.capacity || 0);
        const availableSpots = Math.max(capacity - totalRegistered, 0);

        return {
          title: event.title,
          eventYear,
          date: event.date_text,
          time: event.time_text,
          location: event.location,
          capacity,
          memberFee: Number(event.member_fee) || 0,
          nonMemberFee: Number(event.non_member_fee) || 0,
          under5Free: event.under5_free !== false,
          childMemberFee: event.child_member_fee !== null ? Number(event.child_member_fee) : null,
          childNonMemberFee: event.child_non_member_fee !== null ? Number(event.child_non_member_fee) : null,
          description: event.description,
          isActive: event.is_active,
          published: event.published,
          eventType: event.event_type || "community",
          eventMode: event.event_mode || "in_person",
          accessibilityNotes: event.accessibility_notes || "",
          faqs: Array.isArray(event.faqs) ? event.faqs : [],
          charityName: event.public_profile_enabled ? (event.charity_public_name || null) : null,
          charitySlug: event.public_profile_enabled ? (event.charity_slug || null) : null,
          causes: event.public_profile_enabled ? (event.charity_causes || []) : [],
          startingPriceCents: await pool.query("SELECT MIN(CASE WHEN pricing_mode='pay_what_you_feel' THEN minimum_price_cents ELSE price_cents END)::int AS price FROM kutumb_ticket_types WHERE event_id=$1", [slugify(event.title)]).then((result) => result.rows[0]?.price ?? null),
          flyerImage: event.flyer_image || "",
          createdAt: event.created_at,
          updatedAt: event.updated_at,
          registrationsCount: totalRegistered,
          availableSpots,
          ...(debug && { _debug: { eventYear, registrationsFound: regRows.length } }),
        };
      })
    );

    res.json(enriched);
  } catch (err) {
    console.error("UPCOMING EVENTS ERROR:", err);
    res.status(500).json([]);
  }
});

/* -----------------------------
   ✅ UPCOMING EVENTS UPDATE (upsert by title)
------------------------------ */
app.post("/api/upcoming-events/update", requireAdmin, async (req, res) => {
  try {
    const e = req.body;
    if (!e?.title?.trim()) return res.status(400).json({ message: "Title is required" });

    const existing = await pool.query("SELECT id, flyer_image FROM kutumb_upcoming_events WHERE title = $1", [e.title]);

    if (existing.rows.length > 0) {
      await pool.query(
        `UPDATE kutumb_upcoming_events SET
           date_text = COALESCE($1, date_text), time_text = COALESCE($2, time_text),
           location = COALESCE($3, location), capacity = COALESCE($4, capacity),
           member_fee = COALESCE($5, member_fee), non_member_fee = COALESCE($6, non_member_fee),
           description = COALESCE($7, description), is_active = COALESCE($8, is_active),
           published = COALESCE($9, published), flyer_image = COALESCE($10, flyer_image),
           under5_free = COALESCE($12, under5_free),
           child_member_fee = CASE WHEN $13 THEN $14 ELSE child_member_fee END,
           child_non_member_fee = CASE WHEN $15 THEN $16 ELSE child_non_member_fee END,
           event_type = COALESCE($17,event_type), event_mode = COALESCE($18,event_mode),
           accessibility_notes = COALESCE($19,accessibility_notes), faqs = COALESCE($20,faqs),
           updated_at = now()
         WHERE title = $11`,
        [
          e.date, e.time, e.location, e.capacity !== undefined ? Number(e.capacity) : null,
          e.memberFee !== undefined ? Number(e.memberFee) : null, e.nonMemberFee !== undefined ? Number(e.nonMemberFee) : null,
          e.description, e.isActive, e.published, e.flyerImage || existing.rows[0].flyer_image, e.title,
          e.under5Free !== undefined ? !!e.under5Free : null,
          e.childMemberFee !== undefined, e.childMemberFee !== undefined ? (e.childMemberFee === "" || e.childMemberFee === null ? null : Number(e.childMemberFee)) : null,
          e.childNonMemberFee !== undefined, e.childNonMemberFee !== undefined ? (e.childNonMemberFee === "" || e.childNonMemberFee === null ? null : Number(e.childNonMemberFee)) : null,
          e.eventType || null, e.eventMode || null, e.accessibilityNotes ?? null, e.faqs ? JSON.stringify(e.faqs) : null,
        ]
      );
      res.json({ message: "Event updated" });
    } else {
      await pool.query(
        `INSERT INTO kutumb_upcoming_events
           (title, date_text, time_text, location, capacity, member_fee, non_member_fee, description, is_active, published, flyer_image,
            under5_free, child_member_fee, child_non_member_fee,event_type,event_mode,accessibility_notes,faqs)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
        [
          e.title, e.date || null, e.time || null, e.location || null, Number(e.capacity) || 0,
          Number(e.memberFee) || 0, Number(e.nonMemberFee) || 0, e.description || null,
          !!e.isActive, e.published ?? true, e.flyerImage || null,
          e.under5Free !== undefined ? !!e.under5Free : true,
          e.childMemberFee !== undefined && e.childMemberFee !== "" ? Number(e.childMemberFee) : null,
          e.childNonMemberFee !== undefined && e.childNonMemberFee !== "" ? Number(e.childNonMemberFee) : null,
          e.eventType || "community", e.eventMode || "in_person", e.accessibilityNotes || null, JSON.stringify(e.faqs || []),
        ]
      );
      res.json({ message: "Event added" });
    }
  } catch (err) {
    console.error("UPCOMING EVENTS UPDATE ERROR:", err);
    res.status(500).json({ message: "Update failed" });
  }
});

/* -----------------------------
   ✅ DELETE AN UPCOMING EVENT
------------------------------ */
app.post("/api/upcoming-events/delete", requireAdmin, async (req, res) => {
  try {
    const { title } = req.body;
    await pool.query("DELETE FROM kutumb_upcoming_events WHERE title = $1", [title]);
    res.json({ message: "Event deleted successfully" });
  } catch (err) {
    console.error("DELETE UPCOMING EVENT ERROR:", err);
    res.status(500).json({ message: "Delete failed" });
  }
});

/* -----------------------------
   📁 FLYER STORAGE — image bytes go straight into Postgres
   (kutumb_media_files) via memory storage, never touching disk.
------------------------------ */
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

/* -----------------------------
   ✅ FLYER UPLOAD + LINK
------------------------------ */
app.post("/api/upload-flyer", requireAdmin, upload.single("flyer"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: "No file uploaded" });

    const fileName = Date.now() + "-" + req.file.originalname.replace(/\s+/g, "-");
    const { event } = req.body;
    if (!event) return res.status(400).json({ message: "Event data missing" });

    await pool.query(
      "INSERT INTO kutumb_media_files (filename, mimetype, size_bytes, data) VALUES ($1,$2,$3,$4)",
      [fileName, req.file.mimetype, req.file.size, req.file.buffer]
    );

    const parsedEvent = JSON.parse(event);
    const { rows } = await pool.query(
      "UPDATE kutumb_upcoming_events SET flyer_image = $1, updated_at = now() WHERE title = $2 RETURNING id",
      [fileName, parsedEvent.title?.trim()]
    );

    res.json({
      message: rows.length > 0 ? "Flyer linked successfully" : "Upload done but event not matched",
      fileName,
      updated: rows.length > 0,
    });
  } catch (err) {
    console.error("UPLOAD FLYER ERROR:", err);
    res.status(500).json({ message: "Upload failed" });
  }
});

/* -----------------------------
   ✅ DELETE FLYER
------------------------------ */
app.post("/api/delete-flyer", requireAdmin, async (req, res) => {
  try {
    const { title, fileName } = req.body;
    if (!title || !fileName) return res.status(400).json({ message: "Missing data" });

    await pool.query("DELETE FROM kutumb_media_files WHERE filename = $1", [fileName]);
    await pool.query("UPDATE kutumb_upcoming_events SET flyer_image = '', updated_at = now() WHERE title = $1", [title]);
    return res.json({ message: "Flyer deleted successfully" });
  } catch (err) {
    console.error("DELETE FLYER ERROR:", err);
    return res.status(500).json({ message: "Delete failed" });
  }
});

/* -----------------------------
   🔌 EXECUTIVE TEAM
------------------------------ */

// ✅ serve images
app.use("/team-images", express.static(path.join(DATA_ROOT, "team")));

// ✅ TEAM API
app.get("/api/team", async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT * FROM kutumb_team_profiles ORDER BY sort_order, id");
    res.json(rows.map((t) => ({ name: t.name, role: t.role, phone: t.phone, email: t.email, bio: t.bio, image: t.image })));
  } catch (err) {
    console.error("TEAM API ERROR:", err);
    res.status(500).json([]);
  }
});

/* -----------------------------
   🔌 KUTUMB ACTIVITIES
------------------------------ */

app.use("/activity-images", express.static(path.join(DATA_ROOT, "activities")));

app.get("/api/activities", async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT * FROM kutumb_activities ORDER BY sort_order, id");
    res.json(
      rows.map((a) => ({
        title: a.title,
        image1: a.image1,
        image2: a.image2,
        description: a.description,
        schedule: a.schedule,
        participationOptions: a.participation_options || [],
        onlineYoga: a.online_yoga || [],
        inPersonYoga: a.in_person_yoga || [],
        benefits: a.benefits || [],
      }))
    );
  } catch (err) {
    console.error("ACTIVITIES API ERROR:", err);
    res.status(500).json([]);
  }
});

/* -----------------------------
   🔌 KUTUMB ACTIVITIES REGISTRATION
------------------------------ */

app.post("/api/activity-register", async (req, res) => {
  try {
    const data = req.body;
    if (!data.activityTitle || !data.email) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    const { name, email, activityTitle, ...rest } = data;
    try {
      await pool.query(
        "INSERT INTO kutumb_activity_registrations (activity_title, name, email, details) VALUES ($1,$2,$3,$4)",
        [activityTitle, name || null, email, JSON.stringify(rest)]
      );
    } catch (err) {
      if (err.code === "23505") {
        // unique constraint on (activity_title, lower(email))
        return res.status(409).json({ message: "You are already registered for this activity." });
      }
      throw err;
    }

    res.status(201).json({ message: "Registration successful!" });
  } catch (err) {
    console.error("ACTIVITY REGISTER ERROR:", err);
    res.status(500).json({ message: "Server error" });
  }
});

app.get("/api/email/status", async (req, res) => {
  const status = await checkEmailConfig();
  res.json(status);
});

app.post("/api/email/test-send", requireAdmin, async (req, res) => {
  const { to } = req.body;
  if (!to) return res.status(400).json({ message: "'to' email address is required" });

  const result = await sendTestEmail(to);
  if (!result.sent) {
    return res.status(502).json({ message: result.error || "Failed to send test email" });
  }
  res.json({ message: `Test email sent to ${to}` });
});

/* -----------------------------
   📧 BULK EMAIL TO MEMBERS (ADMIN)
   Sends the same subject/message to a chosen set of members - either every
   currently registered member, or a specific list of emails picked in the
   admin console. Sends are handled by sendBulkEmail (sequential, one at a
   time), so a bad address for one member never blocks the rest, and the
   admin gets back a clear sent/failed count instead of a single flag.
------------------------------ */
app.post("/api/members/send-bulk-email", requireSuperAdmin, async (req, res) => {
  try {
    const { subject, message, emails, recipients: recipientsInput, sendToAll } = req.body;

    if (!subject?.trim() || !message?.trim()) {
      return res.status(400).json({ message: "Subject and message are required" });
    }

    let recipients;
    if (sendToAll) {
      // Pull name + membership number alongside email so every member
      // gets a "Dear <name>," greeting and their own membership number
      // stated in the email, not just a generic one.
      const { rows } = await pool.query("SELECT name, email, membership_number FROM kutumb_members");
      recipients = rows
        .filter((r) => r.email)
        .map((r) => ({ email: r.email, name: r.name || "", membershipNumber: r.membership_number || null }));
    } else if (Array.isArray(recipientsInput) && recipientsInput.length > 0) {
      // Preferred shape: [{ email, name, membershipNumber }, ...] from the
      // admin console, so the greeting AND membership number can be
      // personalized for hand-picked recipients too.
      recipients = recipientsInput
        .filter((r) => r?.email)
        .map((r) => ({ email: r.email, name: r.name || "", membershipNumber: r.membershipNumber || null }));
    } else if (Array.isArray(emails) && emails.length > 0) {
      // Legacy shape: a bare list of email addresses, no name on the
      // request itself - look membership numbers up by email so this path
      // still states them, same as every other bulk email.
      const lowerEmails = emails.filter(Boolean).map((e) => String(e).toLowerCase());
      const { rows: memberRows } = await pool.query(
        "SELECT email, membership_number FROM kutumb_members WHERE lower(email) = ANY($1)",
        [lowerEmails]
      );
      const membershipByEmail = new Map(memberRows.map((r) => [r.email.toLowerCase(), r.membership_number]));
      recipients = emails
        .filter(Boolean)
        .map((email) => ({ email, name: "", membershipNumber: membershipByEmail.get(String(email).toLowerCase()) || null }));
    } else {
      return res.status(400).json({ message: "No recipients selected" });
    }

    // De-duplicate (case-insensitive) in case the same address slipped in twice.
    const seen = new Set();
    recipients = recipients.filter(({ email }) => {
      const key = email.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    if (recipients.length === 0) {
      return res.status(400).json({ message: "No recipients to send to" });
    }

    const filtered = await excludeEmailOptOuts(recipients);
    recipients = filtered.recipients;
    if (recipients.length === 0) return res.status(400).json({ message: "All selected recipients have opted out of non-essential email." });
    const results = await sendBulkEmail({ recipients, subject: subject.trim(), message });
    res.json({
      message: `Sent to ${results.sent} of ${results.total} recipient(s)${results.failed ? `, ${results.failed} failed` : ""}.`,
      skippedOptOuts: filtered.skipped,
      ...results,
    });
  } catch (err) {
    console.error("BULK EMAIL ERROR:", err);
    res.status(500).json({ message: "Failed to send bulk email" });
  }
});

/* -----------------------------
   ✨ AI-DRAFT AN EMAIL (ADMIN)
   Takes a short brief ("reminder about the Diwali event, free for members")
   and returns a subject + body the admin can review and edit in the Send
   Email dialog before anything is sent. Never sends anything itself.
------------------------------ */
app.post("/api/members/generate-email-draft", requireSuperAdmin, async (req, res) => {
  try {
    const { topic } = req.body;
    const draft = await generateEmailDraft({ topic });
    res.json(draft);
  } catch (err) {
    res.status(400).json({ message: err.message || "Failed to generate draft" });
  }
});


app.get("/api/whatsapp/status", (req, res) => {
  const configured = !!(process.env.WHATSAPP_PHONE_NUMBER_ID && process.env.WHATSAPP_ACCESS_TOKEN);
  const publicUrlOk = !!process.env.PUBLIC_BASE_URL && !process.env.PUBLIC_BASE_URL.includes("localhost");

  res.json({
    configured,
    senderNumber: process.env.WHATSAPP_SENDER_NUMBER || null,
    publicBaseUrl: PUBLIC_BASE_URL,
    publicBaseUrlIsPublic: publicUrlOk,
    readyToSend: configured && publicUrlOk,
    notes: [
      !configured && "WHATSAPP_PHONE_NUMBER_ID and/or WHATSAPP_ACCESS_TOKEN missing from .env",
      !publicUrlOk &&
        "PUBLIC_BASE_URL must be a real public https URL (not localhost) so Meta can fetch the card PDF",
    ].filter(Boolean),
  });
});

/* -----------------------------
   💛 DONATIONS
------------------------------ */

app.post("/api/donations", async (req, res) => {
  try {
    console.log("DONATION REQUEST:", {
      contentType: req.headers["content-type"],
      contentLength: req.headers["content-length"],
      body: req.body,
    });
    const { name, email, amount, bankTransferred, transactionNumber, organisationId, campaignId, eventId, fundraisingPageId, isAnonymous, donorMessage } = req.body || {};
    const attribution = req.body?.attribution && typeof req.body.attribution === "object" ? req.body.attribution : {};
    const attributionSource = String(attribution.source || "").trim().slice(0, 120) || null;
    const attributionMedium = String(attribution.medium || "").trim().slice(0, 120) || null;
    const attributionCampaign = String(attribution.campaign || "").trim().slice(0, 160) || null;
    const attributionReferrer = String(attribution.referrer || "").trim().slice(0, 500) || null;

    if (!name?.trim() || !email?.trim() || !Number.isFinite(Number(amount)) || Number(amount) <= 0 || Number(amount) > 1000000) {
      return res.status(400).json({ message: "Name, email and amount are required" });
    }
    if (bankTransferred && !transactionNumber?.trim()) {
      return res.status(400).json({ message: "Transaction number is required when bank transfer is marked as done" });
    }

    let donationOrganisationId = Number(organisationId) || 1;
    let resolvedCampaignId = null;
    let resolvedEventId = null;
    let resolvedPageId = null;
    let teamId = null;
    if (fundraisingPageId && !campaignId && !organisationId) {
      const { rows: pageRows } = await pool.query("SELECT organisation_id FROM kutumb_fundraising_pages WHERE id=$1 AND status='published'", [fundraisingPageId]);
      if (!pageRows[0]) return res.status(404).json({ message: "This fundraising page is not available" });
      donationOrganisationId = Number(pageRows[0].organisation_id);
    }
    if (campaignId) {
      const { rows: campaignRows } = await pool.query(
        "SELECT c.id,c.organisation_id,c.internal_giving_enabled,c.status,o.verification_status,o.public_profile_enabled,o.is_active FROM kutumb_organisation_campaigns c JOIN kutumb_organisations o ON o.id=c.organisation_id WHERE c.id=$1",
        [campaignId]
      );
      const campaign = campaignRows[0];
      if (!campaign || campaign.status !== "published" || !campaign.internal_giving_enabled || campaign.is_active !== true || campaign.public_profile_enabled !== true || campaign.verification_status !== "approved") {
        return res.status(400).json({ message: "This campaign is not accepting donations through KutumbLink" });
      }
      donationOrganisationId = Number(campaign.organisation_id);
      resolvedCampaignId = campaign.id;
    } else if (organisationId) {
      const { rows: organisationRows } = await pool.query("SELECT id,verification_status,public_profile_enabled,is_active FROM kutumb_organisations WHERE id=$1", [donationOrganisationId]);
      const org = organisationRows[0];
      if (!org || org.is_active !== true || org.public_profile_enabled !== true || org.verification_status !== "approved") return res.status(404).json({ message: "This charity is not accepting donations on KutumbLink" });
    }
    if (eventId) {
      const { rows: eventRows } = await pool.query(`SELECT e.id,e.title,e.organisation_id,e.is_active,e.published,o.verification_status,o.public_profile_enabled,o.is_active AS organisation_active
        FROM kutumb_upcoming_events e LEFT JOIN kutumb_organisations o ON o.id=e.organisation_id`);
      const event = eventRows.find((row) => slugify(row.title) === String(eventId) || String(row.id) === String(eventId));
      if (!event || event.is_active !== true || event.published !== true) return res.status(404).json({ message: "This event is not accepting donations" });
      if (event.organisation_active !== true || event.public_profile_enabled !== true || event.verification_status !== "approved") return res.status(404).json({ message: "This event is not accepting donations" });
      if ((organisationId || resolvedCampaignId) && Number(event.organisation_id) !== donationOrganisationId) return res.status(403).json({ message: "The event and charity do not match" });
      donationOrganisationId = Number(event.organisation_id) || 1;
      resolvedEventId = slugify(event.title);
    }
    if (fundraisingPageId) {
      const { rows: pageRows } = await pool.query(`SELECT p.id,p.organisation_id,p.team_id,p.campaign_id,p.event_id,p.status,o.verification_status,o.public_profile_enabled,o.is_active
        FROM kutumb_fundraising_pages p JOIN kutumb_organisations o ON o.id=p.organisation_id WHERE p.id=$1`, [fundraisingPageId]);
      const page = pageRows[0];
      if (!page || page.status !== "published" || !page.is_active || !page.public_profile_enabled || page.verification_status !== "approved" || Number(page.organisation_id) !== donationOrganisationId) return res.status(404).json({ message: "This fundraising page is not available" });
      if (resolvedCampaignId && Number(page.campaign_id) !== Number(resolvedCampaignId)) return res.status(403).json({ message: "This fundraiser is for a different campaign" });
      resolvedPageId = page.id;
      teamId = page.team_id;
      resolvedCampaignId = resolvedCampaignId || page.campaign_id;
      resolvedEventId = resolvedEventId || page.event_id;
    }
    // All online giving uses the existing central Kutumb provider account.
    // The settlement ledger attributes confirmed receipts to this charity for
    // later manual transfer by a platform administrator.

    // Look up membership number, same as the event registration form
    const { rows: memberRows } = await pool.query("SELECT membership_number FROM kutumb_members WHERE lower(email) = lower($1)", [email]);
    const matchedMember = memberRows[0] || null;

    const { rows } = await pool.query(
      `INSERT INTO kutumb_donations
         (name, email, membership_number, amount, bank_transferred, transaction_number, payment_status, payment_method,
          organisation_id,campaign_id,event_id,fundraising_page_id,team_id,is_anonymous,donor_message,tax_classification,attribution_source,attribution_medium,attribution_campaign,attribution_referrer)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'not_claimed',$16,$17,$18,$19) RETURNING *`,
      [
        name, email, matchedMember?.membership_number || null, Number(amount), !!bankTransferred,
        bankTransferred ? transactionNumber : null,
        bankTransferred ? "Paid" : "Pending",
        bankTransferred ? "bank_transfer" : null, donationOrganisationId, resolvedCampaignId, resolvedEventId,
        resolvedPageId, teamId, !!isAnonymous, String(donorMessage || "").trim().slice(0, 500),
        attributionSource, attributionMedium, attributionCampaign, attributionReferrer,
      ]
    );
    const donation = rows[0];

    // Only send the thank-you email here when the donation is already paid
    // (a bank transfer the donor says they've already made). For card,
    // Square and PayPal, this row is just "Pending" — the email goes out
    // later from markDonationPaymentPaid(), once the provider actually
    // confirms the payment.
    if (donation.payment_status === "Paid") {
      sendDonationThankYouEmail({
        to: email,
        name,
        amount: Number(donation.amount),
        membershipNumber: donation.membership_number,
        paid: true,
        bankTransferred: donation.bank_transferred,
        transactionNumber: donation.transaction_number,
      }).catch((err) => console.error("Donation email error:", err));
    }

    res.status(201).json({
      message: "Thank you for your donation",
      donation: { ...donation, id: donation.id, paymentStatus: donation.payment_status },
    });
  } catch (err) {
    console.error("DONATION ERROR:", err);
    res.status(500).json({ message: "Server error" });
  }
});

app.get("/api/donations", requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT * FROM kutumb_donations ORDER BY created_at DESC");
    res.json(
      rows.map((d) => ({
        id: d.id,
        name: d.name,
        email: d.email,
        membershipNumber: d.membership_number,
        amount: Number(d.amount),
        bankTransferred: d.bank_transferred,
        transactionNumber: d.transaction_number,
        paymentStatus: d.payment_status,
        paymentMethod: d.payment_method,
        createdAt: d.created_at,
      }))
    );
  } catch (err) {
    console.error("GET DONATIONS ERROR:", err);
    res.status(500).json([]);
  }
});

/* -----------------------------
   💳 DONATION PAYMENT — CARD (Stripe hosted checkout)
   A plain Stripe Checkout Session (hosted page, not embedded) for the
   donation's fixed amount — simpler than the ticketing system's embedded
   flow, and donations don't need ticket types/attendees at all. Confirmed
   via the same Stripe webhook used for ticketing/registrations
   (checkout.session.completed, matched here by session id).
------------------------------ */
app.post("/api/donations/:id/checkout-card", async (req, res) => {
  try {
    const donationId = Number(req.params.id);
    const { rows } = await pool.query("SELECT * FROM kutumb_donations WHERE id = $1", [donationId]);
    const donation = rows[0];
    if (!donation) return res.status(404).json({ message: "Donation not found" });
    if (donation.payment_status === "Paid") {
      return res.status(400).json({ message: "This donation has already been paid" });
    }

    const stripe = await getStripe();
    if (!stripe) {
      return res.status(503).json({ message: "Card payments aren't configured yet. Ask the admin to add a Stripe secret key in the Admin Console." });
    }

    const baseUrl = await getPublicBaseUrl(req);
    const amount = Number(donation.amount);

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: donation.email,
      line_items: [
        {
          price_data: {
            currency: "aud",
            product_data: { name: `Kutumb donation — ${donation.name}` },
            unit_amount: Math.round(amount * 100),
          },
          quantity: 1,
        },
      ],
      success_url: `${baseUrl}/checkout/return?provider=stripe-donation&donationId=${donationId}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/checkout/return?provider=stripe-donation&donationId=${donationId}&cancelled=1`,
      metadata: { donationId: String(donationId) },
    });

    await recordDonationPaymentAttempt(donationId, "card", session.id, amount);
    res.json({ url: session.url });
  } catch (err) {
    console.error("DONATION CARD CHECKOUT ERROR:", err);
    res.status(500).json({ message: "Could not start card checkout" });
  }
});

app.get("/api/donations/:id/status", async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT * FROM kutumb_donation_payments WHERE donation_id = $1 AND provider = 'card' ORDER BY created_at DESC LIMIT 1",
      [req.params.id]
    );
    const payment = rows[0];
    if (!payment) return res.status(404).json({ message: "No card payment found for this donation" });

    if (payment.status === "pending") {
      const stripe = await getStripe();
      if (stripe) {
        try {
          const session = await stripe.checkout.sessions.retrieve(payment.provider_reference);
          if (session.payment_status === "paid") {
            await markDonationPaymentPaid(payment.id, session.payment_status, session.payment_intent);
          }
        } catch (err) {
          console.error("DONATION STRIPE STATUS CHECK ERROR:", err);
        }
      }
    }

    const refreshed = await getDonationPayment(payment.id);
    res.json({ status: refreshed?.status || payment.status, donationId: payment.donation_id });
  } catch (err) {
    console.error("DONATION STATUS ERROR:", err);
    res.status(500).json({ message: "Could not check payment status" });
  }
});

/* -----------------------------
   ✅ MANUAL ARCHIVE TRIGGER (admin)
------------------------------ */
app.post("/api/upcoming-events/archive-now", requireAdmin, async (req, res) => {
  try {
    await archiveExpiredUpcomingEvents();
    res.json({ message: "Archive check complete" });
  } catch (err) {
    console.error("MANUAL ARCHIVE ERROR:", err);
    res.status(500).json({ message: "Archive check failed" });
  }
});

/* -----------------------------
   📸 PAST EVENTS - ADMIN MANAGEMENT
   (update text fields, upload/delete media for a past event — photo/video
   bytes go straight into Postgres via memory storage, same as flyers)
------------------------------ */
const uploadPastMedia = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

// Update a past event's description/highlights (matched by title + date)
app.post("/api/pastevents/update", requireAdmin, async (req, res) => {
  try {
    const { title, date, description, highlights } = req.body;
    if (!title || !date) return res.status(400).json({ message: "title and date are required" });

    const { rows } = await pool.query(
      `UPDATE kutumb_past_events SET
         description = COALESCE($1, description),
         highlights = COALESCE($2, highlights)
       WHERE title = $3 AND date_text = $4
       RETURNING *`,
      [description, highlights, title, date]
    );
    if (rows.length === 0) return res.status(404).json({ message: "Past event not found" });
    res.json({ message: "Past event updated", event: rows[0] });
  } catch (err) {
    console.error("PAST EVENT UPDATE ERROR:", err);
    res.status(500).json({ message: "Update failed" });
  }
});

// Upload a new photo/video and attach it to a past event (matched by title + date)
app.post("/api/pastevents/upload-media", requireAdmin, uploadPastMedia.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: "No file uploaded" });
    const { title, date } = req.body;
    if (!title || !date) return res.status(400).json({ message: "title and date are required" });

    const { rows: eventRows } = await pool.query("SELECT id FROM kutumb_past_events WHERE title = $1 AND date_text = $2", [title, date]);
    if (eventRows.length === 0) return res.status(404).json({ message: "Past event not found" });

    const filename = Date.now() + "-" + req.file.originalname.replace(/\s+/g, "-");
    await pool.query(
      "INSERT INTO kutumb_media_files (filename, mimetype, size_bytes, data) VALUES ($1,$2,$3,$4)",
      [filename, req.file.mimetype, req.file.size, req.file.buffer]
    );

    const mediaItem = {
      type: req.file.mimetype.startsWith("video") ? "video" : "image",
      src: filename,
    };
    const { rows: countRows } = await pool.query("SELECT COUNT(*) FROM kutumb_past_event_media WHERE past_event_id = $1", [eventRows[0].id]);
    await pool.query(
      "INSERT INTO kutumb_past_event_media (past_event_id, type, src, sort_order) VALUES ($1,$2,$3,$4)",
      [eventRows[0].id, mediaItem.type, mediaItem.src, Number(countRows[0].count)]
    );

    res.json({ message: "Media uploaded", media: mediaItem });
  } catch (err) {
    console.error("PAST EVENT MEDIA UPLOAD ERROR:", err);
    res.status(500).json({ message: "Upload failed" });
  }
});

// Remove a specific media item from a past event (matched by title + date + src)
app.post("/api/pastevents/delete-media", requireAdmin, async (req, res) => {
  try {
    const { title, date, src } = req.body;
    if (!title || !date || !src) {
      return res.status(400).json({ message: "title, date and src are required" });
    }

    const { rows: eventRows } = await pool.query("SELECT id FROM kutumb_past_events WHERE title = $1 AND date_text = $2", [title, date]);
    if (eventRows.length === 0) return res.status(404).json({ message: "Past event not found" });

    await pool.query("DELETE FROM kutumb_past_event_media WHERE past_event_id = $1 AND src = $2", [eventRows[0].id, src]);
    await pool.query("DELETE FROM kutumb_media_files WHERE filename = $1", [src]);

    res.json({ message: "Media removed" });
  } catch (err) {
    console.error("PAST EVENT MEDIA DELETE ERROR:", err);
    res.status(500).json({ message: "Delete failed" });
  }
});

/* ----------------------------- 
🚀 START SERVER + FRONTEND 
------------------------------*/
/* -----------------------------
   🔌 FILE MANAGER ROUTES (admin-only)
   Mounted last, deliberately: this router's own router.use(requireAdmin)
   would otherwise shadow every /api/* route defined below it in this file
   (it matches on the bare "/api" prefix). Placing it here means every other
   /api/* route above always gets first chance to match, and this admin
   gate only ever catches genuinely unmatched paths like /api/folders.
------------------------------ */
app.use("/api", fileManagerRoutes);

// 📱 Lightweight standalone check-in app — plain HTML/JS, no React bundle,
// so it opens instantly and can be "Added to Home Screen" as its own app.
// Registered before the SPA static/fallback below so those don't intercept it.
app.use("/checkin-app", express.static(path.join(__dirname, "../checkin-app")));

app.use(express.static(path.join(__dirname, "../dist")));

// -----------------------------
// 🚀 React Router fallback
// -----------------------------
app.use((req, res, next) => {
  if (
    req.method === "GET" &&
    !req.path.startsWith("/api") &&   // 🔥 CRITICAL FIX
    req.accepts("html")
  ) {
    res.sendFile(path.join(__dirname, "../dist/index.html"));
  } else {
    next();
  }
});

//app.get(/.*/, (req, res) => {
  //res.sendFile(path.join(__dirname, "../dist/index.html"));
//});

// -----------------------------
// 🚀 Start server
// -----------------------------
const PORT = process.env.PORT || 8080;

app.listen(PORT, "0.0.0.0", () => {
  console.log("Server running on", PORT);

  // Bank statement drop folder (Google Drive) — only polls once connected.
  startDriveWatcher().catch((err) => console.error("Drive watcher failed to start:", err.message));
  // Payment reminders, auto-cancellation and day-before welcome emails.
  startRegistrationScheduler();
  // Send due consent-based organisation fundraising newsletters.
  processDueFundraisingEmails();
  setInterval(processDueFundraisingEmails, 60_000).unref();
  // Live NAB feed via openfeed — only runs once connected.
  startOpenfeedAutoSync();

  checkEmailConfig().then((status) => {
    if (!status.configured) {
      console.warn("⚠️  Email is NOT configured - set SMTP_HOST (and SMTP_USER/SMTP_PASS) in .env");
    } else if (status.verified) {
      console.log(`✅ Email configured and verified (sending from ${status.from})`);
    } else {
      console.warn(`⚠️  Email is configured but the connection failed: ${status.error}`);
      console.warn("    Double-check SMTP_HOST/PORT/USER/PASS in .env - see the Email section in README.md");
    }
  });

  if (process.env.WHATSAPP_PHONE_NUMBER_ID && process.env.WHATSAPP_ACCESS_TOKEN) {
    console.log(`✅ WhatsApp configured (sender ${process.env.WHATSAPP_SENDER_NUMBER || "unknown"})`);
    if (!process.env.PUBLIC_BASE_URL || process.env.PUBLIC_BASE_URL.includes("localhost")) {
      console.warn(
        "⚠️  PUBLIC_BASE_URL is not set to a public address - WhatsApp document sends will fail " +
        "because Meta's servers cannot download the card PDF from localhost."
      );
    }
  } else {
    console.warn("⚠️  WhatsApp is NOT configured - set WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_ACCESS_TOKEN in .env");
  }

  // Every emailed "Pay Now" link is built from the public base URL, so say
  // loudly at startup if the setting is missing or was saved wrongly.
  getConfiguredPublicBaseUrl()
    .then((url) => {
      if (url && !isLocalUrl(url)) console.log(`✅ Public base URL: ${url}`);
      else if (url) console.warn(`⚠️  Public base URL is ${url} - emailed payment links will only work on this computer. Set your real website address under Settings & Access → Platform (or PUBLIC_BASE_URL in .env).`);
      else console.warn("⚠️  No valid public base URL configured - set it under Settings & Access → Platform (or PUBLIC_BASE_URL in .env). Emailed payment links will fall back to the address of the request that triggered them.");
    })
    .catch((err) => console.error("Public base URL check failed:", err));

  // Move any already-expired events into Past Events on startup,
  // then re-check once an hour as a background safety net (the
  // /api/upcoming-events endpoint also triggers this on every read).
  archiveExpiredUpcomingEvents().catch((err) =>
    console.error("Startup archive check failed:", err)
  );
  setInterval(() => {
    archiveExpiredUpcomingEvents().catch((err) => console.error("Hourly archive check failed:", err));
  }, 60 * 60 * 1000);

  // Pick up a dropped-in members/members.json under the configured DATA_ROOT, if
  // one's been placed there since the last run (see importMembersDropIn.js
  // for the exact behavior — additive only, then removes the folder).
  importMembersDropIn()
    .then((result) => {
      if (result.found) {
        console.log(`📥 Members drop-in: ${result.imported} imported, ${result.skipped} skipped (already existed)`);
      }
    })
    .catch((err) => console.error("Startup members drop-in check failed:", err));
});
