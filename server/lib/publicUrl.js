import { getSetting } from "./settings.js";

// The site's own public address (e.g. https://www.kutumb.org.au) is used to
// build every link that leaves the server: the "Pay Now" links in emails,
// and the success/cancel URLs handed to Stripe, Square and PayPal.
//
// A wrong value here is nasty because nothing errors — the link just goes
// somewhere else. It once ended up as https://api.stripe.com, so the emailed
// "Pay Now" button pointed at Stripe's API host instead of this website.
// So every value is validated, and anything that looks like a payment
// provider's own address is rejected rather than trusted.

const PROVIDER_HOSTS = [
  "stripe.com",
  "paypal.com",
  "paypal.me",
  "paypalobjects.com",
  "squareup.com",
  "squareupsandbox.com",
  "square.site",
  "square.com",
];

function isProviderHost(hostname) {
  const h = hostname.toLowerCase();
  return PROVIDER_HOSTS.some((p) => h === p || h.endsWith(`.${p}`));
}

/**
 * Validates and normalises a base URL. Returns `{ url }` on success (origin
 * only — no trailing slash, no path) or `{ error }` explaining what's wrong.
 */
export function normalizeBaseUrl(raw) {
  const value = String(raw ?? "").trim();
  if (!value) return { error: "Enter your website address, e.g. https://www.kutumb.org.au" };

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return { error: "That isn't a valid web address. Include https://, e.g. https://www.kutumb.org.au" };
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { error: "The address must start with https:// (or http:// for local testing)." };
  }
  if (isProviderHost(parsed.hostname)) {
    return {
      error:
        `${parsed.hostname} is a payment provider's address, not your website's. ` +
        "Use the address people type to visit your site, e.g. https://www.kutumb.org.au",
    };
  }
  // Origin only: a stray path would produce links like /site/pay/<token>.
  return { url: parsed.origin };
}

/** True for addresses only reachable from the machine running the server
 *  (localhost, 127.x, ::1, private LAN ranges, *.local). A link to one of
 *  these opens for the person running the app and for nobody else. */
export function isLocalUrl(url) {
  try {
    const h = new URL(url).hostname.toLowerCase();
    return (
      h === "localhost" ||
      h.endsWith(".localhost") ||
      h.endsWith(".local") ||
      h === "[::1]" ||
      /^127\./.test(h) ||
      /^10\./.test(h) ||
      /^192\.168\./.test(h) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(h)
    );
  } catch {
    return false;
  }
}

const warned = new Set();
function warnOnce(key, message) {
  if (warned.has(key)) return;
  warned.add(key);
  console.error(`❌ ${message}`);
}

/**
 * The configured public base URL (Settings & Access → Platform, else the
 * PUBLIC_BASE_URL env var), or null if neither is set to a valid value. An
 * invalid value is skipped with a loud console error rather than used.
 * Deliberately has no request-derived or localhost fallback — use this where
 * only the exact registered address is acceptable (e.g. webhook signatures).
 */
export async function getConfiguredPublicBaseUrl() {
  const candidates = [
    ["Settings & Access → Public Base URL", await getSetting("public_base_url")],
    ["PUBLIC_BASE_URL env var", process.env.PUBLIC_BASE_URL],
  ];
  for (const [source, raw] of candidates) {
    if (!raw) continue;
    const { url, error } = normalizeBaseUrl(raw);
    if (url) return url;
    warnOnce(`${source}:${raw}`, `Ignoring invalid ${source} ("${raw}"): ${error}`);
  }
  return null;
}

/**
 * The public base URL to build links from. Order of preference:
 *   1. the configured, valid value (see getConfiguredPublicBaseUrl)
 *   2. the address the current request came from (Origin header, else Host),
 *      so links still point at the real site if the setting is missing/bad
 *   3. http://localhost:8080 (local development)
 */
function warnIfLocal(url) {
  if (isLocalUrl(url)) {
    warnOnce(
      `fallback-local:${url}`,
      `No public base URL is configured, so payment links are being built from ${url}, which only works on this computer. Set your real website address in Settings & Access → Platform (or PUBLIC_BASE_URL in .env).`
    );
  }
  return url;
}

export async function getPublicBaseUrl(req) {
  const configured = await getConfiguredPublicBaseUrl();
  if (configured && !isLocalUrl(configured)) return configured;
  if (configured) {
    warnOnce(`local:${configured}`, `Public Base URL is ${configured} — emailed payment links only work on this computer. Set your real website address in Settings & Access → Platform (or PUBLIC_BASE_URL in .env).`);
    return configured;
  }

  if (req) {
    const origin = req.get?.("origin");
    if (origin) {
      const { url } = normalizeBaseUrl(origin);
      if (url) return warnIfLocal(url);
    }
    const host = req.get?.("x-forwarded-host") || req.get?.("host");
    if (host) {
      const proto = (req.get?.("x-forwarded-proto") || req.protocol || "https").split(",")[0].trim();
      const { url } = normalizeBaseUrl(`${proto}://${host.split(",")[0].trim()}`);
      if (url) return warnIfLocal(url);
    }
  }
  return warnIfLocal(`http://localhost:${process.env.PORT || 8080}`);
}

/**
 * Used by the admin Settings screen: says what the Public Base URL setting
 * is actually resolving to and, if that isn't a real public address, why —
 * so a bad value shows up as a red message on the field instead of only as
 * broken links in emails. Returns null when everything is fine.
 */
export async function getPublicBaseUrlWarning() {
  const saved = await getSetting("public_base_url");
  if (saved) {
    const { url, error } = normalizeBaseUrl(saved);
    if (error) {
      return `The saved value can't be used (${error}) — emailed payment links are ignoring it. Enter your website address, e.g. https://www.kutumb.org.au`;
    }
    if (isLocalUrl(url)) {
      return `${url} only works on the computer running the app. Anyone who opens an emailed payment link will not reach it. Enter your real website address, e.g. https://www.kutumb.org.au`;
    }
    return null;
  }
  const configured = await getConfiguredPublicBaseUrl();
  if (configured && !isLocalUrl(configured)) return null;
  return "Not set. Until it is, emailed payment links point at the address the app is running on (e.g. http://localhost:8080), which nobody else can open. Enter your real website address, e.g. https://www.kutumb.org.au";
}
