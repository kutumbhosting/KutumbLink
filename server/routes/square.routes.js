import { Router } from "express";
import { CANCELLED_MESSAGE } from "../lib/registrationScheduler.js";
import crypto from "crypto";
import { pool } from "../db/pool.js";
import { squareFetch, getSquareConfig } from "../lib/squareClient.js";
import { getSetting } from "../lib/settings.js";
import { getPublicBaseUrl, getConfiguredPublicBaseUrl } from "../lib/publicUrl.js";
import {
  recordPaymentAttempt,
  findPaymentByReference,
  getPayment,
  markPaymentPaid,
  markPaymentFailed,
} from "../lib/registrationPayments.js";
import {
  recordDonationPaymentAttempt,
  findDonationPaymentByReference,
  getDonationPayment,
  markDonationPaymentPaid,
  markDonationPaymentFailed,
} from "../lib/donationPayments.js";

const router = Router();

async function getRemainingBalance(registration) {
  const fee = Number(registration.fee) || 0;
  const alreadyPaid = Number(registration.payment_amount) || 0;
  return Math.max(fee - alreadyPaid, 0);
}

/* ============================================================
   PUBLIC: create a Square-hosted Payment Link for a registration's
   remaining balance. No Square SDK needed on the client — the browser is
   simply sent to Square's own checkout page, then back to /checkout/return.
   ============================================================ */
router.post("/:registrationId/checkout", async (req, res) => {
  try {
    const registrationId = Number(req.params.registrationId);
    const { rows } = await pool.query("SELECT * FROM kutumb_event_registrations WHERE id = $1", [registrationId]);
    const registration = rows[0];
    if (!registration) return res.status(404).json({ message: "Registration not found" });
    if (registration.registration_status === "cancelled") return res.status(410).json({ message: CANCELLED_MESSAGE });

    const remaining = await getRemainingBalance(registration);
    if (remaining <= 0) return res.status(400).json({ message: "This registration has no remaining balance to pay" });

    const config = await getSquareConfig();
    if (!config) {
      return res.status(503).json({ message: "Square isn't configured yet. Ask the admin to add Square details in Settings & Access." });
    }

    const baseUrl = await getPublicBaseUrl(req);

    const data = await squareFetch("/v2/online-checkout/payment-links", {
      method: "POST",
      body: JSON.stringify({
        idempotency_key: crypto.randomUUID(),
        quick_pay: {
          name: `${registration.event_name} registration — ${registration.name}`,
          price_money: { amount: Math.round(remaining * 100), currency: "AUD" },
          location_id: config.locationId,
        },
        checkout_options: {
          redirect_url: `${baseUrl}/checkout/return?provider=square&registrationId=${registrationId}`,
        },
      }),
    });

    const orderId = data.payment_link?.order_id;
    if (!orderId || !data.payment_link?.url) {
      return res.status(502).json({ message: "Square didn't return a usable checkout link" });
    }

    await recordPaymentAttempt(registrationId, "square", orderId, remaining);
    res.json({ url: data.payment_link.url, orderId });
  } catch (err) {
    console.error("SQUARE CHECKOUT ERROR:", err);
    res.status(err.notConfigured ? 503 : 500).json({ message: err.message || "Could not start Square checkout" });
  }
});

/* ============================================================
   PUBLIC: fallback status check for the /checkout/return page, in case the
   webhook hasn't landed yet (mirrors the Stripe session-status endpoint).
   Confirms directly against Square's own Orders API rather than trusting
   the browser having merely returned from checkout.
   ============================================================ */
router.get("/status/:registrationId", async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT * FROM kutumb_registration_payments WHERE registration_id = $1 AND provider = 'square' ORDER BY created_at DESC LIMIT 1",
      [req.params.registrationId]
    );
    const payment = rows[0];
    if (!payment) return res.status(404).json({ message: "No Square payment found for this registration" });

    if (payment.status === "pending") {
      try {
        const order = await squareFetch(`/v2/orders/${payment.provider_reference}`);
        const state = order.order?.state; // 'OPEN' | 'COMPLETED' | 'CANCELED'
        const tenders = order.order?.tenders || [];
        const paidTender = tenders.find((t) => t.payment_id);
        if (state === "COMPLETED" || paidTender) {
          await markPaymentPaid(payment.id, state, paidTender?.payment_id || null);
        } else if (state === "CANCELED") {
          await markPaymentFailed(payment.id, state);
        }
      } catch (err) {
        console.error("SQUARE STATUS CHECK ERROR:", err);
      }
    }

    const refreshed = await getPayment(payment.id);
    res.json({ status: refreshed?.status || payment.status, registrationId: payment.registration_id });
  } catch (err) {
    console.error("SQUARE STATUS ERROR:", err);
    res.status(500).json({ message: "Could not check Square payment status" });
  }
});

/* ============================================================
   PUBLIC: same Payment Link checkout as above, for a donation instead of
   an event registration — a donation's amount is fixed at creation (no
   "remaining balance" concept), so the full amount is always charged.
   ============================================================ */
router.post("/donations/:donationId/checkout", async (req, res) => {
  try {
    const donationId = Number(req.params.donationId);
    const { rows } = await pool.query("SELECT * FROM kutumb_donations WHERE id = $1", [donationId]);
    const donation = rows[0];
    if (!donation) return res.status(404).json({ message: "Donation not found" });
    if (donation.payment_status === "Paid") {
      return res.status(400).json({ message: "This donation has already been paid" });
    }

    const config = await getSquareConfig();
    if (!config) {
      return res.status(503).json({ message: "Square isn't configured yet. Ask the admin to add Square details in Settings & Access." });
    }

    const baseUrl = await getPublicBaseUrl(req);
    const amount = Number(donation.amount);

    const data = await squareFetch("/v2/online-checkout/payment-links", {
      method: "POST",
      body: JSON.stringify({
        idempotency_key: crypto.randomUUID(),
        quick_pay: {
          name: `Kutumb donation — ${donation.name}`,
          price_money: { amount: Math.round(amount * 100), currency: "AUD" },
          location_id: config.locationId,
        },
        checkout_options: {
          redirect_url: `${baseUrl}/checkout/return?provider=square-donation&donationId=${donationId}`,
        },
      }),
    });

    const orderId = data.payment_link?.order_id;
    if (!orderId || !data.payment_link?.url) {
      return res.status(502).json({ message: "Square didn't return a usable checkout link" });
    }

    await recordDonationPaymentAttempt(donationId, "square", orderId, amount);
    res.json({ url: data.payment_link.url, orderId });
  } catch (err) {
    console.error("SQUARE DONATION CHECKOUT ERROR:", err);
    res.status(err.notConfigured ? 503 : 500).json({ message: err.message || "Could not start Square checkout" });
  }
});

router.get("/donation-status/:donationId", async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT * FROM kutumb_donation_payments WHERE donation_id = $1 AND provider = 'square' ORDER BY created_at DESC LIMIT 1",
      [req.params.donationId]
    );
    const payment = rows[0];
    if (!payment) return res.status(404).json({ message: "No Square payment found for this donation" });

    if (payment.status === "pending") {
      try {
        const order = await squareFetch(`/v2/orders/${payment.provider_reference}`);
        const state = order.order?.state;
        const tenders = order.order?.tenders || [];
        const paidTender = tenders.find((t) => t.payment_id);
        if (state === "COMPLETED" || paidTender) {
          await markDonationPaymentPaid(payment.id, state, paidTender?.payment_id || null);
        } else if (state === "CANCELED") {
          await markDonationPaymentFailed(payment.id, state);
        }
      } catch (err) {
        console.error("SQUARE DONATION STATUS CHECK ERROR:", err);
      }
    }

    const refreshed = await getDonationPayment(payment.id);
    res.json({ status: refreshed?.status || payment.status, donationId: payment.donation_id });
  } catch (err) {
    console.error("SQUARE DONATION STATUS ERROR:", err);
    res.status(500).json({ message: "Could not check Square payment status" });
  }
});

/* ============================================================
   Square webhook — mounted with express.raw() in server.js so the raw
   body bytes are available for signature verification. Confirms payment
   using Square's own event, not the browser's return-page visit.
   ============================================================ */
export async function squareWebhookHandler(req, res) {
  try {
    const signatureKey = await getSetting("square_webhook_signature_key");
    const signatureHeader = req.headers["x-square-hmacsha256-signature"];
    const baseUrl = (await getConfiguredPublicBaseUrl()) || "";
    const notificationUrl = `${baseUrl}/api/square/webhook`;

    if (signatureKey && signatureHeader) {
      const hmac = crypto.createHmac("sha256", signatureKey);
      hmac.update(notificationUrl + req.body.toString("utf8"));
      const expected = hmac.digest("base64");
      if (expected !== signatureHeader) {
        console.error("SQUARE WEBHOOK: signature mismatch");
        return res.status(400).send("Invalid signature");
      }
    } else {
      // No signature key configured yet — accept but log, so initial setup
      // isn't blocked; an admin should add the key to secure this properly.
      console.warn("SQUARE WEBHOOK: no square_webhook_signature_key configured — skipping signature check");
    }

    const event = JSON.parse(req.body.toString("utf8"));
    if (event.type === "payment.updated" || event.type === "payment.created") {
      const payment = event.data?.object?.payment;
      const orderId = payment?.order_id;
      const status = payment?.status; // 'COMPLETED' | 'FAILED' | 'CANCELED' | ...
      if (orderId) {
        const record = await findPaymentByReference("square", orderId);
        if (record) {
          if (status === "COMPLETED") {
            await markPaymentPaid(record.id, status, payment.id);
          } else if (status === "FAILED" || status === "CANCELED") {
            await markPaymentFailed(record.id, status);
          }
        } else {
          // Not a registration payment — check whether it's a donation instead.
          const donationRecord = await findDonationPaymentByReference("square", orderId);
          if (donationRecord) {
            if (status === "COMPLETED") {
              await markDonationPaymentPaid(donationRecord.id, status, payment.id);
            } else if (status === "FAILED" || status === "CANCELED") {
              await markDonationPaymentFailed(donationRecord.id, status);
            }
          }
        }
      }
    }

    res.json({ received: true });
  } catch (err) {
    console.error("SQUARE WEBHOOK ERROR:", err);
    res.status(500).send("Webhook processing failed");
  }
}

export default router;
