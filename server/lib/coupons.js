import crypto from "crypto";
import QRCode from "qrcode";
import { pool } from "../db/pool.js";

/** Generates a short, human-shareable, unique coupon code like "KUT-7F3QK2". */
export function generateCouponCode() {
  const random = crypto.randomBytes(4).toString("hex").toUpperCase().slice(0, 6);
  return `KUT-${random}`;
}

export async function buildCouponQrDataUrl(code) {
  return QRCode.toDataURL(code, { width: 300, margin: 1 });
}

/**
 * A coupon's valid_until is stored as a plain date ("2026-09-22"), which
 * JavaScript parses as midnight UTC at the very START of that day — so
 * comparing it against `now` directly made a coupon "valid until Sept 22"
 * expire at the first moment of Sept 22, not the end of it, cutting off
 * almost an entire day early (all of the date it was supposed to still
 * work for). "Valid until <date>" means usable through the end of that
 * date, so treat it as expiring at the end of that day (23:59:59.999 UTC)
 * instead of the start of it.
 */
function couponExpiresAt(validUntil) {
  const d = new Date(validUntil);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999));
}

/**
 * Validates a coupon for a given event without redeeming it — used to show
 * the registrant what it's worth before they commit. Returns
 * { ok: true, coupon } or { ok: false, message }.
 */
export async function findValidCoupon(code, eventName, eventYear) {
  if (!code?.trim()) return { ok: false, message: "Enter a coupon code" };
  const { rows } = await pool.query(
    `SELECT * FROM kutumb_event_coupons
     WHERE upper(code) = upper($1) AND event_name = $2 AND event_year = $3`,
    [code.trim(), eventName, eventYear]
  );
  const coupon = rows[0];
  if (!coupon) return { ok: false, message: "That coupon code isn't valid for this event" };
  if (coupon.status === "used") {
    return { ok: false, message: "This coupon has already been used and cannot be reused" };
  }
  if (coupon.status === "void") return { ok: false, message: "This coupon has been cancelled" };
  const now = new Date();
  if (coupon.valid_from && new Date(coupon.valid_from) > now) {
    return { ok: false, message: "This coupon isn't valid yet" };
  }
  if (coupon.valid_until && couponExpiresAt(coupon.valid_until) < now) {
    return { ok: false, message: "This coupon has expired" };
  }
  return { ok: true, coupon };
}

/**
 * Redeems a coupon against a registration inside the caller's transaction.
 * Locks the coupon row (FOR UPDATE) so two simultaneous redemption attempts
 * on the same coupon can never both succeed on more than the balance that's
 * actually left. This is the actual enforcement of "a coupon can't be
 * overspent"; findValidCoupon above is just a preview.
 *
 * `amountDue` is how much the registration still owes right now. Only
 * min(coupon balance, amountDue) is ever deducted — a $100 coupon applied
 * to a $40 balance due only spends $40, leaving $60 on the coupon (still
 * 'active') so it can be used again on a future booking for this event.
 * The coupon only becomes 'used' once its balance hits zero.
 */
export async function redeemCouponForRegistration(client, code, eventName, eventYear, registrationId, amountDue) {
  const { rows } = await client.query(
    `SELECT * FROM kutumb_event_coupons
     WHERE upper(code) = upper($1) AND event_name = $2 AND event_year = $3
     FOR UPDATE`,
    [code.trim(), eventName, eventYear]
  );
  const coupon = rows[0];
  if (!coupon) return { ok: false, message: "That coupon code isn't valid for this event" };
  if (coupon.status !== "active") {
    return { ok: false, message: coupon.status === "used" ? "This coupon has already been fully used" : "This coupon is no longer valid" };
  }
  const now = new Date();
  if (coupon.valid_from && new Date(coupon.valid_from) > now) return { ok: false, message: "This coupon isn't valid yet" };
  if (coupon.valid_until && couponExpiresAt(coupon.valid_until) < now) return { ok: false, message: "This coupon has expired" };

  const balance = Number(coupon.amount);
  const due = Math.max(Number(amountDue) || 0, 0);
  const applied = Math.min(balance, due);
  // Round to cents to avoid floating-point remainders like $59.999999996.
  const remainingBalance = Math.round((balance - applied) * 100) / 100;
  const fullyConsumed = remainingBalance <= 0;

  const { rows: updated } = await client.query(
    `UPDATE kutumb_event_coupons
     SET amount = $1,
         status = CASE WHEN $2 THEN 'used' ELSE 'active' END,
         redeemed_by_registration_id = $3,
         redeemed_at = now()
     WHERE id = $4 RETURNING *`,
    [remainingBalance, fullyConsumed, registrationId, coupon.id]
  );
  return { ok: true, coupon: updated[0], applied, remainingBalance };
}
