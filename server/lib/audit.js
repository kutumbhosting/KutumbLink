import { pool } from "../db/pool.js";

// Records who did what, for the "no accountability" gap — every mutating
// admin action (event edits, deletes, ticketing changes, etc.) should call
// this. Never throws — a logging failure should never block the real action.
export async function logAudit(admin, action, entity, details) {
  try {
    await pool.query(
      "INSERT INTO kutumb_audit_log (admin_user_id, admin_email, action, entity, details) VALUES ($1,$2,$3,$4,$5)",
      [admin?.id || null, admin?.email || "unknown", action, entity || null, details ? JSON.stringify(details) : null]
    );
  } catch (err) {
    console.error("AUDIT LOG ERROR (non-fatal):", err.message);
  }
}
