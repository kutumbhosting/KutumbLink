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
  description: string | null;
  price_cents: number;
  quantity_total: number;
  quantity_sold: number;
  pricing_mode?: "fixed" | "pay_what_you_feel";
  minimum_price_cents?: number;
  maximum_price_cents?: number | null;
  group_min_quantity?: number | null;
  group_price_cents?: number | null;
}

interface CheckoutModalProps {
  eventTitle: string;
  onClose: () => void;
}

// Two-step modal: 1) pick tickets + buyer details, 2) Stripe's own embedded
// payment form takes over once a Checkout Session exists. Free events skip
// straight to a confirmation with no Stripe involved at all.
export default function CheckoutModal({ eventTitle, onClose }: CheckoutModalProps) {
  const eventId = slugify(eventTitle);
  const [ticketTypes, setTicketTypes] = useState<TicketType[]>([]);
  const [loading, setLoading] = useState(true);
  const [qty, setQty] = useState<Record<number, number>>({});
  const [buyerName, setBuyerName] = useState("");
  const [buyerEmail, setBuyerEmail] = useState("");
  const [accessCodeInput, setAccessCodeInput] = useState("");
  const [accessCode, setAccessCode] = useState("");
  const [discountCodeInput, setDiscountCodeInput] = useState("");
  const [discountCode, setDiscountCode] = useState("");
  const [discount, setDiscount] = useState<{ type: string; value: number } | null>(null);
  const [waitlistJoined, setWaitlistJoined] = useState(false);
  const [customPrices, setCustomPrices] = useState<Record<number, number>>({});
  const [freeConfirmed, setFreeConfirmed] = useState<number | null>(null);
  const [paidConfirmed, setPaidConfirmed] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // Set while the Stripe popup is open and we're waiting to hear back from
  // it, so the modal can show "Waiting for payment..." instead of the old
  // embedded card form.
  const [waitingOnPopup, setWaitingOnPopup] = useState(false);
  const contentRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    fetch(`/api/ticketing/${eventId}/ticket-types${accessCode ? `?accessCode=${encodeURIComponent(accessCode)}` : ""}`)
      .then((r) => r.json())
      .then((data) => setTicketTypes(Array.isArray(data) ? data : []))
      .finally(() => setLoading(false));
  }, [eventId, accessCode]);

  const subtotal = ticketTypes.reduce((sum, tt) => {
    const count = qty[tt.id] || 0;
    const unit = tt.pricing_mode === "pay_what_you_feel" ? (customPrices[tt.id] ?? Number(tt.minimum_price_cents || 0))
      : tt.group_min_quantity && count >= tt.group_min_quantity && tt.group_price_cents != null ? Number(tt.group_price_cents) : tt.price_cents;
    return sum + count * unit;
  }, 0);
  const discountCents = discount ? Math.min(subtotal, discount.type === "percent" ? Math.round(subtotal * discount.value / 100) : Math.round(discount.value * 100)) : 0;
  const total = subtotal - discountCents;

  const unlockAccess = async () => {
    setError("");
    const code = accessCodeInput.trim();
    if (!code) return;
    try {
      const res = await fetch(`/api/ticketing/${eventId}/codes/check?code=${encodeURIComponent(code)}`);
      const data = await res.json();
      if (!res.ok || data.type !== "access") throw new Error(data.message || "That access code is not valid");
      setAccessCode(code);
    } catch (err: any) { setError(err.message || "Could not check this code"); }
  };

  const applyDiscount = async () => {
    setError("");
    const code = discountCodeInput.trim();
    if (!code) return;
    try {
      const res = await fetch(`/api/ticketing/${eventId}/codes/check?code=${encodeURIComponent(code)}`);
      const data = await res.json();
      if (!res.ok || data.type !== "discount") throw new Error(data.message || "That discount code is not valid");
      setDiscountCode(code);
      setDiscount({ type: data.discountType, value: Number(data.discountValue) });
    } catch (err: any) { setError(err.message || "Could not check this code"); }
  };

  const joinWaitlist = async (ticketTypeId: number) => {
    setError("");
    if (!buyerName.trim() || !buyerEmail.trim()) return setError("Add your name and email first so the organiser can contact you.");
    try {
      const res = await fetch(`/api/ticketing/${eventId}/waitlist`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: buyerName, email: buyerEmail, ticketTypeId, requestedQty: 1 }) });
      const data = await res.json(); if (!res.ok) throw new Error(data.message || "Could not join the waitlist");
      setWaitlistJoined(true);
    } catch (err: any) { setError(err.message || "Could not join the waitlist"); }
  };

  const startCheckout = async () => {
    setError("");
    const items = Object.entries(qty).filter(([, q]) => q > 0).map(([ticketTypeId, quantity]) => ({ ticketTypeId: Number(ticketTypeId), quantity, ...(customPrices[Number(ticketTypeId)] != null ? { unitPriceCents: Math.round(customPrices[Number(ticketTypeId)]) } : {}) }));
    if (items.length === 0) return setError("Select at least one ticket.");
    if (!buyerName.trim() || !buyerEmail.trim()) return setError("Name and email are required.");

    // Opened blank, synchronously, right here — before any `await` — so
    // the browser still counts it as triggered by this click and doesn't
    // silently block it (see the matching note in DonateDialog.tsx). We
    // navigate it to the real Stripe checkout URL once we have it below.
    // A free order never needs it, but we don't know that yet — closed
    // straight back down below if so.
    const popup = openBlankCheckoutPopup(contentRef.current);

    setSubmitting(true);
    try {
      const res = await fetch(`/api/ticketing/${eventId}/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ buyerName, buyerEmail, items, accessCode, discountCode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Could not start checkout");

      if (data.free) {
        popup?.close();
        setFreeConfirmed(data.orderId);
        setSubmitting(false);
        return;
      }

      setWaitingOnPopup(true);
      attachCheckoutPopup(popup, data.url, {
        onResult: (result) => {
          setWaitingOnPopup(false);
          setSubmitting(false);
          if (result.status === "paid") {
            setPaidConfirmed(data.orderId);
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
                setPaidConfirmed(data.orderId);
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
    // z-[60], not z-50: keeps this above any Radix Dialog that might still
    // be open behind it (Radix portals its dialogs to the end of <body>,
    // which paints on top of an equal z-index element mounted earlier).
    <div className="market-checkout-overlay fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        ref={contentRef}
        className="market-checkout-panel bg-background rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto relative"
        onClick={(e) => e.stopPropagation()}
      >
        <button onClick={onClose} className="absolute top-3 right-3 text-muted-foreground hover:text-foreground">
          <X size={22} />
        </button>

        <div className="p-6">
          <h2 className="text-xl font-bold mb-4">{eventTitle} — Get tickets</h2>

          {freeConfirmed ? (
            <div className="text-center py-8 space-y-2">
              <p className="text-2xl">🎉</p>
              <p className="font-semibold">You're confirmed!</p>
              <p className="text-muted-foreground text-sm">Order #{freeConfirmed} — a confirmation has been recorded.</p>
              <Button onClick={onClose} className="mt-4">Close</Button>
            </div>
          ) : paidConfirmed ? (
            <div className="text-center py-8 space-y-2">
              <p className="text-2xl">🎉</p>
              <p className="font-semibold">Payment confirmed!</p>
              <p className="text-muted-foreground text-sm">Order #{paidConfirmed} — a confirmation has been recorded.</p>
              <Button onClick={onClose} className="mt-4">Close</Button>
            </div>
          ) : waitingOnPopup ? (
            <div className="text-center py-8 space-y-2">
              <p className="text-2xl">💳</p>
              <p className="font-semibold">Complete your payment in the popup window</p>
              <p className="text-sm text-muted-foreground">This will update automatically once payment is confirmed.</p>
              <Button variant="outline" onClick={onClose} className="mt-2">Cancel</Button>
            </div>
          ) : loading ? (
            <p className="text-muted-foreground text-sm">Loading ticket options...</p>
          ) : ticketTypes.length === 0 ? (
            <div className="space-y-3"><p className="text-muted-foreground text-sm">Tickets are not available yet. If you have an event access code, enter it below.</p>
              <div className="flex gap-2"><Input aria-label="Event access code" placeholder="Access code" value={accessCodeInput} onChange={(e) => setAccessCodeInput(e.target.value)} /><Button type="button" variant="outline" onClick={unlockAccess}>Unlock tickets</Button></div>
            </div>
          ) : (
            <div className="space-y-4">
              {waitlistJoined && <p className="rounded bg-green-50 p-3 text-sm text-green-800" role="status">You’re on the waitlist. The organiser can contact you if a place opens.</p>}
              {ticketTypes.map((tt) => {
                const remaining = tt.quantity_total > 0 ? Math.max(tt.quantity_total - tt.quantity_sold, 0) : null;
                return (
                  <div key={tt.id} className="flex items-center justify-between gap-3 border-b border-border pb-3">
                    <div>
                      <p className="font-medium">{tt.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {tt.pricing_mode === "pay_what_you_feel" ? `Choose your amount · min $${(Number(tt.minimum_price_cents || 0) / 100).toFixed(2)}` : tt.price_cents === 0 ? "Free" : `$${(tt.price_cents / 100).toFixed(2)}`}
                        {remaining !== null && ` · ${remaining} left`}
                      </p>
                      {tt.group_min_quantity && tt.group_price_cents != null && <p className="text-xs text-muted-foreground">From {tt.group_min_quantity}: ${(Number(tt.group_price_cents) / 100).toFixed(2)} each</p>}
                      {tt.pricing_mode === "pay_what_you_feel" && <Input aria-label={`${tt.name} amount in AUD`} className="mt-2 w-32" type="number" min={Number(tt.minimum_price_cents || 0) / 100} max={tt.maximum_price_cents == null ? undefined : Number(tt.maximum_price_cents) / 100} step="0.01" placeholder="Amount AUD" value={customPrices[tt.id] == null ? "" : (customPrices[tt.id] / 100).toFixed(2)} onChange={(e) => setCustomPrices({ ...customPrices, [tt.id]: Math.round(Number(e.target.value) * 100) })} />}
                    </div>
                    {remaining === 0 ? <Button type="button" size="sm" variant="outline" disabled={waitlistJoined} onClick={() => joinWaitlist(tt.id)}>Join waitlist</Button> : <Input
                      type="number" min={0} max={remaining ?? 99} className="w-16"
                      value={qty[tt.id] || 0}
                      onChange={(e) => setQty({ ...qty, [tt.id]: Number(e.target.value) })}
                    />}
                  </div>
                );
              })}

              <div className="space-y-2">
                <Label>Your name</Label>
                <Input value={buyerName} onChange={(e) => setBuyerName(e.target.value)} />
                <Label>Email</Label>
                <Input type="email" value={buyerEmail} onChange={(e) => setBuyerEmail(e.target.value)} />
              </div>

              <div className="space-y-2 rounded-lg border p-3">
                <Label htmlFor="event-discount-code">Discount code</Label>
                <div className="flex gap-2"><Input id="event-discount-code" value={discountCodeInput} onChange={(e) => setDiscountCodeInput(e.target.value)} placeholder="Optional" /><Button type="button" variant="outline" onClick={applyDiscount}>Apply</Button></div>
                {discountCode && <p className="text-xs text-green-700">{discountCode} applied</p>}
              </div>

              {error && <p className="text-sm text-destructive">{error}</p>}
              {discountCents > 0 && <p className="text-sm text-muted-foreground">Discount: −${(discountCents / 100).toFixed(2)}</p>}
              <p className="font-bold">Total: ${(total / 100).toFixed(2)} AUD</p>
              <Button onClick={startCheckout} disabled={submitting} className="w-full btn-hero">
                {submitting ? "Preparing checkout..." : total === 0 ? "Confirm free tickets" : "Continue to payment"}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
