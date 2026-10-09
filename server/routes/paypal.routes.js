import { Router } from "express";
import { CANCELLED_MESSAGE } from "../lib/registrationScheduler.js";
import { pool } from "../db/pool.js";
import { paypalFetch } from "../lib/paypalClient.js";
import { getSetting } from "../lib/settings.js";
import { getPublicBaseUrl } from "../lib/publicUrl.js";
import {
  recordPaymentAttempt,
  findPaymentByReference,
  markPaymentPaid,
  markPaymentFailed,
} from "../lib/registrationPayments.js";
import {
  recordDonationPaymentAttempt,
  findDonationPaymentByReference,
  markDonationPaymentPaid,
  markDonationPaymentFailed,
} from "../lib/donationPayments.js";

const router = Router();

/* ============================================================
   PUBLIC: PayPal Client ID for the storefront's JS SDK. Safe to expose —
   a PayPal Client ID is designed to be public (embedded in the SDK script
   URL on every page that uses it). The client secret never leaves the server.
   ============================================================ */
router.get("/config", async (req, res) => {
  const clientId = await getSetting("paypal_client_id");
  res.json({ clientId: clientId || null });
});

async function getRegistrationOrFail(registrationId, res) {
  const { rows } = await pool.query("SELECT * FROM kutumb_event_registrations WHERE id = $1", [registrationId]);
  const registration = rows[0];
  if (!registration) {
    res.status(404).json({ message: "Registration not found" });
    return null;
  }
  if (registration.registration_status === "cancelled") {
    res.status(410).json({ message: CANCELLED_MESSAGE });
    return null;
  }
  return registration;
}

/* ============================================================
   PUBLIC: create a PayPal order for a registration's remaining balance.
   Returns the order's own "approve" link (PayPal's hosted approval page)
   rather than relying on the PayPal JS SDK's Smart Buttons to manage their
   own popup — that SDK opens and sizes its popup entirely on its own, with
   no way for us to control it, which is why the client instead opens this
   approveUrl itself via the same sized/centered popup used for Stripe and
   Square (see checkoutPopup.ts). application_context.return_url/cancel_url
   is what sends the approval page back to OUR site once the buyer approves
   or cancels, landing back in that same popup. Approval itself doesn't
   move any money — only the server-side capture below does that, and only
   the capture response is trusted.
   ============================================================ */
router.post("/:registrationId/create-order", async (req, res) => {
  try {
    const registrationId = Number(req.params.registrationId);
    const registration = await getRegistrationOrFail(registrationId, res);
    if (!registration) return;

    const fee = Number(registration.fee) || 0;
    const alreadyPaid = Number(registration.payment_amount) || 0;
    const remaining = Math.max(fee - alreadyPaid, 0);
    if (remaining <= 0) return res.status(400).json({ message: "This registration has no remaining balance to pay" });

    const baseUrl = await getPublicBaseUrl(req);
    const order = await paypalFetch("/v2/checkout/orders", {
      method: "POST",
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [
          {
            custom_id: String(registrationId),
            description: `${registration.event_name} registration — ${registration.name}`,
            amount: { currency_code: "AUD", value: remaining.toFixed(2) },
          },
        ],
        application_context: {
          brand_name: "Kutumb",
          shipping_preference: "NO_SHIPPING",
          user_action: "PAY_NOW",
          return_url: `${baseUrl}/checkout/return?provider=paypal&registrationId=${registrationId}`,
          cancel_url: `${baseUrl}/checkout/return?provider=paypal&registrationId=${registrationId}&cancelled=1`,
        },
      }),
    });

    await recordPaymentAttempt(registrationId, "paypal", order.id, remaining);
    const approveUrl = order.links?.find((l) => l.rel === "approve")?.href || null;
    res.json({ orderId: order.id, approveUrl });
  } catch (err) {
    console.error("PAYPAL CREATE ORDER ERROR:", err);
    res.status(err.notConfigured ? 503 : 500).json({ message: err.message || "Could not start PayPal checkout" });
  }
});

/* ============================================================
   PUBLIC: same order creation as above, for a donation. A donation's
   amount is fixed at creation — the full amount is always charged.
   ============================================================ */
router.post("/donations/:donationId/create-order", async (req, res) => {
  try {
    const donationId = Number(req.params.donationId);
    const { rows } = await pool.query("SELECT * FROM kutumb_donations WHERE id = $1", [donationId]);
    const donation = rows[0];
    if (!donation) return res.status(404).json({ message: "Donation not found" });
    if (donation.payment_status === "Paid") {
      return res.status(400).json({ message: "This donation has already been paid" });
    }

    const baseUrl = await getPublicBaseUrl(req);
    const amount = Number(donation.amount);
    const order = await paypalFetch("/v2/checkout/orders", {
      method: "POST",
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [
          {
            custom_id: String(donationId),
            description: `Kutumb donation — ${donation.name}`,
            amount: { currency_code: "AUD", value: amount.toFixed(2) },
          },
        ],
        application_context: {
          brand_name: "Kutumb",
          shipping_preference: "NO_SHIPPING",
          user_action: "PAY_NOW",
          return_url: `${baseUrl}/checkout/return?provider=paypal-donation&donationId=${donationId}`,
          cancel_url: `${baseUrl}/checkout/return?provider=paypal-donation&donationId=${donationId}&cancelled=1`,
        },
      }),
    });

    await recordDonationPaymentAttempt(donationId, "paypal", order.id, amount);
    const approveUrl = order.links?.find((l) => l.rel === "approve")?.href || null;
    res.json({ orderId: order.id, approveUrl });
  } catch (err) {
    console.error("PAYPAL DONATION CREATE ORDER ERROR:", err);
    res.status(err.notConfigured ? 503 : 500).json({ message: err.message || "Could not start PayPal checkout" });
  }
});

/* ============================================================
   PUBLIC: capture a PayPal order after the buyer approves it in the Smart
   Buttons. This call to PayPal itself is the authoritative confirmation —
   the registration is only marked Paid once PayPal's own capture response
   says COMPLETED, never just because the client-side button fired.
   ============================================================ */
router.post("/orders/:orderId/capture", async (req, res) => {
  try {
    const registrationRecord = await findPaymentByReference("paypal", req.params.orderId);
    const donationRecord = registrationRecord ? null : await findDonationPaymentByReference("paypal", req.params.orderId);
    const record = registrationRecord || donationRecord;
    if (!record) return res.status(404).json({ message: "No matching PayPal payment attempt found" });

    let capture;
    try {
      capture = await paypalFetch(`/v2/checkout/orders/${req.params.orderId}/capture`, { method: "POST" });
    } catch (captureErr) {
      // If this order was already captured (e.g. the webhook beat this
      // call to it, or the popup's return page ran this twice), PayPal
      // rejects a second capture attempt outright rather than just
      // repeating the first result. Treat that specific case as success —
      // look up the order's current (already-captured) state instead of
      // failing a payment that actually went through.
      const alreadyCaptured = captureErr.paypalResponse?.details?.some(
        (d) => d.issue === "ORDER_ALREADY_CAPTURED"
      );
      if (!alreadyCaptured) throw captureErr;
      capture = await paypalFetch(`/v2/checkout/orders/${req.params.orderId}`, { method: "GET" });
    }
    const status = capture.status; // 'COMPLETED' | 'VOIDED' | ...
    const captureId = capture.purchase_units?.[0]?.payments?.captures?.[0]?.id;

    if (status === "COMPLETED") {
      if (registrationRecord) {
        await markPaymentPaid(record.id, status, captureId);
        return res.json({ status: "COMPLETED", registrationId: record.registration_id });
      }
      await markDonationPaymentPaid(record.id, status, captureId);
      return res.json({ status: "COMPLETED", donationId: record.donation_id });
    }

    if (registrationRecord) await markPaymentFailed(record.id, status);
    else await markDonationPaymentFailed(record.id, status);
    res.status(402).json({ message: `PayPal did not complete this payment (status: ${status})`, status });
  } catch (err) {
    console.error("PAYPAL CAPTURE ERROR:", err);
    res.status(500).json({ message: err.message || "Could not capture PayPal payment" });
  }
});

/* ============================================================
   Webhook — defense in depth alongside the capture call above (e.g. if the
   buyer's browser loses connection right after approving, before our
   capture call completes). Verified via PayPal's own verify-webhook-
   signature endpoint rather than local signature math.
   ============================================================ */
router.post("/webhook", async (req, res) => {
  try {
    const webhookId = await getSetting("paypal_webhook_id");
    if (webhookId) {
      const verification = await paypalFetch("/v1/notifications/verify-webhook-signature", {
        method: "POST",
        body: JSON.stringify({
          auth_algo: req.headers["paypal-auth-algo"],
          cert_url: req.headers["paypal-cert-url"],
          transmission_id: req.headers["paypal-transmission-id"],
          transmission_sig: req.headers["paypal-transmission-sig"],
          transmission_time: req.headers["paypal-transmission-time"],
          webhook_id: webhookId,
          webhook_event: req.body,
        }),
      }).catch(() => null);
      if (!verification || verification.verification_status !== "SUCCESS") {
        console.error("PAYPAL WEBHOOK: signature verification failed");
        return res.status(400).send("Invalid signature");
      }
    } else {
      console.warn("PAYPAL WEBHOOK: no paypal_webhook_id configured — skipping signature check");
    }

    const event = req.body;
    if (event.event_type === "PAYMENT.CAPTURE.COMPLETED") {
      const orderId = event.resource?.supplementary_data?.related_ids?.order_id;
      const captureId = event.resource?.id;
      if (orderId) {
        const record = await findPaymentByReference("paypal", orderId);
        if (record) {
          await markPaymentPaid(record.id, "COMPLETED", captureId);
        } else {
          const donationRecord = await findDonationPaymentByReference("paypal", orderId);
          if (donationRecord) await markDonationPaymentPaid(donationRecord.id, "COMPLETED", captureId);
        }
      }
    } else if (event.event_type === "PAYMENT.CAPTURE.DENIED") {
      const orderId = event.resource?.supplementary_data?.related_ids?.order_id;
      if (orderId) {
        const record = await findPaymentByReference("paypal", orderId);
        if (record) {
          await markPaymentFailed(record.id, "DENIED");
        } else {
          const donationRecord = await findDonationPaymentByReference("paypal", orderId);
          if (donationRecord) await markDonationPaymentFailed(donationRecord.id, "DENIED");
        }
      }
    }

    res.json({ received: true });
  } catch (err) {
    console.error("PAYPAL WEBHOOK ERROR:", err);
    res.status(500).send("Webhook processing failed");
  }
});

export default router;
