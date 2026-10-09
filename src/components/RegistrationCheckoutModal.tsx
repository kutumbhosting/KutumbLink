import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { X } from "lucide-react";
import { openBlankCheckoutPopup, attachCheckoutPopup } from "@/lib/checkoutPopup";

const slugify = (t: string) => t?.toLowerCase().trim().replace(/\s+/g, "-").replace(/[^\w-]+/g, "");

interface TicketType {
  id: number;
  name: string;
  price_cents: number;
  quantity_total: number;
  quantity_sold: number;
}

interface RegistrationCheckoutModalProps {
  eventTitle: string;
  buyerName: string;
  buyerEmail: string;
  /** The numeric id of the kutumb_event_registrations row being paid for,
   *  if any — passed through to checkout so the webhook/session-status
   *  check can flip that registration's own payment status once Stripe
   *  confirms payment, instead of only recording an unlinked ticket order. */
  registrationId?: number;
  /** Total attendees (adults + children + the registrant) — used as the
   *  default quantity when a real ticket type is selected. */
  defaultQuantity: number;
  /** The already-computed total fee for the whole registration (member/
   *  non-member rate × attendees) — used as the price for the automatic
   *  "General" fallback when no admin-configured ticket types exist. */
  totalFee: number;
  onClose: () => void;
  /** Called once Stripe actually confirms the payment — lets the caller
   *  (the registration success dialog) flip straight to "Registration
   *  Successful" instead of the person having to notice and close this
   *  modal themselves. */
  onSuccess: () => void;
}

// Triggered automatically from the registration success flow whenever a
// fee applies. Lets the person pay by card immediately instead of only
// seeing the bank-transfer option. Ticket type is a dropdown of whatever
// the admin has configured for this event — if nothing's configured yet,
// it silently falls back to a single "General" option priced at the fee
// they were already quoted, and the server auto-creates that ticket type
// the first time anyone actually pays with it.
export default function RegistrationCheckoutModal({
  eventTitle,
  buyerName,
  buyerEmail,
  registrationId,
  defaultQuantity,
  totalFee,
  onClose,
  onSuccess,
}: RegistrationCheckoutModalProps) {
  const eventId = slugify(eventTitle);
  const [ticketTypes, setTicketTypes] = useState<TicketType[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string>("");
  const [quantity, setQuantity] = useState(defaultQuantity);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // Set while the Stripe popup is open and we're waiting to hear back from
  // it, so the modal can show "Waiting for payment..." instead of the old
  // embedded card form.
  const [waitingOnPopup, setWaitingOnPopup] = useState(false);
  const contentRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    fetch(`/api/ticketing/${eventId}/ticket-types`)
      .then((r) => r.json())
      .then((data: TicketType[]) => {
        setTicketTypes(Array.isArray(data) ? data : []);
        if (Array.isArray(data) && data.length > 0) setSelectedId(String(data[0].id));
      })
      .finally(() => setLoading(false));
  }, [eventId]);

  const usingGeneral = ticketTypes.length === 0;
  const selectedType = ticketTypes.find((tt) => String(tt.id) === selectedId);
  const unitPriceCents = usingGeneral ? Math.round(totalFee * 100) : (selectedType?.price_cents ?? 0);
  const effectiveQuantity = usingGeneral ? 1 : quantity;
  const total = unitPriceCents * effectiveQuantity;

  const startCheckout = async () => {
    setError("");
    if (!usingGeneral && !selectedId) return setError("Please select a ticket type.");
    if (effectiveQuantity < 1) return setError("Quantity must be at least 1.");

    // Opened blank, synchronously, right here — before any `await` — so
    // the browser still counts it as triggered by this click and doesn't
    // silently block it (see the matching note in DonateDialog.tsx). We
    // navigate it to the real Stripe checkout URL once we have it below.
    const popup = openBlankCheckoutPopup(contentRef.current);

    setSubmitting(true);
    try {
      const items = usingGeneral
        ? [{ ticketTypeId: "general", quantity: 1, generalPriceCents: Math.round(totalFee * 100) }]
        : [{ ticketTypeId: Number(selectedId), quantity }];

      const res = await fetch(`/api/ticketing/${eventId}/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ buyerName, buyerEmail, items, registrationId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Could not start checkout");

      if (data.free) {
        popup?.close();
        setSubmitting(false);
        onSuccess();
        return;
      }

      setWaitingOnPopup(true);
      attachCheckoutPopup(popup, data.url, {
        onResult: (result) => {
          setWaitingOnPopup(false);
          setSubmitting(false);
          if (result.status === "paid") {
            onSuccess();
          } else {
            setError("The checkout window was cancelled or the payment didn't go through.");
          }
        },
        onBlocked: () => {
          // Pop-up blocked — fall back to the old full-page redirect so
          // the payment can still go through.
          setWaitingOnPopup(false);
          window.location.href = data.url;
        },
        onClosedWithoutResult: () => {
          setWaitingOnPopup(false);
          setSubmitting(false);
          if (!data.sessionId) return;
          fetch(`/api/ticketing/session-status?session_id=${encodeURIComponent(data.sessionId)}`)
            .then((r) => r.json())
            .then((statusData) => {
              if (statusData.status === "paid") {
                onSuccess();
              } else {
                setError("We didn't receive confirmation of payment. If you completed the payment, it may still be processing.");
              }
            })
            .catch(() => {
              setError("We couldn't confirm whether the payment went through. Check your email, or contact us if you were charged.");
            });
        },
      });
    } catch (err: any) {
      popup?.close();
      setError(err.message || "Something went wrong");
      setSubmitting(false);
    }
  };

  return (
    // z-[60], not z-50: this modal is opened from inside
    // EventRegistrationSuccessDialog, a Radix Dialog that stays mounted
    // (and portaled to the end of <body>) behind it. Radix's portal is
    // appended to the DOM after this element, so at matching z-index it
    // would paint on top and silently swallow every click here — the
    // "Pay by Card" button would look broken with no visible error.
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        ref={contentRef}
        className="bg-background rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto relative"
        onClick={(e) => e.stopPropagation()}
      >
        <button onClick={onClose} className="absolute top-3 right-3 text-muted-foreground hover:text-foreground">
          <X size={22} />
        </button>

        <div className="p-6">
          <h2 className="text-xl font-bold mb-1">Pay by Card</h2>
          <p className="text-sm text-muted-foreground mb-4">{eventTitle}</p>

          {waitingOnPopup ? (
            <div className="text-center py-8 space-y-2">
              <p className="text-2xl">💳</p>
              <p className="font-semibold">Complete your payment in the popup window</p>
              <p className="text-sm text-muted-foreground">This will update automatically once payment is confirmed.</p>
              <Button variant="outline" onClick={onClose} className="mt-2">Cancel</Button>
            </div>
          ) : loading ? (
            <p className="text-muted-foreground text-sm">Loading...</p>
          ) : (
            <div className="space-y-4">
              <div>
                <Label>Ticket type</Label>
                {usingGeneral ? (
                  <div className="mt-1 p-2 border rounded bg-muted text-sm">
                    General — ${totalFee.toFixed(2)} <span className="text-muted-foreground">(standard registration fee)</span>
                  </div>
                ) : (
                  <select
                    className="w-full mt-1 p-2 border rounded text-foreground bg-background"
                    value={selectedId}
                    onChange={(e) => setSelectedId(e.target.value)}
                  >
                    {ticketTypes.map((tt) => {
                      const remaining = tt.quantity_total > 0 ? Math.max(tt.quantity_total - tt.quantity_sold, 0) : null;
                      return (
                        <option key={tt.id} value={tt.id}>
                          {tt.name} — ${(tt.price_cents / 100).toFixed(2)}{remaining !== null ? ` (${remaining} left)` : ""}
                        </option>
                      );
                    })}
                  </select>
                )}
              </div>

              {!usingGeneral && (
                <div>
                  <Label>Quantity</Label>
                  <Input type="number" min={1} value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} />
                </div>
              )}

              {error && <p className="text-sm text-destructive">{error}</p>}
              <p className="font-bold">Total: ${(total / 100).toFixed(2)} AUD</p>
              <Button onClick={startCheckout} disabled={submitting} className="w-full btn-hero">
                {submitting ? "Preparing checkout..." : "Continue to payment"}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
