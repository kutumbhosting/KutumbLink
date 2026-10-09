import { getSetting } from "./settings.js";

let cachedToken = null;
let cachedTokenExpiry = 0;
let cachedTokenEnv = null;

async function getBaseUrl() {
  const environment = (await getSetting("paypal_environment")) || "sandbox";
  return environment === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
}

/** OAuth2 client-credentials token, cached until shortly before it expires. */
async function getPaypalAccessToken() {
  const clientId = await getSetting("paypal_client_id");
  const clientSecret = await getSetting("paypal_client_secret");
  if (!clientId || !clientSecret) return null;

  const environment = (await getSetting("paypal_environment")) || "sandbox";
  if (cachedToken && cachedTokenEnv === environment && Date.now() < cachedTokenExpiry) return cachedToken;

  const baseUrl = await getBaseUrl();
  const res = await fetch(`${baseUrl}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || "Could not authenticate with PayPal");

  cachedToken = data.access_token;
  cachedTokenEnv = environment;
  cachedTokenExpiry = Date.now() + (Number(data.expires_in) || 300) * 1000 - 30000;
  return cachedToken;
}

/** Thin wrapper around PayPal's REST API — no SDK dependency needed. */
export async function paypalFetch(path, options = {}) {
  const token = await getPaypalAccessToken();
  if (!token) {
    const err = new Error("PayPal isn't configured yet — add a Client ID and Secret in Settings & Access.");
    err.notConfigured = true;
    throw err;
  }
  const baseUrl = await getBaseUrl();
  const res = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data?.message || `PayPal API error (${res.status})`);
    err.paypalResponse = data;
    throw err;
  }
  return data;
}

export { getBaseUrl as getPaypalBaseUrl };
