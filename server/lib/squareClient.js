import { getSetting } from "./settings.js";

const SQUARE_API_VERSION = "2024-10-17";

export async function getSquareConfig() {
  const accessToken = await getSetting("square_access_token");
  const locationId = await getSetting("square_location_id");
  if (!accessToken || !locationId) return null;
  const environment = (await getSetting("square_environment")) || "sandbox";
  const baseUrl = environment === "production" ? "https://connect.squareup.com" : "https://connect.squareupsandbox.com";
  return { accessToken, locationId, baseUrl, environment };
}

/** Thin wrapper around Square's REST API — no SDK dependency needed. */
export async function squareFetch(path, options = {}) {
  const config = await getSquareConfig();
  if (!config) {
    const err = new Error("Square isn't configured yet — add an Access Token and Location ID in Settings & Access.");
    err.notConfigured = true;
    throw err;
  }
  const res = await fetch(`${config.baseUrl}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.accessToken}`,
      "Square-Version": SQUARE_API_VERSION,
      ...(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = data?.errors?.[0]?.detail || `Square API error (${res.status})`;
    const err = new Error(message);
    err.squareResponse = data;
    throw err;
  }
  return data;
}
