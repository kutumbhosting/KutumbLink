import { loadStripe, Stripe } from "@stripe/stripe-js";

let stripePromise: Promise<Stripe | null> | null = null;

// Lazily fetches the (non-secret) publishable key from our own server and
// loads Stripe.js exactly once, reusing the same promise on every
// subsequent call. If the admin hasn't configured Stripe yet, this
// resolves to null and callers should show a friendly message instead of
// opening a broken payment modal.
export function getStripePromise(): Promise<Stripe | null> {
  if (!stripePromise) {
    stripePromise = fetch("/api/ticketing/config")
      .then((res) => res.json())
      .then((data) => (data.publishableKey ? loadStripe(data.publishableKey) : null))
      .catch(() => null);
  }
  return stripePromise;
}
