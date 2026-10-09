import { Router } from "express";
import { pool } from "../db/pool.js";
import { comparePassword, hashPassword, signAdminToken, signCheckinCodeToken, requireAdmin, requireAdminOrCheckinSession, ADMIN_COOKIE_NAME } from "../lib/auth.js";
import { logAudit } from "../lib/audit.js";
import { redeemCheckinCode } from "../lib/checkinCodes.js";

const router = Router();

const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  maxAge: 12 * 60 * 60 * 1000, // 12h, matches the JWT's own expiry
};

router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ message: "Email and password are required" });

    const { rows } = await pool.query("SELECT * FROM kutumb_admin_users WHERE email = $1", [email.trim().toLowerCase()]);
    const admin = rows[0];
    if (!admin) return res.status(401).json({ message: "Invalid email or password" });

    const ok = await comparePassword(password, admin.password_hash);
    if (!ok) return res.status(401).json({ message: "Invalid email or password" });

    const safeAdmin = { id: admin.id, email: admin.email, name: admin.name, role: admin.role };
    const token = signAdminToken(safeAdmin);
    res.cookie(ADMIN_COOKIE_NAME, token, COOKIE_OPTIONS);
    await logAudit(safeAdmin, "admin.login", null, null);
    // Token is also returned in the body for any non-browser API usage —
    // the browser itself relies on the cookie, not this value.
    res.json({ token, admin: safeAdmin });
  } catch (err) {
    console.error("ADMIN LOGIN ERROR:", err);
    res.status(500).json({ message: "Login failed" });
  }
});

// Log in to the check-in scanner with a temporary code instead of an
// email/password — this is the check-in page's PRIMARY login option (the
// password form is offered as a fallback). The resulting session only ever
// satisfies requireAdminOrCheckinSession (i.e. the check-in routes), never
// a plain requireAdmin — see server/lib/auth.js.
router.post("/login-code", async (req, res) => {
  try {
    const { code, name } = req.body || {};
    if (!code) return res.status(400).json({ message: "A check-in code is required" });
    if (!String(name || "").trim()) return res.status(400).json({ message: "Please enter your name" });

    const result = await redeemCheckinCode(code, name);
    if (!result) return res.status(401).json({ message: "That code wasn't recognised" });
    if (result.error === "name") return res.status(400).json({ message: "Please enter your full name (2–60 characters)" });
    if (result.expired) return res.status(401).json({ message: "That code has expired" });
    if (result.used) return res.status(401).json({ message: "That code has already been used. Ask an event admin for a new one." });

    const { row } = result;
    const safeAdmin = {
      email: "info@kutumb.org.au",
      name: row.used_by_name,
      role: "checkin",
      scope: "checkin_code",
      checkinEventName: row.event_name,
      checkinEventYear: row.event_year,
      checkinCode: row.code,
    };
    const token = signCheckinCodeToken({
      eventName: row.event_name,
      eventYear: row.event_year,
      code: row.code,
      expiresAt: row.expires_at,
      volunteerName: row.used_by_name,
    });
    res.cookie(ADMIN_COOKIE_NAME, token, { ...COOKIE_OPTIONS, maxAge: Math.max(0, new Date(row.expires_at).getTime() - Date.now()) });
    await logAudit(safeAdmin, "checkin.code_login", row.event_name, { volunteer: row.used_by_name, code: row.code });
    res.json({ token, admin: safeAdmin });
  } catch (err) {
    console.error("CHECKIN CODE LOGIN ERROR:", err);
    res.status(500).json({ message: "Login failed" });
  }
});

router.post("/logout", (req, res) => {
  res.clearCookie(ADMIN_COOKIE_NAME, { ...COOKIE_OPTIONS, maxAge: undefined });
  res.json({ message: "Logged out" });
});

router.post("/change-password", requireAdminOrCheckinSession, async (req, res) => {
  if (req.admin.scope === "checkin_code") return res.status(403).json({ message: "Check-in sessions cannot change account passwords" });
  const currentPassword = String(req.body?.currentPassword || "");
  const newPassword = String(req.body?.newPassword || "");
  if (newPassword.length < 10) return res.status(400).json({ message: "Use a new password with at least 10 characters" });
  try {
    const { rows } = await pool.query("SELECT password_hash FROM kutumb_admin_users WHERE id = $1", [req.admin.id]);
    if (!rows[0] || !(await comparePassword(currentPassword, rows[0].password_hash))) {
      return res.status(400).json({ message: "Current password is incorrect" });
    }
    await pool.query("UPDATE kutumb_admin_users SET password_hash = $1 WHERE id = $2", [await hashPassword(newPassword), req.admin.id]);
    await logAudit(req.admin, "admin.password_change", String(req.admin.id), null);
    res.json({ message: "Password updated" });
  } catch (error) {
    console.error("PASSWORD CHANGE ERROR:", error);
    res.status(500).json({ message: "Could not update your password" });
  }
});

router.get("/me", requireAdminOrCheckinSession, async (req, res) => {
  // A check-in-code session has no row in kutumb_admin_users — its identity
  // lives entirely in the (short-lived, narrowly-scoped) token itself.
  if (req.admin.scope === "checkin_code") {
    return res.json({
      email: req.admin.email,
      name: req.admin.name,
      role: req.admin.role,
      scope: req.admin.scope,
      checkinEventName: req.admin.checkinEventName,
      checkinEventYear: req.admin.checkinEventYear,
      checkinCode: req.admin.checkinCode,
    });
  }
  const { rows } = await pool.query("SELECT id, email, name, role, created_at FROM kutumb_admin_users WHERE id = $1", [req.admin.id]);
  if (!rows[0]) return res.status(404).json({ message: "Admin not found" });
  res.json(rows[0]);
});

export default router;
