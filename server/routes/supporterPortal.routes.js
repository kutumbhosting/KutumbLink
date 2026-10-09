import { Router } from "express";
import { createHash, randomBytes } from "node:crypto";
import jwt from "jsonwebtoken";
import { pool } from "../db/pool.js";
import { sendTransactionalEmail } from "../lib/mailer.js";

const router = Router();
const COOKIE = "kutumblink_supporter_token";
const COOKIE_OPTIONS = { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 90 * 60 * 1000, path: "/" };
const hash = (value) => createHash("sha256").update(value).digest("hex");
const escapeHtml = (value) => String(value || "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

function supporterSession(req, res, next) {
  const header = req.headers.authorization || "";
  const token = req.cookies?.[COOKIE] || (header.startsWith("Bearer ") ? header.slice(7) : null);
  if (!token) return res.status(401).json({ message: "Use your email sign-in link to continue" });
  try {
    const session = jwt.verify(token, process.env.JWT_SECRET || "dev-only-insecure-secret-change-me");
    if (session.scope !== "supporter_portal" || !Number.isSafeInteger(Number(session.supporterId))) throw new Error("scope");
    req.supporterSession = session;
    next();
  } catch {
    return res.status(401).json({ message: "Your supporter session has expired. Request a new email link." });
  }
}

router.post("/request-link", async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const name = String(req.body?.name || "").trim();
  const slug = String(req.body?.organisationSlug || "").trim();
  const generic = "If we find a matching supporter profile, a sign-in link will be sent to that email address.";
  if (!/^\S+@\S+\.\S+$/.test(email) || name.length < 2 || !slug) return res.status(200).json({ message: generic });
  try {
    await pool.query("DELETE FROM kutumb_supporter_login_links WHERE expires_at < now()-interval '1 day'");
    const { rows } = await pool.query(
      `SELECT s.id,s.display_name,s.email,o.public_name,o.legal_name,o.slug
       FROM kutumb_supporters s JOIN kutumb_organisations o ON o.id=s.organisation_id
       WHERE lower(s.email)=lower($1) AND lower(s.display_name)=lower($2) AND o.slug=$3
         AND s.merged_into_id IS NULL AND o.is_active=TRUE LIMIT 1`, [email, name, slug]
    );
    if (rows[0]) {
      const { rows: recent } = await pool.query("SELECT 1 FROM kutumb_supporter_login_links WHERE supporter_id=$1 AND created_at>now()-interval '1 minute' LIMIT 1", [rows[0].id]);
      if (!recent[0]) {
        const rawToken = randomBytes(32).toString("base64url");
        await pool.query(`INSERT INTO kutumb_supporter_login_links (supporter_id,token_hash,expires_at) VALUES ($1,$2,now()+interval '15 minutes')`, [rows[0].id, hash(rawToken)]);
        const baseUrl = String(process.env.PUBLIC_BASE_URL || "http://localhost:8080").replace(/\/$/, "");
        if (process.env.NODE_ENV === "production" && !baseUrl.startsWith("https://")) throw new Error("PUBLIC_BASE_URL must use HTTPS for supporter access links");
        const link = `${baseUrl}/supporter/access?token=${encodeURIComponent(rawToken)}`;
        const orgName = escapeHtml(rows[0].public_name || rows[0].legal_name);
        await sendTransactionalEmail({
          to: rows[0].email,
          subject: "Your KutumbLink supporter activity link",
          html: `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto"><h2>Your supporter activity</h2><p>Use this secure link to view your activity with ${orgName} and update your communication preferences.</p><p><a href="${link}" style="display:inline-block;padding:12px 18px;background:#146b59;color:white;text-decoration:none;border-radius:6px">Open supporter activity</a></p><p>This link expires in 15 minutes and can only be used once. If you did not request it, you can ignore this email.</p></div>`,
        });
      }
    }
    res.json({ message: generic });
  } catch (error) {
    console.error("SUPPORTER ACCESS LINK ERROR:", error);
    // Do not reveal whether an email/profile is registered.
    res.json({ message: generic });
  }
});

router.post("/exchange", async (req, res) => {
  const rawToken = String(req.body?.token || "");
  if (rawToken.length < 32 || rawToken.length > 200) return res.status(400).json({ message: "This sign-in link is invalid or has expired." });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `UPDATE kutumb_supporter_login_links SET used_at=now()
       WHERE token_hash=$1 AND used_at IS NULL AND expires_at>now()
       RETURNING supporter_id`, [hash(rawToken)]
    );
    if (!rows[0]) { await client.query("ROLLBACK"); return res.status(400).json({ message: "This sign-in link is invalid or has expired. Request a new one." }); }
    const { rows: supporters } = await client.query("SELECT id,organisation_id FROM kutumb_supporters WHERE id=$1 AND merged_into_id IS NULL", [rows[0].supporter_id]);
    if (!supporters[0]) { await client.query("ROLLBACK"); return res.status(400).json({ message: "This supporter profile is no longer active." }); }
    const token = jwt.sign({ scope: "supporter_portal", supporterId: Number(supporters[0].id), organisationId: Number(supporters[0].organisation_id) }, process.env.JWT_SECRET || "dev-only-insecure-secret-change-me", { expiresIn: "90m" });
    await client.query("COMMIT");
    res.cookie(COOKIE, token, COOKIE_OPTIONS).json({ message: "Signed in securely" });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("SUPPORTER ACCESS EXCHANGE ERROR:", error);
    res.status(500).json({ message: "Could not open supporter activity" });
  } finally { client.release(); }
});

router.get("/me", supporterSession, async (req, res) => {
  try {
    const supporterId = Number(req.supporterSession.supporterId);
    const organisationId = Number(req.supporterSession.organisationId);
    const { rows } = await pool.query(
      `SELECT s.id,s.display_name,s.email,s.email_opt_out,s.sms_opt_out,s.email_consent,s.sms_consent,o.public_name,o.legal_name
       FROM kutumb_supporters s JOIN kutumb_organisations o ON o.id=s.organisation_id
       WHERE s.id=$1 AND s.organisation_id=$2 AND s.merged_into_id IS NULL`, [supporterId, organisationId]
    );
    if (!rows[0]) return res.status(404).json({ message: "Supporter profile not found" });
    const [donations, registrations, tickets, activities, memberships] = await Promise.all([
      pool.query("SELECT amount,payment_status AS status,created_at FROM kutumb_donations WHERE supporter_id=$1 AND organisation_id=$2 ORDER BY created_at DESC LIMIT 100", [supporterId, organisationId]),
      pool.query("SELECT event_name,event_year,payment_status AS status,created_at FROM kutumb_event_registrations WHERE supporter_id=$1 AND organisation_id=$2 ORDER BY created_at DESC LIMIT 100", [supporterId, organisationId]),
      pool.query("SELECT a.event_id AS event_name,a.checked_in_at,o.created_at FROM kutumb_attendees a JOIN kutumb_order_items oi ON oi.id=a.order_item_id JOIN kutumb_orders o ON o.id=oi.order_id WHERE a.supporter_id=$1 AND a.organisation_id=$2 ORDER BY o.created_at DESC LIMIT 100", [supporterId, organisationId]),
      pool.query("SELECT activity_title,created_at FROM kutumb_activity_registrations WHERE supporter_id=$1 AND organisation_id=$2 ORDER BY created_at DESC LIMIT 100", [supporterId, organisationId]),
      pool.query("SELECT membership_number,created_at FROM kutumb_members WHERE supporter_id=$1 AND organisation_id=$2 ORDER BY created_at DESC LIMIT 20", [supporterId, organisationId]),
    ]);
    const activity = [
      ...donations.rows.map((item) => ({ type: "Donation", ...item })),
      ...registrations.rows.map((item) => ({ type: "Event registration", ...item })),
      ...tickets.rows.map((item) => ({ type: item.checked_in_at ? "Event attended" : "Ticket", ...item })),
      ...activities.rows.map((item) => ({ type: "Activity", ...item })),
      ...memberships.rows.map((item) => ({ type: "Membership", ...item })),
    ].sort((a,b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    res.json({ supporter: { name: rows[0].display_name, email: rows[0].email, emailOptOut: rows[0].email_opt_out, smsOptOut: rows[0].sms_opt_out, emailConsent: rows[0].email_consent, smsConsent: rows[0].sms_consent }, organisation: rows[0].public_name || rows[0].legal_name, activity });
  } catch (error) {
    console.error("SUPPORTER PORTAL ERROR:", error);
    res.status(500).json({ message: "Could not load supporter activity" });
  }
});

router.put("/preferences", supporterSession, async (req, res) => {
  const emailOptOut = req.body?.emailOptOut;
  const smsOptOut = req.body?.smsOptOut;
  if (typeof emailOptOut !== "boolean" || typeof smsOptOut !== "boolean") return res.status(400).json({ message: "Choose both communication preferences" });
  try {
  await pool.query("UPDATE kutumb_supporters SET email_opt_out=$1,sms_opt_out=$2,email_consent=$3,sms_consent=$4,consent_updated_at=now(),consent_source='supporter_portal',updated_at=now() WHERE id=$5 AND organisation_id=$6 AND merged_into_id IS NULL", [emailOptOut, smsOptOut, !emailOptOut, !smsOptOut, Number(req.supporterSession.supporterId), Number(req.supporterSession.organisationId)]);
    res.json({ emailOptOut, smsOptOut, message: "Your preferences are saved." });
  } catch (error) {
    console.error("SUPPORTER PREFERENCES ERROR:", error);
    res.status(500).json({ message: "Could not save preferences" });
  }
});

router.post("/logout", (_req, res) => {
  res.clearCookie(COOKIE, { ...COOKIE_OPTIONS, maxAge: undefined });
  res.json({ message: "Signed out" });
});

export default router;
