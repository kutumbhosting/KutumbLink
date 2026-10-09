// server/lib/basiqClient.js
//
// Live bank feed via Basiq (https://basiq.io), an Australian open-banking
// provider operating under the Consumer Data Right (CDR). The account
// holder consents once in Basiq's hosted Consent UI (on the bank's own
// login page — Kutumb never sees bank passwords), and from then on the
// server can pull that account's transactions on demand.
//
// Output is the SAME shape bankStatementParser.js produces, plus a stable
// bank-side id, so it plugs straight into paymentReconciliation.reconcile():
//   [{ id, date: Date|null, amount: number, details: string, accountId }]
//
// Credentials live in Admin → API Keys → "Live Bank Feed (Basiq)":
//   basiq_api_key     (secret)  — from the Basiq dashboard
//   basiq_user_id               — created automatically on first "Connect bank"
//   basiq_account_id            — optional; limit the feed to one account
//
// CDR consent lasts at most 12 months; after that the account holder has
// to click "Connect bank" again.

import { getSetting, setSetting } from "./settings.js";

const API_BASE = "https://au-api.basiq.io";
const CONSENT_UI = "https://consent.basiq.io/home";
const API_VERSION = "3.0";

let cachedServerToken = null; // { token, expiresAt }

async function getApiKey() {
  const key = (await getSetting("basiq_api_key")) || process.env.BASIQ_API_KEY;
  if (!key) {
    throw new Error("Bank feed isn't set up: add the Basiq API key in Admin → API Keys → Live Bank Feed (Basiq).");
  }
  return key.trim();
}

async function fetchToken(scope, userId) {
  const apiKey = await getApiKey();
  const body = new URLSearchParams({ scope });
  if (userId) body.set("userId", userId);

  const res = await fetch(`${API_BASE}/token`, {
    method: "POST",
    headers: {
      // The dashboard key is already base64 — it goes in as-is.
      Authorization: `Basic ${apiKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "basiq-version": API_VERSION,
    },
    body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error(`Basiq token request failed (${res.status}): ${basiqErrorText(data)}`);
  }
  return { token: data.access_token, expiresIn: Number(data.expires_in) || 3600 };
}

async function serverToken() {
  if (cachedServerToken && cachedServerToken.expiresAt > Date.now() + 60_000) {
    return cachedServerToken.token;
  }
  const { token, expiresIn } = await fetchToken("SERVER_ACCESS");
  cachedServerToken = { token, expiresAt: Date.now() + expiresIn * 1000 };
  return token;
}

function basiqErrorText(data) {
  if (Array.isArray(data?.data) && data.data.length) {
    return data.data.map((e) => e.detail || e.title).filter(Boolean).join("; ");
  }
  return data?.message || "unknown error";
}

async function api(pathOrUrl, { method = "GET", body } = {}) {
  const url = pathOrUrl.startsWith("http") ? pathOrUrl : `${API_BASE}${pathOrUrl}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${await serverToken()}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      "basiq-version": API_VERSION,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) cachedServerToken = null;
    throw new Error(`Basiq ${method} ${url.replace(API_BASE, "")} failed (${res.status}): ${basiqErrorText(data)}`);
  }
  return data;
}

export async function isConfigured() {
  try {
    await getApiKey();
    return true;
  } catch {
    return false;
  }
}

/**
 * Returns the Basiq user that represents the account holder, creating it
 * (and saving its id to settings) the first time.
 */
export async function ensureBasiqUser({ email, mobile } = {}) {
  const existing = await getSetting("basiq_user_id");
  if (existing) return existing;
  if (!email) throw new Error("An email for the account holder is needed to set up the bank feed.");

  const user = await api("/users", { method: "POST", body: { email, ...(mobile ? { mobile } : {}) } });
  await setSetting("basiq_user_id", user.id, false);
  return user.id;
}

/**
 * URL the account holder opens to give (or renew) consent in Basiq's
 * hosted Consent UI. The CLIENT_ACCESS token is bound to one user and is
 * short-lived, so generate this fresh each time.
 */
export async function getConsentUrl(opts) {
  const userId = await ensureBasiqUser(opts);
  const { token } = await fetchToken("CLIENT_ACCESS", userId);
  return `${CONSENT_UI}?token=${encodeURIComponent(token)}`;
}

export async function listAccounts() {
  const userId = await getSetting("basiq_user_id");
  if (!userId) return [];
  const data = await api(`/users/${userId}/accounts`);
  return (data.data || []).map((a) => ({
    id: a.id,
    name: a.name,
    accountNo: a.accountNo,
    institution: a.institution,
    balance: a.balance,
    lastUpdated: a.lastUpdated,
    status: a.status,
  }));
}

/**
 * Asks the bank for fresh data and waits (briefly) for the refresh jobs to
 * finish. Best-effort: if it times out we still read whatever Basiq
 * already holds, which is usually at most a few hours old.
 */
export async function refreshConnections({ timeoutMs = 45_000 } = {}) {
  const userId = await getSetting("basiq_user_id");
  if (!userId) throw new Error("No bank connected yet — click Connect Bank in Admin → API Keys → Live Bank Feed (Basiq).");

  let jobs = [];
  try {
    const data = await api(`/users/${userId}/connections/refresh`, { method: "POST" });
    jobs = (data.data || []).map((j) => j.id).filter(Boolean);
  } catch (err) {
    console.warn("Basiq refresh request failed, using cached data:", err.message);
    return { refreshed: false };
  }

  const deadline = Date.now() + timeoutMs;
  const pending = new Set(jobs);
  while (pending.size && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3000));
    for (const id of [...pending]) {
      try {
        const job = await api(`/jobs/${id}`);
        const steps = job.steps || [];
        const failed = steps.some((s) => s.status === "failed");
        const done = steps.length > 0 && steps.every((s) => s.status === "success");
        if (done || failed) pending.delete(id);
      } catch {
        pending.delete(id);
      }
    }
  }
  return { refreshed: pending.size === 0 };
}

function isoDate(d) {
  const dt = d instanceof Date ? d : new Date(d);
  return dt.toISOString().slice(0, 10);
}

/**
 * Pulls CREDIT transactions (money in) for the connected account(s).
 * @param {{ fromDate: Date|string, toDate?: Date|string }} range
 */
export async function fetchCreditTransactions({ fromDate, toDate = new Date() }) {
  const userId = await getSetting("basiq_user_id");
  if (!userId) throw new Error("No bank connected yet — click Connect Bank in Admin → API Keys → Live Bank Feed (Basiq).");
  const accountId = await getSetting("basiq_account_id");

  const filters = [`transaction.postDate.bt('${isoDate(fromDate)}','${isoDate(toDate)}')`];
  if (accountId) filters.push(`account.id.eq('${accountId}')`);

  let next = `/users/${userId}/transactions?limit=500&filter=${encodeURIComponent(filters.join(","))}`;
  const out = [];
  let pages = 0;

  while (next && pages < 40) {
    const data = await api(next);
    pages++;
    for (const t of data.data || []) {
      const amount = Number(t.amount);
      if (!(amount > 0) || t.direction === "debit") continue;
      out.push({
        id: t.id,
        accountId: typeof t.account === "string" ? t.account : t.account?.id || null,
        date: t.postDate ? new Date(t.postDate) : t.transactionDate ? new Date(t.transactionDate) : null,
        amount: Math.round(amount * 100) / 100,
        details: String(t.description || "").trim(),
        status: t.status || null,
      });
    }
    next = data.links?.next || null;
  }
  return out;
}
