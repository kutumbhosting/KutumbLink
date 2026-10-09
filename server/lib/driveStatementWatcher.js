// server/lib/driveStatementWatcher.js
//
// Bank File Drop Box (Google Drive). A statement file dropped in the folder
// is imported, reconciled against every event with unpaid registrations,
// kept on file (kutumb_drive_imports) and removed from the folder.
//
// Two ways a file reaches importStatementFile(), both ending the same way:
//
//   A. Google Apps Script (recommended; setup steps are in README.md).
//      A small script in kutumbhosting@gmail.com's Google account runs on
//      Google's servers every 5 minutes, sends each file to
//      POST /api/events/reconcile/drive/push and bins the file once the
//      site says it's imported. Works even if the website host has put the
//      server to sleep, and needs no Google Cloud project.
//
//   B. Server-side polling (this file's timer) using the "Connect Google
//      Drive" OAuth connection. Only works while the server process is
//      actually running — hosts that scale to zero or sleep when idle
//      (and a laptop running app.cmd that's switched off) never fire it.
//
// Every attempt, good or bad, is recorded, and a failure emails the admin
// mailbox so a file never just sits in the folder unexplained.

import { pool } from "../db/pool.js";
import { getSetting } from "./settings.js";
import { parseBankStatement } from "./bankStatementParser.js";
import { withStatementIds, storeCredits, reconcileOpenEvents } from "./bankLedger.js";
import { sendAdminAlertEmail, sendDropBoxResultEmail } from "./mailer.js";
import {
  isConnected,
  getFolderId,
  listFolderFiles,
  downloadFile,
  removeFile,
  GOOGLE_SHEET_MIME,
} from "./googleDrive.js";

export const SUPPORTED_EXT = /\.(csv|xlsx|xls)$/i;
let running = false;
let timer = null;
let lastRun = null; // { at, message, error, via }

export function getWatcherState() {
  return { running, lastRun, active: !!timer };
}

export function noteRun(entry) {
  lastRun = { at: new Date(), ...entry };
}

/** 'imported' | 'error' | null — what already happened to this exact file version. */
export async function previousOutcome(fileId, modifiedTime) {
  const { rows } = await pool.query(
    "SELECT status, message FROM kutumb_drive_imports WHERE file_id = $1 AND modified_time = $2",
    [fileId, String(modifiedTime)]
  );
  return rows[0] || null;
}

async function recordImport(file, status, message, summary = null, content = null) {
  await pool.query(
    `INSERT INTO kutumb_drive_imports (file_id, file_name, mime_type, modified_time, status, message, summary, content, uploaded_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (file_id, modified_time) DO UPDATE
       SET status = EXCLUDED.status, message = EXCLUDED.message, summary = EXCLUDED.summary,
           content = COALESCE(EXCLUDED.content, kutumb_drive_imports.content),
           uploaded_by = COALESCE(EXCLUDED.uploaded_by, kutumb_drive_imports.uploaded_by), processed_at = now()`,
    [file.id, file.name, file.mimeType || null, String(file.modifiedTime), status, message,
     summary ? JSON.stringify(summary) : null, content, file.uploadedBy || null]
  );
}

const ADMIN_MAILBOX = (process.env.ADMIN_ALERT_EMAIL || "kutumbhosting@gmail.com").toLowerCase();

// The person who dropped the file hears back either way (unless it's the
// admin mailbox itself, which gets the failure alert below anyway).
async function notifyUploader(file, status, message) {
  const to = String(file.uploadedBy || "").trim();
  if (!to || !to.includes("@") || to.toLowerCase() === ADMIN_MAILBOX) return;
  try {
    await sendDropBoxResultEmail({ to, fileName: file.name, status, message });
  } catch (err) {
    console.error("Couldn't email drop-box uploader:", err.message);
  }
}

async function alertFailure(file, message, via) {
  await notifyUploader(file, "error", message);
  try {
    await sendAdminAlertEmail({
      subject: `Bank file not imported: ${file.name}`,
      message:
        `The file "${file.name}" in the Bank File Drop Box could not be imported (${via}).\n` +
        (file.uploadedBy ? `Dropped by: ${file.uploadedBy}\n` : "") +
        `\n` +
        `Reason: ${message}\n\n` +
        `The file has been left in the folder. Fix or replace it (e.g. export the statement from NAB as CSV) ` +
        `and drop it in again — a new or edited file is picked up automatically.`,
    });
  } catch (err) {
    console.error("Couldn't send drop-box failure alert:", err.message);
  }
}

/**
 * Imports one statement file.
 * @param {{ file:{id:string,name:string,mimeType?:string,modifiedTime:string}, buffer:Buffer, filename?:string, via:string, admin?:any }} args
 * @returns {Promise<{status:'imported'|'error', message:string, summary?:any}>}
 */
export async function importStatementFile({ file, buffer, filename, via, admin }) {
  try {
    const parsed = await parseBankStatement(buffer, filename || file.name);
    if (parsed.transactions.length === 0) {
      throw new Error(
        `No money-in transactions found (${parsed.totalRows} row(s) read). Check it's the right account and has Date / Amount (or Credit) / Details columns.`
      );
    }
    const credits = withStatementIds(parsed.transactions);
    const newCredits = await storeCredits(credits, "gdrive");
    const result = await reconcileOpenEvents({
      sourceLabel: `Bank File Drop Box: ${file.name}`,
      admin: admin || { name: `Bank File Drop Box (${via})` },
    });
    const message =
      `${credits.length} credit(s) in file (${credits.length - newCredits} already seen). ` + result.message;
    const summary = {
      creditsInFile: credits.length,
      newCredits,
      duplicateCredits: credits.length - newCredits,
      events: result.events,
      unmatchedCredits: result.unmatched.length,
      via,
    };
    await recordImport(file, "imported", message, summary, buffer);
    await notifyUploader(file, "imported", message);
    return { status: "imported", message, summary };
  } catch (err) {
    const message = err.message || "Import failed";
    console.error(`Bank file import failed for ${file.name} (${via}):`, message);
    await recordImport(file, "error", message, { via }, buffer || null);
    await alertFailure(file, message, via);
    return { status: "error", message };
  }
}

/** Server-side poll of the folder (route B). */
export async function pollDriveFolder({ admin = null } = {}) {
  if (running) return { skipped: true, message: "A check is already in progress." };
  running = true;
  const processed = [];
  try {
    if (!(await isConnected())) {
      const message = "Server-side Drive connection isn't set up (the Apps Script drop box doesn't need it).";
      return { skipped: true, message };
    }
    const folderId = await getFolderId();
    const afterImport = (await getSetting("gdrive_after_import")) === "delete" ? "delete" : "trash";
    const files = await listFolderFiles(folderId);

    for (const file of files) {
      file.uploadedBy = file.owners?.[0]?.emailAddress || null;
      const prev = await previousOutcome(file.id, file.modifiedTime);
      if (prev?.status === "imported") {
        // Imported earlier (e.g. by the Apps Script) but still in the folder — finish the job.
        await removeFile(file.id, afterImport, folderId).catch(() => {});
        continue;
      }
      if (prev) continue; // failed before in this exact version; waits for a new/edited file

      const supported = file.mimeType === GOOGLE_SHEET_MIME || SUPPORTED_EXT.test(file.name);
      if (!supported) {
        const msg = "Not a CSV or Excel file — export the statement from NAB as CSV and drop that instead.";
        await recordImport(file, "error", msg, { via: "server" });
        await alertFailure(file, msg, "server");
        processed.push({ name: file.name, status: "error", message: msg });
        continue;
      }

      let result;
      try {
        const { buffer, filename } = await downloadFile(file);
        result = await importStatementFile({ file, buffer, filename, via: "server", admin });
      } catch (err) {
        await recordImport(file, "error", err.message, { via: "server" });
        await alertFailure(file, err.message, "server");
        result = { status: "error", message: err.message };
      }
      if (result.status === "imported") {
        try {
          await removeFile(file.id, afterImport, folderId);
        } catch (err) {
          result.message += ` (Couldn't remove the file from Drive: ${err.message})`;
        }
      }
      processed.push({ name: file.name, ...result });
    }

    const message = processed.length
      ? `Processed ${processed.length} file(s): ${processed.map((p) => `${p.name} → ${p.status}`).join(", ")}`
      : "No new files in the Bank File Drop Box.";
    noteRun({ message, error: null, via: "server" });
    return { processed, message };
  } catch (err) {
    noteRun({ message: null, error: err.message, via: "server" });
    throw err;
  } finally {
    running = false;
  }
}

/** Starts the background poll (route B). Safe to call more than once. */
export async function startDriveWatcher() {
  if (timer) clearInterval(timer);
  timer = null;
  let minutes = Number(await getSetting("gdrive_poll_minutes").catch(() => null)) || 5;
  minutes = Math.min(Math.max(minutes, 1), 1440);

  const tick = () =>
    pollDriveFolder().catch((err) => {
      console.error("Bank File Drop Box poll error:", err.message);
    });

  timer = setInterval(tick, minutes * 60_000);
  timer.unref?.();
  setTimeout(tick, 20_000).unref?.();
  console.log(`📂 Bank File Drop Box: server-side check every ${minutes} min (when Google Drive is connected)`);
}
