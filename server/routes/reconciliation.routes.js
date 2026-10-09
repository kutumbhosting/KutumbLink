// server/routes/reconciliation.routes.js
//
// Mounted at /api/events/reconcile.
//
//   POST /api/events/reconcile            — upload a bank statement for one
//                                            event, match it against that
//                                            event's registrations, flip
//                                            Pending → Paid where matched,
//                                            and save the run for later
//                                            export.
//   GET  /api/events/reconcile/latest      — the most recent saved run for
//                                            one event (so the "Download
//                                            Excel Report" button still
//                                            works after a page reload).
//   GET  /api/events/reconcile/:id/export  — regenerate and download the
//                                            Excel report for a saved run.
//
//   Live NAB feed (openfeed / CDR open banking) lives in openfeed.routes.js
//   (/api/openfeed/*) and feeds the same ledger + matching.
//
//   Google Drive drop folder — statement files dropped there are imported,
//   reconciled against all events with unpaid registrations, then removed:
//   GET  /api/events/reconcile/drive/status       — connection, folder, recent imports
//   POST /api/events/reconcile/drive/connect      — Google sign-in URL
//   GET  /api/events/reconcile/drive/callback     — OAuth redirect target
//   POST /api/events/reconcile/drive/run-now      — check the folder immediately
//   POST /api/events/reconcile/drive/disconnect
//   GET  /api/events/reconcile/drive/imports/:id/file — original file of an import
//   POST /api/events/reconcile/drive/push         — file sent by the Google Apps
//                                                    Script (key-authenticated, no login)
//   GET  /api/events/reconcile/drive/apps-script  — the ready-to-paste script

import { Router } from "express";
import multer from "multer";
import { pool } from "../db/pool.js";
import { requireAdmin } from "../lib/auth.js";
import { parseBankStatement } from "../lib/bankStatementParser.js";
import { buildReconciliationWorkbook } from "../lib/reconciliationReportBuilder.js";
import { runReconciliation } from "../lib/reconciliationRun.js";
import { getSetting, setSetting } from "../lib/settings.js";
import { getPublicBaseUrl } from "../lib/publicUrl.js";
import { withStatementIds, storeCredits, markAllocations, reconcileOpenEvents } from "../lib/bankLedger.js";
import {
  buildAuthUrl as driveAuthUrl,
  handleCallback as driveHandleCallback,
  disconnect as driveDisconnect,
  isConnected as driveConnected,
  getFolderId as driveFolderId,
  getFolderName as driveFolderName,
  listFolderFiles as driveListFiles,
  redirectUriFor as driveRedirectUri,
} from "../lib/googleDrive.js";
import {
  pollDriveFolder,
  getWatcherState,
  importStatementFile,
  previousOutcome,
  noteRun,
} from "../lib/driveStatementWatcher.js";
import { getOrCreatePushKey, buildAppsScript } from "../lib/dropBoxScript.js";
import crypto from "crypto";
import express from "express";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

/* -----------------------------
   📤 UPLOAD BANK STATEMENT + RECONCILE
------------------------------ */
router.post("/", requireAdmin, upload.single("bankStatement"), async (req, res) => {
  try {
    const { eventName, eventYear } = req.body;
    if (!eventName || !eventYear) {
      return res.status(400).json({ message: "Missing event" });
    }
    if (!req.file) {
      return res.status(400).json({ message: "No bank statement file uploaded" });
    }

    let parsed;
    try {
      parsed = await parseBankStatement(req.file.buffer, req.file.originalname);
    } catch (err) {
      return res.status(400).json({ message: err.message || "Couldn't read that file" });
    }
    if (parsed.transactions.length === 0) {
      return res.status(400).json({
        message:
          "No credit transactions were found in that file. Check it's the right statement, or that it has Date/Amount/Details columns.",
      });
    }

    // Keep the uploaded credits in the shared ledger too, so the Drive
    // folder / bank feed never re-match a credit this upload already used.
    const credits = withStatementIds(parsed.transactions);
    await storeCredits(credits, "upload");

    const { allocations, ...result } = await runReconciliation({
      eventName,
      eventYear,
      transactions: credits,
      sourceLabel: req.file.originalname,
      admin: req.admin,
    });
    await markAllocations(allocations, eventName, eventYear);
    res.json(result);
  } catch (err) {
    if (err.status === 404) return res.status(404).json({ message: err.message });
    console.error("BANK RECONCILIATION ERROR:", err);
    res.status(500).json({ message: "Reconciliation failed" });
  }
});

/* -----------------------------
   📂 GOOGLE DRIVE STATEMENT DROP FOLDER
------------------------------ */
router.get("/drive/status", requireAdmin, async (req, res) => {
  try {
    const baseUrl = await getPublicBaseUrl(req);
    const hasClient = !!((await getSetting("gdrive_client_id")) && (await getSetting("gdrive_client_secret")));
    const connected = await driveConnected();
    const folderId = await driveFolderId();
    let folderName = null;
    let filesWaiting = null;
    let error = null;
    if (connected) {
      try {
        folderName = await driveFolderName(folderId);
        filesWaiting = (await driveListFiles(folderId)).length;
      } catch (err) {
        error = err.message;
      }
    }
    const { rows: imports } = await pool.query(
      `SELECT id, file_name, status, message, summary, processed_at, uploaded_by, (content IS NOT NULL) AS has_file
         FROM kutumb_drive_imports ORDER BY processed_at DESC LIMIT 10`
    );
    res.json({
      hasClient,
      connected,
      connectedEmail: (await getSetting("gdrive_connected_email")) || null,
      folderId,
      folderName,
      folderUrl: `https://drive.google.com/drive/folders/${folderId}`,
      filesWaiting,
      redirectUri: driveRedirectUri(baseUrl),
      watcher: getWatcherState(),
      appsScriptLastSeen: (await getSetting("dropbox_script_last_seen")) || null,
      imports,
      error,
    });
  } catch (err) {
    console.error("DRIVE STATUS ERROR:", err);
    res.status(500).json({ message: "Couldn't read Google Drive status" });
  }
});

// Open check (no login, no data): lets you confirm in a browser that the
// address in the Apps Script reaches a website that has the drop box.
router.get("/drive/ping", (req, res) => {
  res.json({ ok: true, dropBox: true, message: "Kutumb Bank File Drop Box endpoint is available." });
});

/* Apps Script push (route A). Auth is the shared key, compared in constant
   time; the file comes as the raw request body so the app-wide 100 kB JSON
   limit doesn't apply. */
router.post(
  "/drive/push",
  express.raw({ type: "application/octet-stream", limit: "25mb" }),
  async (req, res) => {
    try {
      const expected = await getOrCreatePushKey();
      const given = String(req.get("X-Kutumb-Key") || "");
      const ok =
        given.length === expected.length &&
        crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
      if (!ok) return res.status(401).json({ status: "unauthorised", message: "Wrong drop box key" });

      await setSettingSafe("dropbox_script_last_seen", new Date().toISOString());

      const file = {
        id: String(req.get("X-File-Id") || ""),
        name: decodeURIComponent(String(req.get("X-File-Name") || "statement")),
        mimeType: String(req.get("X-File-Mime") || ""),
        modifiedTime: String(req.get("X-File-Modified") || ""),
        uploadedBy: String(req.get("X-File-Owner") || "").trim() || null,
      };
      if (!file.id || !file.modifiedTime) return res.status(400).json({ status: "error", message: "Missing file id/modified time" });

      const prev = await previousOutcome(file.id, file.modifiedTime);
      if (prev?.status === "imported") {
        return res.json({ status: "already-imported", message: prev.message });
      }
      if (prev?.status === "error") {
        return res.json({ status: "error", message: `Failed earlier: ${prev.message}`, retry: false });
      }
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        return res.status(400).json({ status: "error", message: "Empty file" });
      }

      const result = await importStatementFile({
        file,
        buffer: req.body,
        filename: req.get("X-File-Converted-Name") ? decodeURIComponent(req.get("X-File-Converted-Name")) : file.name,
        via: "apps-script",
      });
      noteRun({ message: `${file.name} → ${result.status}: ${result.message}`, error: null, via: "apps-script" });
      res.json(result);
    } catch (err) {
      console.error("DROP BOX PUSH ERROR:", err);
      res.status(500).json({ status: "error", message: err.message || "Import failed" });
    }
  }
);

async function setSettingSafe(key, value) {
  await setSetting(key, value, false).catch(() => {});
}

router.get("/drive/apps-script", requireAdmin, async (req, res) => {
  try {
    const script = await buildAppsScript({
      siteUrl: await getPublicBaseUrl(req),
      folderId: await driveFolderId(),
      afterImport: (await getSetting("gdrive_after_import")) === "delete" ? "delete" : "trash",
    });
    res.type("text/plain").send(script);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post("/drive/connect", requireAdmin, async (req, res) => {
  try {
    const url = await driveAuthUrl(await getPublicBaseUrl(req));
    res.json({ url });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

router.get("/drive/callback", requireAdmin, async (req, res) => {
  const page = (title, body) =>
    `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
     <div style="font-family:Arial,sans-serif;max-width:520px;margin:60px auto;padding:0 16px">
     <h2 style="color:#7c3f00">${title}</h2><p>${body}</p><p><a href="/admin">Back to admin</a></p></div>`;
  try {
    if (req.query.error) throw new Error(`Google sign-in was cancelled (${req.query.error}).`);
    const { email } = await driveHandleCallback({
      code: String(req.query.code || ""),
      state: String(req.query.state || ""),
      baseUrl: await getPublicBaseUrl(req),
    });
    // Check straight away so anything already waiting is picked up.
    pollDriveFolder({ admin: req.admin }).catch((err) => console.error("Drive first poll error:", err.message));
    res.send(page("Google Drive connected", `Connected as <strong>${email || "your Google account"}</strong>. Statement files dropped in the folder will now be reconciled automatically. You can close this tab.`));
  } catch (err) {
    res.status(400).send(page("Couldn't connect Google Drive", String(err.message).replace(/</g, "&lt;")));
  }
});

router.post("/drive/run-now", requireAdmin, async (req, res) => {
  try {
    const result = await pollDriveFolder({ admin: req.admin });
    res.json(result);
  } catch (err) {
    console.error("DRIVE RUN ERROR:", err);
    res.status(500).json({ message: err.message || "Drive check failed" });
  }
});

router.post("/drive/disconnect", requireAdmin, async (req, res) => {
  await driveDisconnect();
  res.json({ message: "Google Drive disconnected" });
});

router.get("/drive/imports/:id/file", requireAdmin, async (req, res) => {
  const { rows } = await pool.query("SELECT file_name, mime_type, content FROM kutumb_drive_imports WHERE id = $1", [req.params.id]);
  if (!rows.length || !rows[0].content) return res.status(404).json({ message: "No stored file for that import" });
  const name = rows[0].mime_type === "application/vnd.google-apps.spreadsheet" ? `${rows[0].file_name}.xlsx` : rows[0].file_name;
  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader("Content-Disposition", `attachment; filename="${String(name).replace(/[^\w.\- ]+/g, "_")}"`);
  res.send(rows[0].content);
});

// Reconcile every unmatched ledger credit against all open events (the same
// pass the Drive watcher runs) — handy after new registrations come in.
router.post("/open-events", requireAdmin, async (req, res) => {
  try {
    res.json(await reconcileOpenEvents({ sourceLabel: "Re-run on stored bank credits", admin: req.admin }));
  } catch (err) {
    console.error("OPEN EVENTS RECONCILE ERROR:", err);
    res.status(500).json({ message: err.message || "Reconciliation failed" });
  }
});

/* -----------------------------
   🔁 LATEST SAVED RUN FOR AN EVENT (so the download button survives a reload)
------------------------------ */
router.get("/latest", requireAdmin, async (req, res) => {
  try {
    const { eventName, eventYear } = req.query;
    if (!eventName || !eventYear) return res.status(400).json({ message: "Missing event" });

    const { rows } = await pool.query(
      `SELECT id, uploaded_filename, run_at, summary FROM kutumb_bank_reconciliations
       WHERE event_name = $1 AND event_year = $2 ORDER BY run_at DESC LIMIT 1`,
      [eventName, eventYear]
    );
    if (rows.length === 0) return res.json(null);
    res.json({
      reconciliationId: rows[0].id,
      uploadedFilename: rows[0].uploaded_filename,
      runAt: rows[0].run_at,
      summary: rows[0].summary,
    });
  } catch (err) {
    console.error("RECONCILIATION LATEST ERROR:", err);
    res.status(500).json({ message: "Server error" });
  }
});

/* -----------------------------
   📥 DOWNLOAD EXCEL REPORT FOR A SAVED RUN
------------------------------ */
router.get("/:id/export", requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT * FROM kutumb_bank_reconciliations WHERE id = $1",
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ message: "Reconciliation run not found" });

    const report = rows[0].report;
    const workbook = buildReconciliationWorkbook({
      eventName: report.eventName,
      eventYear: report.eventYear,
      uploadedFilename: report.uploadedFilename,
      dateRange: report.dateRange,
      rows: report.rows,
      unmatchedCredits: report.unmatchedCredits,
    });

    const buffer = await workbook.xlsx.writeBuffer();
    const eventLabel =
      report.eventYear && !String(report.eventName).trim().endsWith(String(report.eventYear))
        ? `${report.eventName}_${report.eventYear}`
        : report.eventName;
    const safeName = `${eventLabel}_Payment_Reconciliation`.replace(/[^\w\-]+/g, "_");

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${safeName}.xlsx"`);
    res.send(Buffer.from(buffer));
  } catch (err) {
    console.error("RECONCILIATION EXPORT ERROR:", err);
    res.status(500).json({ message: "Export failed" });
  }
});

export default router;
