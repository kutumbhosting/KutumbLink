import { Router } from "express";
import ExcelJS from "exceljs";
import { pool } from "../db/pool.js";
import { requireAdmin } from "../lib/auth.js";
import { redeemCouponForRegistration } from "../lib/coupons.js";
import { sendEventPaymentConfirmationEmail } from "../lib/mailer.js";
import { generateQrDataUrl } from "../lib/membershipCard.js";
import { sendEventTickets } from "../lib/tickets.js";

const router = Router();

/* ============================================================
   PUBLIC: pay for (part or all of) a registration with a coupon.
   Mirrors /api/events/record-payment's scoping (event + email match) —
   this is called straight from the registration-success dialog, not by a
   logged-in admin, so it's deliberately narrow: it can only ever touch the
   one registration whose event+email the caller already knows.
   ============================================================ */
router.post("/apply-coupon", async (req, res) => {
  const client = await pool.connect();
  try {
    const { eventName, eventYear, email, couponCode } = req.body;
    if (!eventName || !eventYear || !email || !couponCode?.trim()) {
      return res.status(400).json({ message: "eventName, eventYear, email and couponCode are required" });
    }

    await client.query("BEGIN");
    const { rows: regRows } = await client.query(
      `SELECT * FROM kutumb_event_registrations
       WHERE event_name = $1 AND event_year = $2 AND lower(email) = lower($3)
         AND registration_status <> 'cancelled'
       ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
      [eventName, eventYear, email]
    );
    const registration = regRows[0];
    if (!registration) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Registration not found" });
    }

    const alreadyPaid = Number(registration.payment_amount) || 0;
    const fee = Number(registration.fee) || 0;
    const amountDue = Math.max(fee - alreadyPaid, 0);

    // Only ever deducts up to what's actually still owed — if the coupon is
    // worth more than that, the leftover balance stays on the coupon
    // (still 'active') for a future booking against this same event.
    const redemption = await redeemCouponForRegistration(client, couponCode, eventName, eventYear, registration.id, amountDue);
    if (!redemption.ok) {
      await client.query("ROLLBACK");
      return res.status(400).json({ message: redemption.message });
    }

    const coupon = redemption.coupon;
    const couponApplied = redemption.applied;
    const newAmountPaid = alreadyPaid + couponApplied;
    const fullyPaid = newAmountPaid >= fee;

    const { rows: updated } = await client.query(
      `UPDATE kutumb_event_registrations SET
         payment_amount = $1,
         payment_date = now(),
         coupon_code = $2,
         coupon_amount = COALESCE(coupon_amount, 0) + $3,
         payment_method = 'coupon',
         payment_status = CASE WHEN $4 THEN 'Paid' ELSE payment_status END,
         registration_status = CASE WHEN $4 THEN 'confirmed' ELSE registration_status END
       WHERE id = $5 RETURNING *`,
      [newAmountPaid, coupon.code, couponApplied, fullyPaid, registration.id]
    );

    await client.query("COMMIT");

    if (fullyPaid) {
      sendEventPaymentConfirmationEmail({
        to: registration.email,
        name: registration.name,
        eventName: registration.event_name,
        registrationNumber: registration.registration_number,
        fee,
        transactionNumber: `Coupon ${coupon.code}`,
      }).catch((err) => console.error("Coupon payment email error:", err));

      sendEventTickets(updated[0].id).catch((err) => console.error("Ticket email error:", err));
    }

    const couponLeftover = redemption.remainingBalance;
    res.json({
      message: fullyPaid
        ? couponLeftover > 0
          ? `Coupon applied — your registration is fully paid. $${couponLeftover.toFixed(2)} remains on this coupon for a future booking.`
          : "Coupon applied — your registration is fully paid."
        : `Coupon applied. $${(fee - newAmountPaid).toFixed(2)} still remaining.`,
      amountApplied: couponApplied,
      remaining: Math.max(fee - newAmountPaid, 0),
      couponRemainingBalance: couponLeftover,
      registration: updated[0],
    });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("APPLY COUPON ERROR:", err);
    res.status(500).json({ message: "Could not apply coupon" });
  } finally {
    client.release();
  }
});

/* ============================================================
   ADMIN: list the individual attendees (with QR tokens/check-in status)
   for one registration — powers the "Attendees" dialog on the Event
   Registration table.
   ============================================================ */
router.get("/registration/:id/attendees", requireAdmin, async (req, res) => {
  const { rows } = await pool.query(
    "SELECT * FROM kutumb_registration_attendees WHERE registration_id = $1 ORDER BY id",
    [req.params.id]
  );
  // The QR image encodes only the opaque token (never name/email) and is
  // rendered on demand here rather than stored, using the same `qrcode`
  // library already used for membership cards.
  const withQr = await Promise.all(
    rows.map(async (a) => ({
      id: a.id,
      name: a.name,
      category: a.category,
      qrToken: a.qr_token,
      qrCode: await generateQrDataUrl(a.qr_token),
      checkedInAt: a.checked_in_at,
      checkedInBy: a.checked_in_by,
      checkedInCode: a.checked_in_code,
    }))
  );
  res.json(withQr);
});

/* ============================================================
   ADMIN: filtered Excel export for the Event Registration table.
   The client sends exactly the rows currently visible (after its own
   search/status-filter, or the checkbox-selected subset) — this endpoint
   just lays them out as a formatted workbook, so the download always
   matches whatever the admin is looking at, including manual selection.
   ============================================================ */
router.post("/export-excel", requireAdmin, async (req, res) => {
  try {
    const { eventName, eventYear, rows, scope } = req.body;
    if (!Array.isArray(rows)) return res.status(400).json({ message: "rows array is required" });

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Registrations");

    sheet.columns = [
      { header: "Reg. No", key: "registrationNumber", width: 12 },
      { header: "Name", key: "name", width: 22 },
      { header: "Email", key: "email", width: 26 },
      { header: "Phone", key: "phone", width: 16 },
      { header: "Adults", key: "adults", width: 9 },
      { header: "Children (Under 5)", key: "childrenUnder5", width: 14 },
      { header: "Children (5+)", key: "children5Plus", width: 12 },
      { header: "Fee", key: "fee", width: 10 },
      { header: "Payment Status", key: "paymentStatus", width: 14 },
      { header: "Registration Status", key: "registrationStatus", width: 16 },
      { header: "Payment Method", key: "paymentMethod", width: 14 },
      { header: "Amount Paid", key: "paymentAmount", width: 12 },
      { header: "Date Paid", key: "paymentDate", width: 14 },
      { header: "Transaction No", key: "transactionNumber", width: 16 },
      { header: "Coupon Code", key: "couponCode", width: 14 },
      { header: "Membership No", key: "membershipNumber", width: 14 },
      { header: "Heard About", key: "heardAboutSource", width: 22 },
      { header: "Heard About (Other)", key: "heardAboutOther", width: 26 },
      { header: "Comments", key: "comments", width: 30 },
    ];
    sheet.getRow(1).font = { bold: true };

    for (const r of rows) {
      sheet.addRow({
        registrationNumber: r.registrationNumber || "",
        name: r.name || "",
        email: r.email || "",
        phone: r.phone || "",
        adults: r.adults ?? 0,
        childrenUnder5: r.childrenUnder5 ?? 0,
        children5Plus: r.children5Plus ?? (r.children ?? 0),
        fee: typeof r.fee === "number" ? r.fee : Number(r.fee) || 0,
        paymentStatus: r.paymentStatus || "N/A",
        registrationStatus: r.registrationStatus || "",
        paymentMethod: r.paymentMethod || "",
        paymentAmount: r.paymentAmount ?? "",
        paymentDate: r.paymentDate ? new Date(r.paymentDate).toLocaleDateString("en-AU") : "",
        transactionNumber: r.transactionNumber || "",
        couponCode: r.couponCode || "",
        membershipNumber: r.membershipNumber || "",
        heardAboutSource: r.heardAboutSource || "",
        heardAboutOther: r.heardAboutOther || "",
        comments: r.comments || "",
      });
    }

    const safeName = (eventName || "event").toString().replace(/[^\w-]+/g, "_");
    const suffix = scope === "selected" ? "selected" : "filtered";
    const filename = `${safeName}_${eventYear || ""}_${suffix}.xlsx`;

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error("EXPORT EXCEL ERROR:", err);
    res.status(500).json({ message: "Export failed" });
  }
});

export default router;
