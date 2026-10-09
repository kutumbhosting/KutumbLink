// Shared by DonateDialog, EventRegistrationSuccessDialog, RegistrationPaymentPanel
// and PayPalButton for any Stripe/Square/PayPal checkout that works by
// redirecting to a provider-hosted page (Stripe Checkout, Square Payment
// Links, PayPal's approval page) rather than embedding a form in place.
// Instead of navigating the whole site away with `window.location.href`,
// we open that URL in a small popup window; the popup eventually lands on
// /checkout/return (see CheckoutReturn.tsx), which posts the outcome back
// to us via window.postMessage and then closes itself.

// Must match CHECKOUT_POPUP_NAME in CheckoutReturn.tsx — that's how the
// return page recognizes it's running inside one of *our* popups (as
// opposed to some unrelated window that merely has an opener).
export const CHECKOUT_POPUP_NAME = "kutumb-checkout";

// The last popup WE opened. Used to (a) close it before opening a new one,
// so two payment attempts never leave a stray leftover window lying around,
// and (b) avoid ever reusing a stale window ourselves.
let lastOpenedPopup: Window | null = null;

export interface CheckoutPopupResult {
  source: "kutumb-checkout";
  status: "paid" | "error";
  provider?: string | null;
  donationId?: string | null;
  registrationId?: string | null;
  orderId?: number | null;
}

interface AttachCheckoutPopupOptions {
  /** Called once /checkout/return inside the popup reports a definite outcome. */
  onResult: (result: CheckoutPopupResult) => void;
  /** Called if the popup couldn't be navigated to the checkout URL (it was closed, or blocked outright). */
  onBlocked: () => void;
  /**
   * Called if the person closes the popup themselves before any result
   * message arrives (e.g. they paid but closed the tab too quickly, or
   * gave up partway through). We don't know the outcome at that point —
   * the caller should re-check via its own status endpoint if it has one.
   */
  onClosedWithoutResult?: () => void;
}

// Fixed popup size for every Stripe/Square/PayPal checkout: a comfortable
// width for a hosted card-payment page, and a TOTAL window height of 807px
// — title bar, address/URL bar and all — matching what "Complete Payment
// to Confirm" naturally renders at. Deliberately no longer computed from
// the calling dialog's own on-screen size — trying to mirror an arbitrary
// dialog's exact box ran straight into a hard browser limit: the popup's
// title bar + address bar are drawn by the browser itself and browsers
// (Brave in particular) block scripts from measuring/trimming that space
// back out afterwards. A fixed, centered size sidesteps that.
const POPUP_WIDTH = 480;
const POPUP_TOTAL_HEIGHT = 807;

/**
 * Opens a blank popup window at a fixed total size of POPUP_WIDTH x
 * POPUP_TOTAL_HEIGHT (title bar and address bar included), centered on the
 * screen. Call this FIRST, synchronously, directly inside
 * the click handler — before any `await` — and only fetch the real
 * checkout URL afterwards, then hand both to attachCheckoutPopup(). This
 * two-step dance (open blank now, navigate it later) is the standard
 * workaround for popup blockers: a `window.open` called after an `await`
 * is no longer considered part of the original click by most browsers
 * (Safari in particular, but Chrome too in many cases) and gets silently
 * blocked — not with an error, it just quietly doesn't work, which is
 * exactly what "the popup never opens" looks like from the outside. Opened
 * with no URL yet (about:blank) the window.open call itself still happens
 * synchronously in the click, so it's exempt from that block; we only fill
 * in where it navigates once we know.
 *
 * `anchorEl` is accepted but no longer used for sizing — kept only so
 * existing call sites don't need to change.
 */
export function openBlankCheckoutPopup(_anchorEl?: HTMLElement | null): Window | null {
  // window.open's `height` feature sets the CONTENT area height only —
  // every browser then draws its title bar + address bar ABOVE that,
  // adding to the total window height rather than eating into the number
  // requested. So to land on a total (title bar + address bar + content)
  // of POPUP_TOTAL_HEIGHT, subtract an estimate of that chrome first. The
  // best estimate available before the popup exists is this SAME browser's
  // own overhead on the current window (outerHeight - innerHeight) — not
  // perfect (a popup's chrome can be a little slimmer, no tab strip or
  // bookmarks bar), but far closer than not accounting for it at all.
  const estimatedChromeHeight = Math.max(0, window.outerHeight - window.innerHeight);
  const requestedContentHeight = Math.max(300, POPUP_TOTAL_HEIGHT - estimatedChromeHeight);

  const left = Math.round(window.screenX + Math.max(0, (window.outerWidth - POPUP_WIDTH) / 2));
  const top = Math.round(window.screenY + Math.max(0, (window.outerHeight - POPUP_TOTAL_HEIGHT) / 2));

  // Close any popup we opened ourselves that's still hanging around from a
  // previous attempt, and — critically — open this one under a fresh,
  // never-used-before name every time. window.open() only honours
  // width/height/left/top when it's creating a brand-new window; if a
  // window with the given name already exists (e.g. the person's last
  // checkout attempt left it open, minimized, or behind another window),
  // the browser just hands back THAT window, completely ignoring our size
  // and position — which is what a stray leftover window from an earlier
  // attempt looks like. A unique name every time guarantees a fresh
  // window, so the requested size/position always actually applies.
  try {
    if (lastOpenedPopup && !lastOpenedPopup.closed) lastOpenedPopup.close();
  } catch {
    // Ignore — worst case an old popup is left open for the person to
    // close themselves, same as before this change existed.
  }
  const uniqueName = `${CHECKOUT_POPUP_NAME}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const popup = window.open(
    "about:blank",
    uniqueName,
    `width=${POPUP_WIDTH},height=${requestedContentHeight},left=${left},top=${top},resizable=yes,scrollbars=yes`
  );
  lastOpenedPopup = popup;

  if (popup) {
    // /checkout/return identifies "one of our popups" by window.name —
    // window.open's target argument becomes the new window's .name
    // automatically, so with a unique target above that would no longer
    // match CHECKOUT_POPUP_NAME. window.name is one of the few properties
    // still writable across origins, and it persists across navigation of
    // the same window (that's exactly why it's used for this), so setting
    // it once, right here, keeps CheckoutReturn.tsx's check working
    // exactly as before, regardless of what name the window was opened
    // under.
    try {
      popup.name = CHECKOUT_POPUP_NAME;
    } catch {
      // Extremely unlikely for a same-origin about:blank window, but if it
      // fails, CheckoutReturn.tsx just falls back to treating it as an
      // ordinary page load — not ideal, but not broken either.
    }
  }

  return popup;
}

/**
 * Navigates an already-open popup (from openBlankCheckoutPopup) to the
 * real checkout URL once it's known, and resolves via callback once the
 * popup's /checkout/return page posts back a result. Calls `onBlocked` if
 * `popup` is null/closed (the initial open was blocked, or the person
 * closed the blank window before this was called) or if navigating it
 * throws, so the caller can fall back to a full-page redirect.
 */
export function attachCheckoutPopup(
  popup: Window | null,
  url: string,
  { onResult, onBlocked, onClosedWithoutResult }: AttachCheckoutPopupOptions
) {
  if (!popup || popup.closed) {
    onBlocked();
    return;
  }

  try {
    popup.location.href = url;
  } catch (err) {
    onBlocked();
    return;
  }

  let settled = false;

  const handleMessage = (event: MessageEvent) => {
    if (event.origin !== window.location.origin) return;
    const data = event.data as Partial<CheckoutPopupResult> | undefined;
    if (!data || data.source !== "kutumb-checkout") return;
    settled = true;
    cleanup();
    onResult(data as CheckoutPopupResult);
  };

  window.addEventListener("message", handleMessage);

  // Fallback for when the popup is closed (by the person, or because
  // window.close() ran) before or without ever posting a message —
  // otherwise the parent UI would be stuck waiting forever.
  const pollClosed = window.setInterval(() => {
    if (popup.closed) {
      cleanup();
      if (!settled) onClosedWithoutResult?.();
    }
  }, 500);

  function cleanup() {
    window.removeEventListener("message", handleMessage);
    window.clearInterval(pollClosed);
  }
}
