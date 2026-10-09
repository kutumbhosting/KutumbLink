import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Mail, CreditCard } from "lucide-react";
import RegistrationPaymentPanel, { type PaymentOutcome } from "@/components/RegistrationPaymentPanel";
import { useEffect, useRef, useState } from "react";

export interface EventRegistrationSuccessData {
  id?: number;
  eventName: string;
  eventDate?: string;
  eventYear?: string;
  registrationNumber: string;
  isMember: boolean;
  membershipNumber?: string | null;
  adults: number;
  children: number;
  fee?: number;
  perPersonFee?: number;
  email: string;
  name: string;
}

interface EventRegistrationSuccessDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: EventRegistrationSuccessData | null;
}

const EventRegistrationSuccessDialog = ({
  open,
  onOpenChange,
  data,
}: EventRegistrationSuccessDialogProps) => {
  // So the Stripe/Square popup can be opened at the same size and screen
  // position as this dialog, instead of some arbitrary default box.
  const dialogContentRef = useRef<HTMLDivElement | null>(null);
  const [paymentRecorded, setPaymentRecorded] = useState(false);
  const [paymentOutcome, setPaymentOutcome] = useState<PaymentOutcome>("confirmed");

  const feeOwed = !!data && typeof data.fee === "number" && data.fee > 0;

  // A registration row already exists at this point (that's what makes a
  // Stripe/Square/PayPal checkout possible at all — they need a
  // registrationId to attach the payment to), but for a paid event it sits
  // as "pending_payment" server-side until money actually arrives. So
  // rather than declaring victory the moment the form was submitted, this
  // dialog leads with the payment step for as long as something is still
  // owed, and only shows the full "Registration Successful" confirmation
  // once that's cleared (or immediately, for a free event where nothing
  // was ever owed).
  const awaitingPayment = feeOwed && !paymentRecorded;
  // A bank transfer they've reported but Kutumb hasn't yet seen arrive: not
  // confirmed, and not "still needs paying" either.
  const awaitingVerification = feeOwed && paymentRecorded && paymentOutcome === "pending_verification";
  const registrationId = data?.id;

  // Covers the person closing the browser tab/window (or navigating away
  // entirely) while still on the payment step, without ever clicking
  // Close — sendBeacon fires reliably during unload in a way a normal
  // fetch() often doesn't. Only armed while there's actually something
  // unpaid to remind them about. Declared before the `if (!data)` early
  // return below, along with every other hook, since hooks can't be
  // called conditionally.
  useEffect(() => {
    if (!open || !awaitingPayment || !registrationId) return;
    const handleUnload = () => {
      navigator.sendBeacon?.(
        `/api/events/registration/${registrationId}/send-payment-reminder`,
        new Blob([], { type: "application/json" })
      );
    };
    window.addEventListener("beforeunload", handleUnload);
    return () => window.removeEventListener("beforeunload", handleUnload);
  }, [open, awaitingPayment, registrationId]);

  if (!data) return null;

  // Fire-and-forget: tells the server to send the "payment required" email
  // (with its Pay Now link) for this registration. Only ever actually
  // sends anything the first time it's called while the registration is
  // still unpaid — see the endpoint itself — so it's safe to call this
  // speculatively from more than one place below without checking state
  // first.
  const sendPaymentReminder = () => {
    if (!registrationId) return;
    fetch(`/api/events/registration/${registrationId}/send-payment-reminder`, { method: "POST" }).catch(() => {});
  };

  // Wraps whatever dismisses the dialog — the Close button below, but also
  // Escape and clicking the overlay, both of which call this same prop —
  // so leaving unpaid always triggers the reminder email, however they
  // leave.
  const handleOpenChange = (next: boolean) => {
    if (!next && awaitingPayment) sendPaymentReminder();
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent ref={dialogContentRef} className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          {awaitingPayment ? (
            <>
              <DialogTitle className="flex items-center gap-2 text-orange-700">
                <CreditCard className="w-6 h-6" />
                Complete Payment to Confirm
              </DialogTitle>
              <DialogDescription>
                Your spot for <strong>{data.eventName}</strong>
                {data.eventDate ? ` — ${data.eventDate}` : ""} is reserved as{" "}
                <strong>{data.registrationNumber}</strong>, but it isn't confirmed yet — pay the
                amount below to finish registering.
              </DialogDescription>
            </>
          ) : awaitingVerification ? (
            <>
              <DialogTitle className="flex items-center gap-2 text-orange-700">
                <CreditCard className="w-6 h-6" />
                Transfer Details Received
              </DialogTitle>
              <DialogDescription>
                Your spot for <strong>{data.eventName}</strong>
                {data.eventDate ? ` — ${data.eventDate}` : ""} is reserved as{" "}
                <strong>{data.registrationNumber}</strong>. Your ticket(s) will be issued after your
                payment has been verified — we'll confirm once your bank transfer shows in our account.
              </DialogDescription>
            </>
          ) : (
            <>
              <DialogTitle className="flex items-center gap-2 text-green-700">
                <CheckCircle2 className="w-6 h-6" />
                Registration Successful
              </DialogTitle>
              <DialogDescription>
                You're registered for <strong>{data.eventName}</strong>
                {data.eventDate ? ` — ${data.eventDate}` : ""}.
              </DialogDescription>
            </>
          )}
        </DialogHeader>

        <div className="rounded-lg border bg-muted/40 p-4 space-y-2 text-sm">
          <p>
            <span className="font-medium">Registration Number:</span> {data.registrationNumber}
          </p>
          {data.isMember && data.membershipNumber && (
            <p>
              <span className="font-medium">Membership Number:</span> {data.membershipNumber}
            </p>
          )}
          <p>
            <span className="font-medium">Adults:</span> {data.adults + 1}{" "}
            <span className="text-muted-foreground">(including you)</span>
          </p>
          <p>
            <span className="font-medium">Children:</span> {data.children}
          </p>
          {typeof data.fee === "number" && (
            <p>
              <span className="font-medium">Fee:</span>{" "}
              {data.fee > 0 ? (
                <>
                  ${data.fee}
                  {typeof data.perPersonFee === "number" && data.perPersonFee > 0 && (
                    <span className="text-muted-foreground">
                      {" "}(${data.perPersonFee} &times; {data.adults + 1 + data.children})
                    </span>
                  )}
                  {awaitingPayment && <span className="text-orange-700 font-medium"> — payment required</span>}
                </>
              ) : (
                "Free"
              )}
            </p>
          )}
        </div>

        <p className="text-sm text-muted-foreground flex items-center gap-1.5">
          <Mail className="w-3.5 h-3.5 shrink-0" />
          {awaitingPayment
            ? `Pay below to finish now — or if you leave this page before paying, we'll email a payment link to ${data.email}.`
            : awaitingVerification
            ? `We've emailed ${data.email} to acknowledge your transfer. Your ticket(s) will follow once payment is confirmed.`
            : `A confirmation email has been sent to ${data.email}.`}
        </p>

        {awaitingPayment && (
          <div className="border-t pt-4">
            <RegistrationPaymentPanel
              data={{
                id: data.id,
                eventName: data.eventName,
                eventDate: data.eventDate,
                eventYear: data.eventYear,
                email: data.email,
                name: data.name,
                fee: data.fee as number,
                adults: data.adults,
                children: data.children,
                registrationNumber: data.registrationNumber,
              }}
              anchorEl={dialogContentRef.current}
              onPaid={(outcome) => {
                setPaymentOutcome(outcome ?? "confirmed");
                setPaymentRecorded(true);
              }}
            />
          </div>
        )}

        {awaitingVerification && (
          <p className="text-sm text-orange-700 font-medium border-t pt-4">
            ⏳ Transfer details recorded. Your ticket(s) will be issued after your payment has been
            verified, which can take a few business days.
          </p>
        )}
        {feeOwed && paymentRecorded && !awaitingVerification && (
          <p className="text-sm text-green-700 font-medium border-t pt-4">
            ✅ Payment confirmed. Thank you!
          </p>
        )}

        <Button onClick={() => handleOpenChange(false)} variant="outline" className="w-full">
          Close
        </Button>
      </DialogContent>
    </Dialog>
  );
};

export default EventRegistrationSuccessDialog;
