import { Router } from "express";
import { pool } from "../db/pool.js";
import { isFeatureEnabled } from "../lib/featureFlags.js";
import { slugify } from "../lib/slugify.js";

const router = Router();
const available = (res) => {
  if (isFeatureEnabled("organisations")) return true;
  res.status(404).json({ message: "Fundraising pages are currently unavailable" });
  return false;
};

router.post("/event-view/:eventId", async (req,res)=>{
  if(!available(res))return;
  const id=Number(req.params.eventId); if(!Number.isInteger(id)||id<1)return res.status(400).json({message:"Invalid event"});
  try{
    const event=await pool.query(`SELECT e.id,e.organisation_id FROM kutumb_upcoming_events e JOIN kutumb_organisations o ON o.id=e.organisation_id WHERE e.id=$1 AND e.is_active=TRUE AND e.published=TRUE AND o.is_active=TRUE AND o.public_profile_enabled=TRUE AND o.verification_status='approved'`,[id]);
    if(!event.rows[0])return res.status(404).json({message:"Event not found"});
    const text=(v,n)=>String(v||"").trim().slice(0,n)||null;
    await pool.query("INSERT INTO kutumb_event_page_views(organisation_id,event_id,source,medium,campaign) VALUES($1,$2,$3,$4,$5)",[event.rows[0].organisation_id,id,text(req.body?.source,120),text(req.body?.medium,120),text(req.body?.campaign,160)]);
    res.status(202).json({recorded:true});
  }catch(error){console.error("EVENT VIEW TRACKING ERROR:",error);res.status(500).json({message:"Could not record event view"});}
});

router.get("/campaigns/:slug", async (req, res) => {
  if (!available(res)) return;
  try {
    const { rows } = await pool.query(
      `SELECT c.id,c.slug,c.title,c.description,c.story,c.image_url,c.goal_amount,c.starts_at,c.ends_at,c.internal_giving_enabled,
        o.id organisation_id,o.public_name,o.legal_name,o.slug organisation_slug,o.causes,
        (SELECT COALESCE(sum(d.amount),0)::numeric(12,2) FROM kutumb_donations d WHERE d.campaign_id=c.id AND lower(d.payment_status)='paid') raised_amount
       FROM kutumb_organisation_campaigns c JOIN kutumb_organisations o ON o.id=c.organisation_id
       WHERE c.slug=$1 AND c.status='published' AND o.is_active=TRUE AND o.public_profile_enabled=TRUE AND o.verification_status='approved'`, [req.params.slug]);
    if (!rows[0]) return res.status(404).json({ message: "Campaign not found" });
    const campaign = rows[0];
    const { rows: pages } = await pool.query(
      `SELECT p.id,p.slug,p.title,p.display_name,p.story,p.goal_amount,p.team_id,
        (SELECT COALESCE(sum(d.amount),0)::numeric(12,2) FROM kutumb_donations d WHERE d.fundraising_page_id=p.id AND lower(d.payment_status)='paid') raised_amount
       FROM kutumb_fundraising_pages p WHERE p.campaign_id=$1 AND p.status='published' ORDER BY raised_amount DESC LIMIT 50`, [campaign.id]);
    const { rows: teams } = await pool.query(
      `SELECT t.id,t.slug,t.name,t.goal_amount,(SELECT COALESCE(sum(d.amount),0)::numeric(12,2) FROM kutumb_donations d WHERE d.team_id=t.id AND lower(d.payment_status)='paid') raised_amount
       FROM kutumb_fundraising_teams t WHERE t.campaign_id=$1 AND t.status='active' ORDER BY raised_amount DESC LIMIT 50`, [campaign.id]);
    res.json({ campaign, fundraisers: pages, teams });
  } catch (error) { console.error("PUBLIC CAMPAIGN ERROR:", error); res.status(500).json({ message: "Could not load this campaign" }); }
});

router.get("/pages/:slug", async (req, res) => {
  if (!available(res)) return;
  try {
    const { rows } = await pool.query(
      `SELECT p.id,p.slug,p.title,p.display_name,p.story,p.goal_amount,p.organisation_id,p.campaign_id,p.event_id,p.team_id,
        c.title campaign_title,c.slug campaign_slug,COALESCE(c.internal_giving_enabled,FALSE) AS internal_giving_enabled,o.id organisation_id,o.public_name,o.legal_name,o.slug organisation_slug,
        (SELECT COALESCE(sum(d.amount),0)::numeric(12,2) FROM kutumb_donations d WHERE d.fundraising_page_id=p.id AND lower(d.payment_status)='paid') raised_amount
       FROM kutumb_fundraising_pages p JOIN kutumb_organisations o ON o.id=p.organisation_id
       LEFT JOIN kutumb_organisation_campaigns c ON c.id=p.campaign_id
       WHERE p.slug=$1 AND p.status='published' AND o.is_active=TRUE AND o.public_profile_enabled=TRUE AND o.verification_status='approved'
         AND (p.campaign_id IS NULL OR c.status='published')`, [req.params.slug]);
    if (!rows[0]) return res.status(404).json({ message: "Fundraising page not found" });
    res.json(rows[0]);
  } catch (error) { console.error("PUBLIC FUNDRAISER ERROR:", error); res.status(500).json({ message: "Could not load this fundraising page" }); }
});

router.post("/pages", async (req, res) => {
  if (!available(res)) return;
  const campaignId = Number(req.body?.campaignId);
  const displayName = String(req.body?.displayName || "").trim().slice(0, 100);
  const email = String(req.body?.email || "").trim().toLowerCase().slice(0, 254);
  const title = String(req.body?.title || "").trim().slice(0, 160);
  const story = String(req.body?.story || "").trim().slice(0, 3000);
  const goal = req.body?.goalAmount === "" || req.body?.goalAmount == null ? null : Number(req.body.goalAmount);
  if (!Number.isInteger(campaignId) || campaignId < 1 || displayName.length < 2 || !/^\S+@\S+\.\S+$/.test(email) || title.length < 3 || (goal !== null && (!Number.isFinite(goal) || goal < 0 || goal > 10000000))) return res.status(400).json({ message: "Add your name, email, a page title and a valid optional goal." });
  try {
    const { rows } = await pool.query(
      `SELECT c.id,c.slug,c.organisation_id,c.status,c.internal_giving_enabled,o.is_active,o.public_profile_enabled,o.verification_status
       FROM kutumb_organisation_campaigns c JOIN kutumb_organisations o ON o.id=c.organisation_id WHERE c.id=$1`, [campaignId]);
    const campaign = rows[0];
    if (!campaign || campaign.status !== "published" || !campaign.internal_giving_enabled || !campaign.is_active || !campaign.public_profile_enabled || campaign.verification_status !== "approved") return res.status(404).json({ message: "This campaign is not accepting KutumbLink fundraisers" });
    let teamId = null;
    if (req.body?.teamId) {
      const team = await pool.query("SELECT id FROM kutumb_fundraising_teams WHERE id=$1 AND campaign_id=$2 AND organisation_id=$3 AND status='active'", [Number(req.body.teamId),campaignId,campaign.organisation_id]);
      if (!team.rows[0]) return res.status(400).json({ message: "Choose a team from this campaign" });
      teamId = team.rows[0].id;
    }
    const recent = await pool.query("SELECT count(*)::int count FROM kutumb_fundraising_pages WHERE organisation_id=$1 AND lower(contact_email)=lower($2) AND created_at>now()-interval '24 hours'",[campaign.organisation_id,email]);
    if(Number(recent.rows[0]?.count||0)>=3)return res.status(429).json({message:"You have submitted a few fundraising pages today. Contact the charity team if you need help."});
    const base = slugify(title).slice(0, 70) || "fundraiser";
    const slug = `${base}-${Date.now().toString(36)}`;
    const created = await pool.query(
      `WITH supporter AS (
         INSERT INTO kutumb_supporters (organisation_id,display_name,email,source)
         VALUES ($1,$4,$5,'fundraiser')
         ON CONFLICT (organisation_id,(lower(email)),(lower(display_name)))
         DO UPDATE SET updated_at=now() RETURNING id
       )
       INSERT INTO kutumb_fundraising_pages (organisation_id,campaign_id,team_id,supporter_id,display_name,contact_email,title,story,slug,goal_amount,status)
       SELECT $1,$2,$3,supporter.id,$4,$5,$6,$7,$8,$9,'pending' FROM supporter RETURNING id,slug,title`,
      [campaign.organisation_id,campaignId,teamId,displayName,email,title,story || null,slug,goal]);
    res.status(201).json({ ...created.rows[0], status:"pending", message:"Your fundraiser has been sent to the charity for a quick review. It will be public after they approve it." });
  } catch (error) { console.error("CREATE FUNDRAISER ERROR:", error); res.status(500).json({ message: "Could not create this fundraising page" }); }
});

export default router;
