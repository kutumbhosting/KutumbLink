import { useEffect, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { CHECKOUT_POPUP_NAME } from "@/lib/checkoutPopup";

// Stripe's Embedded Checkout navigates the browser HERE once payment
// completes (it's a real page load, not just closing the modal — that's
// how Embedded Checkout is designed to work). We look up the payment
// status by session_id and show a simple confirmation.
//
// This page can be reached two ways:
//  1. Inside a popup window we opened ourselves (window.open(url,
//     CHECKOUT_POPUP_NAME, ...)) for a Stripe or Square redirect checkout.
//     Once we know the outcome, we post it back to the opener and offer to
//     close the popup automatically.
//  2. As an ordinary page load (no opener, or a popup got blocked and the
//     browser navigated the main tab instead) — in that case we just show
//     the normal confirmation UI, same as before.
export default function CheckoutReturn() {
  const [params] = useSearchParams();
  const sessionId = params.get("session_id");
  const provider = params.get("provider"); // "square" when returning from a Square Payment Link
  const registrationId = params.get("registrationId");
  const [status, setStatus] = useState<"loading" | "paid" | "pending" | "error">("loading");
  const [orderId, setOrderId] = useState<number | null>(null);

  const donationId = params.get("donationId");
  // PayPal appends its own order id to whatever return_url we gave it as
  // `token` (its terminology, not ours — it's the same id create-order
  // returned as orderId) — that's how we know which order to capture.
  // `cancelled` is our own flag, added to the cancel_url we pass PayPal.
  const paypalOrderToken = params.get("token");
  const cancelled = params.get("cancelled") === "1";

  // Only treat this as "running inside our popup" when it really is one:
  // has an opener, isn't the top-level window some other way, and was
  // given our popup name.
  const isPopup =
    typeof window !== "undefined" &&
    !!window.opener &&
    window.opener !== window &&
    window.name === CHECKOUT_POPUP_NAME;

  const [autoCloseIn, setAutoCloseIn] = useState<number | null>(null);

  // Tell the opener what happened as soon as we have a definite answer, and
  // start the auto-close countdown. We never auto-close on "pending" —
  // that state means we genuinely don't know yet, so the person should be
  // able to read the message and decide for themselves.
  useEffect(() => {
    if (!isPopup || status === "loading" || status === "pending") return;

    try {
      window.opener.postMessage(
        {
          source: "kutumb-checkout",
          status, // "paid" | "error"
          provider,
          donationId: donationId || null,
          registrationId: registrationId || null,
          orderId,
        },
        window.location.origin
      );
    } catch (err) {
      console.error("Could not notify opener window:", err);
    }

    setAutoCloseIn(status === "paid" ? 3 : 6);
  }, [isPopup, status, provider, donationId, registrationId, orderId]);

  // Count down, then close. If window.close() is refused by the browser
  // (it can be, depending on how the popup was opened), the countdown just
  // reaches 0 and the person uses the "Close this window" button instead —
  // handled below.
  useEffect(() => {
    if (autoCloseIn === null) return;
    if (autoCloseIn <= 0) {
      window.close();
      return;
    }
    const t = setTimeout(() => setAutoCloseIn((s) => (s !== null ? s - 1 : s)), 1000);
    return () => clearTimeout(t);
  }, [autoCloseIn]);

  useEffect(() => {
    if (provider === "square" && registrationId) {
      fetch(`/api/square/status/${registrationId}`)
        .then((r) => r.json())
        .then((data) => setStatus(data.status === "paid" ? "paid" : data.status === "failed" ? "error" : "pending"))
        .catch(() => setStatus("error"));
      return;
    }

    if (provider === "square-donation" && donationId) {
      fetch(`/api/square/donation-status/${donationId}`)
        .then((r) => r.json())
        .then((data) => setStatus(data.status === "paid" ? "paid" : data.status === "failed" ? "error" : "pending"))
        .catch(() => setStatus("error"));
      return;
    }

    if (provider === "stripe-donation" && donationId) {
      fetch(`/api/donations/${donationId}/status`)
        .then((r) => r.json())
        .then((data) => setStatus(data.status === "paid" ? "paid" : data.status === "failed" ? "error" : "pending"))
        .catch(() => setStatus("error"));
      return;
    }

    if (provider === "registration-card" && registrationId) {
      fetch(`/api/events/registration/${registrationId}/card-status`)
        .then((r) => r.json())
        .then((data) => setStatus(data.status === "paid" ? "paid" : data.status === "failed" ? "error" : "pending"))
        .catch(() => setStatus("error"));
      return;
    }

    // PayPal's own redirect flow (opened in our own sized/centered popup —
    // see checkoutPopup.ts and PayPalButton.tsx) rather than the JS SDK's
    // Smart Buttons, which managed their own uncontrollable popup. If the
    // buyer cancelled on PayPal's page, or PayPal somehow didn't hand back
    // its order token, there's nothing approved to capture — call it an
    // error without bothering PayPal, exactly like a cancelled Stripe/
    // Square checkout ends up "not paid" without a special-cased message.
    if ((provider === "paypal" || provider === "paypal-donation") && paypalOrderToken) {
      if (cancelled) {
        setStatus("error");
        return;
      }
      fetch(`/api/paypal/orders/${paypalOrderToken}/capture`, { method: "POST" })
        .then((r) => r.json().then((data) => ({ ok: r.ok, data })))
        .then(({ ok, data }) => setStatus(ok && data.status === "COMPLETED" ? "paid" : "error"))
        .catch(() => setStatus("error"));
      return;
    }

    if (!sessionId) {
      setStatus("error");
      return;
    }
    fetch(`/api/ticketing/session-status?session_id=${encodeURIComponent(sessionId)}`)
      .then((r) => r.json())
      .then((data) => {
        setOrderId(data.orderId || null);
        setStatus(data.status === "paid" ? "paid" : "pending");
      })
      .catch(() => setStatus("error"));
  }, [sessionId, provider, registrationId, donationId, paypalOrderToken, cancelled]);

  // Inside our popup, skip the site chrome entirely — it's a small window
  // whose only job is to show the outcome for a few seconds and disappear.
  if (isPopup) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center text-center px-6">
        {status === "loading" && <p className="text-muted-foreground">Checking your payment...</p>}

        {status === "paid" && (
          <>
            <p className="text-3xl mb-2">🎉</p>
            <h1 className="text-xl font-extrabold mb-2">Payment confirmed!</h1>
            <p className="text-muted-foreground mb-4">
              {donationId ? "Thank you for your donation!" : "Your payment has been recorded."}
            </p>
          </>
        )}

        {status === "error" && (
          <>
            <h1 className="text-xl font-bold mb-2">Something went wrong</h1>
            <p className="text-muted-foreground mb-4">
              We couldn't confirm that payment. If you were charged, please contact us.
            </p>
          </>
        )}

        {autoCloseIn !== null && (
          <p className="text-sm text-muted-foreground mb-2">
            This window will close automatically in {autoCloseIn}s…
          </p>
        )}
        <button
          onClick={() => window.close()}
          className="text-primary hover:underline text-sm"
        >
          Close this window
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-1 container mx-auto px-4 py-20 text-center">
        {status === "loading" && <p className="text-muted-foreground">Checking your payment...</p>}

        {status === "paid" && (
          <>
            <h1 className="text-3xl font-extrabold mb-2">🎉 Payment confirmed!</h1>
            <p className="text-muted-foreground mb-6">
              {donationId
                ? "Thank you for your donation!"
                : orderId
                ? `Order #${orderId} is confirmed.`
                : "Your registration is confirmed."}{" "}
              A confirmation has been recorded.
            </p>
          </>
        )}

        {status === "pending" && (
          <>
            <h1 className="text-2xl font-bold mb-2">Almost there...</h1>
            <p className="text-muted-foreground mb-6">
              We're still waiting for final confirmation from Stripe. This is usually instant — refresh in a few seconds if it doesn't update.
            </p>
          </>
        )}

        {status === "error" && (
          <>
            <h1 className="text-2xl font-bold mb-2">Something went wrong</h1>
            <p className="text-muted-foreground mb-6">We couldn't find that payment session. If you were charged, please contact us.</p>
          </>
        )}

        <Link to="/events" className="text-primary hover:underline">Back to Events</Link>
      </main>
      <Footer />
    </div>
  );
}
