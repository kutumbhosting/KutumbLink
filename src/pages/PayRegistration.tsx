import { useEffect, useState } from "react";
import { useParams, useSearchParams, Link } from "react-router-dom";
import RegistrationPaymentPanel, { type PreferredPaymentMethod, type PaymentOutcome } from "@/components/RegistrationPaymentPanel";
import { CheckCircle2, Clock, Lock } from "lucide-react";

interface RegistrationInfo {
  id: number;
  eventName: string;
  eventDate: string | null;
  eventYear: string;
  registrationNumber: string;
  name: string;
  email: string;
  adults: number;
  children: number;
  fee: number; // amount still owed
  totalFee: number;
  paymentStatus: string;
  registrationStatus: string;
  cancelledMessage?: string | null;
}

// Landed on from the "Pay Now" link in the pending-payment registration
// email — lets someone finish paying for a registration without having to
// dig back through the site to find it, days after they originally
// submitted the form. Keyed by the registration's opaque pay_token (see
// GET /api/events/registration/by-token/:token), not a guessable numeric
// id, so the link works with no login but can't be used to browse to
// anyone else's registration.
const PREFERRED_METHODS: PreferredPaymentMethod[] = ["card", "paypal", "square", "bank"];

export default function PayRegistration() {
  const { token } = useParams<{ token: string }>();
  // The registration email links each payment option to /pay/:token?method=…
  // so the one the person clicked is shown first. Anything else is ignored.
  const [searchParams] = useSearchParams();
  const methodParam = searchParams.get("method");
  const preferredMethod = PREFERRED_METHODS.includes(methodParam as PreferredPaymentMethod)
    ? (methodParam as PreferredPaymentMethod)
    : null;
  const [status, setStatus] = useState<"loading" | "found" | "not-found" | "already-paid" | "cancelled">("loading");
  const [registration, setRegistration] = useState<RegistrationInfo | null>(null);
  const [paid, setPaid] = useState(false);
  const [outcome, setOutcome] = useState<PaymentOutcome>("confirmed");
  // The card itself: the Stripe/Square popups size and position themselves to
  // match it, so checkout opens as a window sitting right over this one.
  const [cardEl, setCardEl] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (!token) {
      setStatus("not-found");
      return;
    }
    fetch(`/api/events/registration/by-token/${encodeURIComponent(token)}`)
      .then((r) => {
        if (!r.ok) throw new Error("Not found");
        return r.json();
      })
      .then((data: RegistrationInfo) => {
        setRegistration(data);
        setStatus(
          data.registrationStatus === "confirmed"
            ? "already-paid"
            : data.registrationStatus === "cancelled"
            ? "cancelled"
            : "found"
        );
      })
      .catch(() => setStatus("not-found"));
  }, [token]);

  return (
    // A focused checkout window rather than a full site page: the link in the
    // payment email opens straight to this — no site menu or footer to click
    // away into — with the amount due and the ways to pay in one compact card.
    <div className="min-h-screen bg-muted/40 flex items-start sm:items-center justify-center p-3 sm:p-6">
      <main
        ref={setCardEl}
        className="w-full max-w-md bg-background rounded-xl border shadow-lg p-5 sm:p-7"
      >
        <div className="flex items-center justify-between mb-5">
          <span className="text-lg font-bold tracking-tight text-primary">KutumbLink</span>
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            <Lock className="w-3 h-3" /> Secure payment
          </span>
        </div>
        {status === "loading" && (
          <p className="text-center text-muted-foreground">Loading your registration...</p>
        )}

        {status === "not-found" && (
          <div className="text-center space-y-3">
            <h1 className="text-xl font-bold">We couldn't find that registration</h1>
            <p className="text-muted-foreground text-sm">
              This payment link may be incorrect, or the registration it points to no longer
              exists. If you think this is a mistake, please contact us.
            </p>
            <Link to="/events" className="text-primary hover:underline text-sm inline-block">
              Back to Events
            </Link>
          </div>
        )}

        {status === "cancelled" && registration && (
          <div className="text-center space-y-3">
            <Clock className="w-10 h-10 text-muted-foreground mx-auto" />
            <h1 className="text-xl font-bold">This registration was cancelled</h1>
            <p className="text-muted-foreground text-sm">
              Registration <strong>{registration.registrationNumber}</strong> for{" "}
              <strong>{registration.eventName}</strong> was cancelled because payment wasn't received in
              time. If you've already paid, please contact us and we'll sort it out.
            </p>
            <Link to="/events" className="text-primary hover:underline text-sm inline-block">
              Register again
            </Link>
          </div>
        )}

        {status === "already-paid" && registration && (
          <div className="text-center space-y-3">
            <CheckCircle2 className="w-10 h-10 text-green-600 mx-auto" />
            <h1 className="text-xl font-bold">Already paid — thank you!</h1>
            <p className="text-muted-foreground text-sm">
              Registration <strong>{registration.registrationNumber}</strong> for{" "}
              <strong>{registration.eventName}</strong> is already confirmed — there's nothing
              more to pay. If you're expecting your ticket(s), check your inbox (and spam
              folder) for a separate email with your QR code(s).
            </p>
            <Link to="/events" className="text-primary hover:underline text-sm inline-block">
              Back to Events
            </Link>
          </div>
        )}

        {status === "found" && registration && !paid && (
          <div className="space-y-6">
            <div className="text-center space-y-1">
              <h1 className="text-xl font-bold">Choose how to pay</h1>
              <p className="text-muted-foreground text-sm">
                {registration.eventName}
                {registration.eventDate ? ` — ${registration.eventDate}` : ""}
              </p>
            </div>

            <div className="rounded-lg border bg-muted/40 p-4 space-y-1 text-sm">
              <p>
                <span className="font-medium">Registration Number:</span> {registration.registrationNumber}
              </p>
              <p>
                <span className="font-medium">Name:</span> {registration.name}
              </p>
              <p>
                <span className="font-medium">Amount Due:</span> ${registration.fee.toFixed(2)}
              </p>
            </div>

            <RegistrationPaymentPanel
              data={{
                id: registration.id,
                eventName: registration.eventName,
                eventDate: registration.eventDate || undefined,
                eventYear: registration.eventYear,
                email: registration.email,
                name: registration.name,
                fee: registration.fee,
                adults: registration.adults,
                children: registration.children,
                registrationNumber: registration.registrationNumber,
              }}
              anchorEl={cardEl}
              preferredMethod={preferredMethod}
              onPaid={(result) => {
                setOutcome(result ?? "confirmed");
                setPaid(true);
              }}
            />
          </div>
        )}

        {status === "found" && paid && outcome === "pending_verification" && (
          <div className="text-center space-y-3">
            <Clock className="w-10 h-10 text-orange-600 mx-auto" />
            <h1 className="text-xl font-bold">Transfer details received</h1>
            <p className="text-muted-foreground text-sm">
              Thank you — we've noted your bank transfer for registration{" "}
              <strong>{registration?.registrationNumber}</strong>.
            </p>
            <p className="text-sm font-semibold text-orange-800">
              Your ticket(s) will be issued after your payment has been verified.
            </p>
            <p className="text-muted-foreground text-sm">
              We'll confirm it once the payment shows in our bank account (this can take a few
              business days), then email your ticket(s) with a QR code for each person.
            </p>
            <Link to="/events" className="text-primary hover:underline text-sm inline-block">
              Back to Events
            </Link>
          </div>
        )}

        {status === "found" && paid && outcome === "confirmed" && (
          <div className="text-center space-y-3">
            <CheckCircle2 className="w-10 h-10 text-green-600 mx-auto" />
            <h1 className="text-xl font-bold">Payment confirmed! 🎉</h1>
            <p className="text-muted-foreground text-sm">
              Thank you — your registration is now confirmed. Your ticket(s), with a QR code for
              each person on this registration, will be emailed to you shortly.
            </p>
            <Link to="/events" className="text-primary hover:underline text-sm inline-block">
              Back to Events
            </Link>
          </div>
        )}
      </main>
    </div>
  );
}
