import { useState } from "react";
import { Button } from "@/components/ui/button";
import { openBlankCheckoutPopup, attachCheckoutPopup } from "@/lib/checkoutPopup";

interface PayPalButtonProps {
  /** Which kind of thing is being paid for — picks the right backend endpoint. */
  kind?: "registration" | "donation";
  registrationId?: number;
  donationId?: number;
  onSuccess: () => void;
  onError: (message: string) => void;
  /**
   * Optional: told true right when the popup opens and false once it
   * settles, so a parent that swaps its whole layout for a single
   * "complete your payment in the popup" message (as RegistrationPaymentPanel
   * does for Card/Square) can do the same for PayPal. Safe to omit — this
   * component shows its own small inline waiting state either way.
   */
  onWaitingChange?: (waiting: boolean) => void;
}

// Opens PayPal's own hosted approval page in a popup WE size and center
// (see checkoutPopup.ts) — the same popup Card and Square use — rather
// than rendering PayPal's JS SDK "Smart Buttons", which manage their own
// popup entirely internally with no way for us to control its size or
// position. The server creates the order and hands back its "approve"
// link (see /:registrationId/create-order); the popup lands back on
// /checkout/return once approved or cancelled, which is what actually
// calls the capture endpoint — the same result-over-postMessage pattern
// Card and Square already use.
export default function PayPalButton({
  kind = "registration",
  registrationId,
  donationId,
  onSuccess,
  onError,
  onWaitingChange,
}: PayPalButtonProps) {
  const [starting, setStarting] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const targetId = kind === "donation" ? donationId : registrationId;
  const createOrderPath =
    kind === "donation" ? `/api/paypal/donations/${targetId}/create-order` : `/api/paypal/${targetId}/create-order`;

  const setWaitingState = (value: boolean) => {
    setWaiting(value);
    onWaitingChange?.(value);
  };

  const handlePayPaypal = async () => {
    if (!targetId) {
      onError("Missing reference for this payment.");
      return;
    }
    // Opened blank, synchronously, right here — before any `await` — so
    // the browser still counts it as triggered by this click and doesn't
    // silently block it. We navigate it to PayPal's real approval URL once
    // we have it below.
    const popup = openBlankCheckoutPopup();

    setStarting(true);
    try {
      const res = await fetch(createOrderPath, { method: "POST" });
      const result = await res.json();
      if (!res.ok) throw new Error(result.message || "Could not start PayPal checkout");
      if (!result.approveUrl) throw new Error("PayPal didn't return an approval link");

      setWaitingState(true);
      attachCheckoutPopup(popup, result.approveUrl, {
        onResult: (popupResult) => {
          setWaitingState(false);
          setStarting(false);
          if (popupResult.status === "paid") {
            onSuccess();
          } else {
            onError("The PayPal checkout was cancelled or the payment didn't go through.");
          }
        },
        onBlocked: () => {
          setWaitingState(false);
          setStarting(false);
          // Popup blocked outright — fall back to a full-page redirect,
          // same fallback Card/Square use in RegistrationPaymentPanel.
          window.location.href = result.approveUrl;
        },
        onClosedWithoutResult: () => {
          setWaitingState(false);
          setStarting(false);
          onError(
            "We didn't receive confirmation of payment. If you completed the payment, it may still be processing."
          );
        },
      });
    } catch (err: any) {
      popup?.close();
      setWaitingState(false);
      setStarting(false);
      onError(err.message || "Could not start PayPal checkout");
    }
  };

  if (waiting) {
    return (
      <div className="text-center py-4 space-y-1">
        <p className="text-xl">🅿️</p>
        <p className="text-sm font-semibold">Complete your payment in the popup window</p>
        <p className="text-xs text-muted-foreground">This will update automatically once payment is confirmed.</p>
      </div>
    );
  }

  return (
    <Button
      onClick={handlePayPaypal}
      disabled={starting}
      className="w-full text-white"
      style={{ backgroundColor: "#0070ba" }}
    >
      {starting ? "Opening PayPal checkout..." : "Pay with PayPal"}
    </Button>
  );
}
