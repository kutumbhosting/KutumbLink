// server/lib/openfeedClient.js
//
// Live NAB feed through openfeed (https://openfeed.au, by Biza.io) — an
// accredited Consumer Data Right recipient. Kutumb registers an app with
// openfeed; the account holder connects the NAB account to openfeed once
// (CDR consent at NAB) and then shares it with the Kutumb app in one tap.
// From then on this server pulls the account's transactions unattended.
//
// openfeed requires the FAPI 2.0 "Recommended" profile, implemented here with
// Node's crypto only (no extra dependency):
//   • private_key_jwt client authentication (PS256, app keypair)
//   • Pushed Authorization Requests (PAR) + PKCE S256
//   • DPoP sender-constrained tokens (PS256, separate DPoP keypair),
//     including the one-shot `use_dpop_nonce` retry
//   • resource=https://api.openfeed.au on PAR, code exchange and refresh
//
// Stored in kutumb_platform_settings (encrypted where secret):
//   openfeed_app_private_key, openfeed_dpop_private_key  (generated here)
//   openfeed_refresh_token, openfeed_grant_id             (after connecting)
//   openfeed_account_id / openfeed_account_label          (the matched NAB account)
//   openfeed_last_sync                                    (JSON summary)
// Visible settings (Admin → API Keys → Live Bank Feed (openfeed)):
//   openfeed_client_id, openfeed_app_id, openfeed_issuer, account name/BSB/number,
//   openfeed_auto_sync, openfeed_sync_days

import crypto from "crypto";
import { pool } from "../db/pool.js";
import { getSetting, setSetting, deleteSetting } from "./settings.js";

// Env overrides exist only for testing against a local mock.
export const API_BASE = process.env.OPENFEED_API_BASE || "https://api.openfeed.au";
const APP_BASE = process.env.OPENFEED_APP_BASE || "https://app.openfeed.au";
const RESOURCE = "https://api.openfeed.au";
const SCOPE = "openid offline_access openfeed-au:data:banking:read";

const b64u = (buf) => Buffer.from(buf).toString("base64url");

/* ── Keys ─────────────────────────────────────────────────────────────── */

function publicJwkFromPem(pem) {
  const jwk = crypto.createPublicKey(pem).export({ format: "jwk" });
  // RFC 7638 thumbprint as the key id.
  const kid = b64u(crypto.createHash("sha256").update(JSON.stringify({ e: jwk.e, kty: jwk.kty, n: jwk.n })).digest());
  return { kty: jwk.kty, n: jwk.n, e: jwk.e, kid, use: "sig", alg: "PS256" };
}

function newRsaPem() {
  return crypto.generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" });
}

/** Creates the app + DPoP keypairs once. Returns the public JWKS to register. */
export async function ensureKeys({ rotate = false } = {}) {
  let appKey = await getSetting("openfeed_app_private_key");
  let dpopKey = await getSetting("openfeed_dpop_private_key");
  if (!appKey || rotate) {
    appKey = newRsaPem();
    await setSetting("openfeed_app_private_key", appKey, true);
  }
  if (!dpopKey || rotate) {
    dpopKey = newRsaPem();
    await setSetting("openfeed_dpop_private_key", dpopKey, true);
  }
  return getPublicJwks();
}

/** Public half of the APP keypair only — the DPoP key is never published. */
export async function getPublicJwks() {
  const appKey = await getSetting("openfeed_app_private_key");
  return appKey ? { keys: [publicJwkFromPem(appKey)] } : null;
}

function signJwt(header, payload, pem) {
  const input = `${b64u(JSON.stringify(header))}.${b64u(JSON.stringify(payload))}`;
  const sig = crypto.sign("sha256", Buffer.from(input), {
    key: pem,
    padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
    saltLength: 32,
  });
  return `${input}.${b64u(sig)}`;
}

/* ── Config & discovery ───────────────────────────────────────────────── */

async function config() {
  const clientId = (await getSetting("openfeed_client_id"))?.trim();
  const appId = (await getSetting("openfeed_app_id"))?.trim();
  const issuer = ((await getSetting("openfeed_issuer")) || "https://auth.openfeed.au").trim().replace(/\/+$/, "");
  const appKey = await getSetting("openfeed_app_private_key");
  const dpopKey = await getSetting("openfeed_dpop_private_key");
  return { clientId, appId, issuer, appKey, dpopKey };
}

export async function isConfigured() {
  const c = await config();
  return !!(c.clientId && c.appId && c.appKey && c.dpopKey);
}

let discoveryCache = null; // { issuer, doc, at }
async function discovery(issuer) {
  if (discoveryCache && discoveryCache.issuer === issuer && Date.now() - discoveryCache.at < 3_600_000) {
    return discoveryCache.doc;
  }
  const res = await fetch(`${issuer}/.well-known/openid-configuration`);
  if (!res.ok) throw new Error(`openfeed discovery failed (${res.status})`);
  const doc = await res.json();
  discoveryCache = { issuer, doc, at: Date.now() };
  return doc;
}

function clientAssertion(c, aud) {
  const now = Math.floor(Date.now() / 1000);
  const { kid } = publicJwkFromPem(c.appKey);
  return signJwt(
    { alg: "PS256", typ: "JWT", kid },
    { iss: c.clientId, sub: c.clientId, aud, jti: crypto.randomUUID(), iat: now, exp: now + 60 },
    c.appKey
  );
}

const dpopNonces = new Map(); // origin+path -> last nonce
function dpopProof(c, { htm, url, accessToken }) {
  const htu = url.split("?")[0].split("#")[0];
  const payload = { htu, htm, jti: crypto.randomUUID(), iat: Math.floor(Date.now() / 1000) };
  if (accessToken) payload.ath = b64u(crypto.createHash("sha256").update(accessToken).digest());
  const nonce = dpopNonces.get(htu);
  if (nonce) payload.nonce = nonce;
  const { kty, n, e } = publicJwkFromPem(c.dpopKey);
  return signJwt({ alg: "PS256", typ: "dpop+jwt", jwk: { kty, n, e } }, payload, c.dpopKey);
}

/** fetch with DPoP proof, retrying once if the server demands a nonce. */
async function dpopFetch(c, url, { method = "GET", headers = {}, body, accessToken } = {}) {
  const htu = url.split("?")[0].split("#")[0];
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(url, {
      method,
      headers: {
        ...headers,
        DPoP: dpopProof(c, { htm: method, url, accessToken }),
        ...(accessToken ? { Authorization: `DPoP ${accessToken}` } : {}),
      },
      body,
    });
    const nonce = res.headers.get("DPoP-Nonce");
    if (nonce) dpopNonces.set(htu, nonce);
    if (attempt === 0 && nonce && (res.status === 400 || res.status === 401)) {
      const text = await res.clone().text().catch(() => "");
      if (text.includes("use_dpop_nonce") || res.headers.get("WWW-Authenticate")?.includes("use_dpop_nonce")) continue;
    }
    return res;
  }
}

/* ── Authorization (admin connects once) ──────────────────────────────── */

const pendingFlows = new Map(); // state -> { verifier, nonce, redirectUri, expires }

/** Starts PAR and returns the URL to send the admin's browser to. */
export async function startAuthorization(baseUrl) {
  const c = await config();
  if (!(c.clientId && c.appId)) throw new Error("Enter the openfeed OAuth2 Client ID and App ID first.");
  if (!(c.appKey && c.dpopKey)) throw new Error("Generate the openfeed keys first.");
  const d = await discovery(c.issuer);

  const verifier = b64u(crypto.randomBytes(32));
  const challenge = b64u(crypto.createHash("sha256").update(verifier).digest());
  const state = crypto.randomUUID();
  const nonce = crypto.randomUUID();
  const redirectUri = `${baseUrl}/api/openfeed/callback`;
  const existingGrant = await getSetting("openfeed_grant_id");

  const params = new URLSearchParams({
    client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
    client_assertion: clientAssertion(c, d.issuer),
    response_type: "code",
    client_id: c.clientId,
    redirect_uri: redirectUri,
    scope: SCOPE,
    resource: RESOURCE,
    code_challenge: challenge,
    code_challenge_method: "S256",
    nonce,
    state,
    ...(existingGrant
      ? { grant_management_action: "replace", grant_id: existingGrant }
      : { grant_management_action: "create" }),
  });
  const res = await fetch(d.pushed_authorization_request_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.request_uri) {
    throw new Error(`openfeed PAR failed (${res.status}): ${data.error_description || data.error || "unknown error"}`);
  }
  for (const [k, v] of pendingFlows) if (v.expires < Date.now()) pendingFlows.delete(k);
  pendingFlows.set(state, { verifier, nonce, redirectUri, expires: Date.now() + 10 * 60_000 });
  return `${d.authorization_endpoint}?client_id=${encodeURIComponent(c.clientId)}&request_uri=${encodeURIComponent(data.request_uri)}`;
}

async function tokenRequest(c, d, params) {
  const res = await dpopFetch(c, d.token_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
      client_assertion: clientAssertion(c, d.issuer),
      resource: RESOURCE,
      ...params,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    const err = new Error(`openfeed token request failed (${res.status}): ${data.error_description || data.error || "unknown error"}`);
    err.oauthError = data.error;
    throw err;
  }
  return data;
}

let accessCache = null; // { token, expiresAt }

async function saveTokens(data) {
  if (data.refresh_token) await setSetting("openfeed_refresh_token", data.refresh_token, true);
  accessCache = { token: data.access_token, expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000 };
  return data.authorization_details?.[0]?.grant_id || null;
}

/**
 * Handles the redirect back from openfeed. Returns either
 * { consentUrl } (no disclosure grant yet — send the admin there) or { grantId }.
 */
export async function handleCallback({ code, state, iss, baseUrl }) {
  const flow = pendingFlows.get(state);
  pendingFlows.delete(state);
  if (!flow || flow.expires < Date.now()) throw new Error("This openfeed sign-in has expired — start again from Admin → API Keys.");
  const c = await config();
  const d = await discovery(c.issuer);
  if (iss && iss !== d.issuer) throw new Error("Issuer mismatch in openfeed response.");

  const data = await tokenRequest(c, d, {
    grant_type: "authorization_code",
    code,
    code_verifier: flow.verifier,
    redirect_uri: flow.redirectUri,
  });
  if (!data.refresh_token) throw new Error("openfeed didn't return a refresh token (offline_access) — check the app's scopes.");
  const grantId = await saveTokens(data);
  if (grantId) {
    await setSetting("openfeed_grant_id", grantId, true);
    return { grantId };
  }
  const consentUrl =
    `${APP_BASE}/grants/disclosure?appId=${encodeURIComponent(c.appId)}` +
    `&redirectUri=${encodeURIComponent(`${baseUrl}/api/openfeed/consent-return`)}`;
  return { consentUrl };
}

/** After the account holder picks accounts on openfeed's consent screen. */
export async function handleConsentReturn({ grantId: returnedGrantId }) {
  const grantId = await refreshAccess();
  if (!grantId) throw new Error("openfeed still reports no data-sharing grant — please try connecting again.");
  if (returnedGrantId && grantId !== returnedGrantId) throw new Error("openfeed grant mismatch — please try connecting again.");
  await setSetting("openfeed_grant_id", grantId, true);
  return { grantId };
}

let refreshing = null;
/** Mints a new access token from the stored refresh token (rotating it). */
async function refreshAccess() {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const c = await config();
    const d = await discovery(c.issuer);
    const refreshToken = await getSetting("openfeed_refresh_token");
    if (!refreshToken) throw new Error("The NAB account isn't connected to openfeed yet — click Connect in Admin → API Keys.");
    try {
      const data = await tokenRequest(c, d, { grant_type: "refresh_token", refresh_token: refreshToken });
      const grantId = await saveTokens(data);
      if (grantId) await setSetting("openfeed_grant_id", grantId, true);
      return grantId || (await getSetting("openfeed_grant_id"));
    } catch (err) {
      if (err.oauthError === "invalid_grant") {
        await deleteSetting("openfeed_refresh_token");
        throw new Error("The openfeed connection has expired or was revoked — click Connect again in Admin → API Keys.");
      }
      throw err;
    }
  })();
  try {
    return await refreshing;
  } finally {
    refreshing = null;
  }
}

async function accessToken() {
  if (accessCache && accessCache.expiresAt > Date.now() + 60_000) return accessCache.token;
  await refreshAccess();
  return accessCache.token;
}

/* ── Sharing API ──────────────────────────────────────────────────────── */

async function api(pathOrUrl) {
  const c = await config();
  const url = pathOrUrl.startsWith("http") ? pathOrUrl : `${API_BASE}${pathOrUrl}`;
  let token = await accessToken();
  let res = await dpopFetch(c, url, { accessToken: token });
  if (res.status === 401) {
    accessCache = null;
    token = await accessToken();
    res = await dpopFetch(c, url, { accessToken: token });
  }
  if (res.ok) return res.json();
  const body = await res.json().catch(() => null);
  if (res.status === 402) throw new Error("openfeed access is paused: the Kutumb app's openfeed credits have run out. Top up at app.openfeed.au.");
  if (res.status === 403 && body?.code === "disclosure_grant_required") {
    await deleteSetting("openfeed_grant_id");
    throw new Error("The NAB account is no longer shared with Kutumb on openfeed — click Connect again in Admin → API Keys.");
  }
  if (res.status === 429) throw new Error("openfeed is rate-limiting requests — try again in a few minutes.");
  throw new Error(`openfeed ${res.status}: ${body?.message || body?.code || "request failed"}`);
}

async function allPages(path) {
  const out = [];
  let next = path;
  let guard = 0;
  while (next && guard++ < 50) {
    const page = await api(next);
    out.push(...(Array.isArray(page.data) ? page.data : [page.data]));
    next = page.links?.next || null;
  }
  return out;
}

const digits = (s) => String(s || "").replace(/\D/g, "");

/**
 * Lists the shared banking accounts and picks the Kutumb NAB account by
 * BSB + account number (falls back to the last 4 digits of the masked
 * number, then the account name). Saves the choice.
 */
export async function matchAccount() {
  const accounts = await allPages("/v1/banking/accounts");
  const wantBsb = digits((await getSetting("openfeed_account_bsb")) || "082-356");
  const wantNum = digits((await getSetting("openfeed_account_number")) || "778280517");
  const wantName = String((await getSetting("openfeed_account_name")) || "Kutumb Australia Inc").toLowerCase();

  let match = null;
  const described = [];
  for (const a of accounts) {
    let detail = null;
    try {
      detail = (await api(`/v1/banking/accounts/${a.accountId}`)).data;
    } catch {
      /* detail is optional */
    }
    const bsb = digits(detail?.bsb);
    const num = digits(detail?.accountNumber);
    described.push({
      accountId: a.accountId,
      displayName: a.displayName,
      providerName: a.providerName,
      maskedNumber: a.maskedNumber,
      bsb: bsb || null,
      exact: !!(num && num === wantNum && (!bsb || bsb === wantBsb)),
    });
    if (!match && num && num === wantNum && (!bsb || bsb === wantBsb)) match = a;
  }
  if (!match) {
    match =
      accounts.find((a) => wantNum && digits(a.maskedNumber).length >= 3 && wantNum.endsWith(digits(a.maskedNumber).slice(-4))) ||
      accounts.find((a) => String(a.displayName || "").toLowerCase().includes(wantName)) ||
      null;
  }
  if (match) {
    await setSetting("openfeed_account_id", match.accountId, false);
    await setSetting(
      "openfeed_account_label",
      `${match.providerName || "Bank"} · ${match.displayName || ""} ${match.maskedNumber || ""}`.trim(),
      false
    );
  }
  return { accounts: described, matched: match ? match.accountId : null };
}

function isoDay(d) {
  return new Date(d).toISOString().slice(0, 10);
}

function sydneyDay(d) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Sydney", year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(d)
      .map((x) => [x.type, x.value])
  );
  return `${p.year}-${p.month}-${p.day}`;
}

/**
 * All POSTED transactions (money in and out) for the matched account over the
 * last `days` days. Pending items are skipped (their ids can change when they
 * post). Returns statement lines for the dashboard and, separately, the
 * credits in the shape the reconciliation expects.
 */
export async function fetchTransactions({ days } = {}) {
  let accountId = await getSetting("openfeed_account_id");
  if (!accountId) accountId = (await matchAccount()).matched;
  if (!accountId) throw new Error("Couldn't find the Kutumb NAB account among the accounts shared on openfeed.");
  const nDays = Math.min(Math.max(Number(days || (await getSetting("openfeed_sync_days")) || 60), 1), 730);
  const oldest = isoDay(Date.now() - nDays * 86_400_000);
  // accountId is used raw (not percent-encoded) — openfeed ids may contain "=".
  const txns = await allPages(`/v1/banking/accounts/${accountId}/transactions?oldestDate=${oldest}&limit=1000`);
  const lines = [];
  const credits = [];
  for (const t of txns) {
    const amount = Math.round(Number(t.amount) * 100) / 100;
    if (!Number.isFinite(amount) || amount === 0) continue;
    if (t.status && String(t.status).toUpperCase() === "PENDING") continue;
    const when = t.postedDateTime || t.executionDateTime || null;
    const day = t.transactionDate || t.valueDate || (when ? sydneyDay(new Date(when)) : null);
    const id = `of_${t.transactionId}`;
    lines.push({
      id,
      accountId,
      txnDate: day,
      postedAt: when ? new Date(when) : day ? new Date(`${day}T00:00:00+10:00`) : null,
      amount,
      description: t.description || null,
      reference: t.reference || null,
      merchantName: t.merchantName || null,
      transactionType: t.transactionType || null,
    });
    if (amount > 0) {
      credits.push({
        id,
        accountId,
        date: when ? new Date(when) : day ? new Date(`${day}T00:00:00+10:00`) : null,
        amount,
        details: [t.description, t.reference, t.merchantName].filter(Boolean).join(" ").replace(/\s+/g, " ").trim(),
      });
    }
  }
  return { lines, credits, oldest };
}

/** Back-compat helper: credits only. */
export async function fetchCredits(opts) {
  const { credits, oldest } = await fetchTransactions(opts);
  return { credits, oldest };
}

/** Live balance (openfeed caches ~15 min). Never throws — null if unavailable. */
export async function getBalance() {
  try {
    const accountId = await getSetting("openfeed_account_id");
    if (!accountId) return null;
    const r = await api(`/v1/banking/accounts/${accountId}/balance`);
    return {
      currentBalance: r.data?.currentBalance != null ? Number(r.data.currentBalance) : null,
      availableBalance: r.data?.availableBalance != null ? Number(r.data.availableBalance) : null,
      currency: r.data?.currency || "AUD",
      at: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export async function getStatus() {
  const c = await config();
  let lastSync = null;
  try {
    lastSync = JSON.parse((await getSetting("openfeed_last_sync")) || "null");
  } catch {
    /* ignore */
  }
  const { rows } = await pool.query(
    "SELECT COUNT(*)::int AS n FROM kutumb_bank_transactions WHERE source = 'openfeed'"
  );
  return {
    hasKeys: !!(c.appKey && c.dpopKey),
    hasIds: !!(c.clientId && c.appId),
    connected: !!(await getSetting("openfeed_refresh_token")) && !!(await getSetting("openfeed_grant_id")),
    accountId: (await getSetting("openfeed_account_id")) || null,
    accountLabel: (await getSetting("openfeed_account_label")) || null,
    lastSync,
    storedCredits: rows[0].n,
    jwks: await getPublicJwks(),
  };
}

/** Forget the connection (tokens, grant, matched account). Keys stay. */
export async function disconnect() {
  accessCache = null;
  for (const k of ["openfeed_refresh_token", "openfeed_grant_id", "openfeed_account_id", "openfeed_account_label"]) {
    await deleteSetting(k);
  }
}
