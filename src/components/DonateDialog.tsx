import { useState, useEffect, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useToast } from "@/hooks/use-toast";
import { HeartHandshake } from "lucide-react";
import PayPalButton from "@/components/PayPalButton";
import { openBlankCheckoutPopup, attachCheckoutPopup } from "@/lib/checkoutPopup";

interface DonateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organisationId?: number;
  campaignId?: number;
  eventId?: string;
  fundraisingPageId?: number;
  defaultAmount?: number;
}

const BANK_DETAILS = {
  accountName: "Kutumb Australia Inc",
  bsb: "082-356",
  account: "778280517",
};

type PaymentMethod = "bank" | "card" | "square" | "paypal";

const DonateDialog = ({ open, onOpenChange, organisationId, campaignId, eventId, fundraisingPageId, defaultAmount }: DonateDialogProps) => {
  const { toast } = useToast();
  // So the Stripe/Square popup can be opened at the same size and screen
  // position as this dialog, instead of some arbitrary default box.
  const dialogContentRef = useRef<HTMLDivElement | null>(null);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [amount, setAmount] = useState("");
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [donorMessage, setDonorMessage] = useState("");
  const [bankTransferred, setBankTransferred] = useState<"yes" | "no">("no");
  const [transactionNumber, setTransactionNumber] = useState("");
  const [membershipNumber, setMembershipNumber] = useState<string | null>(null);
  const [checkingMembership, setCheckingMembership] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Which payment methods an admin has switched on (Settings & Access →
  // Payment Methods). Bank Transfer is on by default; Card/Square/PayPal
  // only appear here once an admin has enabled them AND filled in that
  // provider's API credentials.
  const [methods, setMethods] = useState({ bankTransfer: true, card: false, square: false, paypal: false });
  const [loadingMethods, setLoadingMethods] = useState(true);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("bank");

  // ── After the donation is recorded, only PayPal needs a further step
  // here (its button has to render after we have a donation id) — Card
  // and Square redirect away immediately, and Bank Transfer just closes. ──
  const [donationId, setDonationId] = useState<number | null>(null);
  const [paymentDone, setPaymentDone] = useState(false);
  const [showingPaypal, setShowingPaypal] = useState(false);
  // Set while the Stripe/Square popup is open and we're waiting to hear
  // back from it, so the form can show "Waiting for payment..." instead of
  // just sitting there looking idle once the button click returns.
  const [waitingOnPopup, setWaitingOnPopup] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoadingMethods(true);
    // no-store: this reflects an admin toggle that can change at any time,
    // so a cached response (browser or intermediate proxy) must never be
    // allowed to hide a payment method that was just switched on.
    fetch("/api/payment-methods", { cache: "no-store" })
      .then((res) => {
        if (!res.ok) throw new Error(`Request failed (${res.status})`);
        return res.json();
      })
      .then((data) => {
        const next = { bankTransfer: !!data.bankTransfer, card: !!data.card, square: !!data.square, paypal: !!data.paypal };
        setMethods(next);
        // Default to the first available method, preferring Bank Transfer
        // since it needs no redirect — but pick *something* enabled so the
        // form is never stuck defaulted to a method that isn't offered.
        if (next.bankTransfer) setPaymentMethod("bank");
        else if (next.card) setPaymentMethod("card");
        else if (next.square) setPaymentMethod("square");
        else if (next.paypal) setPaymentMethod("paypal");
      })
      .catch((err) => {
        console.error("Failed to load payment methods:", err);
        // Fail open to Bank Transfer only — never silently pretend an
        // online method is available when we couldn't actually confirm it.
        setMethods({ bankTransfer: true, card: false, square: false, paypal: false });
        setPaymentMethod("bank");
      })
      .finally(() => setLoadingMethods(false));
  }, [open]);

  // Reset form each time the dialog is opened fresh
  useEffect(() => {
    if (open) {
      setName("");
      setEmail("");
      setAmount(defaultAmount ? String(defaultAmount) : "");
      setIsAnonymous(false);
      setDonorMessage("");
      setBankTransferred("no");
      setTransactionNumber("");
      setMembershipNumber(null);
      setDonationId(null);
      setPaymentDone(false);
      setShowingPaypal(false);
      setWaitingOnPopup(false);
    }
  }, [open]);

  // Live membership lookup once both name + a valid-looking email are present
  useEffect(() => {
    const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    if (!name.trim() || !emailValid) {
      setMembershipNumber(null);
      return;
    }

    const timer = setTimeout(async () => {
      setCheckingMembership(true);
      try {
        const res = await fetch(
          `/api/members/lookup?name=${encodeURIComponent(name)}&email=${encodeURIComponent(email)}`
        );
        const data = await res.json();
        setMembershipNumber(data.found ? data.membershipNumber : null);
      } catch {
        setMembershipNumber(null);
      } finally {
        setCheckingMembership(false);
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [name, email]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim() || !email.trim() || !amount) {
      toast({ title: "Missing Information", description: "Please fill in all required fields.", variant: "destructive" });
      return;
    }
    if (paymentMethod === "bank" && bankTransferred === "yes" && !transactionNumber.trim()) {
      toast({ title: "Transaction Number Required", description: "Please enter the bank transfer transaction number.", variant: "destructive" });
      return;
    }

    // Card/Square open a popup — window.open() only counts as triggered by
    // this click if it happens synchronously, with no `await` in between.
    // Everything below has at least one network round trip before we know
    // the real checkout URL, so the popup is opened blank right here, this
    // instant, and only navigated to the real URL once we have it (see
    // attachProviderPopup). Opening it after an await, even a fast one, is
    // exactly what silently gets it blocked by Safari and (often) Chrome —
    // not with an error, it just never appears, which is what "pressing
    // pay does nothing" looks like from the outside.
    const needsPopup = paymentMethod === "card" || paymentMethod === "square";
    const popup = needsPopup ? openBlankCheckoutPopup(dialogContentRef.current) : null;

    setSubmitting(true);
    try {
      const isBankDone = paymentMethod === "bank" && bankTransferred === "yes";
      const res = await fetch("/api/donations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          email,
          amount: Number(amount),
          organisationId,
          campaignId,
          eventId,
          fundraisingPageId,
          isAnonymous,
          donorMessage: donorMessage.trim(),
          attribution: {
            source: new URLSearchParams(window.location.search).get("utm_source"),
            medium: new URLSearchParams(window.location.search).get("utm_medium"),
            campaign: new URLSearchParams(window.location.search).get("utm_campaign"),
            referrer: document.referrer,
          },
          bankTransferred: isBankDone,
          transactionNumber: isBankDone ? transactionNumber : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to record donation");
      const newDonationId = data.donation?.id || null;

      if (paymentMethod === "bank") {
        toast({
          title: "Thank You! 💛",
          description: isBankDone
            ? "Your donation has been recorded. A confirmation email is on its way."
            : "Your donation has been recorded — please complete the bank transfer using the details shown.",
        });
        onOpenChange(false);
        return;
      }

      // Online payment methods: the donation now exists (Pending) — start
      // (or render) the actual payment.
      setDonationId(newDonationId);
      if (paymentMethod === "card") {
        const cardRes = await fetch(`/api/donations/${newDonationId}/checkout-card`, { method: "POST" });
        const cardResult = await cardRes.json();
        if (!cardRes.ok) throw new Error(cardResult.message || "Could not start card checkout");
        attachProviderPopup(popup, cardResult.url, "card", newDonationId);
        return;
      }
      if (paymentMethod === "square") {
        const squareRes = await fetch(`/api/square/donations/${newDonationId}/checkout`, { method: "POST" });
        const squareResult = await squareRes.json();
        if (!squareRes.ok) throw new Error(squareResult.message || "Could not start Square checkout");
        attachProviderPopup(popup, squareResult.url, "square", newDonationId);
        return;
      }
      if (paymentMethod === "paypal") {
        setShowingPaypal(true);
        setSubmitting(false);
      }
    } catch (err: any) {
      popup?.close();
      toast({ title: "Something went wrong", description: err.message, variant: "destructive" });
      setSubmitting(false);
    }
  };

  // Navigates the already-open popup (from openBlankCheckoutPopup, called
  // synchronously back in handleSubmit) to the real checkout URL, and
  // reacts once /checkout/return (inside that popup) reports the outcome.
  const attachProviderPopup = (popup: Window | null, url: string, provider: "card" | "square", forDonationId: number) => {
    setWaitingOnPopup(true);
    attachCheckoutPopup(popup, url, {
      onResult: (result) => {
        setWaitingOnPopup(false);
        setSubmitting(false);
        if (result.status === "paid") {
          toast({ title: "Payment confirmed 🎉", description: "Thank you for your donation!" });
          setPaymentDone(true);
        } else {
          toast({
            title: "Payment not completed",
            description: "The checkout window was cancelled or the payment didn't go through.",
            variant: "destructive",
          });
        }
      },
      onBlocked: () => {
        // Pop-up blocked — fall back to the old full-page redirect so the
        // donor can still pay.
        setWaitingOnPopup(false);
        window.location.href = url;
      },
      onClosedWithoutResult: () => {
        // They closed the popup before we heard back. Ask the server
        // directly rather than leaving the dialog stuck on "waiting".
        setWaitingOnPopup(false);
        setSubmitting(false);
        const statusUrl =
          provider === "card"
            ? `/api/donations/${forDonationId}/status`
            : `/api/square/donation-status/${forDonationId}`;
        fetch(statusUrl)
          .then((r) => r.json())
          .then((data) => {
            if (data.status === "paid") {
              toast({ title: "Payment confirmed 🎉", description: "Thank you for your donation!" });
              setPaymentDone(true);
            } else {
              toast({
                title: "Checkout window closed",
                description: "We didn't receive confirmation of payment. If you completed the payment, it may still be processing.",
              });
            }
          })
          .catch(() => {
            toast({
              title: "Checkout window closed",
              description: "We couldn't confirm whether the payment went through. Check your email, or contact us if you were charged.",
            });
          });
      },
    });
  };

  const anyOnlineMethod = methods.card || methods.square || methods.paypal;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent ref={dialogContentRef} className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HeartHandshake className="w-5 h-5 text-orange-600" />
            Support Kutumb
          </DialogTitle>
          <DialogDescription>
            Your donation helps us keep serving the community. Thank you for your generosity.
          </DialogDescription>
        </DialogHeader>

        {paymentDone ? (
          <div className="text-center py-6 space-y-2">
            <p className="text-2xl">💛</p>
            <p className="font-semibold">Thank you for your donation!</p>
            <Button onClick={() => onOpenChange(false)} className="mt-4">Close</Button>
          </div>
        ) : waitingOnPopup ? (
          <div className="text-center py-6 space-y-2">
            <p className="text-2xl">💳</p>
            <p className="font-semibold">Complete your payment in the popup window</p>
            <p className="text-sm text-muted-foreground">
              This dialog will update automatically once payment is confirmed.
            </p>
            <Button variant="outline" onClick={() => onOpenChange(false)} className="mt-2">
              Cancel
            </Button>
          </div>
        ) : showingPaypal && donationId ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Complete your ${amount} donation with PayPal:
            </p>
            <PayPalButton
              kind="donation"
              donationId={donationId}
              onSuccess={() => {
                toast({ title: "Payment confirmed 🎉", description: "Thank you for your donation!" });
                setPaymentDone(true);
              }}
              onError={(message) => toast({ title: "PayPal checkout failed", description: message, variant: "destructive" })}
            />
            <Button variant="outline" className="w-full" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
          </div>
        ) : (
        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <Label htmlFor="donor-name">Full Name *</Label>
            <Input id="donor-name" value={name} onChange={(e) => setName(e.target.value)} className="mt-2" placeholder="Enter your full name" />
          </div>

          <div>
            <Label htmlFor="donor-email">Email Address *</Label>
            <Input id="donor-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-2" placeholder="your.email@example.com" />
          </div>

          <div className="rounded-lg bg-muted/50 px-4 py-3 text-sm">
            {checkingMembership ? (
              <span className="text-muted-foreground">Checking membership…</span>
            ) : membershipNumber ? (
              <span>
                Kutumb Membership Number: <strong>{membershipNumber}</strong>
              </span>
            ) : (
              <span className="text-muted-foreground">
                No Kutumb membership found for this email (that's okay - anyone can donate).
              </span>
            )}
          </div>

          <div>
            <Label htmlFor="donor-amount">Donation amount (AUD) *</Label>
            <div className="mt-2 grid grid-cols-4 gap-2">{[20, 50, 100, 250].map((preset) => <Button key={preset} type="button" size="sm" variant={Number(amount) === preset ? "default" : "outline"} onClick={() => setAmount(String(preset))}>${preset}</Button>)}</div>
            <Input id="donor-amount" type="number" min="1" step="1" value={amount} onChange={(e) => setAmount(e.target.value)} className="mt-2" placeholder="e.g. 50" />
            <p className="mt-2 text-xs text-muted-foreground">A donation is recorded separately from event tickets. Tax deductibility is not assumed; check the charity’s DGR information.</p>
          </div>

          <div className="space-y-3 rounded-lg border p-3">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={isAnonymous} onChange={(e) => setIsAnonymous(e.target.checked)} />Keep my name private on public fundraising pages</label>
            <div><Label htmlFor="donor-message">Message to the charity (optional)</Label><textarea id="donor-message" maxLength={500} rows={3} value={donorMessage} onChange={(e) => setDonorMessage(e.target.value)} className="mt-2 w-full rounded-md border bg-background p-2 text-sm" placeholder="Add a short note" /></div>
          </div>

          {/* Payment method — shown up front so online options (once an
              admin enables them in Settings & Access) are never hidden
              behind a second step. */}
          {loadingMethods ? (
            <p className="text-sm text-muted-foreground">Loading payment options…</p>
          ) : anyOnlineMethod ? (
            <div>
              <Label className="mb-2 block">How would you like to pay? *</Label>
              <RadioGroup value={paymentMethod} onValueChange={(v) => setPaymentMethod(v as PaymentMethod)} className="space-y-2">
                {methods.card && (
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="card" id="pay-card" />
                    <label htmlFor="pay-card" className="text-sm cursor-pointer">💳 Card (Stripe)</label>
                  </div>
                )}
                {methods.square && (
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="square" id="pay-square" />
                    <label htmlFor="pay-square" className="text-sm cursor-pointer">⬛ Pay by Card (Square)</label>
                  </div>
                )}
                {methods.paypal && (
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="paypal" id="pay-paypal" />
                    <label htmlFor="pay-paypal" className="text-sm cursor-pointer">🅿️ PayPal</label>
                  </div>
                )}
                {methods.bankTransfer && (
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="bank" id="pay-bank" />
                    <label htmlFor="pay-bank" className="text-sm cursor-pointer">🏦 Bank Transfer</label>
                  </div>
                )}
              </RadioGroup>
            </div>
          ) : null}

          {paymentMethod === "bank" && methods.bankTransfer && (
            <>
              <div>
                <Label className="mb-2 block">Have you already completed a bank transfer? *</Label>
                <RadioGroup value={bankTransferred} onValueChange={(v) => setBankTransferred(v as "yes" | "no")} className="flex gap-6">
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="yes" id="transferred-yes" />
                    <label htmlFor="transferred-yes" className="text-sm cursor-pointer">Yes</label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="no" id="transferred-no" />
                    <label htmlFor="transferred-no" className="text-sm cursor-pointer">No, not yet</label>
                  </div>
                </RadioGroup>
              </div>

              {bankTransferred === "yes" && (
                <div>
                  <Label htmlFor="txn-number">Transaction / Reference Number *</Label>
                  <Input id="txn-number" value={transactionNumber} onChange={(e) => setTransactionNumber(e.target.value)} className="mt-2" placeholder="e.g. TXN123456789" />
                </div>
              )}

              <div className="rounded-lg border-2 border-orange-200 bg-orange-50 px-4 py-3 space-y-1 text-sm">
                <p className="font-semibold text-orange-800 mb-1">Kutumb Bank Details</p>
                <p><span className="font-medium">Account Name:</span> {BANK_DETAILS.accountName}</p>
                <p><span className="font-medium">BSB:</span> {BANK_DETAILS.bsb}</p>
                <p><span className="font-medium">Account:</span> {BANK_DETAILS.account}</p>
              </div>
            </>
          )}

          <Button type="submit" disabled={submitting} className="w-full text-white" style={{ backgroundColor: "#c2410c" }}>
            {submitting
              ? "Submitting…"
              : paymentMethod === "bank"
              ? "Confirm Donation"
              : `Continue to ${paymentMethod === "card" ? "Card" : paymentMethod === "square" ? "Card (Square)" : "PayPal"} Payment`}
          </Button>
        </form>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default DonateDialog;
