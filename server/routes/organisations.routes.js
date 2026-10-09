import { Router } from "express";
import bcrypt from "bcryptjs";
import { pool } from "../db/pool.js";
import { authenticateAdminIdentity, signAdminToken, ADMIN_COOKIE_NAME } from "../lib/auth.js";
import { isFeatureEnabled } from "../lib/featureFlags.js";
import { hasOrganisationPermission, isOrganisationRole, membershipMatchesScope } from "../lib/organisationAccess.js";
import { slugify } from "../lib/slugify.js";
import { generateEventDraft } from "../lib/aiDraft.js";

const router = Router();
const PROFILE_FIELDS = [
  "public_name", "legal_name", "abn", "charity_status", "dgr_status", "acnc_registration_number", "causes", "description",
  "contact_email", "contact_phone", "logo_url", "website", "address_line1", "address_line2",
  "suburb", "state", "postcode", "country",
];

function platformOnly(req, res, next) {
  return req.admin.role === "superadmin" || req.admin.role === "platform_admin"
    ? next() : res.status(403).json({ message: "Platform administrator access required" });
}

// Public charity discovery intentionally returns an allow-listed projection;
// internal verification notes and documents never leave authenticated APIs.
router.get("/public", async (_req, res) => {
  if (!isFeatureEnabled("organisations")) return res.json([]);
  const { rows } = await pool.query(
    `SELECT id,public_name,legal_name,slug,description,causes,logo_url,website,contact_email,suburb,state,postcode,verification_status
     FROM kutumb_organisations WHERE is_active=TRUE AND public_profile_enabled=TRUE AND verification_status='approved'
     ORDER BY COALESCE(public_name,legal_name)`
  );
  res.json(rows);
});

router.get("/public-campaigns", async (_req, res) => {
  if (!isFeatureEnabled("organisations")) return res.json([]);
  const { rows } = await pool.query(
    `SELECT c.id,c.slug,c.title,c.description,c.story,c.image_url,c.goal_amount,c.internal_giving_enabled,c.fundraising_url,o.id AS organisation_id,o.public_name,o.legal_name,o.slug AS organisation_slug,o.causes,
       (SELECT COALESCE(sum(d.amount),0)::numeric(12,2) FROM kutumb_donations d WHERE d.campaign_id=c.id AND lower(d.payment_status)='paid') AS raised_amount
     FROM kutumb_organisation_campaigns c JOIN kutumb_organisations o ON o.id=c.organisation_id
     WHERE c.status='published' AND o.is_active=TRUE AND o.public_profile_enabled=TRUE AND o.verification_status='approved'
     ORDER BY c.created_at DESC LIMIT 100`
  );
  res.json(rows);
});

router.get("/public/:slug", async (req, res) => {
  if (!isFeatureEnabled("organisations")) return res.status(404).json({ message: "Charity profiles are currently unavailable" });
  try {
    const { rows } = await pool.query(
      `SELECT id, public_name, legal_name, slug, description, causes, logo_url, website, contact_email,
              suburb, state, postcode, verification_status, charity_status, dgr_status, abn
       FROM kutumb_organisations WHERE slug = $1 AND is_active = TRUE AND public_profile_enabled = TRUE
         AND verification_status = 'approved'`, [req.params.slug]
    );
    if (!rows[0]) return res.status(404).json({ message: "Charity profile not found" });
    const organisation = rows[0];
    const { rows: events } = await pool.query(
      `SELECT id, title, date_text, time_text, location, description
       FROM kutumb_upcoming_events WHERE organisation_id = $1 AND published = TRUE AND is_active = TRUE
       ORDER BY id DESC LIMIT 20`, [organisation.id]
    );
    const { rows: campaigns } = await pool.query(
      `SELECT c.id,c.slug,c.title,c.description,c.story,c.image_url,c.goal_amount,c.currency,c.fundraising_url,c.internal_giving_enabled,
         (SELECT COALESCE(sum(d.amount),0)::numeric(12,2) FROM kutumb_donations d WHERE d.campaign_id=c.id AND lower(d.payment_status)='paid') AS raised_amount
       FROM kutumb_organisation_campaigns c WHERE c.organisation_id=$1 AND c.status='published' ORDER BY c.created_at DESC LIMIT 20`, [organisation.id]
    );
    const [store, memberships] = await Promise.all([
      pool.query("SELECT EXISTS(SELECT 1 FROM kutumb_store_products WHERE organisation_id=$1 AND status='published' AND stock_on_hand>stock_reserved) available", [organisation.id]),
      pool.query("SELECT EXISTS(SELECT 1 FROM kutumb_membership_tiers WHERE organisation_id=$1 AND status='published') available", [organisation.id]),
    ]);
    res.json({ organisation, events: events.map((event) => ({ ...event, event_slug: slugify(event.title) })), campaigns,
      fundraisingTools: { store: store.rows[0].available, memberships: memberships.rows[0].available },
      actions: { donate: organisation.website || null, fundraise: "/host", volunteer: organisation.contact_email ? `mailto:${organisation.contact_email}` : null } });
  } catch (error) {
    console.error("PUBLIC CHARITY PROFILE ERROR:", error);
    res.status(500).json({ message: "Could not load this charity profile" });
  }
});

// Public volunteer interest is limited to a currently published event owned by
// an approved, public charity. Accessibility notes are private to event staff.
router.post("/public/events/:eventId/volunteers", async (req, res) => {
  if (!isFeatureEnabled("organisations")) return res.status(404).json({ message: "Volunteer sign-up is unavailable" });
  const eventId = Number(req.params.eventId);
  const name = String(req.body?.name || "").trim().slice(0, 120);
  const email = String(req.body?.email || "").trim().toLowerCase().slice(0, 254);
  const phone = String(req.body?.phone || "").trim().slice(0, 40);
  const skills = Array.isArray(req.body?.skills) ? req.body.skills.map((s) => String(s).trim().slice(0, 50)).filter(Boolean).slice(0, 20) : [];
  const availability = String(req.body?.availability || "").trim().slice(0, 500);
  const accessibilityNotes = String(req.body?.accessibilityNotes || "").trim().slice(0, 1000);
  if (!Number.isInteger(eventId) || name.length < 2 || !/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ message: "Enter your name and a valid email address." });
  try {
    const { rows: events } = await pool.query(`SELECT e.id,e.organisation_id FROM kutumb_upcoming_events e JOIN kutumb_organisations o ON o.id=e.organisation_id WHERE e.id=$1 AND e.is_active=TRUE AND e.published=TRUE AND o.is_active=TRUE AND o.public_profile_enabled=TRUE AND o.verification_status='approved'`, [eventId]);
    if (!events[0]) return res.status(404).json({ message: "This event is not accepting volunteer interest" });
    const { rows } = await pool.query(`INSERT INTO kutumb_volunteer_applications (organisation_id,event_id,name,email,phone,skills,availability,accessibility_notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,status`, [events[0].organisation_id,eventId,name,email,phone||null,skills,availability||null,accessibilityNotes||null]);
    res.status(201).json({ id: rows[0].id, status: rows[0].status, message: "Thanks. The event team will follow up with you." });
  } catch (error) { console.error("VOLUNTEER SIGNUP ERROR:", error); res.status(500).json({ message: "Could not send your volunteer interest" }); }
});

router.post("/onboarding/start", async (req, res) => {
  if (!isFeatureEnabled("organisations")) return res.status(404).json({ message: "Charity onboarding is currently unavailable" });
  const firstName = String(req.body?.firstName || "").trim();
  const lastName = String(req.body?.lastName || "").trim();
  const name = `${firstName} ${lastName}`.trim();
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");
  const mobile = String(req.body?.mobile || "").trim();
  const region = String(req.body?.region || "").trim();
  const state = String(req.body?.state || "").trim();
  const publicName = String(req.body?.organisationName || "").trim();
  const legalName = String(req.body?.legalName || "").trim();
  const abn = String(req.body?.abn || "").replace(/\s/g, "");
  const acceptedTerms = req.body?.acceptedTerms === true;
  const missing = [];
  if (!firstName) missing.push("first name");
  if (!lastName) missing.push("last name");
  if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 254) missing.push("a valid email address");
  if (!/^\+?[0-9 ()-]{8,20}$/.test(mobile)) missing.push("a valid mobile number");
  if (!region) missing.push("region");
  if (!state) missing.push("state");
  if (publicName.length < 2) missing.push("company / organisation name");
  if (legalName.length < 2) missing.push("legal name");
  if (!/^\d{11}$/.test(abn)) missing.push("a valid 11-digit ABN");
  if (password.length < 12) missing.push("a password of at least 12 characters");
  if (name.length > 100 || region.length > 100 || state.length > 100) missing.push("shorter name, region and state values");
  if (missing.length) return res.status(400).json({ message: `Please provide: ${missing.join(", ")}.` });
  if (!acceptedTerms) return res.status(400).json({ message: "You must accept the terms and conditions and privacy policy to continue." });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: existing } = await client.query("SELECT id FROM kutumb_admin_users WHERE lower(email)=lower($1) FOR UPDATE", [email]);
    if (existing[0]) { await client.query("ROLLBACK"); return res.status(409).json({ message: "An account already uses this email. Sign in to continue or use another email." }); }
    const { rows: userRows } = await client.query(
      `INSERT INTO kutumb_admin_users (email,password_hash,name,role) VALUES ($1,$2,$3,'organisation_user') RETURNING id,email,name,role`,
      [email, await bcrypt.hash(password, 10), name]
    );
    const slugBase = slugify(publicName).slice(0, 90) || "organisation";
    const { rows: slugs } = await client.query("SELECT slug FROM kutumb_organisations WHERE slug LIKE $1", [`${slugBase}%`]);
    const taken = new Set(slugs.map((row) => row.slug));
    let slug = slugBase; let suffix = 2;
    while (taken.has(slug)) slug = `${slugBase}-${suffix++}`;
    const { rows: orgRows } = await client.query(
      `INSERT INTO kutumb_organisations (public_name,legal_name,slug,abn,contact_email,contact_phone,region,state,applicant_first_name,applicant_last_name,terms_accepted_at,created_by_admin_id,verification_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now(),$11,'draft') RETURNING id,legal_name,slug,verification_status`,
      [publicName, legalName, slug, abn, email, mobile, region, state, firstName, lastName, userRows[0].id]
    );
    await client.query("INSERT INTO kutumb_organisation_users (organisation_id,admin_user_id,role) VALUES ($1,$2,'owner')", [orgRows[0].id, userRows[0].id]);
    await client.query(`INSERT INTO kutumb_organisation_verification_history (organisation_id,actor_admin_id,actor_email,from_status,to_status,note) VALUES ($1,$2,$3,NULL,'draft','Onboarding application started.')`, [orgRows[0].id, userRows[0].id, email]);
    await client.query("COMMIT");
    const session = signAdminToken(userRows[0]);
    res.cookie(ADMIN_COOKIE_NAME, session, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 12 * 60 * 60 * 1000 });
    res.status(201).json({ organisation: orgRows[0], message: "Your draft is ready. Continue the guided profile steps." });
  } catch (error) {
    await client.query("ROLLBACK");
    if (error.code === "23505") return res.status(409).json({ message: "An account or organisation with those details already exists." });
    console.error("PUBLIC ONBOARDING START ERROR:", error);
    res.status(500).json({ message: "Could not start charity onboarding" });
  } finally { client.release(); }
});

// Keep the published profile public, while all subsequent onboarding,
// verification-console and supporter-management routes require a real session.
router.use((req, res, next) => {
  if (!isFeatureEnabled("organisations")) return res.status(404).json({ message: "Organisation features are currently unavailable" });
  next();
}, authenticateAdminIdentity);

// Charity balances are liabilities tracked against the single Kutumb payment
// account. Only platform admins can record an actual manual bank transfer.
router.get("/platform/settlements", platformOnly, async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT o.id organisation_id,o.legal_name,o.public_name,
        COALESCE(sum(l.amount) FILTER (WHERE l.entry_type IN ('ticket_payment','donation_payment','store_payment','auction_payment','membership_payment')),0)::numeric(14,2) gross_receipts,
        abs(COALESCE(sum(l.amount) FILTER (WHERE l.entry_type IN ('ticket_refund','donation_refund','store_refund','auction_refund','membership_refund')),0))::numeric(14,2) refunds,
        abs(COALESCE(sum(l.amount) FILTER (WHERE l.entry_type='processor_fee'),0))::numeric(14,2) fees,
        abs(COALESCE(sum(l.amount) FILTER (WHERE l.entry_type='manual_transfer'),0))::numeric(14,2) transferred,
        COALESCE(sum(l.amount),0)::numeric(14,2) outstanding
      FROM kutumb_organisations o LEFT JOIN kutumb_settlement_ledger l ON l.organisation_id=o.id
      GROUP BY o.id ORDER BY o.legal_name`);
    res.json(rows);
  } catch (error) { console.error("PLATFORM SETTLEMENT LIST ERROR:", error); res.status(500).json({ message: "Could not load charity balances" }); }
});

router.get("/platform/settlements/:organisationId", platformOnly, async (req, res) => {
  const id = Number(req.params.organisationId);
  if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ message: "Invalid organisation" });
  try {
    const [{ rows: org }, { rows: entries }] = await Promise.all([
      pool.query("SELECT id,legal_name,public_name FROM kutumb_organisations WHERE id=$1", [id]),
      pool.query(`SELECT l.id,l.entry_type,l.amount,l.source_type,l.source_id,l.provider_reference,l.note,l.created_at,l.recorded_by_admin_id,u.email recorded_by,
         t.transferred_at,t.bank_reference,t.recipient_note
        FROM kutumb_settlement_ledger l LEFT JOIN kutumb_admin_users u ON u.id=l.recorded_by_admin_id
        LEFT JOIN kutumb_charity_transfers t ON l.source_type='manual_transfer' AND t.id::text=l.source_id
        WHERE l.organisation_id=$1 ORDER BY l.created_at DESC LIMIT 1000`, [id]),
    ]);
    if (!org[0]) return res.status(404).json({ message: "Organisation not found" });
    const total = entries.reduce((sum, entry) => sum + Number(entry.amount), 0);
    res.json({ organisation: org[0], outstanding: total.toFixed(2), entries });
  } catch (error) { console.error("PLATFORM SETTLEMENT DETAIL ERROR:", error); res.status(500).json({ message: "Could not load settlement history" }); }
});

router.post("/platform/settlements/:organisationId/transfers", platformOnly, async (req, res) => {
  const id = Number(req.params.organisationId);
  const amount = Number(req.body?.amount);
  const bankReference = String(req.body?.bankReference || "").trim().slice(0, 160);
  const recipientNote = String(req.body?.recipientNote || "").trim().slice(0, 500) || null;
  const transferredAt = String(req.body?.transferredAt || "").trim();
  if (!Number.isSafeInteger(id) || id < 1 || !Number.isFinite(amount) || amount <= 0 || !bankReference || (transferredAt && !/^\d{4}-\d{2}-\d{2}$/.test(transferredAt))) {
    return res.status(400).json({ message: "Enter a valid amount, transfer date and bank reference" });
  }
  const rounded = Math.round(amount * 100) / 100;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const org = await client.query("SELECT id FROM kutumb_organisations WHERE id=$1 AND is_active=TRUE FOR UPDATE", [id]);
    if (!org.rows[0]) { await client.query("ROLLBACK"); return res.status(404).json({ message: "Organisation not found" }); }
    const balance = await client.query("SELECT COALESCE(sum(amount),0)::numeric(14,2) outstanding FROM kutumb_settlement_ledger WHERE organisation_id=$1", [id]);
    const outstanding = Number(balance.rows[0].outstanding);
    if (rounded > outstanding + 0.0001) { await client.query("ROLLBACK"); return res.status(409).json({ message: `Transfer exceeds the available balance of $${Math.max(0,outstanding).toFixed(2)} AUD` }); }
    const transfer = await client.query(`INSERT INTO kutumb_charity_transfers(organisation_id,amount,transferred_at,bank_reference,recipient_note,recorded_by_admin_id)
      VALUES($1,$2,COALESCE($3::date,CURRENT_DATE),$4,$5,$6) RETURNING *`, [id, rounded, transferredAt || null, bankReference, recipientNote, req.admin.id]);
    const t = transfer.rows[0];
    await client.query(`INSERT INTO kutumb_settlement_ledger(organisation_id,entry_type,amount,source_type,source_id,provider_reference,note,recorded_by_admin_id)
      VALUES($1,'manual_transfer',$2,'manual_transfer',$3,$4,$5,$6)`, [id,-rounded,String(t.id),bankReference,recipientNote || "Manual charity transfer recorded",req.admin.id]);
    await client.query(`INSERT INTO kutumb_audit_log(admin_user_id,admin_email,action,entity,details,organisation_id)
      VALUES($1,$2,'settlement.manual_transfer', $3, $4, $5)`, [req.admin.id,req.admin.email,String(t.id),JSON.stringify({ amount: rounded, bankReference, transferredAt: t.transferred_at }),id]);
    await client.query("COMMIT");
    res.status(201).json({ transfer: t, outstanding: (outstanding-rounded).toFixed(2) });
  } catch (error) { await client.query("ROLLBACK").catch(()=>{}); console.error("MANUAL CHARITY TRANSFER ERROR:", error); res.status(500).json({ message: "Could not record the transfer" }); }
  finally { client.release(); }
});

router.get("/:organisationId/settlement", loadOrganisation, requireOrgPermission("finance.view"), async (req, res) => {
  try {
    const [{ rows: totals }, { rows: entries }] = await Promise.all([
      pool.query(`SELECT COALESCE(sum(amount) FILTER (WHERE entry_type IN ('ticket_payment','donation_payment','store_payment','auction_payment','membership_payment')),0)::numeric(14,2) gross_receipts,
        abs(COALESCE(sum(amount) FILTER (WHERE entry_type IN ('ticket_refund','donation_refund','store_refund','auction_refund','membership_refund')),0))::numeric(14,2) refunds,
        abs(COALESCE(sum(amount) FILTER (WHERE entry_type='manual_transfer'),0))::numeric(14,2) transferred,
        COALESCE(sum(amount),0)::numeric(14,2) outstanding FROM kutumb_settlement_ledger WHERE organisation_id=$1`, [req.organisation.id]),
      pool.query("SELECT entry_type,amount,provider_reference,note,created_at FROM kutumb_settlement_ledger WHERE organisation_id=$1 ORDER BY created_at DESC LIMIT 100", [req.organisation.id]),
    ]);
    res.json({ ...totals[0], entries });
  } catch (error) { console.error("ORGANISATION SETTLEMENT ERROR:", error); res.status(500).json({ message: "Could not load settlement summary" }); }
});

router.get("/verification/queue", platformOnly, async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT o.id, o.legal_name, o.slug, o.abn, o.contact_email, o.state, o.verification_status,
              o.charity_status, o.dgr_status, o.onboarding_submitted_at, o.created_at,
              (SELECT count(*)::int FROM kutumb_organisation_verification_documents d WHERE d.organisation_id=o.id) AS document_count
       FROM kutumb_organisations o WHERE o.verification_status IN ('submitted','under_review','needs_information','verified','rejected','approved','suspended')
       ORDER BY o.onboarding_submitted_at NULLS LAST, o.updated_at DESC`);
    res.json(rows);
  } catch (error) {
    console.error("VERIFICATION QUEUE ERROR:", error);
    res.status(500).json({ message: "Could not load the verification queue" });
  }
});

router.post("/verification/:organisationId/decision", platformOnly, async (req, res) => {
  const organisationId = Number(req.params.organisationId);
  const status = String(req.body?.status || "");
  const note = String(req.body?.note || "").trim();
  const allowed = ["under_review", "needs_information", "verified", "approved", "rejected", "suspended"];
  if (!Number.isSafeInteger(organisationId) || organisationId < 1) return res.status(400).json({ message: "Invalid organisation" });
  if (!allowed.includes(status)) return res.status(400).json({ message: "Choose a valid verification action" });
  if (note.length < 3 || note.length > 2000) return res.status(400).json({ message: "Add a short note for the charity and audit trail" });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query("SELECT verification_status, slug FROM kutumb_organisations WHERE id=$1 FOR UPDATE", [organisationId]);
    if (!rows[0]) { await client.query("ROLLBACK"); return res.status(404).json({ message: "Organisation not found" }); }
    const previous = rows[0].verification_status;
    await client.query(
      `UPDATE kutumb_organisations SET verification_status=$1, is_verified=($1 IN ('verified','approved')),
       public_profile_enabled=($1='approved'), updated_at=now() WHERE id=$2`, [status, organisationId]
    );
    await client.query(
      `INSERT INTO kutumb_organisation_verification_history (organisation_id,actor_admin_id,actor_email,from_status,to_status,note)
       VALUES ($1,$2,$3,$4,$5,$6)`, [organisationId, req.admin.id, req.admin.email, previous, status, note]
    );
    await client.query(
      `INSERT INTO kutumb_audit_log (admin_user_id,admin_email,action,entity,details,organisation_id)
       VALUES ($1,$2,'organisation.verification.decision',$3,$4,$5)`,
      [req.admin.id, req.admin.email, rows[0].slug, JSON.stringify({ from: previous, to: status, note }), organisationId]
    );
    await client.query("COMMIT");
    res.json({ organisationId, status, note });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("VERIFICATION DECISION ERROR:", error);
    res.status(500).json({ message: "Could not save this verification decision" });
  } finally { client.release(); }
});

router.get("/:organisationId/onboarding", loadOrganisation, requireOrgPermission("profile.manage"), async (req, res) => {
  try {
    const org = req.organisation;
    const fields = [org.public_name, org.legal_name, org.abn, org.contact_email, org.description, org.causes?.length, org.website, org.address_line1, org.suburb, org.state, org.postcode];
    const completed = fields.filter(Boolean).length;
    const [{ rows: history }, { rows: documents }] = await Promise.all([
      pool.query(`SELECT id, actor_email, from_status, to_status, note, created_at FROM kutumb_organisation_verification_history WHERE organisation_id=$1 ORDER BY created_at DESC LIMIT 30`, [org.id]),
      pool.query(`SELECT id, label, document_url, created_at FROM kutumb_organisation_verification_documents WHERE organisation_id=$1 ORDER BY created_at DESC`, [org.id]),
    ]);
    res.json({ status: org.verification_status, completedSteps: completed, totalSteps: fields.length, history, documents,
      governmentStatus: { charity: org.charity_status, dgr: org.dgr_status, acncNumber: org.acnc_registration_number } });
  } catch (error) {
    console.error("ONBOARDING STATUS ERROR:", error);
    res.status(500).json({ message: "Could not load onboarding progress" });
  }
});

router.post("/:organisationId/onboarding/submit", loadOrganisation, requireOrgPermission("profile.manage"), async (req, res) => {
  const org = req.organisation;
  if (!["draft", "needs_information", "rejected"].includes(org.verification_status)) return res.status(409).json({ message: "This application is already in review or approved. Contact the platform team if you need help." });
  const missing = [];
    if (!org.public_name?.trim()) missing.push("organisation name");
  if (!org.legal_name?.trim()) missing.push("legal name");
  if (!/^\d{11}$/.test(String(org.abn || "").replace(/\s/g, ""))) missing.push("11-digit ABN");
  if (!/^\S+@\S+\.\S+$/.test(org.contact_email || "")) missing.push("contact email");
  if (!org.description?.trim()) missing.push("description");
  if (!org.causes?.length) missing.push("at least one cause area");
  if (!org.suburb || !org.state || !/^\d{4}$/.test(org.postcode || "")) missing.push("Australian address, state and postcode");
  if (missing.length) return res.status(400).json({ message: `Complete these details before submitting: ${missing.join(", ")}.` });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`UPDATE kutumb_organisations SET verification_status='submitted', onboarding_submitted_at=now(), updated_at=now() WHERE id=$1`, [org.id]);
    await client.query(`INSERT INTO kutumb_organisation_verification_history (organisation_id,actor_admin_id,actor_email,from_status,to_status,note) VALUES ($1,$2,$3,$4,'submitted','Charity submitted its onboarding details for review.')`, [org.id, req.admin.id, req.admin.email, org.verification_status]);
    await client.query(`INSERT INTO kutumb_audit_log (admin_user_id,admin_email,action,entity,details,organisation_id) VALUES ($1,$2,'organisation.onboarding.submit',$3,'{}',$4)`, [req.admin.id, req.admin.email, org.slug, org.id]);
    await client.query("COMMIT");
    res.json({ status: "submitted", message: "Your details are submitted. We’ll review them and contact you if we need anything else." });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("ONBOARDING SUBMIT ERROR:", error);
    res.status(500).json({ message: "Could not submit onboarding" });
  } finally { client.release(); }
});

router.post("/:organisationId/onboarding/documents", loadOrganisation, requireOrgPermission("profile.manage"), async (req, res) => {
  const label = String(req.body?.label || "").trim();
  const documentUrl = String(req.body?.documentUrl || "").trim();
  if (label.length < 2 || label.length > 120) return res.status(400).json({ message: "Add a short document label" });
  let parsed;
  try { parsed = new URL(documentUrl); } catch { return res.status(400).json({ message: "Enter a valid secure document link" }); }
  if (parsed.protocol !== "https:") return res.status(400).json({ message: "Document links must use HTTPS" });
  try {
    const { rows } = await pool.query(`INSERT INTO kutumb_organisation_verification_documents (organisation_id,uploaded_by_admin_id,label,document_url) VALUES ($1,$2,$3,$4) RETURNING id,label,document_url,created_at`, [req.organisation.id, req.admin.id, label, parsed.toString()]);
    await recordOrgAudit(req.admin, req.organisation.id, "organisation.verification.document.add", String(rows[0].id), { label });
    res.status(201).json(rows[0]);
  } catch (error) {
    console.error("VERIFICATION DOCUMENT ERROR:", error);
    res.status(500).json({ message: "Could not save the document link" });
  }
});

router.get("/verification/:organisationId/details", platformOnly, async (req, res) => {
  const id = Number(req.params.organisationId);
  if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ message: "Invalid organisation" });
  try {
    const [{ rows: org }, { rows: history }, { rows: documents }] = await Promise.all([
      pool.query("SELECT * FROM kutumb_organisations WHERE id=$1", [id]),
      pool.query("SELECT * FROM kutumb_organisation_verification_history WHERE organisation_id=$1 ORDER BY created_at DESC", [id]),
      pool.query("SELECT id,label,document_url,created_at FROM kutumb_organisation_verification_documents WHERE organisation_id=$1 ORDER BY created_at DESC", [id]),
    ]);
    if (!org[0]) return res.status(404).json({ message: "Organisation not found" });
    res.json({ organisation: org[0], history, documents });
  } catch (error) {
    console.error("VERIFICATION DETAILS ERROR:", error);
    res.status(500).json({ message: "Could not load verification details" });
  }
});

router.get("/:organisationId/supporters", loadOrganisation, requireOrgPermission("supporters.view"), async (req, res) => {
  const search = String(req.query.search || "").trim().slice(0, 100);
  try {
    const { rows } = await pool.query(
      `SELECT s.id,s.display_name,s.email,s.phone,s.source,s.created_at,
        (SELECT count(*)::int FROM kutumb_donations d WHERE d.supporter_id=s.id AND d.organisation_id=s.organisation_id) AS donation_count,
        (SELECT COALESCE(sum(d.amount),0)::numeric(12,2) FROM kutumb_donations d WHERE d.supporter_id=s.id AND d.organisation_id=s.organisation_id AND lower(d.payment_status) IN ('paid','completed','succeeded')) AS donated_total,
        (SELECT count(*)::int FROM kutumb_attendees a WHERE a.supporter_id=s.id AND a.organisation_id=s.organisation_id) AS ticket_count
       FROM kutumb_supporters s WHERE s.organisation_id=$1 AND s.merged_into_id IS NULL
         AND ($2='' OR s.display_name ILIKE '%'||$2||'%' OR s.email ILIKE '%'||$2||'%')
       ORDER BY lower(s.display_name) LIMIT 100`, [req.organisation.id, search]);
    res.json(rows);
  } catch (error) {
    console.error("SUPPORTER LIST ERROR:", error);
    res.status(500).json({ message: "Could not load supporters" });
  }
});

router.get("/:organisationId/supporters/:supporterId", loadOrganisation, requireOrgPermission("supporters.view"), async (req, res) => {
  const supporterId = Number(req.params.supporterId);
  if (!Number.isSafeInteger(supporterId) || supporterId < 1) return res.status(400).json({ message: "Invalid supporter" });
  try {
    const { rows } = await pool.query("SELECT id,display_name,email,phone,source,email_opt_out,sms_opt_out,created_at FROM kutumb_supporters WHERE id=$1 AND organisation_id=$2 AND merged_into_id IS NULL", [supporterId, req.organisation.id]);
    if (!rows[0]) return res.status(404).json({ message: "Supporter not found" });
    const orgId = req.organisation.id;
    const [donations, registrations, tickets, activities, memberRows] = await Promise.all([
      pool.query("SELECT id,amount,payment_status,created_at FROM kutumb_donations WHERE supporter_id=$1 AND organisation_id=$2 ORDER BY created_at DESC LIMIT 100", [supporterId, orgId]),
      pool.query("SELECT id,event_name,event_year,payment_status,created_at FROM kutumb_event_registrations WHERE supporter_id=$1 AND organisation_id=$2 ORDER BY created_at DESC LIMIT 100", [supporterId, orgId]),
      pool.query("SELECT a.id,a.event_id,a.checked_in_at,o.created_at FROM kutumb_attendees a JOIN kutumb_order_items oi ON oi.id=a.order_item_id JOIN kutumb_orders o ON o.id=oi.order_id WHERE a.supporter_id=$1 AND a.organisation_id=$2 ORDER BY o.created_at DESC LIMIT 100", [supporterId, orgId]),
      pool.query("SELECT id,activity_title,created_at FROM kutumb_activity_registrations WHERE supporter_id=$1 AND organisation_id=$2 ORDER BY created_at DESC LIMIT 100", [supporterId, orgId]),
      pool.query("SELECT id,membership_number,created_at FROM kutumb_members WHERE supporter_id=$1 AND organisation_id=$2 ORDER BY created_at DESC LIMIT 20", [supporterId, orgId]),
    ]);
    const timeline = [
      ...donations.rows.map((row) => ({ type: "donation", ...row })),
      ...registrations.rows.map((row) => ({ type: "event_registration", ...row })),
      ...tickets.rows.map((row) => ({ type: row.checked_in_at ? "event_attendance" : "ticket", ...row })),
      ...activities.rows.map((row) => ({ type: "activity", ...row })),
      ...memberRows.rows.map((row) => ({ type: "membership", ...row })),
    ].sort((a,b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    res.json({ supporter: rows[0], summary: { donations: donations.rows.length, registrations: registrations.rows.length, tickets: tickets.rows.length }, timeline });
  } catch (error) {
    console.error("SUPPORTER TIMELINE ERROR:", error);
    res.status(500).json({ message: "Could not load this supporter timeline" });
  }
});

router.post("/:organisationId/supporters/:supporterId/merge", loadOrganisation, requireOrgPermission("supporters.manage"), async (req, res) => {
  const sourceId = Number(req.params.supporterId);
  const targetId = Number(req.body?.targetSupporterId);
  if (!Number.isSafeInteger(sourceId) || !Number.isSafeInteger(targetId) || sourceId < 1 || targetId < 1 || sourceId === targetId) return res.status(400).json({ message: "Choose two different supporter profiles" });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query("SELECT id FROM kutumb_supporters WHERE organisation_id=$1 AND id=ANY($2::bigint[]) AND merged_into_id IS NULL ORDER BY id FOR UPDATE", [req.organisation.id, [sourceId,targetId]]);
    if (rows.length !== 2) { await client.query("ROLLBACK"); return res.status(404).json({ message: "Both supporter profiles must belong to this organisation and be active" }); }
    for (const table of ["kutumb_members","kutumb_event_registrations","kutumb_donations","kutumb_orders","kutumb_attendees","kutumb_activity_registrations"]) {
      await client.query(`UPDATE ${table} SET supporter_id=$1 WHERE supporter_id=$2 AND organisation_id=$3`, [targetId, sourceId, req.organisation.id]);
    }
    await client.query("UPDATE kutumb_supporters SET merged_into_id=$1, updated_at=now() WHERE id=$2 AND organisation_id=$3", [targetId, sourceId, req.organisation.id]);
    await client.query("INSERT INTO kutumb_supporter_merge_log (organisation_id,source_supporter_id,target_supporter_id,merged_by_admin_id,details) VALUES ($1,$2,$3,$4,$5)", [req.organisation.id, sourceId, targetId, req.admin.id, JSON.stringify({ preservedSource: true })]);
    await client.query("INSERT INTO kutumb_audit_log (admin_user_id,admin_email,action,entity,details,organisation_id) VALUES ($1,$2,'supporter.merge',$3,$4,$5)", [req.admin.id, req.admin.email, String(sourceId), JSON.stringify({ targetId }), req.organisation.id]);
    await client.query("COMMIT");
    res.json({ message: "Profiles merged. Financial and attendance records are retained on the remaining profile." });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("SUPPORTER MERGE ERROR:", error);
    res.status(500).json({ message: "Could not merge these profiles" });
  } finally { client.release(); }
});

function isPlatformAdmin(admin) {
  return admin.role === "superadmin" || admin.role === "platform_admin";
}

async function recordOrgAudit(admin, orgId, action, entity, details = {}) {
  await pool.query(
    `INSERT INTO kutumb_audit_log (admin_user_id, admin_email, action, entity, details, organisation_id)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [admin.id, admin.email, action, entity, JSON.stringify(details), orgId]
  );
}

async function loadOrganisation(req, res, next) {
  try {
    const orgId = Number(req.params.organisationId);
    if (!Number.isSafeInteger(orgId) || orgId < 1) return res.status(400).json({ message: "Invalid organisation" });
    const selected = req.get("x-organisation-id");
    if (selected && Number(selected) !== orgId) return res.status(403).json({ message: "The selected organisation does not match this request" });

    const { rows: organisations } = await pool.query(
      "SELECT * FROM kutumb_organisations WHERE id = $1 AND is_active = TRUE",
      [orgId]
    );
    if (!organisations[0]) return res.status(404).json({ message: "Organisation not found" });

    if (isPlatformAdmin(req.admin)) {
      req.organisation = organisations[0];
      req.organisationRole = "platform_admin";
    } else {
      const { rows } = await pool.query(
        `SELECT organisation_id, admin_user_id, role, is_active FROM kutumb_organisation_users
         WHERE organisation_id = $1 AND admin_user_id = $2 AND is_active = TRUE`,
        [orgId, req.admin.id]
      );
      if (!membershipMatchesScope(rows[0], orgId, req.admin.id)) return res.status(403).json({ message: "You do not belong to this organisation" });
      req.organisation = organisations[0];
      req.organisationRole = rows[0].role;
    }
    next();
  } catch (error) {
    console.error("ORGANISATION ACCESS ERROR:", error);
    res.status(500).json({ message: "Could not verify organisation access" });
  }
}

function requireOrgPermission(permission) {
  return (req, res, next) => hasOrganisationPermission(req.organisationRole, permission)
    ? next()
    : res.status(403).json({ message: "Your organisation role does not allow this action" });
}

router.get("/mine", async (req, res) => {
  try {
    if (isPlatformAdmin(req.admin)) {
      const { rows } = await pool.query("SELECT o.*, 'platform_admin' AS role FROM kutumb_organisations o ORDER BY o.legal_name");
      return res.json(rows);
    }
    const { rows } = await pool.query(
      `SELECT o.*, ou.role FROM kutumb_organisations o
       JOIN kutumb_organisation_users ou ON ou.organisation_id = o.id
       WHERE ou.admin_user_id = $1 AND ou.is_active = TRUE AND o.is_active = TRUE
       ORDER BY o.legal_name`,
      [req.admin.id]
    );
    res.json(rows);
  } catch (error) {
    console.error("ORGANISATION LIST ERROR:", error);
    res.status(500).json({ message: "Could not load your organisations" });
  }
});

router.post("/", async (req, res) => {
  const legalName = String(req.body?.legalName || "").trim();
  if (legalName.length < 2 || legalName.length > 180) return res.status(400).json({ message: "Enter an organisation name (2–180 characters)" });
  const slugBase = slugify(legalName).slice(0, 90) || "organisation";
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: existing } = await client.query("SELECT slug FROM kutumb_organisations WHERE slug LIKE $1", [`${slugBase}%`]);
    const taken = new Set(existing.map((row) => row.slug));
    let slug = slugBase;
    let suffix = 2;
    while (taken.has(slug)) slug = `${slugBase}-${suffix++}`;
    const { rows } = await client.query(
      `INSERT INTO kutumb_organisations (legal_name, slug, created_by_admin_id)
       VALUES ($1,$2,$3) RETURNING *`,
      [legalName, slug, req.admin.id]
    );
    const organisation = rows[0];
    await client.query(
      `INSERT INTO kutumb_organisation_users (organisation_id, admin_user_id, role, invited_by_admin_id)
       VALUES ($1,$2,'owner',$2)`,
      [organisation.id, req.admin.id]
    );
    await client.query(
      `INSERT INTO kutumb_audit_log (admin_user_id, admin_email, action, entity, details, organisation_id)
       VALUES ($1,$2,'organisation.create',$3,$4,$5)`,
      [req.admin.id, req.admin.email, slug, JSON.stringify({ legalName }), organisation.id]
    );
    await client.query("COMMIT");
    res.status(201).json({ ...organisation, role: "owner" });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("ORGANISATION CREATE ERROR:", error);
    res.status(500).json({ message: "Could not create the organisation" });
  } finally {
    client.release();
  }
});

router.get("/:organisationId", loadOrganisation, (req, res) => {
  res.json({ ...req.organisation, role: req.organisationRole });
});

router.put("/:organisationId", loadOrganisation, requireOrgPermission("profile.manage"), async (req, res) => {
  const fields = PROFILE_FIELDS.filter((field) => Object.hasOwn(req.body || {}, field.replace(/_([a-z])/g, (_, char) => char.toUpperCase())));
  if (!fields.length) return res.status(400).json({ message: "No organisation details were provided" });
  const values = fields.map((field) => req.body[field.replace(/_([a-z])/g, (_, char) => char.toUpperCase())]);
  const sets = fields.map((field, index) => `${field} = $${index + 1}`);
  const charityStatus = req.body.charityStatus;
  const dgrStatus = req.body.dgrStatus;
  if (charityStatus && !["unverified", "registered", "not_registered", "pending"].includes(charityStatus)) {
    return res.status(400).json({ message: "Choose a valid charity status" });
  }
  if (dgrStatus && !["unknown", "endorsed", "not_endorsed", "pending"].includes(dgrStatus)) {
    return res.status(400).json({ message: "Choose a valid DGR status" });
  }
  for (let index = 0; index < fields.length; index += 1) {
    if (fields[index] === "causes" && typeof values[index] === "string") {
      values[index] = values[index].split(",").map((item) => item.trim()).filter(Boolean);
    }
    if (fields[index] === "abn" && values[index]) {
      const abn = String(values[index]).replace(/\s/g, "");
      if (!/^\d{11}$/.test(abn)) return res.status(400).json({ message: "An ABN must contain 11 digits" });
      values[index] = abn;
    }
    if (["website", "logo_url"].includes(fields[index]) && values[index]) {
      let url;
      try { url = new URL(String(values[index])); } catch { return res.status(400).json({ message: "Website and logo links must be valid HTTPS URLs" }); }
      if (url.protocol !== "https:") return res.status(400).json({ message: "Website and logo links must use HTTPS" });
      values[index] = url.toString();
    }
    if (["public_name", "legal_name"].includes(fields[index]) && String(values[index] || "").trim().length > 180) return res.status(400).json({ message: "Organisation names must be 180 characters or fewer" });
    if (fields[index] === "description" && String(values[index] || "").length > 4000) return res.status(400).json({ message: "Keep the mission description under 4,000 characters" });
  }
  try {
    const requiresReview = req.organisation.verification_status === "approved" && fields.some((field) => ["public_name", "legal_name", "abn", "causes", "description", "website", "contact_email"].includes(field));
    const assignments = [...sets];
    if (requiresReview) assignments.push("verification_status='submitted'", "is_verified=FALSE", "public_profile_enabled=FALSE", "onboarding_submitted_at=now()");
    const { rows } = await pool.query(
      `UPDATE kutumb_organisations SET ${assignments.join(", ")}, updated_at = now() WHERE id = $${fields.length + 1} RETURNING *`,
      [...values, req.organisation.id]
    );
    await recordOrgAudit(req.admin, req.organisation.id, "organisation.update", req.organisation.slug, { fields });
    if (requiresReview) await pool.query(
      `INSERT INTO kutumb_organisation_verification_history (organisation_id,actor_admin_id,actor_email,from_status,to_status,note) VALUES ($1,$2,$3,'approved','submitted','Material public profile details changed; platform re-review is required.')`,
      [req.organisation.id, req.admin.id, req.admin.email]
    );
    res.json({ ...rows[0], role: req.organisationRole });
  } catch (error) {
    console.error("ORGANISATION UPDATE ERROR:", error);
    res.status(500).json({ message: "Could not save organisation details" });
  }
});

router.get("/:organisationId/members", loadOrganisation, requireOrgPermission("members.view"), async (req, res) => {
  const { rows } = await pool.query(
    `SELECT u.id AS admin_user_id, u.email, u.name, ou.role, ou.is_active, ou.created_at
     FROM kutumb_organisation_users ou JOIN kutumb_admin_users u ON u.id = ou.admin_user_id
     WHERE ou.organisation_id = $1 AND ou.is_active = TRUE
     ORDER BY CASE ou.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, u.name`,
    [req.organisation.id]
  );
  res.json(rows);
});

router.post("/:organisationId/members", loadOrganisation, requireOrgPermission("members.manage"), async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const name = String(req.body?.name || "").trim();
  const password = String(req.body?.password || "");
  const role = String(req.body?.role || "read_only");
  if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ message: "Enter a valid email address" });
  if (name.length < 2 || name.length > 100) return res.status(400).json({ message: "Enter the person's name" });
  if (!isOrganisationRole(role)) return res.status(400).json({ message: "Choose a valid organisation role" });
  if (role === "owner" && req.organisationRole !== "owner" && !isPlatformAdmin(req.admin)) return res.status(403).json({ message: "Only an owner can assign the Owner role" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT id FROM kutumb_organisations WHERE id = $1 FOR UPDATE", [req.organisation.id]);
    const { rows: previousMembership } = await client.query(
      "SELECT role FROM kutumb_organisation_users WHERE organisation_id = $1 AND admin_user_id = (SELECT id FROM kutumb_admin_users WHERE email = $2) FOR UPDATE",
      [req.organisation.id, email]
    );
    if (previousMembership[0]?.role === "owner" && role !== "owner") {
      const { rows: ownerCount } = await client.query("SELECT count(*)::int AS count FROM kutumb_organisation_users WHERE organisation_id = $1 AND role = 'owner' AND is_active = TRUE", [req.organisation.id]);
      if (ownerCount[0].count <= 1) {
        await client.query("ROLLBACK");
        return res.status(409).json({ message: "Assign another owner before changing the last owner's role" });
      }
      if (req.organisationRole !== "owner" && !isPlatformAdmin(req.admin)) {
        await client.query("ROLLBACK");
        return res.status(403).json({ message: "Only an owner can change another owner's role" });
      }
    }
    const { rows: found } = await client.query("SELECT id, role FROM kutumb_admin_users WHERE email = $1 FOR UPDATE", [email]);
    let user = found[0];
    if (!user) {
      if (password.length < 10) {
        await client.query("ROLLBACK");
        return res.status(400).json({ message: "For a new login, use an initial password of at least 10 characters" });
      }
      const passwordHash = await bcrypt.hash(password, 10);
      const inserted = await client.query(
        `INSERT INTO kutumb_admin_users (email, password_hash, name, role)
         VALUES ($1,$2,$3,'organisation_user') RETURNING id, role`,
        [email, passwordHash, name]
      );
      user = inserted.rows[0];
    } else if (user.role !== "organisation_user") {
      await client.query("ROLLBACK");
      return res.status(409).json({ message: "This email already has Kutumb platform access. Use a separate organisation account to keep access scoped." });
    } else if (!previousMembership[0] && !isPlatformAdmin(req.admin)) {
      await client.query("ROLLBACK");
      return res.status(409).json({ message: "This login already exists. Ask a platform administrator to connect it to another organisation." });
    }
    const membership = await client.query(
      `INSERT INTO kutumb_organisation_users (organisation_id, admin_user_id, role, invited_by_admin_id)
       VALUES ($1,$2,$3,$4) ON CONFLICT (organisation_id, admin_user_id) DO UPDATE
       SET role = EXCLUDED.role, is_active = TRUE, updated_at = now()
       RETURNING organisation_id, admin_user_id, role, is_active, created_at`,
      [req.organisation.id, user.id, role, req.admin.id]
    );
    await client.query(
      `INSERT INTO kutumb_audit_log (admin_user_id, admin_email, action, entity, details, organisation_id)
       VALUES ($1,$2,'organisation.member.assign',$3,$4,$5)`,
      [req.admin.id, req.admin.email, String(user.id), JSON.stringify({ email, role }), req.organisation.id]
    );
    await client.query("COMMIT");
    res.status(201).json({ ...membership.rows[0], email, name });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("ORGANISATION MEMBER ASSIGN ERROR:", error);
    res.status(500).json({ message: "Could not assign this organisation role" });
  } finally {
    client.release();
  }
});

router.delete("/:organisationId/members/:adminUserId", loadOrganisation, requireOrgPermission("members.manage"), async (req, res) => {
  const userId = Number(req.params.adminUserId);
  if (!Number.isSafeInteger(userId) || userId < 1) return res.status(400).json({ message: "Invalid user" });
  if (userId === Number(req.admin.id) && req.organisationRole === "owner") return res.status(400).json({ message: "Assign another owner before removing yourself" });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT id FROM kutumb_organisations WHERE id = $1 FOR UPDATE", [req.organisation.id]);
    const { rows: targetRows } = await client.query(
      "SELECT role FROM kutumb_organisation_users WHERE organisation_id = $1 AND admin_user_id = $2 AND is_active = TRUE FOR UPDATE",
      [req.organisation.id, userId]
    );
    if (!targetRows[0]) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Organisation member not found" });
    }
    if (targetRows[0].role === "owner") {
      const { rows } = await client.query("SELECT count(*)::int AS count FROM kutumb_organisation_users WHERE organisation_id = $1 AND role = 'owner' AND is_active = TRUE", [req.organisation.id]);
      if (rows[0].count <= 1) {
        await client.query("ROLLBACK");
        return res.status(409).json({ message: "An organisation must keep at least one owner" });
      }
      if (req.organisationRole !== "owner" && !isPlatformAdmin(req.admin)) {
        await client.query("ROLLBACK");
        return res.status(403).json({ message: "Only an owner can remove another owner" });
      }
    }
    await client.query("UPDATE kutumb_organisation_users SET is_active = FALSE, updated_at = now() WHERE organisation_id = $1 AND admin_user_id = $2", [req.organisation.id, userId]);
    await client.query(
      `INSERT INTO kutumb_audit_log (admin_user_id, admin_email, action, entity, details, organisation_id)
       VALUES ($1,$2,'organisation.member.remove',$3,'{}',$4)`,
      [req.admin.id, req.admin.email, String(userId), req.organisation.id]
    );
    await client.query("COMMIT");
    res.json({ message: "Organisation access removed" });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("ORGANISATION MEMBER REMOVE ERROR:", error);
    res.status(500).json({ message: "Could not remove organisation access" });
  } finally {
    client.release();
  }
});

router.get("/:organisationId/events", loadOrganisation, requireOrgPermission("events.view"), async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, title, date_text, time_text, location, capacity, member_fee, non_member_fee,
            description, is_active, published, created_at
     FROM kutumb_upcoming_events WHERE organisation_id = $1 ORDER BY id DESC`,
    [req.organisation.id]
  );
  res.json(rows);
});

router.post("/:organisationId/event-draft-assist",loadOrganisation,requireOrgPermission("events.manage"),async(req,res)=>{
  const brief=String(req.body?.brief||"").trim();
  if(brief.length<10||brief.length>3000)return res.status(400).json({message:"Describe the event in 10–3,000 characters."});
  try{const draft=await generateEventDraft({brief,organisationName:req.organisation.public_name||req.organisation.legal_name});res.json({draft,message:"Review and edit this draft in the event wizard before saving or publishing."});}
  catch(error){res.status(503).json({message:error.message||"AI event drafting is not available"});}
});

router.get("/:organisationId/campaigns", loadOrganisation, requireOrgPermission("events.view"), async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT id,slug,title,description,story,image_url,goal_amount,fundraising_url,internal_giving_enabled,status,created_at FROM kutumb_organisation_campaigns WHERE organisation_id=$1 ORDER BY created_at DESC", [req.organisation.id]);
    res.json(rows);
  } catch (error) {
    console.error("ORGANISATION CAMPAIGN LIST ERROR:", error);
    res.status(500).json({ message: "Could not load campaigns" });
  }
});

router.post("/:organisationId/campaigns", loadOrganisation, requireOrgPermission("profile.manage"), async (req, res) => {
  const title = String(req.body?.title || "").trim();
  const description = String(req.body?.description || "").trim();
  const goal = req.body?.goalAmount === "" || req.body?.goalAmount == null ? null : Number(req.body.goalAmount);
  const fundraisingUrl = String(req.body?.fundraisingUrl || "").trim();
  const story = String(req.body?.story || "").trim();
  const imageUrl = String(req.body?.imageUrl || "").trim();
  const internalGivingEnabled = req.body?.internalGivingEnabled === true;
  const status = String(req.body?.status || "draft");
  let parsedUrl = null;
  if (fundraisingUrl) {
    try { parsedUrl = new URL(fundraisingUrl); } catch { return res.status(400).json({ message: "Enter a valid fundraising page link" }); }
    if (parsedUrl.protocol !== "https:") return res.status(400).json({ message: "Fundraising page links must use HTTPS" });
  }
  let parsedImage = null;
  if (imageUrl) { try { parsedImage = new URL(imageUrl); } catch { return res.status(400).json({ message: "Enter a valid campaign image link" }); } if (parsedImage.protocol !== "https:") return res.status(400).json({ message: "Campaign images must use HTTPS" }); }
  if (title.length < 3 || title.length > 180 || description.length > 3000) return res.status(400).json({ message: "Add a campaign title and a description under 3,000 characters" });
  if (goal !== null && (!Number.isFinite(goal) || goal < 0 || goal > 100000000)) return res.status(400).json({ message: "Enter a valid AUD fundraising goal" });
  if (!["draft", "published", "closed"].includes(status)) return res.status(400).json({ message: "Choose a valid campaign status" });
  if (story.length > 10000) return res.status(400).json({ message: "Campaign story must be 10,000 characters or fewer" });
  if (status === "published" && !parsedUrl && !internalGivingEnabled) return res.status(400).json({ message: "Enable KutumbLink donations or add a secure external fundraising link before publishing" });
  try {
    const campaignSlug = `${slugify(title)}-${req.organisation.id}`;
    const { rows } = await pool.query(`INSERT INTO kutumb_organisation_campaigns (organisation_id,title,slug,description,story,image_url,goal_amount,fundraising_url,internal_giving_enabled,status,created_by_admin_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id,slug,title,description,story,image_url,goal_amount,fundraising_url,internal_giving_enabled,status,created_at`, [req.organisation.id,title,campaignSlug,description || null,story || null,parsedImage?.toString() || null,goal,parsedUrl?.toString() || null,internalGivingEnabled,status,req.admin.id]);
    await recordOrgAudit(req.admin, req.organisation.id, "organisation.campaign.create", String(rows[0].id), { title, status });
    res.status(201).json(rows[0]);
  } catch (error) {
    console.error("ORGANISATION CAMPAIGN CREATE ERROR:", error);
    res.status(500).json({ message: "Could not save this campaign" });
  }
});

router.post("/:organisationId/events", loadOrganisation, requireOrgPermission("events.manage"), async (req, res) => {
  const title = String(req.body?.title || "").trim();
  const eventDate = String(req.body?.date || "").trim();
  const capacity = Math.max(0, Math.floor(Number(req.body?.capacity) || 0));
  const fee = Math.max(0, Number(req.body?.price) || 0);
  if (title.length < 3 || title.length > 180) return res.status(400).json({ message: "Enter an event name (3–180 characters)" });
  if (!eventDate || Number.isNaN(Date.parse(eventDate))) return res.status(400).json({ message: "Choose a valid event date" });
  if (!Number.isFinite(Number(req.body?.capacity || 0)) || !Number.isFinite(Number(req.body?.price || 0)) || Number(req.body?.price || 0) > 1000000) {
    return res.status(400).json({ message: "Enter a valid capacity and ticket price" });
  }
  const eventId = slugify(title);
  if (!eventId) return res.status(400).json({ message: "Event name must include letters or numbers" });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: allEvents } = await client.query("SELECT title FROM kutumb_upcoming_events");
    const { rows: existingTicketIds } = await client.query("SELECT DISTINCT event_id FROM kutumb_ticket_types");
    if (allEvents.some((event) => slugify(event.title) === eventId) || existingTicketIds.some((row) => row.event_id === eventId)) {
      await client.query("ROLLBACK");
      return res.status(409).json({ message: "An event with this name already exists. Choose a more specific name." });
    }
    const { rows } = await client.query(
      `INSERT INTO kutumb_upcoming_events
       (title, date_text, time_text, location, capacity, member_fee, non_member_fee, description, is_active, published, organisation_id)
       VALUES ($1,$2,$3,$4,$5,$6,$6,$7,TRUE,TRUE,$8) RETURNING *`,
      [title, eventDate, String(req.body?.time || "").trim() || null, String(req.body?.location || "").trim() || null,
        capacity, fee, String(req.body?.description || "").trim() || null, req.organisation.id]
    );
    await client.query(
      `INSERT INTO kutumb_ticket_types (event_id, name, description, price_cents, quantity_total, organisation_id)
       VALUES ($1,'General admission','Standard event entry',$2,$3,$4)`,
      [eventId, Math.round(fee * 100), capacity, req.organisation.id]
    );
    await client.query(
      `INSERT INTO kutumb_audit_log (admin_user_id, admin_email, action, entity, details, organisation_id)
       VALUES ($1,$2,'organisation.event.create',$3,$4,$5)`,
      [req.admin.id, req.admin.email, eventId, JSON.stringify({ title }), req.organisation.id]
    );
    await client.query("COMMIT");
    res.status(201).json(rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("ORGANISATION EVENT CREATE ERROR:", error);
    res.status(500).json({ message: "Could not create this event" });
  } finally {
    client.release();
  }
});

// Phase 6/7: organisation-scoped team setup for campaign fundraisers.
router.get("/:organisationId/campaigns/:campaignId/teams", loadOrganisation, requireOrgPermission("events.view"), async (req, res) => {
  const campaignId = Number(req.params.campaignId);
  const { rows } = await pool.query(`SELECT id,name,slug,goal_amount,status,created_at FROM kutumb_fundraising_teams WHERE organisation_id=$1 AND campaign_id=$2 ORDER BY created_at DESC`, [req.organisation.id,campaignId]);
  res.json(rows);
});
router.post("/:organisationId/campaigns/:campaignId/teams", loadOrganisation, requireOrgPermission("events.manage"), async (req, res) => {
  const campaignId = Number(req.params.campaignId); const name = String(req.body?.name || "").trim().slice(0,120);
  const goal = req.body?.goalAmount == null || req.body.goalAmount === "" ? null : Number(req.body.goalAmount);
  if (!Number.isInteger(campaignId) || name.length < 2 || (goal !== null && (!Number.isFinite(goal) || goal < 0 || goal > 10000000))) return res.status(400).json({message:"Enter a team name and valid optional goal."});
  try {
    const campaign = await pool.query("SELECT id FROM kutumb_organisation_campaigns WHERE id=$1 AND organisation_id=$2 AND status='published'", [campaignId,req.organisation.id]);
    if (!campaign.rows[0]) return res.status(404).json({message:"Published campaign not found"});
    const teamSlug = `${slugify(name)}-${Date.now().toString(36)}`;
    const { rows } = await pool.query(`INSERT INTO kutumb_fundraising_teams (organisation_id,campaign_id,name,slug,goal_amount,created_by_admin_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id,name,slug,goal_amount,status`, [req.organisation.id,campaignId,name,teamSlug,goal,req.admin.id]);
    await recordOrgAudit(req.admin,req.organisation.id,"fundraising.team.create",String(rows[0].id),{campaignId,name}); res.status(201).json(rows[0]);
  } catch (error) { console.error("FUNDRAISING TEAM ERROR:",error); res.status(500).json({message:"Could not create the team"}); }
});
router.get("/:organisationId/fundraiser-review",loadOrganisation,requireOrgPermission("events.manage"),async(req,res)=>{const {rows}=await pool.query(`SELECT p.id,p.title,p.display_name,p.contact_email,p.story,p.goal_amount,p.created_at,c.title campaign_title FROM kutumb_fundraising_pages p LEFT JOIN kutumb_organisation_campaigns c ON c.id=p.campaign_id WHERE p.organisation_id=$1 AND p.status='pending' ORDER BY p.created_at ASC`,[req.organisation.id]);res.json(rows);});
router.patch("/:organisationId/fundraiser-review/:pageId",loadOrganisation,requireOrgPermission("events.manage"),async(req,res)=>{const status=String(req.body?.status||"");if(!["published","rejected"].includes(status))return res.status(400).json({message:"Choose approve or decline"});const {rows}=await pool.query(`UPDATE kutumb_fundraising_pages p SET status=$1,updated_at=now() WHERE p.id=$2 AND p.organisation_id=$3 AND p.status='pending' AND EXISTS(SELECT 1 FROM kutumb_organisations o WHERE o.id=p.organisation_id AND o.is_active=TRUE AND o.public_profile_enabled=TRUE AND o.verification_status='approved') AND (p.campaign_id IS NULL OR EXISTS(SELECT 1 FROM kutumb_organisation_campaigns c WHERE c.id=p.campaign_id AND c.organisation_id=p.organisation_id AND c.status='published')) RETURNING id,title,status,slug`,[status,Number(req.params.pageId),req.organisation.id]);if(!rows[0])return res.status(404).json({message:"Fundraiser request not found or no longer eligible"});await recordOrgAudit(req.admin,req.organisation.id,"fundraising.page.review",String(rows[0].id),{status});res.json(rows[0]);});

// Phase 7: optional sponsor and auction tools. Raffles are explicitly blocked
// until jurisdiction and licence controls are configured by the platform.
router.get("/:organisationId/events/:eventId/sponsors", loadOrganisation, requireOrgPermission("finance.view"), async (req,res)=>{
  const { rows }=await pool.query("SELECT id,name,description,amount,benefits,capacity,status FROM kutumb_sponsor_packages WHERE organisation_id=$1 AND event_id=$2 ORDER BY amount",[req.organisation.id,Number(req.params.eventId)]); res.json(rows);
});
router.post("/:organisationId/events/:eventId/sponsors", loadOrganisation, requireOrgPermission("finance.manage"), async (req,res)=>{
  const eventId=Number(req.params.eventId), name=String(req.body?.name||"").trim().slice(0,120), amount=Number(req.body?.amount);
  if(!Number.isInteger(eventId)||name.length<2||!Number.isFinite(amount)||amount<0||amount>10000000)return res.status(400).json({message:"Enter a package name and valid AUD amount"});
  const event=await pool.query("SELECT id FROM kutumb_upcoming_events WHERE id=$1 AND organisation_id=$2",[eventId,req.organisation.id]); if(!event.rows[0])return res.status(404).json({message:"Event not found"});
  const benefits=Array.isArray(req.body?.benefits)?req.body.benefits.map(x=>String(x).trim().slice(0,120)).filter(Boolean).slice(0,20):[];
  try{const {rows}=await pool.query("INSERT INTO kutumb_sponsor_packages(organisation_id,event_id,name,description,amount,benefits,capacity,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",[req.organisation.id,eventId,name,String(req.body?.description||"").slice(0,1000)||null,amount,JSON.stringify(benefits),req.body?.capacity==null?null:Math.max(0,Number(req.body.capacity)),req.body?.status==="published"?"published":"draft"]); await recordOrgAudit(req.admin,req.organisation.id,"event.sponsor_package.create",String(rows[0].id),{eventId,name});res.status(201).json(rows[0]);}catch(error){console.error("SPONSOR PACKAGE ERROR:",error);res.status(500).json({message:"Could not save sponsor package"});}
});
router.post("/:organisationId/events/:eventId/sponsors/leads", loadOrganisation, requireOrgPermission("finance.manage"), async (req,res)=>{
  const eventId=Number(req.params.eventId), name=String(req.body?.sponsorName||"").trim().slice(0,160), amount=Number(req.body?.amount||0), email=String(req.body?.email||"").trim().toLowerCase().slice(0,254);
  if(!Number.isInteger(eventId)||name.length<2||!Number.isFinite(amount)||amount<0)return res.status(400).json({message:"Enter sponsor name and a valid amount"});
  const event=await pool.query("SELECT id FROM kutumb_upcoming_events WHERE id=$1 AND organisation_id=$2",[eventId,req.organisation.id]);if(!event.rows[0])return res.status(404).json({message:"Event not found"});
  const packageId=req.body?.packageId?Number(req.body.packageId):null;
  if(packageId){const p=await pool.query("SELECT id FROM kutumb_sponsor_packages WHERE id=$1 AND event_id=$2 AND organisation_id=$3",[packageId,eventId,req.organisation.id]);if(!p.rows[0])return res.status(400).json({message:"Choose a package from this event"});}
  const {rows}=await pool.query("INSERT INTO kutumb_event_sponsors(organisation_id,event_id,package_id,sponsor_name,contact_email,amount,payment_status,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,sponsor_name,amount,payment_status,created_at",[req.organisation.id,eventId,packageId,name,email||null,amount,["lead","invoiced","paid","cancelled"].includes(req.body?.paymentStatus)?req.body.paymentStatus:"lead",String(req.body?.notes||"").slice(0,2000)||null]); await recordOrgAudit(req.admin,req.organisation.id,"event.sponsor.record",String(rows[0].id),{eventId,amount,status:rows[0].payment_status});res.status(201).json(rows[0]);
});
router.get("/:organisationId/events/:eventId/auction", loadOrganisation, requireOrgPermission("finance.view"), async (req,res)=>{const {rows}=await pool.query("SELECT id,title,description,starting_bid,winning_amount,winning_bidder,payment_status,status,created_at FROM kutumb_auction_items WHERE organisation_id=$1 AND event_id=$2 ORDER BY id",[req.organisation.id,Number(req.params.eventId)]);res.json(rows);});
router.post("/:organisationId/events/:eventId/auction", loadOrganisation, requireOrgPermission("finance.manage"), async (req,res)=>{const eventId=Number(req.params.eventId),title=String(req.body?.title||"").trim().slice(0,160),bid=Number(req.body?.startingBid||0);if(!Number.isInteger(eventId)||title.length<3||!Number.isFinite(bid)||bid<0)return res.status(400).json({message:"Enter an item title and valid starting bid"});const event=await pool.query("SELECT id FROM kutumb_upcoming_events WHERE id=$1 AND organisation_id=$2",[eventId,req.organisation.id]);if(!event.rows[0])return res.status(404).json({message:"Event not found"});const {rows}=await pool.query("INSERT INTO kutumb_auction_items(organisation_id,event_id,title,description,starting_bid) VALUES($1,$2,$3,$4,$5) RETURNING *",[req.organisation.id,eventId,title,String(req.body?.description||"").slice(0,2000)||null,bid]);await recordOrgAudit(req.admin,req.organisation.id,"event.auction_item.create",String(rows[0].id),{eventId,title});res.status(201).json(rows[0]);});
router.post("/:organisationId/events/:eventId/raffles", loadOrganisation, requireOrgPermission("events.manage"), (_req,res)=>res.status(409).json({message:"Digital raffles are disabled. Configure jurisdiction-specific licences and compliance review before enabling raffle sales."}));

// Phase 9: volunteers and the event checklist reuse the organisation roles
// and existing QR check-in system; sensitive access notes stay staff-only.
router.get("/:organisationId/events/:eventId/volunteers",loadOrganisation,requireOrgPermission("volunteers.manage"),async(req,res)=>{const {rows}=await pool.query("SELECT id,name,email,phone,skills,availability,accessibility_notes,status,assigned_shift,created_at FROM kutumb_volunteer_applications WHERE organisation_id=$1 AND event_id=$2 ORDER BY created_at DESC",[req.organisation.id,Number(req.params.eventId)]);res.json(rows);});
router.patch("/:organisationId/events/:eventId/volunteers/:applicationId",loadOrganisation,requireOrgPermission("volunteers.manage"),async(req,res)=>{const status=String(req.body?.status||"");if(!["pending","approved","declined","withdrawn"].includes(status))return res.status(400).json({message:"Choose a valid volunteer status"});const shift=String(req.body?.assignedShift||"").trim().slice(0,120)||null;const {rows}=await pool.query("UPDATE kutumb_volunteer_applications SET status=$1,assigned_shift=$2 WHERE id=$3 AND event_id=$4 AND organisation_id=$5 RETURNING id,status,assigned_shift",[status,shift,Number(req.params.applicationId),Number(req.params.eventId),req.organisation.id]);if(!rows[0])return res.status(404).json({message:"Volunteer application not found"});await recordOrgAudit(req.admin,req.organisation.id,"event.volunteer.update",String(rows[0].id),{status,shift});res.json(rows[0]);});
router.get("/:organisationId/events/:eventId/checklist",loadOrganisation,requireOrgPermission("events.view"),async(req,res)=>{const {rows}=await pool.query("SELECT id,label,is_done,due_at,assigned_to,notes,updated_at FROM kutumb_event_checklist WHERE organisation_id=$1 AND event_id=$2 ORDER BY id",[req.organisation.id,Number(req.params.eventId)]);res.json(rows);});
router.post("/:organisationId/events/:eventId/checklist",loadOrganisation,requireOrgPermission("events.manage"),async(req,res)=>{const eventId=Number(req.params.eventId),label=String(req.body?.label||"").trim().slice(0,180);if(!Number.isInteger(eventId)||label.length<2)return res.status(400).json({message:"Enter a checklist item"});const ev=await pool.query("SELECT id FROM kutumb_upcoming_events WHERE id=$1 AND organisation_id=$2",[eventId,req.organisation.id]);if(!ev.rows[0])return res.status(404).json({message:"Event not found"});const {rows}=await pool.query("INSERT INTO kutumb_event_checklist(organisation_id,event_id,label,assigned_to,notes,updated_by_admin_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",[req.organisation.id,eventId,label,String(req.body?.assignedTo||"").slice(0,120)||null,String(req.body?.notes||"").slice(0,1000)||null,req.admin.id]);await recordOrgAudit(req.admin,req.organisation.id,"event.checklist.add",String(rows[0].id),{eventId,label});res.status(201).json(rows[0]);});
router.patch("/:organisationId/events/:eventId/checklist/:itemId",loadOrganisation,requireOrgPermission("events.manage"),async(req,res)=>{if(typeof req.body?.isDone!=="boolean")return res.status(400).json({message:"Choose whether the task is complete"});const {rows}=await pool.query("UPDATE kutumb_event_checklist SET is_done=$1,updated_by_admin_id=$2,updated_at=now() WHERE id=$3 AND event_id=$4 AND organisation_id=$5 RETURNING *",[req.body.isDone,req.admin.id,Number(req.params.itemId),Number(req.params.eventId),req.organisation.id]);if(!rows[0])return res.status(404).json({message:"Checklist item not found"});await recordOrgAudit(req.admin,req.organisation.id,"event.checklist.update",String(rows[0].id),{isDone:req.body.isDone});res.json(rows[0]);});

// Phase 8: simple, consent-aware relationship segments. Only aggregate counts
// are exposed here; email addresses remain in the existing communication tools.
router.get("/:organisationId/supporter-segments",loadOrganisation,requireOrgPermission("supporters.view"),async(req,res)=>{const allowed=["recent_donor","attendee","volunteer","fundraiser","inactive"];const segment=String(req.query.segment||"");if(!allowed.includes(segment))return res.status(400).json({message:"Choose a supported supporter segment"});const conditions={recent_donor:"EXISTS(SELECT 1 FROM kutumb_donations d WHERE d.supporter_id=s.id AND d.organisation_id=s.organisation_id AND lower(d.payment_status)='paid' AND d.created_at>now()-interval '90 days')",attendee:"EXISTS(SELECT 1 FROM kutumb_attendees a WHERE a.supporter_id=s.id AND a.organisation_id=s.organisation_id)",volunteer:"EXISTS(SELECT 1 FROM kutumb_volunteer_applications v WHERE lower(v.email)=lower(s.email) AND v.organisation_id=s.organisation_id AND v.status='approved')",fundraiser:"EXISTS(SELECT 1 FROM kutumb_fundraising_pages p WHERE lower(p.contact_email)=lower(s.email) AND p.organisation_id=s.organisation_id AND p.status='published')",inactive:"s.updated_at<now()-interval '365 days'"};const {rows}=await pool.query(`SELECT count(*)::int count, count(*) FILTER (WHERE s.email_consent=TRUE AND s.email_opt_out=FALSE)::int emailable FROM kutumb_supporters s WHERE s.organisation_id=$1 AND s.merged_into_id IS NULL AND ${conditions[segment]}`,[req.organisation.id]);res.json({segment,...rows[0]});});

// Phases 10/12: aggregate charity/event activity using source records and
// distinguish ticket orders from donations and reported impact.
router.get("/:organisationId/impact-summary",loadOrganisation,requireOrgPermission("finance.view"),async(req,res)=>{const [events,donations,tickets,volunteers,sponsors]=await Promise.all([
  pool.query("SELECT count(*)::int count FROM kutumb_upcoming_events WHERE organisation_id=$1",[req.organisation.id]),
  pool.query("SELECT COALESCE(sum(amount) FILTER(WHERE lower(payment_status) IN ('paid','completed','succeeded')),0)::numeric(12,2) raised,count(*) FILTER(WHERE lower(payment_status) IN ('paid','completed','succeeded'))::int donation_count,count(DISTINCT supporter_id) FILTER(WHERE lower(payment_status) IN ('paid','completed','succeeded'))::int donors FROM kutumb_donations WHERE organisation_id=$1",[req.organisation.id]),
  pool.query("SELECT count(*)::int attendees FROM kutumb_attendees WHERE organisation_id=$1",[req.organisation.id]),
  pool.query("SELECT count(*) FILTER(WHERE status='approved')::int volunteers FROM kutumb_volunteer_applications WHERE organisation_id=$1",[req.organisation.id]),
  pool.query("SELECT COALESCE(sum(amount) FILTER(WHERE payment_status='paid'),0)::numeric(12,2) raised FROM kutumb_event_sponsors WHERE organisation_id=$1",[req.organisation.id])
]);res.json({events:events.rows[0].count,donations:donations.rows[0],attendees:tickets.rows[0].attendees,volunteers:volunteers.rows[0].volunteers,sponsorships:sponsors.rows[0].raised,currency:"AUD",impactNotesSupported:true});});

router.get("/:organisationId/event-finance-summary/:eventId",loadOrganisation,requireOrgPermission("finance.view"),async(req,res)=>{const eventId=Number(req.params.eventId);const event=await pool.query("SELECT id,title FROM kutumb_upcoming_events WHERE id=$1 AND organisation_id=$2",[eventId,req.organisation.id]);if(!event.rows[0])return res.status(404).json({message:"Event not found"});const [donations,sponsors,addons,auctions,tickets]=await Promise.all([
  pool.query("SELECT COALESCE(sum(amount) FILTER(WHERE lower(payment_status) IN ('paid','completed','succeeded')),0)::numeric(12,2) paid,COALESCE(sum(amount) FILTER(WHERE lower(payment_status)='refunded'),0)::numeric(12,2) refunded FROM kutumb_donations WHERE organisation_id=$1 AND event_id=$2",[req.organisation.id,slugify(event.rows[0].title)]),
  pool.query("SELECT COALESCE(sum(amount) FILTER(WHERE payment_status='paid'),0)::numeric(12,2) paid,COALESCE(sum(amount) FILTER(WHERE payment_status IN ('lead','invoiced')),0)::numeric(12,2) outstanding FROM kutumb_event_sponsors WHERE organisation_id=$1 AND event_id=$2",[req.organisation.id,eventId]),
  pool.query("SELECT COALESCE(sum(amount),0)::numeric(12,2) configured FROM kutumb_event_addons WHERE organisation_id=$1 AND event_id=$2 AND status='published'",[req.organisation.id,eventId]),
  pool.query("SELECT COALESCE(sum(winning_amount) FILTER(WHERE payment_status='paid'),0)::numeric(12,2) paid FROM kutumb_auction_items WHERE organisation_id=$1 AND event_id=$2",[req.organisation.id,eventId]),
  pool.query("SELECT COALESCE(sum(total_cents) FILTER(WHERE status='paid'),0)::numeric(14,0) paid_cents FROM kutumb_orders WHERE organisation_id=$1 AND event_id=$2",[req.organisation.id,slugify(event.rows[0].title)])
]);res.json({event:event.rows[0].title,currency:"AUD",tickets:(Number(tickets.rows[0].paid_cents)||0)/100,donations:donations.rows[0].paid,donationRefunds:donations.rows[0].refunded,sponsorships:sponsors.rows[0].paid,sponsorOutstanding:sponsors.rows[0].outstanding,auctionPayments:auctions.rows[0].paid,configuredAddons: addons.rows[0].configured,accountingIntegration:"Xero/MYOB boundary only; no accounting sync configured"});});

router.get("/:organisationId/events/:eventId/analytics",loadOrganisation,requireOrgPermission("events.view"),async(req,res)=>{const eventId=Number(req.params.eventId);const event=await pool.query("SELECT id,title FROM kutumb_upcoming_events WHERE id=$1 AND organisation_id=$2",[eventId,req.organisation.id]);if(!event.rows[0])return res.status(404).json({message:"Event not found"});const eventKey=slugify(event.rows[0].title);const [views,orders,attendees,donations,fundraisers,volunteers]=await Promise.all([
  pool.query("SELECT count(*)::int views FROM kutumb_event_page_views WHERE organisation_id=$1 AND event_id=$2",[req.organisation.id,eventId]),
  pool.query("SELECT count(*) FILTER(WHERE status='paid')::int paid_orders,count(*) FILTER(WHERE status IN ('pending','paid'))::int orders,COALESCE(sum(total_cents) FILTER(WHERE status='paid'),0)::numeric(14,0) paid_cents FROM kutumb_orders WHERE organisation_id=$1 AND event_id=$2",[req.organisation.id,eventKey]),
  pool.query("SELECT count(*)::int registered,count(*) FILTER(WHERE checked_in_at IS NOT NULL)::int checked_in,count(*) FILTER(WHERE checked_in_at IS NULL)::int not_checked_in,count(DISTINCT supporter_id)::int supporters FROM kutumb_attendees WHERE organisation_id=$1 AND event_id=$2",[req.organisation.id,eventKey]),
  pool.query("SELECT COALESCE(sum(amount) FILTER(WHERE lower(payment_status) IN ('paid','completed','succeeded')),0)::numeric(12,2) raised,count(*) FILTER(WHERE lower(payment_status) IN ('paid','completed','succeeded'))::int count FROM kutumb_donations WHERE organisation_id=$1 AND event_id=$2",[req.organisation.id,eventKey]),
  pool.query("SELECT count(*)::int pages FROM kutumb_fundraising_pages WHERE organisation_id=$1 AND event_id=$2 AND status='published'",[req.organisation.id,eventKey]),
  pool.query("SELECT count(*)::int interested,count(*) FILTER(WHERE status='approved')::int approved FROM kutumb_volunteer_applications WHERE organisation_id=$1 AND event_id=$2",[req.organisation.id,eventId])
]);const paidOrders=orders.rows[0].paid_orders;const registered=attendees.rows[0].registered;res.json({event:event.rows[0].title,views:views.rows[0].views,paidOrders,registered,checkedIn:attendees.rows[0].checked_in,noShows:attendees.rows[0].not_checked_in,ticketRevenueAud:(Number(orders.rows[0].paid_cents)||0)/100,donations:donations.rows[0],fundraisingPages:fundraisers.rows[0].pages,volunteers:volunteers.rows[0],conversionPercent:views.rows[0].views?Number(((paidOrders/views.rows[0].views)*100).toFixed(1)):0,currency:"AUD"});});

router.get("/:organisationId/reports/donations.csv",loadOrganisation,requireOrgPermission("finance.view"),async(req,res)=>{try{const {rows}=await pool.query("SELECT id,created_at,amount,payment_status,payment_method,campaign_id,event_id,fundraising_page_id,transaction_classification,tax_classification,is_anonymous FROM kutumb_donations WHERE organisation_id=$1 ORDER BY created_at DESC LIMIT 50000",[req.organisation.id]);const esc=(v)=>`\"${String(v??"").replace(/\"/g,'\"\"')}\"`;const lines=[["Donation ID","Created at","Amount AUD","Status","Method","Campaign ID","Event","Fundraiser ID","Classification","Tax status","Anonymous"],...rows.map(r=>[r.id,r.created_at?.toISOString?.()||r.created_at,r.amount,r.payment_status,r.payment_method,r.campaign_id,r.event_id,r.fundraising_page_id,r.transaction_classification,r.tax_classification,r.is_anonymous])].map(row=>row.map(esc).join(",")).join("\r\n");res.setHeader("Content-Type","text/csv; charset=utf-8");res.setHeader("Content-Disposition","attachment; filename=kutumblink-donations.csv");res.send(`\uFEFF${lines}`);}catch(error){console.error("DONATION EXPORT ERROR:",error);res.status(500).json({message:"Could not export donations"});}});

export default router;
