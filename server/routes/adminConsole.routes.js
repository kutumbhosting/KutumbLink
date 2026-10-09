import { Router } from "express";
import pg from "pg";
import { pool } from "../db/pool.js";
import { buildPoolConfig } from "../db/pool.js";
import { readEnvFile, setEnvVar } from "../lib/envFile.js";
import { requireSuperAdmin, hashPassword } from "../lib/auth.js";
import { startDriveWatcher } from "../lib/driveStatementWatcher.js";
import { getAllSettingsForAdmin, setSetting, deleteSetting, getSetting, SETTINGS_SCHEMA } from "../lib/settings.js";
import { normalizeBaseUrl, getPublicBaseUrlWarning } from "../lib/publicUrl.js";
import { logAudit } from "../lib/audit.js";
import { importMembersDropIn } from "../lib/importMembersDropIn.js";
import { listGroqModels } from "../lib/aiDraft.js";

const router = Router();
// Everything in the Admin Console (API Keys, Settings, Database, Admin
// Users, Audit Log) is Super Admin-only. Limited admins get scoped access
// to Events Settings / Events Management / File Management instead — see
// the route-level guards in server.js and dbTables.routes.js.
router.use(requireSuperAdmin);

/* -------- Settings (Stripe keys etc.) -------- */
router.get("/settings", async (req, res) => {
  const settings = await getAllSettingsForAdmin();
  // Flag an unusable/local Public Base URL right on its field — it otherwise
  // only shows up as broken links in emailed payment buttons.
  const warning = await getPublicBaseUrlWarning().catch(() => null);
  res.json(settings.map((s) => (s.key === "public_base_url" && warning ? { ...s, warning } : s)));
});

router.put("/settings/:key", async (req, res) => {
  const def = SETTINGS_SCHEMA.find((s) => s.key === req.params.key);
  if (!def) return res.status(400).json({ message: "Unknown setting key" });
  const { value } = req.body;
  if (value === undefined) return res.status(400).json({ message: "value is required" });

  // Every emailed "Pay Now" link and every Stripe/Square return URL is built
  // from this, so refuse values that would send people somewhere other than
  // this website (it was once saved as https://api.stripe.com).
  let toStore = value;
  if (def.key === "public_base_url") {
    const { url, error } = normalizeBaseUrl(value);
    if (error) return res.status(400).json({ message: error });
    toStore = url;
  }
  if (def.key === "gdrive_after_import") {
    toStore = String(value).trim().toLowerCase();
    if (!["trash", "delete"].includes(toStore)) {
      return res.status(400).json({ message: 'Enter "trash" or "delete"' });
    }
  }
  if (def.key === "gdrive_poll_minutes") {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1 || n > 1440) {
      return res.status(400).json({ message: "Enter a whole number of minutes between 1 and 1440" });
    }
    toStore = String(n);
  }
  if (def.key === "reg_reminder_days") {
    const names = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
    const days = String(value).toLowerCase().split(/[\s,;]+/).filter(Boolean).map((d) => d.slice(0, 3));
    if (!days.length || days.some((d) => !names.includes(d))) {
      return res.status(400).json({ message: "Enter days like: mon,thu" });
    }
    toStore = [...new Set(days)].join(",");
  }
  const ranges = { reg_email_hour: [0, 23], reg_final_days_before: [2, 60], reg_cancel_days_before: [1, 59] };
  if (ranges[def.key]) {
    const [min, max] = ranges[def.key];
    const n = Number(value);
    if (!Number.isInteger(n) || n < min || n > max) {
      return res.status(400).json({ message: `Enter a whole number from ${min} to ${max}` });
    }
    toStore = String(n);
  }
  if (def.key === "gdrive_folder_id" || def.key === "media_dropbox_folder_id") {
    // Accept a pasted folder link as well as a bare id.
    const m = String(value).match(/folders\/([A-Za-z0-9_-]+)/);
    toStore = m ? m[1] : String(value).trim();
  }

  await setSetting(def.key, toStore, def.secret);
  if (def.key === "gdrive_poll_minutes") {
    startDriveWatcher().catch((err) => console.error("Drive watcher restart failed:", err.message));
  }
  await logAudit(req.admin, "settings.update", def.key, { secret: def.secret });
  res.json({ message: "Saved" });
});

router.delete("/settings/:key", async (req, res) => {
  const def = SETTINGS_SCHEMA.find((s) => s.key === req.params.key);
  if (!def) return res.status(400).json({ message: "Unknown setting key" });
  await deleteSetting(def.key);
  await logAudit(req.admin, "settings.clear", def.key, null);
  res.json({ message: "Cleared" });
});

/* -------- Groq models (for the AI Email Draft model dropdown) --------
   Fetched live from Groq rather than hardcoded, since Groq's model lineup
   changes often enough that a baked-in id can quietly stop working (as
   happened with an earlier hardcoded default). Uses whichever Groq API key
   is already saved in settings. */
router.get("/groq-models", async (req, res) => {
  try {
    const apiKey = await getSetting("groq_api_key");
    if (!apiKey) return res.status(400).json({ message: "Save a Groq API key first, then load the model list." });
    const models = await listGroqModels(apiKey);
    res.json({ models });
  } catch (err) {
    res.status(400).json({ message: err.message || "Couldn't load models" });
  }
});

/* -------- Database connection (superadmin only) --------
   DATABASE_URL itself has to live in .env (the app needs it before it can
   connect to anything, including a settings table), so this isn't stored
   alongside the other encrypted settings in Postgres — instead these
   endpoints read/test/update the .env file directly on disk. */

function maskConnectionString(raw) {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const userInfo = url.username ? `${url.username}:${"•".repeat(8)}@` : "";
    return `${url.protocol}//${userInfo}${url.host}${url.pathname}`;
  } catch {
    return "•••• (set, but not a valid URL)";
  }
}

router.get("/database", requireSuperAdmin, async (req, res) => {
  const current = maskConnectionString(process.env.DATABASE_URL);
  let connected = false;
  try {
    await pool.query("SELECT 1");
    connected = true;
  } catch {
    connected = false;
  }
  res.json({ current, connected });
});

// Tests a candidate connection string against a throwaway pool (never the
// live one) before anything is saved, so a typo can't take the app down.
router.post("/database/test", requireSuperAdmin, async (req, res) => {
  const { connectionString } = req.body;
  if (!connectionString?.trim()) return res.status(400).json({ message: "connectionString is required" });

  const testPool = new pg.Pool({ ...buildPoolConfig(connectionString.trim()), max: 1, connectionTimeoutMillis: 8000 });
  try {
    await testPool.query("SELECT 1");
    res.json({ ok: true, message: "Connected successfully" });
  } catch (err) {
    res.status(400).json({ ok: false, message: err.message });
  } finally {
    await testPool.end().catch(() => {});
  }
});

// Only writes to .env after a successful test — this does NOT hot-swap the
// live connection pool (that risks tearing the app out from under itself
// mid-request), so a restart is required for it to take effect. That's a
// deliberate, safer trade-off for something this central.
router.put("/database", requireSuperAdmin, async (req, res) => {
  const { connectionString } = req.body;
  if (!connectionString?.trim()) return res.status(400).json({ message: "connectionString is required" });
  const trimmed = connectionString.trim();

  const testPool = new pg.Pool({ ...buildPoolConfig(trimmed), max: 1, connectionTimeoutMillis: 8000 });
  try {
    await testPool.query("SELECT 1");
  } catch (err) {
    await testPool.end().catch(() => {});
    return res.status(400).json({ message: `Could not connect with this string: ${err.message}` });
  }
  await testPool.end().catch(() => {});

  try {
    setEnvVar("DATABASE_URL", trimmed);
  } catch (err) {
    return res.status(500).json({ message: `Connected fine, but couldn't save to .env: ${err.message}` });
  }

  await logAudit(req.admin, "database.update", null, { host: maskConnectionString(trimmed) });
  res.json({
    message: "Saved to .env. Restart the server (stop app.cmd and run it again) for this to take effect.",
    requiresRestart: true,
  });
});

/* -------- Members drop-in import (manual trigger, no restart needed) --------
   Same logic that runs automatically on server startup, exposed here so an
   admin can pick up a freshly-dropped members/members.json under DATA_ROOT
   immediately instead of waiting for the next restart. */
router.post("/import-members", async (req, res) => {
  try {
    const result = await importMembersDropIn();
    await logAudit(req.admin, "members.dropin_import", null, result);
    res.json(result);
  } catch (err) {
    console.error("MANUAL MEMBERS IMPORT ERROR:", err);
    res.status(500).json({ message: "Import failed" });
  }
});

/* -------- Admin users (superadmin only) -------- */
router.get("/admin-users", requireSuperAdmin, async (req, res) => {
  const { rows } = await pool.query("SELECT id, email, name, role, created_at FROM kutumb_admin_users ORDER BY id");
  res.json(rows);
});

router.post("/admin-users", requireSuperAdmin, async (req, res) => {
  const { name, email, password, role } = req.body;
  if (!name?.trim() || !email?.trim() || !password) return res.status(400).json({ message: "name, email, password required" });
  const hash = await hashPassword(password);
  const { rows } = await pool.query(
    "INSERT INTO kutumb_admin_users (email, password_hash, name, role) VALUES ($1,$2,$3,$4) RETURNING id, email, name, role",
    [email.trim().toLowerCase(), hash, name.trim(), ["superadmin", "platform_admin"].includes(role) ? role : "admin"]
  );
  await logAudit(req.admin, "admin_user.create", rows[0].email, null);
  res.status(201).json(rows[0]);
});

router.put("/admin-users/:id", requireSuperAdmin, async (req, res) => {
  const { name, role, password } = req.body;
  if (password) {
    const hash = await hashPassword(password);
    await pool.query("UPDATE kutumb_admin_users SET password_hash = $1 WHERE id = $2", [hash, req.params.id]);
  }
  const { rows } = await pool.query(
    "UPDATE kutumb_admin_users SET name = COALESCE($1,name), role = COALESCE($2,role) WHERE id = $3 RETURNING id, email, name, role",
    [name, ["admin", "platform_admin", "superadmin"].includes(role) ? role : null, req.params.id]
  );
  await logAudit(req.admin, "admin_user.update", rows[0]?.email, null);
  res.json(rows[0]);
});

router.delete("/admin-users/:id", requireSuperAdmin, async (req, res) => {
  if (Number(req.params.id) === req.admin.id) {
    return res.status(400).json({ message: "You can't delete your own logged-in account" });
  }
  const { rows } = await pool.query("SELECT email FROM kutumb_admin_users WHERE id = $1", [req.params.id]);
  await pool.query("DELETE FROM kutumb_admin_users WHERE id = $1", [req.params.id]);
  await logAudit(req.admin, "admin_user.delete", rows[0]?.email, null);
  res.json({ message: "Admin user deleted" });
});

/* -------- Audit log -------- */
router.get("/audit-log", async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM kutumb_audit_log ORDER BY id DESC LIMIT 300");
  res.json(rows);
});

export default router;
