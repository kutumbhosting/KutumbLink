import nodemailer from "nodemailer";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LOGO_PATH = path.join(__dirname, "../../public/kutumb-logo.png");
const LOGO_EXISTS = fs.existsSync(LOGO_PATH);
const LOGO_HTML = LOGO_EXISTS
  ? `<img src="cid:kutumbLogo" alt="Kutumb" width="148" height="40" style="height:40px;width:148px;max-width:148px;display:block;margin-bottom:16px;border:0;" />`
  : "";
function logoAttachment() {
  return LOGO_EXISTS
    ? [{ filename: "kutumb-logo.png", path: LOGO_PATH, cid: "kutumbLogo" }]
    : [];
}

let transporter = null;

// Kutumb's community WhatsApp group — included in the membership
// confirmation email so new members can join right away.
const WHATSAPP_GROUP_INVITE = "https://chat.whatsapp.com/Etit0vlcVj18n3WNvrcEFR?s=cl&p=i&ilr=4";

// Kutumb's bank account for bank-transfer payments — shown in the
// registration and donation emails. (The website's payment panel has its own
// copy in RegistrationPaymentPanel.tsx; keep the two in step.)
const BANK_DETAILS = {
  accountName: "Kutumb Australia Inc",
  bsb: "082-356",
  account: "778280517",
};

function getTransporter() {
  if (transporter) return transporter;

  if (!process.env.SMTP_HOST) {
    console.warn(
      "⚠️  SMTP_HOST not set - emails will NOT be sent. Configure .env (see .env.example)."
    );
    return null;
  }

  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "true", // true for port 465, false for 587/25
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
  });

  return transporter;
}

const FROM_ADDRESS =
  process.env.EMAIL_FROM || `"Kutumb" <${process.env.SMTP_USER || "pramod@kutumb.org.au"}>`;

/**
 * Returns whether SMTP looks configured, and (if so) actually verifies the
 * connection/credentials with the mail server - so config problems are
 * caught immediately instead of only failing silently later at send time.
 */
export async function checkEmailConfig() {
  if (!process.env.SMTP_HOST) {
    return { configured: false, verified: false, error: "SMTP_HOST is not set in .env" };
  }

  const t = getTransporter();
  if (!t) return { configured: false, verified: false, error: "SMTP not configured" };

  try {
    await t.verify();
    return { configured: true, verified: true, from: FROM_ADDRESS };
  } catch (err) {
    return { configured: true, verified: false, from: FROM_ADDRESS, error: err.message };
  }
}

/** Sends a simple test email - used by /api/email/test-send for diagnostics. */
export async function sendTestEmail(to) {
  return send({
    to,
    subject: "Kutumb test email",
    html: `
      <div style="font-family: Arial, sans-serif;">
        ${LOGO_HTML}
        <p>This is a test email from your Kutumb app - if you're reading this,
        SMTP is configured correctly and membership/event confirmation emails
        will be delivered.</p>
      </div>
    `,
    attachments: logoAttachment(),
  });
}

/**
 * Generic sender. Returns { sent: boolean, error?: string } instead of throwing,
 * so a mail outage never blocks the registration flow itself.
 */
async function send({ to, subject, html, attachments = [] }) {
  const t = getTransporter();
  if (!t) return { sent: false, error: "SMTP not configured" };

  try {
    await t.sendMail({ from: FROM_ADDRESS, to, subject, html, attachments });
    return { sent: true };
  } catch (err) {
    console.error("EMAIL SEND ERROR:", err.message);
    return { sent: false, error: err.message };
  }
}

// Transactional messages such as supporter sign-in links share the existing
// SMTP transport and its non-blocking failure behaviour.
export async function sendTransactionalEmail({ to, subject, html }) {
  return send({ to, subject, html });
}

export async function sendMembershipConfirmationEmail({
  to,
  name,
  membershipNumber,
  qrPngBuffer,
  cardPdfBuffer, // the same styled PDF card shown in the popup/download button
}) {
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: auto;">
      ${LOGO_HTML}
      <h2 style="color:#7c3f00;">Welcome to Kutumb, ${name}!</h2>
      <p>Your membership application has been received and confirmed.</p>
      <p style="font-size: 18px;"><strong>Membership Number: ${membershipNumber}</strong></p>
      <p>Your membership card is attached to this email as a PDF, and your QR code is shown below.</p>
      <img src="cid:membershipQr" alt="Membership QR Code" style="width:180px;height:180px;" />
      <p style="margin:24px 0 8px;">Join our community WhatsApp group to stay up to date with events and activities:</p>
      <a href="${WHATSAPP_GROUP_INVITE}" style="display:inline-block;background:#25D366;color:#ffffff;text-decoration:none;padding:10px 20px;border-radius:6px;font-weight:600;font-size:14px;">
        Join the Kutumb WhatsApp Group
      </a>
      <p style="margin-top:24px;color:#555;font-size:13px;">
        With Best Regards, &middot; Kutumb Executive Team
      </p>
    </div>
  `;

  return send({
    to,
    subject: "Welcome to Kutumb - Your Membership is Confirmed",
    html,
    attachments: [
      ...logoAttachment(),
      ...(qrPngBuffer
        ? [{ filename: "membership-qr.png", content: qrPngBuffer, cid: "membershipQr" }]
        : []),
      ...(cardPdfBuffer
        ? [{ filename: `kutumb-membership-card-${membershipNumber}.pdf`, content: cardPdfBuffer }]
        : []),
    ],
  });
}

export async function sendEventConfirmationEmail({
  to,
  name,
  eventName,
  eventDate,
  registrationNumber, // optional
  fee, // optional - total fee owed (0 or undefined = no fee)
  membershipNumber, // optional - mentioned as plain text only, no card/QR/PDF
  payToken, // optional - the registration's opaque pay_token; powers the "Pay Now" link below
  baseUrl, // optional - required (together with payToken) for the "Pay Now" link to appear
  flyerBuffer, // optional - the event's flyer image, attached as a keepsake
  flyerFilename, // optional - original filename, used to infer extension/content type
  // Part payments already received (e.g. a coupon applied before leaving the
  // payment window). When > 0 the email shows Registration fee / Payment
  // received / Balance to pay, and the Pay button is for the balance only.
  amountPaid = 0,
  couponAmount = 0, // the part of amountPaid that came from coupon(s)
  couponCode = null,
}) {
  const money = (n) => {
    const v = Math.round(Number(n) * 100) / 100;
    return Number.isInteger(v) ? `$${v}` : `$${v.toFixed(2)}`;
  };
  const membershipLine = membershipNumber
    ? `<p style="font-size:14px;">Your Kutumb Membership Number: <strong>${membershipNumber}</strong></p>`
    : "";

  const registrationLine = registrationNumber
    ? `<p style="font-size:14px;">Registration Number: <strong>${registrationNumber}</strong></p>`
    : "";

  const feeOwed = typeof fee === "number" && fee > 0;
  const paidSoFar = feeOwed ? Math.min(Math.max(Number(amountPaid) || 0, 0), fee) : 0;
  const balance = feeOwed ? Math.round((fee - paidSoFar) * 100) / 100 : 0;
  const partlyPaid = feeOwed && paidSoFar > 0 && balance > 0;
  const couponPart = partlyPaid ? Math.min(Math.max(Number(couponAmount) || 0, 0), paidSoFar) : 0;
  const otherPart = Math.round((paidSoFar - couponPart) * 100) / 100;
  // Only ever build this link when there's actually a fee owed AND we have
  // both a token and a base URL to build it from — payToken is only set on
  // registrations created after the pay_token column existed, so an older
  // pending row (or a call site that doesn't pass baseUrl) just quietly
  // gets no link rather than a broken one.
  const payUrl = feeOwed && payToken && baseUrl ? `${baseUrl}/pay/${payToken}` : null;
  // Just the one button. It opens the pay page, which offers every method
  // the admin has enabled (Card, PayPal, Square, Bank transfer) — the email
  // itself doesn't list or duplicate any of them.
  const payButton = payUrl
    ? `<p style="text-align:center;margin:20px 0 4px;">
         <a href="${payUrl}" target="_blank" rel="noopener" style="display:inline-block;background:#c2410c;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:6px;font-weight:600;font-size:15px;">
           Pay ${money(partlyPaid ? balance : fee)} Now
         </a>
       </p>
       <p style="font-size:12px;color:#888;text-align:center;">
         Or copy and paste this link into your browser: <a href="${payUrl}" style="color:#888;">${payUrl}</a>
       </p>`
    : "";

  // Tickets (one QR code per attendee — you, any additional adults, any
  // children) are a separate email, sent only once a registration is
  // actually confirmed (see sendEventTickets) — never before payment for a
  // paid event, so set that expectation here rather than leaving it a
  // surprise, or worse, implying a ticket exists already.
  const row = (label, value, strong = false) =>
    `<tr><td style="padding:4px 0;">${label}</td><td style="padding:4px 0;text-align:right;white-space:nowrap;">${strong ? `<strong>${value}</strong>` : value}</td></tr>`;
  const partPaymentBlock = partlyPaid
    ? `<p style="font-size:14px;">Thank you for your part payment. Please pay the remaining balance to confirm your booking.</p>
       <table style="width:100%;font-size:14px;border-top:1px solid #e5e7eb;border-bottom:1px solid #e5e7eb;margin:8px 0 12px;padding:4px 0;">
         ${row("Registration fee", money(fee))}
         ${couponPart > 0 ? row(`Paid by coupon${couponCode ? ` <span style="font-family:monospace;">${escapeHtml(couponCode)}</span>` : ""}`, `&minus; ${money(couponPart)}`) : ""}
         ${otherPart > 0 ? row(couponPart > 0 ? "Other payment received" : "Payment received", `&minus; ${money(otherPart)}`) : ""}
         ${row("Balance to pay", `<span style="color:#b45309;">${money(balance)}</span>`, true)}
       </table>
       <p style="font-size:14px;">Payment Status: <strong style="color:#b45309;">Part paid &mdash; balance pending</strong></p>`
    : "";
  const bankLine = registrationNumber
    ? `<p style="font-size:14px;">Paying by bank transfer? ${partlyPaid ? `Transfer the balance of <strong>${money(balance)}</strong> and put` : "Put"} <strong style="font-family:monospace;font-size:15px;">${registrationNumber}</strong> in the reference/description field so we can match your payment automatically.</p>`
    : "";
  const couponLapseNote = partlyPaid && couponPart > 0 && otherPart <= 0
    ? `<p style="font-size:13px;color:#555;">Please pay the balance before the payment deadline &mdash; unpaid registrations may be cancelled before the event, and the coupon payment would then lapse.</p>`
    : "";

  const paymentLine = feeOwed
    ? `${partlyPaid ? partPaymentBlock : `<p style="font-size:14px;">Registration Fee: <strong>${money(fee)}</strong> &middot; Payment Status: <strong style="color:#b45309;">Pending</strong></p>`}
       ${payButton}
       ${bankLine}
       ${couponLapseNote}
       <p style="font-size:13px;color:#9a3412;background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:10px 14px;margin:16px 0 0;font-weight:600;">
         Once your payment has been recorded, you'll receive a separate confirmation email —
         and your ticket(s), with a QR code for each person on this registration, will be
         generated and emailed to you at that point.
       </p>`
    : `<p style="font-size:14px;">Registration Fee: <strong>Free</strong></p>
       <p style="font-size:13px;color:#555;">
         Your ticket(s) — a QR code for each person on this registration — will follow in a
         separate email shortly.
       </p>`;

  // A paid event's registration is only a hold until payment actually
  // clears — don't tell them it's "Confirmed" in the subject line and
  // opening sentence while a fee is still outstanding; that's the same
  // premature-success messaging that was fixed in the success dialog and
  // the post-submit toast, just showing up in the inbox instead.
  const heading = partlyPaid
    ? "Registration Received — Balance Payment Required"
    : feeOwed ? "Registration Received — Payment Required" : "Registration Confirmed";
  const openingLine = feeOwed
    ? `Hi ${name}, we've received your registration for:`
    : `Hi ${name}, you're registered for:`;
  const subject = partlyPaid
    ? `Registration Received (Balance ${money(balance)} Due) - ${eventName}`
    : feeOwed ? `Registration Received (Payment Required) - ${eventName}` : `Registration Confirmed - ${eventName}`;

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: auto;">
      ${LOGO_HTML}
      <h2 style="color:#7c3f00;">${heading}</h2>
      <p>${openingLine}</p>
      <p style="font-size:16px;"><strong>${eventName}</strong>${eventDate ? ` &mdash; ${eventDate}` : ""}</p>
      ${registrationLine}
      ${membershipLine}
      ${paymentLine}
      <p>We look forward to seeing you there!</p>
      <p style="margin-top:24px;color:#555;font-size:13px;">
        With Best Regards, &middot; Kutumb Executive Team
      </p>
    </div>
  `;

  return send({
    to,
    subject,
    html,
    attachments: [
      ...logoAttachment(),
      ...(flyerBuffer ? [{ filename: flyerFilename || "event-flyer.jpg", content: flyerBuffer }] : []),
    ],
  });
}

const ATTENDEE_CATEGORY_LABELS = {
  primary_adult: "Registrant",
  adult: "Additional Adult",
  child_under5: "Child (Under 5)",
  child_5plus: "Child (5+)",
};

/**
 * Sends one email per registration with every attendee's individual QR
 * ticket — the primary registrant, each additional adult, and each child
 * (under-5 and 5+) — inline in the email body (as cid images, same
 * technique as the membership QR) and as a combined multi-page PDF
 * attachment for printing or showing at the door. Only ever called once a
 * registration is actually confirmed (see sendEventTickets in tickets.js,
 * which is what enforces the "only after payment" rule and the one-time
 * send guard).
 */
export async function sendEventTicketsEmail({
  to,
  name,
  eventName,
  eventDate,
  registrationNumber,
  attendees, // [{ name, category, qrPngBuffer }]
  ticketsPdfBuffer,
}) {
  const ticketBlocks = attendees
    .map(
      (a, i) => `
        <div style="margin:20px 0;padding:16px;border:1px solid #eee;border-radius:8px;text-align:center;">
          <img src="cid:eventTicketQr${i}" alt="QR code for ${a.name}" style="width:160px;height:160px;" />
          <p style="margin:10px 0 2px;font-size:14px;font-weight:bold;">${a.name}</p>
          <p style="margin:0;font-size:12px;color:#b45309;font-weight:600;">
            ${ATTENDEE_CATEGORY_LABELS[a.category] || "Attendee"}
          </p>
        </div>`
    )
    .join("");

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: auto;">
      ${LOGO_HTML}
      <h2 style="color:#15803d;">Your Tickets 🎟️</h2>
      <p>Hi ${name}, here ${attendees.length === 1 ? "is your ticket" : `are your ${attendees.length} tickets`} for:</p>
      <p style="font-size:16px;"><strong>${eventName}</strong>${eventDate ? ` &mdash; ${eventDate}` : ""}</p>
      ${registrationNumber ? `<p style="font-size:14px;">Registration Number: <strong>${registrationNumber}</strong></p>` : ""}
      <p style="font-size:13px;color:#555;">
        Each person listed below has their own scannable QR code — show it at check-in
        (on your phone or printed from the attached PDF). One scan per ticket.
      </p>
      ${ticketBlocks}
      <p>We look forward to seeing you there!</p>
      <p style="margin-top:24px;color:#555;font-size:13px;">
        With Best Regards, &middot; Kutumb Executive Team
      </p>
    </div>
  `;

  return send({
    to,
    subject: `Your Tickets - ${eventName}`,
    html,
    attachments: [
      ...logoAttachment(),
      ...attendees.map((a, i) => ({
        filename: `ticket-${i + 1}.png`,
        content: a.qrPngBuffer,
        cid: `eventTicketQr${i}`,
      })),
      ...(ticketsPdfBuffer
        ? [{ filename: `kutumb-tickets-${registrationNumber || "event"}.pdf`, content: ticketsPdfBuffer }]
        : []),
    ],
  });
}

/**
 * Sent when a registrant says they've made a bank transfer and enters its
 * reference. It is an acknowledgement only — the registration stays pending
 * until the transfer is actually found in Kutumb's bank account, at which
 * point the real "Payment Confirmed" email and the tickets go out.
 */
export async function sendBankTransferReceivedEmail({
  to,
  name,
  eventName,
  registrationNumber,
  fee,
  transactionNumber,
}) {
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: auto;">
      ${LOGO_HTML}
      <h2 style="color:#7c3f00;">Bank Transfer Details Received</h2>
      <p>Hi ${name}, thanks - we've noted your bank transfer for:</p>
      <p style="font-size:16px;"><strong>${eventName}</strong></p>
      ${registrationNumber ? `<p style="font-size:14px;">Registration Number: <strong>${registrationNumber}</strong></p>` : ""}
      <p style="font-size:14px;">Amount: <strong>$${fee}</strong> &middot; Your Reference: <strong>${transactionNumber}</strong></p>
      <p style="font-size:14px;">Status: <strong style="color:#b45309;">Awaiting verification</strong></p>
      <p style="font-size:14px;font-weight:600;color:#9a3412;">
        Your ticket(s) will be issued after your payment has been verified.
      </p>
      <p style="font-size:13px;color:#555;">
        We'll confirm your registration as soon as the payment shows in our bank account
        (this can take a few business days). You'll then receive a confirmation email, and
        your ticket(s) with a QR code for each person on this registration.
      </p>
      <p style="margin-top:24px;color:#555;font-size:13px;">
        With Best Regards, &middot; Kutumb Executive Team
      </p>
    </div>
  `;

  return send({
    to,
    subject: `Bank Transfer Received (Pending Verification) - ${eventName}`,
    html,
    attachments: logoAttachment(),
  });
}

export async function sendEventPaymentConfirmationEmail({
  to,
  name,
  eventName,
  eventDate,
  registrationNumber,
  fee,
  transactionNumber,
}) {
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: auto;">
      ${LOGO_HTML}
      <h2 style="color:#15803d;">Payment Confirmed ✅</h2>
      <p>Hi ${name}, thank you - your payment has been recorded for:</p>
      <p style="font-size:16px;"><strong>${eventName}</strong>${eventDate ? ` &mdash; ${eventDate}` : ""}</p>
      ${registrationNumber ? `<p style="font-size:14px;">Registration Number: <strong>${registrationNumber}</strong></p>` : ""}
      <p style="font-size:14px;">Amount: <strong>$${fee}</strong> &middot; Payment Status: <strong style="color:#15803d;">Paid</strong></p>
      ${transactionNumber ? `<p style="font-size:14px;">Transaction Reference: <strong>${transactionNumber}</strong></p>` : ""}
      <p>You have paid in full - we look forward to seeing you there!</p>
      <p style="margin-top:24px;color:#555;font-size:13px;">
        With Best Regards, &middot; Kutumb Executive Team
      </p>
    </div>
  `;

  return send({
    to,
    subject: `Payment Confirmed - ${eventName}`,
    html,
    attachments: logoAttachment(),
  });
}

/**
 * Sends the same admin-composed announcement to a batch of recipients, one
 * at a time (not one giant "to" list, so a bad address never exposes every
 * other member's email in their inbox headers, and a failure for one
 * recipient doesn't block the rest). Kept sequential with a small delay
 * rather than firing all sends in parallel, to stay well under typical SMTP
 * provider rate limits when the member list is large.
 *
 * Returns { total, sent, failed, failures: [{ to, error }] } so the admin
 * console can show a clear summary instead of a single pass/fail flag.
 */
export async function sendBulkEmail({ recipients, subject, message }) {
  // Recipients may be plain email strings (legacy callers) or
  // { email, name, membershipNumber?, pendingAmount? } objects — normalize
  // so every send below can address the recipient by name and mention
  // their membership number / amount owed, when known, regardless of what
  // the admin actually typed in the message body.
  const normalized = recipients.map((r) =>
    typeof r === "string"
      ? { email: r, name: "", membershipNumber: null, pendingAmount: null }
      : {
          email: r.email,
          name: r.name || "",
          membershipNumber: r.membershipNumber || null,
          pendingAmount: r.pendingAmount != null && Number(r.pendingAmount) > 0 ? Number(r.pendingAmount) : null,
        }
  );

  const results = { total: normalized.length, sent: 0, failed: 0, failures: [] };

  // Plain admin-composed text, lightly wrapped in the same branded shell as
  // every other outgoing email. Line breaks in the textarea are preserved
  // since the message is otherwise plain text, not HTML, from the admin.
  const bodyHtml = String(message || "")
    .split(/\r?\n/)
    .map((line) => (line.trim() ? `<p style="margin:0 0 12px;">${escapeHtml(line)}</p>` : ""))
    .join("");

  for (const { email: to, name, membershipNumber, pendingAmount } of normalized) {
    // Personalized "Dear <name>," greeting up top for every recipient,
    // falling back to "Dear Member," when a name isn't on file.
    const trimmedName = String(name || "").trim();
    const greeting = trimmedName ? `Dear ${escapeHtml(trimmedName)},` : "Dear Member,";

    // Every email to a registered member always states their membership
    // number, and every email about an event registration with a pending
    // balance always states the amount owed — regardless of what the admin
    // typed, so this can never be accidentally left out.
    const membershipLine = membershipNumber
      ? `<p style="margin:0 0 12px;font-size:14px;">Your Kutumb Membership Number: <strong>${escapeHtml(String(membershipNumber))}</strong></p>`
      : "";
    const pendingAmountLine = pendingAmount
      ? `<p style="margin:0 0 12px;font-size:14px;color:#c2410c;font-weight:bold;">Amount Pending: $${pendingAmount.toFixed(2)}</p>`
      : "";

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 480px; margin: auto;">
        ${LOGO_HTML}
        <p style="margin:0 0 12px;">${greeting}</p>
        ${membershipLine}
        ${pendingAmountLine}
        ${bodyHtml}
        <p style="margin-top:24px;color:#555;font-size:13px;">
          With Best Regards, &middot; Kutumb Executive Team
        </p>
      </div>
    `;

    const result = await send({ to, subject, html, attachments: logoAttachment() });
    if (result.sent) {
      results.sent += 1;
    } else {
      results.failed += 1;
      results.failures.push({ to, error: result.error || "Unknown error" });
    }
    // Small pacing delay between sends - avoids tripping SMTP provider
    // rate limits on larger member lists.
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  return results;
}

/**
 * Operational alert to the Kutumb admin mailbox (e.g. a bank statement in
 * the Drive drop box that couldn't be imported). Recipient: ADMIN_ALERT_EMAIL
 * in .env, else kutumbhosting@gmail.com.
 */
export async function sendAdminAlertEmail({ subject, message }) {
  const to = process.env.ADMIN_ALERT_EMAIL || "kutumbhosting@gmail.com";
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 520px; margin: auto;">
      <h2 style="color:#7c3f00;">${escapeHtml(subject)}</h2>
      <p style="font-size:14px;white-space:pre-wrap;">${escapeHtml(message)}</p>
    </div>`;
  return send({ to, subject: `[Kutumb website] ${subject}`, html });
}

/**
 * Tells the person who dropped a file in the Bank File Drop Box what
 * happened to it — they may not have admin access to see it otherwise.
 */
export async function sendDropBoxResultEmail({ to, fileName, status, message }) {
  const ok = status === "imported";
  const subject = ok ? `Bank file imported: ${fileName}` : `Bank file NOT imported: ${fileName}`;
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 520px; margin: auto;">
      ${LOGO_HTML}
      <h2 style="color:#7c3f00;">${ok ? "Bank file imported" : "Bank file could not be imported"}</h2>
      <p style="font-size:14px;">File: <strong>${escapeHtml(fileName)}</strong></p>
      <p style="font-size:14px;white-space:pre-wrap;">${escapeHtml(message)}</p>
      <p style="font-size:13px;color:#555;">${
        ok
          ? "The file has been removed from the drop box folder and a copy is kept on the website."
          : "The file has been left in the folder. Please export the statement from NAB as CSV and drop that in instead, or contact the Kutumb admin team."
      }</p>
    </div>`;
  return send({ to, subject: `[Kutumb] ${subject}`, html, attachments: logoAttachment() });
}


// ── Automatic registration emails (registrationScheduler.js) ─────────────

function eventDetailsHtml({ eventName, eventDate, eventTime, location, registrationNumber }) {
  return `
      <p style="font-size:16px;margin:4px 0;"><strong>${escapeHtml(eventName)}</strong></p>
      ${eventDate ? `<p style="font-size:14px;margin:2px 0;">📅 ${escapeHtml(eventDate)}${eventTime ? ` &middot; ${escapeHtml(eventTime)}` : ""}</p>` : ""}
      ${location ? `<p style="font-size:14px;margin:2px 0;">📍 ${escapeHtml(location)}</p>` : ""}
      ${registrationNumber ? `<p style="font-size:14px;margin:2px 0;">Registration Number: <strong>${escapeHtml(registrationNumber)}</strong></p>` : ""}`;
}

function bankDetailsHtml(registrationNumber) {
  return `
      <div style="font-size:14px;background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:10px 14px;margin:12px 0;">
        <p style="font-weight:600;color:#9a3412;margin:0 0 4px;">Pay by bank transfer</p>
        <p style="margin:2px 0;">Account Name: ${BANK_DETAILS.accountName}</p>
        <p style="margin:2px 0;">BSB: ${BANK_DETAILS.bsb}</p>
        <p style="margin:2px 0;">Account: ${BANK_DETAILS.account}</p>
        ${registrationNumber ? `<p style="margin:6px 0 0;">Reference: <strong style="font-family:monospace;">${escapeHtml(registrationNumber)}</strong></p>` : ""}
      </div>`;
}

/**
 * Payment reminder for a registration still awaiting payment. `final`
 * switches to the last-chance wording with the cancellation date.
 */
export async function sendPaymentReminderEmail({
  to, name, eventName, eventDate, eventTime, location, registrationNumber,
  amountDue, payUrl, final = false, cancelOn = null, claimedTransfer = false,
  // Coupon part-payment: the amount already covered by a coupon, and the
  // full fee, so the email can show the breakdown. couponWillLapse adds the
  // "your coupon payment will lapse if the balance isn't paid" warning to
  // the final (pre-cancellation) reminder.
  couponAmount = 0, totalFee = null, couponWillLapse = false,
  otherPaid = 0, // part payments received by card / bank / PayPal / Square
}) {
  const hasCoupon = Number(couponAmount) > 0;
  const hasPartPayment = hasCoupon || Number(otherPaid) > 0;
  const heading = final
    ? cancelOn
      ? "Final reminder: payment needed to keep your booking"
      : "Last reminder: your registration payment is still pending"
    : "Reminder: your registration payment is still pending";
  const intro = claimedTransfer
    ? `Hi ${escapeHtml(name)}, you told us you'd paid by bank transfer, but we haven't been able to match it in our bank account yet.
       Please check the transfer went through with the reference below, or reply to this email with the date and amount so we can find it.`
    : hasPartPayment
    ? `Hi ${escapeHtml(name)}, thank you for registering and for your part payment${hasCoupon && !(Number(otherPaid) > 0) ? " by coupon" : ""}. The remaining balance of your registration fee hasn't been received yet.`
    : `Hi ${escapeHtml(name)}, thank you for registering. We haven't received your payment yet.`;
  const couponBreakdown = hasPartPayment ? couponBreakdownHtml({ totalFee, couponAmount, amountDue, otherPaid }) : "";
  const couponLapse = hasCoupon && couponWillLapse
    ? `<p style="font-size:14px;font-weight:600;color:#b91c1c;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:10px 14px;">
         Please note: your coupon payment of $${Number(couponAmount).toFixed(2)} will lapse${cancelOn ? ` on ${escapeHtml(cancelOn)}` : ""} if the balance isn't paid —
         the coupon is single-use, so it cannot be refunded or used again once your registration is cancelled.
       </p>`
    : "";
  const deadline = final && cancelOn
    ? `<p style="font-size:14px;font-weight:600;color:#b91c1c;">If payment isn't received, your registration will be cancelled on ${escapeHtml(cancelOn)} and the spots released to others.</p>`
    : "";
  const payButton = payUrl
    ? `<p style="text-align:center;margin:20px 0 8px;">
         <a href="${payUrl}" target="_blank" rel="noopener" style="display:inline-block;background:#c2410c;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:6px;font-weight:600;font-size:15px;">
           Pay $${Number(amountDue).toFixed(2)} Now
         </a>
       </p>`
    : "";
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: auto;">
      ${LOGO_HTML}
      <h2 style="color:#7c3f00;">${heading}</h2>
      <p style="font-size:14px;">${intro}</p>
      ${eventDetailsHtml({ eventName, eventDate, eventTime, location, registrationNumber })}
      ${couponBreakdown || `<p style="font-size:14px;margin-top:12px;">Amount due: <strong>$${Number(amountDue).toFixed(2)}</strong></p>`}
      ${deadline}
      ${couponLapse}
      ${payButton}
      ${bankDetailsHtml(registrationNumber)}
      <p style="font-size:13px;color:#555;">Already paid in the last day or two? Thank you — please ignore this email; bank transfers can take a little while to show.</p>
      <p style="margin-top:24px;color:#555;font-size:13px;">With Best Regards, &middot; Kutumb Executive Team</p>
    </div>`;
  const subject = final ? `Final reminder: payment for ${eventName}` : `Payment reminder: ${eventName}`;
  return send({ to, subject, html, attachments: logoAttachment() });
}

export async function sendRegistrationCancelledEmail({ to, name, eventName, eventDate, registrationNumber, registerUrl, couponLapsedAmount = 0 }) {
  const couponLine = Number(couponLapsedAmount) > 0
    ? `<p style="font-size:14px;color:#b91c1c;">The coupon part payment of <strong>$${Number(couponLapsedAmount).toFixed(2)}</strong> applied to this registration has lapsed with the cancellation.</p>`
    : "";
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: auto;">
      ${LOGO_HTML}
      <h2 style="color:#7c3f00;">Registration cancelled</h2>
      <p style="font-size:14px;">Hi ${escapeHtml(name)}, as we didn't receive payment in time, your registration below has been cancelled and the spots released.</p>
      ${eventDetailsHtml({ eventName, eventDate, registrationNumber })}
      ${couponLine}
      <p style="font-size:14px;">If you've paid in the last day or two, or think this is a mistake, please reply to this email and we'll sort it out.</p>
      ${registerUrl ? `<p style="font-size:14px;">If spots are still available you're welcome to <a href="${registerUrl}">register again</a>.</p>` : ""}
      <p style="margin-top:24px;color:#555;font-size:13px;">With Best Regards, &middot; Kutumb Executive Team</p>
    </div>`;
  return send({ to, subject: `Registration cancelled - ${eventName}`, html, attachments: logoAttachment() });
}

function couponBreakdownHtml({ totalFee, couponAmount, amountDue, otherPaid = 0 }) {
  const row = (label, value, strong = false) =>
    `<tr><td style="padding:3px 0;">${label}</td><td style="padding:3px 0;text-align:right;">${strong ? `<strong>${value}</strong>` : value}</td></tr>`;
  return `
      <table style="width:100%;font-size:14px;border-top:1px solid #e5e7eb;border-bottom:1px solid #e5e7eb;margin:12px 0;padding:6px 0;">
        ${totalFee !== null && totalFee !== undefined ? row("Registration fee", `$${Number(totalFee).toFixed(2)}`) : ""}
        ${Number(couponAmount) > 0 ? row("Paid by coupon", `&minus; $${Number(couponAmount).toFixed(2)}`) : ""}
        ${Number(otherPaid) > 0 ? row(Number(couponAmount) > 0 ? "Other payment received" : "Payment received", `&minus; $${Number(otherPaid).toFixed(2)}`) : ""}
        ${row("Balance to pay", `$${Number(amountDue).toFixed(2)}`, true)}
      </table>`;
}

/**
 * Sent once when a coupon covered only PART of a registration fee and the
 * registrant then left without paying the balance (see
 * runCouponPartPaymentEmails in registrationScheduler.js). Thanks them for
 * the part payment and asks for the remainder by card or bank transfer.
 */
export async function sendCouponPartPaymentEmail({
  to, name, eventName, eventDate, eventTime, location, registrationNumber,
  totalFee, couponAmount, couponCode, amountDue, payUrl,
}) {
  const payButton = payUrl
    ? `<p style="text-align:center;margin:20px 0 8px;">
         <a href="${payUrl}" target="_blank" rel="noopener" style="display:inline-block;background:#c2410c;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:6px;font-weight:600;font-size:15px;">
           Pay balance $${Number(amountDue).toFixed(2)} by card
         </a>
       </p>`
    : "";
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: auto;">
      ${LOGO_HTML}
      <h2 style="color:#7c3f00;">Thank you for your part payment 🙏</h2>
      <p style="font-size:14px;">Hi ${escapeHtml(name)}, thank you — your coupon${couponCode ? ` <strong style="font-family:monospace;">${escapeHtml(couponCode)}</strong>` : ""} has been applied to your registration as a part payment.</p>
      ${eventDetailsHtml({ eventName, eventDate, eventTime, location, registrationNumber })}
      ${couponBreakdownHtml({ totalFee, couponAmount, amountDue })}
      <p style="font-size:14px;">To confirm your booking and receive your tickets, please pay the remaining <strong>$${Number(amountDue).toFixed(2)}</strong> by credit/debit card or bank transfer.</p>
      ${payButton}
      ${bankDetailsHtml(registrationNumber)}
      <p style="font-size:13px;color:#555;">Your registration stays pending until the balance is received. If it isn't paid in time, the registration may be cancelled and the coupon payment will lapse.</p>
      <p style="font-size:13px;color:#555;">Already paid the balance? Thank you — please ignore this email; bank transfers can take a little while to show.</p>
      <p style="margin-top:24px;color:#555;font-size:13px;">With Best Regards, &middot; Kutumb Executive Team</p>
    </div>`;
  return send({ to, subject: `Thank you for your part payment - balance due for ${eventName}`, html, attachments: logoAttachment() });
}

/**
 * Sent to the email entered when an admin creates coupon(s) (Admin →
 * Coupons), and again on "Resend email". `coupons` is one or more
 * { code, amount, qrDataUrl, validFrom, validUntil, notes } for the same
 * event — a batch generated in one go arrives as ONE email listing every
 * code, rather than up to 100 separate emails. QR images are attached
 * (inline) for up to 10 coupons.
 */
export async function sendCouponIssuedEmail({ to, recipientName, eventName, eventYear, coupons, eventsUrl }) {
  const list = Array.isArray(coupons) ? coupons : [];
  if (!list.length) return { sent: false, error: "No coupons to send" };
  const fmt = (d) => {
    if (!d) return null;
    const dt = new Date(d);
    return isNaN(dt) ? String(d) : dt.toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  };
  const validityOf = (c) => {
    const from = fmt(c.validFrom);
    const until = fmt(c.validUntil);
    return from && until ? `${from} to ${until}` : until ? `until ${until}` : from ? `from ${from}` : "No expiry";
  };
  const attachments = [...logoAttachment()];
  const withQr = list.length <= 10;
  const blocks = list.map((c, i) => {
    let qrHtml = "";
    const m = withQr && typeof c.qrDataUrl === "string" && c.qrDataUrl.match(/^data:image\/png;base64,(.+)$/);
    if (m) {
      const cid = `coupon-qr-${i}`;
      attachments.push({ filename: `kutumb-coupon-${c.code}.png`, content: Buffer.from(m[1], "base64"), cid });
      qrHtml = `<p style="margin:10px 0 0;"><img src="cid:${cid}" alt="QR code for ${escapeHtml(c.code)}" width="140" height="140" /></p>`;
    }
    return `
      <div style="border:2px dashed #ea580c;background:#fff7ed;border-radius:10px;padding:14px 18px;margin:12px 0;text-align:center;">
        <p style="margin:0;font-size:13px;color:#9a3412;">Coupon code${list.length > 1 ? ` ${i + 1} of ${list.length}` : ""}</p>
        <p style="margin:4px 0 8px;font-size:24px;font-weight:800;letter-spacing:2px;font-family:monospace;">${escapeHtml(c.code)}</p>
        <p style="margin:0;font-size:15px;">Value: <strong>$${Number(c.amount).toFixed(2)}</strong> &middot; Valid: ${escapeHtml(validityOf(c))}</p>
        ${c.notes ? `<p style="margin:6px 0 0;font-size:13px;">${escapeHtml(c.notes)}</p>` : ""}
        ${qrHtml}
      </div>`;
  });
  const plural = list.length > 1;
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: auto;">
      ${LOGO_HTML}
      <h2 style="color:#7c3f00;">Your Kutumb event coupon${plural ? "s" : ""} 🎟️</h2>
      <p style="font-size:14px;">Hi ${escapeHtml(recipientName || "there")}, ${plural ? `${list.length} coupons have` : "a coupon has"} been issued to you for:</p>
      <p style="font-size:16px;margin:4px 0;"><strong>${escapeHtml(eventName)}${eventYear ? ` (${escapeHtml(eventYear)})` : ""}</strong></p>
      ${blocks.join("")}
      <p style="font-size:14px;"><strong>How to use ${plural ? "a coupon" : "it"}:</strong> register for the event${eventsUrl ? ` on the <a href="${eventsUrl}">Kutumb Events page</a>` : " on the Kutumb website"}, then type the code into the <em>"Have an event coupon?"</em> box on the payment screen and press <em>Apply</em>.
      If the coupon is worth less than the registration fee, the balance is calculated automatically and can be paid by card or bank transfer.</p>
      <p style="font-size:13px;color:#555;">Each coupon can be used once only, and only for this event. Please keep this email safe.</p>
      <p style="margin-top:24px;color:#555;font-size:13px;">With Best Regards, &middot; Kutumb Executive Team</p>
    </div>`;
  const subject = plural
    ? `Your ${list.length} Kutumb coupons - ${eventName}`
    : `Your Kutumb coupon ${list[0].code} - ${eventName}`;
  return send({ to, subject, html, attachments });
}

export async function sendCheckinCodesEmail({ to, eventName, eventYear, eventDateText, codes, expiresAt }) {
  const expiryText = (() => {
    const dt = new Date(expiresAt);
    return isNaN(dt)
      ? "the end of the event day"
      : dt.toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short", timeZone: "Australia/Sydney" });
  })();
  const codeBlocks = (codes || [])
    .map(
      (code) => `
      <div style="display:inline-block;border:2px dashed #ea580c;background:#fff7ed;border-radius:10px;padding:10px 22px;margin:6px;text-align:center;">
        <span style="font-size:22px;font-weight:800;letter-spacing:3px;font-family:monospace;">${escapeHtml(code)}</span>
      </div>`
    )
    .join("");
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: auto;">
      ${LOGO_HTML}
      <h2 style="color:#7c3f00;">Check-in codes 🎫</h2>
      <p style="font-size:14px;">${codes?.length || 0} temporary check-in login code(s) have been generated for:</p>
      <p style="font-size:16px;margin:4px 0;"><strong>${escapeHtml(eventName)}${eventYear ? ` (${escapeHtml(eventYear)})` : ""}</strong>${eventDateText ? ` &mdash; ${escapeHtml(eventDateText)}` : ""}</p>
      <div style="text-align:center;margin:16px 0;">${codeBlocks}</div>
      <p style="font-size:14px;">Give one code to each door volunteer's device. At <a href="https://kutumb.org.au/checkin">kutumb.org.au/checkin</a>, choose <strong>"Log in with a code"</strong>, enter their own name and the code — no email or password needed.</p>
      <p style="font-size:14px;font-weight:600;color:#9a3412;">These codes stop working after ${escapeHtml(expiryText)} and are then deleted automatically.</p>
      <p style="font-size:13px;color:#555;"><strong>Each code works only once</strong> — the first volunteer to sign in with it enters their name, and that code is then linked to them and cannot be used again. Please give each volunteer a different code. Every check-in is recorded against the volunteer's name.</p>
      <p style="margin-top:24px;color:#555;font-size:13px;">With Best Regards, &middot; Kutumb Executive Team</p>
    </div>`;
  return send({ to, subject: `Check-in codes — ${eventName}`, html, attachments: logoAttachment() });
}

export async function sendEventWelcomeEmail({
  to, name, eventName, eventDate, eventTime, location, registrationNumber, peopleCount, ticketsPdfBuffer, when = "tomorrow",
}) {
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: auto;">
      ${LOGO_HTML}
      <h2 style="color:#7c3f00;">See you ${when}! 🙏</h2>
      <p style="font-size:14px;">Hi ${escapeHtml(name)}, we're looking forward to welcoming you${peopleCount > 1 ? ` and your group of ${peopleCount}` : ""} to:</p>
      ${eventDetailsHtml({ eventName, eventDate, eventTime, location, registrationNumber })}
      <p style="font-size:14px;margin-top:12px;">
        ${ticketsPdfBuffer
          ? "Your QR ticket(s) are attached again for convenience — please have them ready on your phone or printed for a quick check-in."
          : "Please bring your QR ticket(s) from your confirmation email for a quick check-in."}
      </p>
      <p style="font-size:14px;">If your plans have changed, please reply to let us know so we can offer your spot to someone else.</p>
      <p style="margin-top:24px;color:#555;font-size:13px;">With Best Regards, &middot; Kutumb Executive Team</p>
    </div>`;
  const attachments = [
    ...logoAttachment(),
    ...(ticketsPdfBuffer ? [{ filename: `kutumb-tickets-${registrationNumber || "event"}.pdf`, content: ticketsPdfBuffer }] : []),
  ];
  return send({ to, subject: `See you ${when} - ${eventName}`, html, attachments });
}

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export async function sendDonationThankYouEmail({
  to,
  name,
  amount,
  membershipNumber, // optional
  // `paid` is the one that actually decides which message this email shows.
  // It's true for EVERY call site that reaches this function — the
  // immediate bank-transfer-with-transaction-number path in server.js, and
  // the webhook-confirmed card/Square/PayPal path in donationPayments.js —
  // because both only ever call this once a donation is genuinely paid.
  // `bankTransferred` on its own does NOT mean "unpaid": it only describes
  // *which* payment method was used, so it must never be the sole thing
  // this template branches on (that was the bug — a real, already-paid
  // Square/card donation was showing "please do a bank transfer" because
  // the webhook path correctly passes bankTransferred: false for a card
  // payment, which the old code misread as "not yet paid").
  paid = false,
  bankTransferred,
  transactionNumber,
}) {
  const membershipLine = membershipNumber
    ? `<p style="font-size:14px;">Kutumb Membership Number: <strong>${membershipNumber}</strong></p>`
    : "";

  const transferLine = paid
    ? `<p style="font-size:14px;">Payment Status: <strong style="color:#15803d;">Paid</strong> &middot; Transaction Reference: <strong>${transactionNumber || "(not provided)"}</strong></p>`
    : `<p style="font-size:14px;">Payment Status: <strong style="color:#b45309;">Pending</strong> - please complete your bank transfer using the details below when ready.</p>
       <div style="border:2px solid #fed7aa;background:#fff7ed;border-radius:8px;padding:12px 16px;margin:12px 0;font-size:14px;">
         <p style="font-weight:600;color:#9a3412;margin:0 0 4px;">Kutumb Bank Details</p>
         <p style="margin:2px 0;">Account Name: ${BANK_DETAILS.accountName}</p>
         <p style="margin:2px 0;">BSB: ${BANK_DETAILS.bsb}</p>
         <p style="margin:2px 0;">Account: ${BANK_DETAILS.account}</p>
       </div>`;

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: auto;">
      ${LOGO_HTML}
      <h2 style="color:#7c3f00;">Thank You for Your Donation, ${name}!</h2>
      <p>We've recorded your pledged donation of <strong>$${amount}</strong> to Kutumb.</p>
      ${membershipLine}
      ${transferLine}
      <p>Your generosity helps us continue serving the community. Thank you for your support!</p>
      <p style="margin-top:24px;color:#555;font-size:13px;">
        With Best Regards, &middot; Kutumb Executive Team
      </p>
    </div>
  `;

  return send({
    to,
    subject: "Thank You for Your Donation to Kutumb",
    html,
    attachments: logoAttachment(),
  });
}
