import crypto from "crypto";
import { pool } from "../db/pool.js";

const ALGO = "aes-256-gcm";

function getKey() {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) throw new Error("ENCRYPTION_KEY is missing from .env — required to store/read secret settings.");
  return crypto.createHash("sha256").update(raw).digest();
}

function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, getKey(), iv);
  const enc = Buffer.concat([cipher.update(String(text), "utf-8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}
function decrypt(payload) {
  const buf = Buffer.from(payload, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);
  const decipher = crypto.createDecipheriv(ALGO, getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf-8");
}

export const SETTINGS_SCHEMA = [
  { group: "Stripe", key: "stripe_publishable_key", label: "Stripe Publishable Key", secret: false },
  { group: "Stripe", key: "stripe_secret_key", label: "Stripe Secret Key", secret: true },
  { group: "Stripe", key: "stripe_webhook_secret", label: "Stripe Webhook Signing Secret", secret: true },
  { group: "Platform", key: "public_base_url", label: "Public Base URL (your website address, e.g. https://www.kutumb.org.au — NOT a Stripe/PayPal/Square address)", secret: false },
  // Toggle which payment methods registrants are offered on the event
  // registration success page. Bank transfer defaults on (it needs no
  // external setup); card defaults off until Stripe keys above are filled
  // in and an admin deliberately switches it on.
  { group: "Payment Methods", key: "payment_method_bank_transfer", label: "Bank Transfer", type: "boolean", default: "true" },
  { group: "Payment Methods", key: "payment_method_card", label: "Pay by Card (Stripe)", type: "boolean", default: "false" },
  { group: "Payment Methods", key: "payment_method_square", label: "Pay by Card (Square)", type: "boolean", default: "false" },
  { group: "Payment Methods", key: "payment_method_paypal", label: "Pay by PayPal", type: "boolean", default: "false" },
  // Square: a Square "Payment Link" (hosted checkout page) is created per
  // registration, so no client-side Square SDK is needed. The access token
  // is an Application access token from the Square Developer Dashboard;
  // Location ID identifies which of the business's Square locations the
  // payment is recorded against.
  { group: "Square", key: "square_access_token", label: "Square Access Token", secret: true },
  { group: "Square", key: "square_location_id", label: "Square Location ID", secret: false },
  { group: "Square", key: "square_environment", label: "Square Environment (sandbox or production)", secret: false, default: "sandbox" },
  { group: "Square", key: "square_webhook_signature_key", label: "Square Webhook Signature Key", secret: true },
  // PayPal: Client ID/Secret from a PayPal REST API app (developer.paypal.com).
  { group: "PayPal", key: "paypal_client_id", label: "PayPal Client ID", secret: false },
  { group: "PayPal", key: "paypal_client_secret", label: "PayPal Client Secret", secret: true },
  { group: "PayPal", key: "paypal_environment", label: "PayPal Environment (sandbox or live)", secret: false, default: "sandbox" },
  { group: "PayPal", key: "paypal_webhook_id", label: "PayPal Webhook ID (optional, for signature verification)", secret: false },
  // Powers the "Generate with AI" draft button on the Members → Send Email
  // dialog. Optional — without it, admins can still write emails by hand.
  // No hardcoded default for groq_model: Groq's model lineup changes often,
  // so the admin picks a real one from a live-fetched list instead of us
  // guessing an id that might already be renamed or retired.
  { group: "AI Email Draft", key: "groq_api_key", label: "Groq API Key", secret: true },
  { group: "AI Email Draft", key: "groq_model", label: "Groq Model", secret: false },
  // Automatic payment reconciliation for upcoming events (openfeedSync.js).
  { group: "Payment Reconciliation", key: "auto_reconcile_upcoming", label: "Automatically reconcile pending payments for upcoming events (hourly check of bank credits; new NAB transactions pulled every 4 hours)", type: "boolean", default: "true" },
  // Automatic registration emails — see server/lib/registrationScheduler.js.
  // All times are Sydney time.
  // Master switches; each event also has its own ticks (see the table in
  // that settings section), and both must be on for an email to go out.
  { group: "Automatic Registration Emails", key: "reg_reminders_enabled", label: "Payment reminders (twice weekly + final reminder) — on for ticked events", type: "boolean", default: "true" },
  { group: "Automatic Registration Emails", key: "reg_autocancel_enabled", label: "Auto-cancel unpaid registrations — on for ticked events", type: "boolean", default: "true" },
  { group: "Automatic Registration Emails", key: "reg_welcome_enabled", label: "Day-before welcome email — on for ticked events", type: "boolean", default: "true" },
  { group: "Automatic Registration Emails", key: "reg_reminder_days", label: "Payment reminder days (e.g. mon,thu)", secret: false, default: "mon,thu" },
  { group: "Automatic Registration Emails", key: "reg_email_hour", label: "Send at hour (0-23, Sydney time)", secret: false, default: "10" },
  { group: "Automatic Registration Emails", key: "reg_final_days_before", label: "Final reminder — days before event", secret: false, default: "6" },
  { group: "Automatic Registration Emails", key: "reg_cancel_days_before", label: "Cancel unpaid — days before event", secret: false, default: "5" },
  { group: "Automatic Registration Emails", key: "reg_coupon_partial_email_enabled", label: "Coupon part payment — email a thank-you + balance-due request if the registrant leaves without paying the balance", type: "boolean", default: "true" },
  { group: "Automatic Registration Emails", key: "reg_coupon_partial_email_delay_min", label: "Coupon part payment — minutes to wait before sending that email (5-1440)", secret: false, default: "30" },
  { group: "Automatic Registration Emails", key: "coupon_issue_email_enabled", label: "Email the coupon code & details to the email entered when a coupon is created", type: "boolean", default: "true" },
  { group: "Automatic Registration Emails", key: "reg_cancel_claimed_transfers", label: "Also auto-cancel people who said they paid by bank transfer but it isn't matched yet", type: "boolean", default: "false" },
  // Bank File Drop Box: a NAB statement file (.csv/.xlsx/.xls/Google Sheet)
  // dropped in this Drive folder is imported, reconciled against every event
  // with unpaid registrations, then removed from the folder. Pick-up is done
  // by a Google Apps Script (copied from this settings page). The OAuth
  // client below is only for the optional server-side polling.
  { group: "Bank File Drop Box (Google Drive)", key: "gdrive_folder_id", label: "Drive Folder ID", secret: false, default: "1wo2VFMi_2zZQSeQbJgFBSqBXS5enTCME" },
  { group: "Bank File Drop Box (Google Drive)", key: "gdrive_after_import", label: "After import: trash (recoverable 30 days) or delete (permanent)", secret: false, default: "trash" },
  { group: "Bank File Drop Box (Google Drive)", key: "gdrive_client_id", label: "Optional server-side polling — Google OAuth Client ID", secret: false },
  { group: "Bank File Drop Box (Google Drive)", key: "gdrive_client_secret", label: "Optional server-side polling — Google OAuth Client Secret", secret: true },
  { group: "Bank File Drop Box (Google Drive)", key: "gdrive_poll_minutes", label: "Optional server-side polling — check every N minutes", secret: false, default: "5" },
  // Event Media Drop Box: shared Drive folder where volunteers upload event
  // photos/videos, each event in its own sub-folder. Opened from the footer
  // link (after a prompt asking them to create/open the event's folder).
  { group: "Event Media Drop Box", key: "media_dropbox_folder_id", label: "Drive Folder ID (or paste the folder link)", secret: false, default: "1xWnGVgBdTIuBFD2Gj8JjT0y0QgMJijJf" },
  // Live NAB feed via openfeed (Consumer Data Right) — see
  // server/lib/openfeedClient.js and OPENFEED-SETUP.md. The two IDs come from
  // registering the app at app.openfeed.au; keys, tokens and the grant are
  // created and stored automatically (hidden) by the setup panel.
  { group: "Live Bank Feed (openfeed)", key: "openfeed_client_id", label: "OAuth2 Client ID (app-… from openfeed)", secret: false },
  { group: "Live Bank Feed (openfeed)", key: "openfeed_app_id", label: "App ID (bare UUID from openfeed)", secret: false },
  { group: "Live Bank Feed (openfeed)", key: "openfeed_issuer", label: "Issuer", secret: false, default: "https://auth.openfeed.au" },
  { group: "Live Bank Feed (openfeed)", key: "openfeed_account_name", label: "Bank account name", secret: false, default: "Kutumb Australia Inc" },
  { group: "Live Bank Feed (openfeed)", key: "openfeed_account_bsb", label: "BSB", secret: false, default: "082-356" },
  { group: "Live Bank Feed (openfeed)", key: "openfeed_account_number", label: "Account number", secret: false, default: "778280517" },
  { group: "Live Bank Feed (openfeed)", key: "openfeed_auto_sync", label: "Pull new transactions and reconcile automatically every 4 hours", type: "boolean", default: "true" },
  { group: "Live Bank Feed (openfeed)", key: "openfeed_sync_days", label: "Days of history to read on each sync", secret: false, default: "60" },
];

export async function getSetting(key) {
  const { rows } = await pool.query("SELECT value, is_secret FROM kutumb_platform_settings WHERE key = $1", [key]);
  if (rows.length === 0 || rows[0].value == null) return null;
  return rows[0].is_secret ? decrypt(rows[0].value) : rows[0].value;
}

export async function getAllSettingsForAdmin() {
  const { rows } = await pool.query("SELECT key, value, is_secret, updated_at FROM kutumb_platform_settings");
  const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
  return SETTINGS_SCHEMA.map((def) => {
    const row = byKey[def.key];
    const hasValue = !!row?.value;
    if (def.type === "boolean") {
      const raw = hasValue ? row.value : def.default ?? "false";
      return { ...def, hasValue: true, value: raw === "true" ? "true" : "false", updatedAt: row?.updated_at || null };
    }
    return {
      ...def,
      hasValue,
      value: def.secret ? (hasValue ? "••••••••" : "") : row?.value || "",
      updatedAt: row?.updated_at || null,
    };
  });
}

// Public (unauthenticated) view of just the payment-method toggles — used
// by the registration success page to decide which payment options to show
// a registrant. Deliberately doesn't expose anything else in the schema.
export async function getPaymentMethodSettings() {
  const defs = {
    bankTransfer: SETTINGS_SCHEMA.find((s) => s.key === "payment_method_bank_transfer"),
    card: SETTINGS_SCHEMA.find((s) => s.key === "payment_method_card"),
    square: SETTINGS_SCHEMA.find((s) => s.key === "payment_method_square"),
    paypal: SETTINGS_SCHEMA.find((s) => s.key === "payment_method_paypal"),
  };
  const [bankRaw, cardRaw, squareRaw, paypalRaw] = await Promise.all([
    getSetting("payment_method_bank_transfer"),
    getSetting("payment_method_card"),
    getSetting("payment_method_square"),
    getSetting("payment_method_paypal"),
  ]);
  return {
    bankTransfer: (bankRaw ?? defs.bankTransfer.default) === "true",
    card: (cardRaw ?? defs.card.default) === "true",
    square: (squareRaw ?? defs.square.default) === "true",
    paypal: (paypalRaw ?? defs.paypal.default) === "true",
  };
}

export async function setSetting(key, value, isSecret) {
  const stored = isSecret ? encrypt(value) : value;
  await pool.query(
    `INSERT INTO kutumb_platform_settings (key, value, is_secret, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (key) DO UPDATE SET value = $2, is_secret = $3, updated_at = now()`,
    [key, stored, !!isSecret]
  );
}

export async function deleteSetting(key) {
  await pool.query("DELETE FROM kutumb_platform_settings WHERE key = $1", [key]);
}
