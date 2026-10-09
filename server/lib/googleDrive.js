// server/lib/googleDrive.js
//
// Minimal Google Drive v3 client (plain fetch, no extra dependency) used by
// the bank-statement drop folder. It acts AS the Drive account that owns
// the folder (kutumbhosting@gmail.com) through a one-time OAuth consent, so
// it can read the dropped files and remove them afterwards — a service
// account can't delete files it doesn't own in a normal (My Drive) folder.
//
// Settings (Admin → Settings → "Bank File Drop Box (Google Drive)"):
//   gdrive_client_id / gdrive_client_secret — OAuth client from Google Cloud
//   gdrive_folder_id      — the watched folder
//   gdrive_refresh_token  — saved automatically by "Connect Google Drive"
//   gdrive_connected_email — shown in the admin UI
//   gdrive_after_import   — "trash" (default, recoverable 30 days) or "delete"
//   gdrive_poll_minutes   — how often to check the folder (default 5)

import crypto from "crypto";
import { getSetting, setSetting, deleteSetting } from "./settings.js";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const DRIVE = "https://www.googleapis.com/drive/v3";
const SCOPES = ["https://www.googleapis.com/auth/drive", "openid", "email"];

export const DEFAULT_FOLDER_ID = "1wo2VFMi_2zZQSeQbJgFBSqBXS5enTCME";

let cachedAccess = null; // { token, expiresAt }
const pendingStates = new Map(); // state -> expiresAt

async function clientCreds() {
  const clientId = (await getSetting("gdrive_client_id")) || process.env.GDRIVE_CLIENT_ID;
  const clientSecret = (await getSetting("gdrive_client_secret")) || process.env.GDRIVE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "Google Drive isn't set up: add the OAuth Client ID and Secret in Admin → Settings → Bank File Drop Box."
    );
  }
  return { clientId: clientId.trim(), clientSecret: clientSecret.trim() };
}

export function redirectUriFor(baseUrl) {
  return `${baseUrl}/api/events/reconcile/drive/callback`;
}

export async function getFolderId() {
  return ((await getSetting("gdrive_folder_id")) || DEFAULT_FOLDER_ID).trim();
}

export async function buildAuthUrl(baseUrl) {
  const { clientId } = await clientCreds();
  const state = crypto.randomBytes(16).toString("hex");
  pendingStates.set(state, Date.now() + 15 * 60_000);
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUriFor(baseUrl),
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent", // always return a refresh token
    include_granted_scopes: "true",
    login_hint: "kutumbhosting@gmail.com",
    state,
  });
  return `${AUTH_URL}?${params}`;
}

export async function handleCallback({ code, state, baseUrl }) {
  const exp = pendingStates.get(state);
  pendingStates.delete(state);
  if (!exp || exp < Date.now()) throw new Error("This Google sign-in link has expired — start again from the admin page.");

  const { clientId, clientSecret } = await clientCreds();
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUriFor(baseUrl),
      grant_type: "authorization_code",
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.refresh_token) {
    throw new Error(`Google didn't return a refresh token (${res.status}): ${data.error_description || data.error || "unknown error"}`);
  }
  await setSetting("gdrive_refresh_token", data.refresh_token, true);
  cachedAccess = { token: data.access_token, expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000 };

  let email = null;
  try {
    const about = await drive("/about?fields=user(emailAddress)");
    email = about.user?.emailAddress || null;
  } catch {
    /* not essential */
  }
  if (email) await setSetting("gdrive_connected_email", email, false);
  return { email };
}

export async function disconnect() {
  cachedAccess = null;
  await deleteSetting("gdrive_refresh_token");
  await deleteSetting("gdrive_connected_email");
}

export async function isConnected() {
  return !!(await getSetting("gdrive_refresh_token"));
}

async function accessToken() {
  if (cachedAccess && cachedAccess.expiresAt > Date.now() + 60_000) return cachedAccess.token;
  const refreshToken = await getSetting("gdrive_refresh_token");
  if (!refreshToken) throw new Error("Google Drive isn't connected yet — click Connect Google Drive in Admin → Settings → Bank File Drop Box.");
  const { clientId, clientSecret } = await clientCreds();
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    if (data.error === "invalid_grant") {
      throw new Error(
        "Google Drive access has expired or was revoked — click Connect Google Drive again in Admin → Settings → Bank File Drop Box. " +
          "(If this happens every 7 days, publish the OAuth consent screen to 'In production' in Google Cloud.)"
      );
    }
    throw new Error(`Google token refresh failed (${res.status}): ${data.error_description || data.error || "unknown"}`);
  }
  cachedAccess = { token: data.access_token, expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000 };
  return cachedAccess.token;
}

async function drive(path, { method = "GET", body, raw = false } = {}) {
  const res = await fetch(path.startsWith("http") ? path : `${DRIVE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${await accessToken()}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    if (res.status === 401) cachedAccess = null;
    throw new Error(`Google Drive ${method} failed (${res.status}): ${text.slice(0, 300)}`);
  }
  if (raw) return Buffer.from(await res.arrayBuffer());
  if (res.status === 204) return null;
  return res.json();
}

export const GOOGLE_SHEET_MIME = "application/vnd.google-apps.spreadsheet";
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Files (not folders) directly inside the folder, oldest first. */
export async function listFolderFiles(folderId) {
  const q = `'${folderId.replace(/'/g, "\\'")}' in parents and trashed = false and mimeType != 'application/vnd.google-apps.folder'`;
  const params = new URLSearchParams({
    q,
    fields: "files(id,name,mimeType,modifiedTime,size,owners(emailAddress))",
    orderBy: "createdTime",
    pageSize: "100",
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "true",
  });
  const data = await drive(`/files?${params}`);
  return data.files || [];
}

export async function getFolderName(folderId) {
  const data = await drive(`/files/${folderId}?fields=name&supportsAllDrives=true`);
  return data.name;
}

/** Returns { buffer, filename } — Google Sheets are exported as .xlsx. */
export async function downloadFile(file) {
  // Old .xls files can't be read by the server's Excel library, so let
  // Google convert them: copy as a temporary Google Sheet (outside the
  // watched folder), export that as .xlsx, then delete the copy.
  if (file.mimeType === "application/vnd.ms-excel" || /\.xls$/i.test(file.name)) {
    const copy = await drive(`/files/${file.id}/copy?supportsAllDrives=true&fields=id`, {
      method: "POST",
      body: { name: `kutumb-temp-${file.name}`, mimeType: GOOGLE_SHEET_MIME, parents: ["root"] },
    });
    try {
      const buffer = await drive(`/files/${copy.id}/export?mimeType=${encodeURIComponent(XLSX_MIME)}`, { raw: true });
      return { buffer, filename: file.name.replace(/\.xls$/i, "") + ".xlsx" };
    } finally {
      await drive(`/files/${copy.id}`, { method: "DELETE" }).catch(() => {});
    }
  }
  if (file.mimeType === GOOGLE_SHEET_MIME) {
    const buffer = await drive(`/files/${file.id}/export?mimeType=${encodeURIComponent(XLSX_MIME)}`, { raw: true });
    return { buffer, filename: `${file.name}.xlsx` };
  }
  const buffer = await drive(`/files/${file.id}?alt=media&supportsAllDrives=true`, { raw: true });
  return { buffer, filename: file.name };
}

export async function removeFile(fileId, mode = "trash", folderId = null) {
  try {
    if (mode === "delete") {
      await drive(`/files/${fileId}?supportsAllDrives=true`, { method: "DELETE" });
    } else {
      await drive(`/files/${fileId}?supportsAllDrives=true`, { method: "PATCH", body: { trashed: true } });
    }
  } catch (err) {
    // A file someone else dropped is owned by them, and Drive only lets the
    // owner bin or delete it. The folder owner can still take it OUT of the
    // folder, which is what matters here (it stays in the uploader's Drive).
    if (!folderId) throw err;
    await drive(`/files/${fileId}?removeParents=${encodeURIComponent(folderId)}&supportsAllDrives=true`, {
      method: "PATCH",
      body: {},
    });
  }
}
