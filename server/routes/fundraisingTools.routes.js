import { Router } from "express";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import { pool } from "../db/pool.js";
import { authenticateAdminIdentity } from "../lib/auth.js";
import { hasOrganisationPermission, membershipMatchesScope } from "../lib/organisationAccess.js";
import { getStripe } from "../lib/stripeClient.js";
import { getSetting } from "../lib/settings.js";
import { getConfiguredPublicBaseUrl, getPublicBaseUrl, isLocalUrl } from "../lib/publicUrl.js";
import { sendTransactionalEmail } from "../lib/mailer.js";
import { slugify } from "../lib/slugify.js";

const router = Router();
const maxMoney = 10_000_000;
const emailPattern = /^\S+@\S+\.\S+$/;
const money = (value) => Number.isFinite(Number(value)) && Number(value) > 0 && Number(value) <= maxMoney && Math.round(Number(value) * 100) === Number(value) * 100;
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const tokenHash = (token) => crypto.createHash("sha256").update(token).digest("hex");
const jwtSecret = () => process.env.JWT_SECRET || "dev-only-insecure-secret-change-me";
const isPlatformAdmin = (admin) => ["superadmin", "platform_admin"].includes(admin.role);

async function requireOrganisation(req, res, next) {
  try {
    const id = Number(req.params.organisationId);
    if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ message: "Invalid organisation" });
    const requested = req.get("x-organisation-id");
    if (requested && Number(requested) !== id) return res.status(403).json({ message: "The selected organisation does not match this request" });
    const { rows: [organisation] } = await pool.query("SELECT * FROM kutumb_organisations WHERE id=$1 AND is_active=TRUE", [id]);
    if (!organisation) return res.status(404).json({ message: "Organisation not found" });
    if (isPlatformAdmin(req.admin)) req.organisationRole = "platform_admin";
    else {
      const { rows } = await pool.query("SELECT organisation_id,admin_user_id,role,is_active FROM kutumb_organisation_users WHERE organisation_id=$1 AND admin_user_id=$2 AND is_active=TRUE", [id, req.admin.id]);
      if (!membershipMatchesScope(rows[0], id, req.admin.id)) return res.status(403).json({ message: "You do not belong to this organisation" });
      req.organisationRole = rows[0].role;
    }
    req.organisation = organisation;
    next();
  } catch (error) {
    console.error("FUNDRAISING ORGANISATION ACCESS ERROR:", error);
    res.status(500).json({ message: "Could not verify organisation access" });
  }
}
const permit = (permission) => (req, res, next) => hasOrganisationPermission(req.organisationRole, permission) ? next() : res.status(403).json({ message: "Your organisation role does not allow this action" });

async function publicOrganisation(slug) {
  const { rows } = await pool.query("SELECT id,slug,public_name,legal_name FROM kutumb_organisations WHERE slug=$1 AND is_active=TRUE AND public_profile_enabled=TRUE AND verification_status='approved'", [slug]);
  return rows[0] || null;
}

// Public auction discovery, with bids serialized against the auction row so
// simultaneous bids cannot both become the leader at the same amount.
router.get("/auctions", async (_req, res) => {
  try {
    const { rows } = await pool.query(`SELECT a.id,a.slug,a.title,a.description,a.starting_bid,a.minimum_increment,a.starts_at,a.ends_at,
      COALESCE((SELECT max(b.amount) FROM kutumb_auction_bids b WHERE b.auction_id=a.id AND b.status='leading'),a.starting_bid)::numeric(12,2) current_bid,
      o.slug organisation_slug,o.public_name,o.legal_name
      FROM kutumb_auction_items a JOIN kutumb_organisations o ON o.id=a.organisation_id
      JOIN kutumb_upcoming_events e ON e.id=a.event_id AND e.is_active=TRUE AND e.published=TRUE
      WHERE a.status='open' AND (a.starts_at IS NULL OR a.starts_at<=now()) AND (a.ends_at IS NULL OR a.ends_at>now())
      AND o.is_active=TRUE AND o.public_profile_enabled=TRUE AND o.verification_status='approved' ORDER BY a.ends_at NULLS LAST LIMIT 100`);
    res.json(rows);
  } catch (error) { console.error("PUBLIC AUCTION LIST ERROR:", error); res.status(500).json({ message: "Could not load auctions" }); }
});

router.get("/auctions/:slug", async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT a.id,a.slug,a.title,a.description,a.starting_bid,a.minimum_increment,a.starts_at,a.ends_at,a.status,
      COALESCE((SELECT max(b.amount) FROM kutumb_auction_bids b WHERE b.auction_id=a.id AND b.status='leading'),a.starting_bid)::numeric(12,2) current_bid,
      (SELECT count(*)::int FROM kutumb_auction_bids b WHERE b.auction_id=a.id AND b.status IN ('leading','outbid')) bid_count,
      o.id organisation_id,o.slug organisation_slug,o.public_name,o.legal_name
      FROM kutumb_auction_items a JOIN kutumb_organisations o ON o.id=a.organisation_id
      JOIN kutumb_upcoming_events e ON e.id=a.event_id AND e.is_active=TRUE AND e.published=TRUE
      WHERE a.slug=$1 AND o.is_active=TRUE AND o.public_profile_enabled=TRUE AND o.verification_status='approved'`, [req.params.slug]);
    if (!rows[0]) return res.status(404).json({ message: "Auction not found" });
    res.json(rows[0]);
  } catch (error) { console.error("PUBLIC AUCTION ERROR:", error); res.status(500).json({ message: "Could not load auction" }); }
});

router.post("/auctions/:slug/bids", async (req, res) => {
  const name = String(req.body?.name || "").trim().slice(0, 120);
  const email = String(req.body?.email || "").trim().toLowerCase().slice(0, 254);
  const amount = Number(req.body?.amount);
  if (name.length < 2 || !emailPattern.test(email) || !money(amount)) return res.status(400).json({ message: "Enter your name, a valid email and a bid in AUD." });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(`SELECT a.*,o.is_active,o.public_profile_enabled,o.verification_status
      FROM kutumb_auction_items a JOIN kutumb_organisations o ON o.id=a.organisation_id WHERE a.slug=$1 FOR UPDATE OF a`, [req.params.slug]);
    const auction = rows[0];
    if (!auction || !auction.is_active || !auction.public_profile_enabled || auction.verification_status !== "approved") { await client.query("ROLLBACK"); return res.status(404).json({ message: "Auction not found" }); }
    if (auction.status !== "open" || (auction.starts_at && new Date(auction.starts_at) > new Date()) || (auction.ends_at && new Date(auction.ends_at) <= new Date())) { await client.query("ROLLBACK"); return res.status(409).json({ message: "Bidding is not open for this auction." }); }
    const { rows: [leader] } = await client.query("SELECT max(amount)::numeric(12,2) amount FROM kutumb_auction_bids WHERE auction_id=$1 AND status='leading'", [auction.id]);
    const minimum = leader?.amount ? Number(leader.amount) + Number(auction.minimum_increment || 1) : Number(auction.starting_bid);
    if (amount < minimum) { await client.query("ROLLBACK"); return res.status(400).json({ message: `Your bid must be at least A$${minimum.toFixed(2)}.` }); }
    await client.query("UPDATE kutumb_auction_bids SET status='outbid' WHERE auction_id=$1 AND status='leading'", [auction.id]);
    const { rows: [bid] } = await client.query("INSERT INTO kutumb_auction_bids(auction_id,organisation_id,bidder_name,bidder_email,amount,status) VALUES($1,$2,$3,$4,$5,'leading') RETURNING id,amount,status,created_at", [auction.id,auction.organisation_id,name,email,amount]);
    await client.query("COMMIT");
    res.status(201).json({ ...bid, message: "Bid recorded. We’ll contact the successful bidder after the auction closes." });
  } catch (error) { await client.query("ROLLBACK"); console.error("AUCTION BID ERROR:", error); res.status(500).json({ message: "Could not record your bid" }); }
  finally { client.release(); }
});

router.get("/stores/:organisationSlug", async (req, res) => {
  try {
    const org = await publicOrganisation(req.params.organisationSlug);
    if (!org) return res.status(404).json({ message: "Store not found" });
    const { rows } = await pool.query("SELECT id,name,slug,description,price,requires_shipping,shipping_fee,(stock_on_hand-stock_reserved) available FROM kutumb_store_products WHERE organisation_id=$1 AND status='published' AND stock_on_hand>stock_reserved ORDER BY name", [org.id]);
    res.json({ organisation: org, products: rows });
  } catch (error) { console.error("STORE LIST ERROR:", error); res.status(500).json({ message: "Could not load store" }); }
});

router.get("/memberships/:organisationSlug", async (req, res) => {
  try {
    const org = await publicOrganisation(req.params.organisationSlug);
    if (!org) return res.status(404).json({ message: "Membership page not found" });
    const { rows } = await pool.query("SELECT id,name,slug,description,amount,billing_interval FROM kutumb_membership_tiers WHERE organisation_id=$1 AND status='published' ORDER BY amount", [org.id]);
    res.json({ organisation: org, tiers: rows });
  } catch (error) { console.error("MEMBERSHIP TIER LIST ERROR:", error); res.status(500).json({ message: "Could not load membership options" }); }
});

router.post("/memberships/:organisationSlug/:tierSlug/checkout", async (req, res) => {
  const name = String(req.body?.name || "").trim().slice(0, 120);
  const email = String(req.body?.email || "").trim().toLowerCase().slice(0, 254);
  if (name.length < 2 || !emailPattern.test(email)) return res.status(400).json({ message: "Enter your name and a valid email address." });
  try {
    const org = await publicOrganisation(req.params.organisationSlug);
    if (!org) return res.status(404).json({ message: "Membership page not found" });
    const { rows: [tier] } = await pool.query("SELECT * FROM kutumb_membership_tiers WHERE organisation_id=$1 AND slug=$2 AND status='published'", [org.id,req.params.tierSlug]);
    if (!tier) return res.status(404).json({ message: "Membership tier not found" });
    const stripe = await getStripe();
    if (!stripe) return res.status(503).json({ message: "Recurring membership checkout is not configured. Please contact the organisation." });
    const { rows: [membership] } = await pool.query("INSERT INTO kutumb_paid_memberships(organisation_id,tier_id,member_name,member_email) VALUES($1,$2,$3,$4) RETURNING id", [org.id,tier.id,name,email]);
    const baseUrl = await getPublicBaseUrl(req);
    const session = await stripe.checkout.sessions.create({ mode: "subscription", customer_email: email,
      line_items: [{ price_data: { currency: "aud", unit_amount: Math.round(Number(tier.amount)*100), recurring: { interval: tier.billing_interval }, product_data: { name: `${tier.name} membership` } }, quantity: 1 }],
      metadata: { membershipId: String(membership.id), organisationId: String(org.id) },
      subscription_data: { metadata: { membershipId: String(membership.id), organisationId: String(org.id) } },
      success_url: `${baseUrl}/fundraising/membership-return?session_id={CHECKOUT_SESSION_ID}`, cancel_url: `${baseUrl}/memberships/${encodeURIComponent(org.slug)}` });
    await pool.query("UPDATE kutumb_paid_memberships SET stripe_session_id=$1,updated_at=now() WHERE id=$2", [session.id,membership.id]);
    res.json({ url: session.url });
  } catch (error) { console.error("MEMBERSHIP CHECKOUT ERROR:", error); res.status(500).json({ message: "Could not start membership checkout" }); }
});
router.post("/memberships/manage-link",async(req,res)=>{
  const email=String(req.body?.email||"").trim().toLowerCase().slice(0,254),slug=String(req.body?.organisationSlug||"").trim();
  const generic={message:"If an active membership matches those details, a secure management link has been emailed."};
  if(!emailPattern.test(email)||!slug)return res.json(generic);
  try{const {rows:[membership]}=await pool.query(`SELECT m.id,m.member_email,m.stripe_customer_id,m.stripe_subscription_id,o.slug,o.public_name,o.legal_name
    FROM kutumb_paid_memberships m JOIN kutumb_organisations o ON o.id=m.organisation_id
    WHERE lower(m.member_email)=lower($1) AND o.slug=$2 AND m.status IN ('active','past_due') ORDER BY m.created_at DESC LIMIT 1`,[email,slug]);
    if(membership){const token=jwt.sign({membershipId:Number(membership.id),email:membership.member_email,organisationSlug:membership.slug},jwtSecret(),{expiresIn:"20m",audience:"membership-manage"});const base=(await getSetting("public_base_url").catch(()=>null))||process.env.PUBLIC_BASE_URL||`${req.protocol}://${req.get("host")}`;const link=`${base}/memberships/manage?token=${encodeURIComponent(token)}`;await sendTransactionalEmail({to:membership.member_email,subject:"Manage your membership renewal",html:`<p>Hello,</p><p>Use this secure link to manage your recurring membership with ${escapeHtml(membership.public_name||membership.legal_name)}.</p><p><a href="${escapeHtml(link)}">Manage membership</a></p><p>This link expires in 20 minutes. If you did not request it, you can ignore this email.</p>`});}
    res.json(generic);
  }catch(error){console.error("MEMBERSHIP MANAGE LINK ERROR:",error);res.json(generic);}
});
router.post("/memberships/cancel",async(req,res)=>{
  try{const payload=jwt.verify(String(req.body?.token||""),jwtSecret(),{audience:"membership-manage"});const {rows:[membership]}=await pool.query("SELECT id,status,stripe_subscription_id FROM kutumb_paid_memberships WHERE id=$1 AND lower(member_email)=lower($2) AND status IN ('active','past_due')",[Number(payload.membershipId),payload.email]);if(!membership||!membership.stripe_subscription_id)return res.status(404).json({message:"Membership not found or not active."});const stripe=await getStripe();if(!stripe)return res.status(503).json({message:"Membership management is unavailable."});const subscription=await stripe.subscriptions.update(membership.stripe_subscription_id,{cancel_at_period_end:true});await pool.query("UPDATE kutumb_paid_memberships SET cancel_at_period_end=TRUE,current_period_end=to_timestamp($1),updated_at=now() WHERE id=$2",[subscription.current_period_end||0,membership.id]);res.json({message:"Renewal cancelled. Your membership stays active until the paid period ends.",periodEnd:subscription.current_period_end});}
  catch(error){if(error.name==="JsonWebTokenError"||error.name==="TokenExpiredError")return res.status(400).json({message:"This management link is invalid or expired."});console.error("MEMBERSHIP CANCELLATION ERROR:",error);res.status(500).json({message:"Could not update membership renewal."});}
});

// Public email tracking and a signed, one-click unsubscribe confirmation.
const gif=Buffer.from("R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=","base64");
router.get("/track/:token.gif",async(req,res)=>{try{const {rows}=await pool.query("UPDATE kutumb_email_campaign_recipients r SET opened_at=COALESCE(opened_at,now()) FROM kutumb_email_campaigns c WHERE r.tracking_token=$1 AND c.id=r.campaign_id AND r.status='sent' AND r.opened_at IS NULL RETURNING c.id",[req.params.token]);if(rows[0])await pool.query("UPDATE kutumb_email_campaigns SET opened_count=opened_count+1 WHERE id=$1",[rows[0].id]);res.set("Cache-Control","no-store").type("gif").send(gif);}catch(error){console.error("EMAIL OPEN TRACKING ERROR:",error);res.status(200).type("gif").send(gif);}});
router.get("/click/:token",async(req,res)=>{try{const parsed=new URL(String(req.query.url||""));if(parsed.protocol!=="https:")return res.status(400).send("Only secure HTTPS links are allowed.");const {rows}=await pool.query("UPDATE kutumb_email_campaign_recipients r SET clicked_at=COALESCE(clicked_at,now()),click_count=click_count+1 FROM kutumb_email_campaigns c WHERE r.tracking_token=$1 AND c.id=r.campaign_id AND r.status='sent' RETURNING c.id",[req.params.token]);if(rows[0])await pool.query("UPDATE kutumb_email_campaigns SET clicked_count=clicked_count+1 WHERE id=$1",[rows[0].id]);res.redirect(302,parsed.toString());}catch(error){if(error instanceof TypeError)return res.status(400).send("Invalid link.");console.error("EMAIL CLICK TRACKING ERROR:",error);res.status(404).send("Link not available.");}});
router.get("/unsubscribe",(req,res)=>{const token=String(req.query.token||"");try{jwt.verify(token,jwtSecret(),{audience:"email-unsubscribe"});res.type("html").send(`<!doctype html><title>Email preferences</title><main style="max-width:36rem;margin:4rem auto;font:16px system-ui"><h1>Unsubscribe from updates</h1><p>Confirm that you want to stop non-essential emails from this organisation.</p><form method="post" action="/api/fundraising-tools/unsubscribe"><input type="hidden" name="token" value="${escapeHtml(token)}"><button>Unsubscribe</button></form></main>`);}catch{return res.status(400).send("This unsubscribe link is invalid or expired.");}});
router.post("/unsubscribe",async(req,res)=>{try{const token=String(req.body?.token||"");const payload=jwt.verify(token,jwtSecret(),{audience:"email-unsubscribe"});await pool.query("UPDATE kutumb_supporters SET email_opt_out=TRUE,email_consent=FALSE,consent_updated_at=now(),consent_source='email_unsubscribe',updated_at=now() WHERE id=$1 AND organisation_id=$2",[Number(payload.supporterId),Number(payload.organisationId)]);res.type("html").send("<!doctype html><title>Unsubscribed</title><main style=\"max-width:36rem;margin:4rem auto;font:16px system-ui\"><h1>You’re unsubscribed</h1><p>You will no longer receive non-essential emails from this organisation.</p></main>");}catch{return res.status(400).send("This unsubscribe link is invalid or expired.");}});

// Authenticated organisation workspace APIs.
router.use(authenticateAdminIdentity);

router.get("/org/:organisationId/auctions", requireOrganisation, permit("finance.view"), async (req, res) => {
  try { const { rows } = await pool.query(`SELECT a.*,COALESCE((SELECT max(b.amount) FROM kutumb_auction_bids b WHERE b.auction_id=a.id AND b.status IN ('leading','won')),a.starting_bid)::numeric(12,2) current_bid,
      (SELECT count(*)::int FROM kutumb_auction_bids b WHERE b.auction_id=a.id) bid_count FROM kutumb_auction_items a WHERE a.organisation_id=$1 ORDER BY a.created_at DESC`, [req.organisation.id]); res.json(rows); }
  catch (error) { console.error("AUCTION ADMIN LIST ERROR:", error); res.status(500).json({ message: "Could not load auction items" }); }
});

router.post("/org/:organisationId/auctions", requireOrganisation, permit("finance.manage"), async (req, res) => {
  const eventId = Number(req.body?.eventId); const title = String(req.body?.title || "").trim().slice(0,160);
  const start = Number(req.body?.startingBid); const increment = Number(req.body?.minimumIncrement || 1);
  const startsAt = req.body?.startsAt ? new Date(req.body.startsAt) : null; const endsAt = req.body?.endsAt ? new Date(req.body.endsAt) : null;
  if (!Number.isInteger(eventId) || title.length < 3 || !Number.isFinite(start) || start < 0 || start > maxMoney || !money(increment) || (startsAt && !Number.isFinite(startsAt.getTime())) || (endsAt && !Number.isFinite(endsAt.getTime())) || (startsAt && endsAt && startsAt >= endsAt)) return res.status(400).json({ message: "Enter an event, title, valid AUD starting amount and bidding dates." });
  try {
    const { rows: [event] } = await pool.query("SELECT id FROM kutumb_upcoming_events WHERE id=$1 AND organisation_id=$2", [eventId,req.organisation.id]);
    if (!event) return res.status(404).json({ message: "Event not found" });
    const { rows: [item] } = await pool.query("INSERT INTO kutumb_auction_items(organisation_id,event_id,title,description,starting_bid,minimum_increment,starts_at,ends_at,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'draft') RETURNING *", [req.organisation.id,eventId,title,String(req.body?.description||"").trim().slice(0,3000)||null,start,increment,startsAt,endsAt]);
    const slug = `${slugify(title).slice(0,60)||"auction"}-${item.id}`;
    const { rows: [saved] } = await pool.query("UPDATE kutumb_auction_items SET slug=$1 WHERE id=$2 RETURNING *", [slug,item.id]);
    res.status(201).json(saved);
  } catch (error) { console.error("AUCTION CREATE ERROR:", error); res.status(500).json({ message: "Could not create auction item" }); }
});

router.patch("/org/:organisationId/auctions/:auctionId", requireOrganisation, permit("finance.manage"), async (req,res) => {
  const status = String(req.body?.status || "");
  if (!(["draft","open","cancelled"].includes(status))) return res.status(400).json({message:"Choose draft, open or cancelled."});
  const { rows } = await pool.query("UPDATE kutumb_auction_items SET status=$1 WHERE id=$2 AND organisation_id=$3 AND status IN ('draft','open') RETURNING id,status", [status,Number(req.params.auctionId),req.organisation.id]);
  if (!rows[0]) return res.status(404).json({message:"Auction not found or already closed."});
  res.json(rows[0]);
});

router.post("/org/:organisationId/auctions/:auctionId/close", requireOrganisation, permit("finance.manage"), async (req,res) => {
  const client = await pool.connect(); const token = crypto.randomBytes(32).toString("base64url");
  try {
    await client.query("BEGIN");
    const { rows: [item] } = await client.query("SELECT * FROM kutumb_auction_items WHERE id=$1 AND organisation_id=$2 FOR UPDATE", [Number(req.params.auctionId),req.organisation.id]);
    if (!item || item.status !== "open") { await client.query("ROLLBACK"); return res.status(409).json({message:"Only an open auction can be closed."}); }
    const { rows: [leader] } = await client.query("SELECT * FROM kutumb_auction_bids WHERE auction_id=$1 AND status='leading' ORDER BY amount DESC,created_at ASC LIMIT 1 FOR UPDATE", [item.id]);
    if (!leader) {
      await client.query("UPDATE kutumb_auction_items SET status='closed',payment_status='not_applicable' WHERE id=$1", [item.id]);
      await client.query("COMMIT"); return res.json({ status:"closed", message:"Auction closed with no bids." });
    }
    await client.query("UPDATE kutumb_auction_bids SET status='won' WHERE id=$1", [leader.id]);
    await client.query("UPDATE kutumb_auction_items SET status='awarded',winning_amount=$1,winning_bidder=$2,winner_email=$3,winner_token_hash=$4,winner_token_expires_at=now()+interval '7 days',payment_status='due' WHERE id=$5", [leader.amount,leader.bidder_name,leader.bidder_email,tokenHash(token),item.id]);
    await client.query("COMMIT");
    const baseUrl=await getPublicBaseUrl(req); const checkoutUrl=`${baseUrl}/fundraising/auctions/${encodeURIComponent(item.slug)}?winner=${encodeURIComponent(token)}`;
    const sent=await sendTransactionalEmail({to:leader.bidder_email,subject:`You won: ${item.title}`,html:`<p>Hello ${escapeHtml(leader.bidder_name)},</p><p>Your winning bid of A$${Number(leader.amount).toFixed(2)} for <strong>${escapeHtml(item.title)}</strong> has been accepted.</p><p><a href="${escapeHtml(checkoutUrl)}">Complete checkout within 7 days</a>.</p><p>Contact the organisation if you need assistance.</p>`});
    res.json({ status:"awarded", winner:leader.bidder_name, amount:leader.amount, emailSent:sent.sent, checkoutUrl });
  } catch(error) { await client.query("ROLLBACK"); console.error("AUCTION CLOSE ERROR:",error); res.status(500).json({message:"Could not close auction"}); }
  finally {client.release();}
});

router.post("/auctions/:slug/checkout", async (req,res) => {
  const token=String(req.body?.winnerToken||"");
  if(token.length<32)return res.status(400).json({message:"A valid winner checkout link is required."});
  try {
    const {rows:[item]}=await pool.query("SELECT * FROM kutumb_auction_items WHERE slug=$1 AND status='awarded' AND payment_status='due' AND winner_token_hash=$2 AND winner_token_expires_at>now()",[req.params.slug,tokenHash(token)]);
    if(!item)return res.status(404).json({message:"This winner checkout link is invalid or expired."});
    const stripe=await getStripe();if(!stripe)return res.status(503).json({message:"Card checkout is unavailable. Please contact the organisation."});
    const baseUrl=await getPublicBaseUrl(req);
    const session=await stripe.checkout.sessions.create({mode:"payment",customer_email:item.winner_email,
      line_items:[{price_data:{currency:"aud",unit_amount:Math.round(Number(item.winning_amount)*100),product_data:{name:`Winning bid: ${item.title}`}},quantity:1}],
      metadata:{auctionId:String(item.id)},payment_intent_data:{receipt_email:item.winner_email,metadata:{auctionId:String(item.id)}},success_url:`${baseUrl}/fundraising/auction-return?session_id={CHECKOUT_SESSION_ID}`,cancel_url:`${baseUrl}/fundraising/auctions/${encodeURIComponent(item.slug)}`});
    await pool.query("UPDATE kutumb_auction_items SET stripe_session_id=$1 WHERE id=$2",[session.id,item.id]);
    res.json({url:session.url});
  }catch(error){console.error("AUCTION CHECKOUT ERROR:",error);res.status(500).json({message:"Could not start winner checkout"});}
});

router.get("/org/:organisationId/products", requireOrganisation, permit("finance.view"), async (req,res)=>{
  const {rows}=await pool.query("SELECT * FROM kutumb_store_products WHERE organisation_id=$1 ORDER BY created_at DESC",[req.organisation.id]);res.json(rows);
});
router.post("/org/:organisationId/products", requireOrganisation, permit("finance.manage"), async (req,res)=>{
  const name=String(req.body?.name||"").trim().slice(0,120), amount=Number(req.body?.price), stock=Number(req.body?.stock),shippingFee=Number(req.body?.shippingFee||0),requiresShipping=req.body?.requiresShipping===true;
  if(name.length<2||!money(amount)||!Number.isSafeInteger(stock)||stock<0||stock>1000000||!Number.isFinite(shippingFee)||shippingFee<0||shippingFee>maxMoney||Math.round(shippingFee*100)!==shippingFee*100)return res.status(400).json({message:"Add a product name, positive AUD price, whole-number stock and valid shipping amount."});
  try { const base=slugify(name).slice(0,70)||"product"; const slug=`${base}-${crypto.randomBytes(3).toString("hex")}`;
    const {rows}=await pool.query("INSERT INTO kutumb_store_products(organisation_id,name,slug,description,price,stock_on_hand,requires_shipping,shipping_fee,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *",[req.organisation.id,name,slug,String(req.body?.description||"").trim().slice(0,2000)||null,amount,stock,requiresShipping,requiresShipping?shippingFee:0,req.body?.status==="published"?"published":"draft"]);res.status(201).json(rows[0]);
  } catch(error){console.error("STORE PRODUCT CREATE ERROR:",error);res.status(500).json({message:"Could not create product"});}
});
router.patch("/org/:organisationId/products/:productId", requireOrganisation, permit("finance.manage"), async(req,res)=>{
  const {rows:[product]}=await pool.query("SELECT * FROM kutumb_store_products WHERE id=$1 AND organisation_id=$2",[Number(req.params.productId),req.organisation.id]);if(!product)return res.status(404).json({message:"Product not found"});
  const status=String(req.body?.status??product.status),stock=req.body?.stock==null?Number(product.stock_on_hand):Number(req.body.stock),price=req.body?.price==null?Number(product.price):Number(req.body.price);
  if(!["draft","published","paused"].includes(status)||!Number.isSafeInteger(stock)||stock<Number(product.stock_reserved)||stock>1000000||!money(price))return res.status(400).json({message:"Choose a valid status, price and stock count. Stock cannot be lower than currently reserved orders."});
  const {rows}=await pool.query("UPDATE kutumb_store_products SET status=$1,stock_on_hand=$2,price=$3,updated_at=now() WHERE id=$4 AND organisation_id=$5 RETURNING id,status,stock_on_hand,price",[status,stock,price,product.id,req.organisation.id]);res.json(rows[0]);
});
router.get("/org/:organisationId/store-orders",requireOrganisation,permit("finance.view"),async(req,res)=>{const {rows}=await pool.query(`SELECT o.id,o.buyer_name,o.buyer_email,o.total_amount,o.status,o.fulfilment_status,o.shipping_details,o.created_at,
  COALESCE(json_agg(json_build_object('name',i.product_name,'quantity',i.quantity,'unitPrice',i.unit_price)) FILTER(WHERE i.id IS NOT NULL),'[]'::json) items
  FROM kutumb_store_orders o LEFT JOIN kutumb_store_order_items i ON i.order_id=o.id WHERE o.organisation_id=$1 GROUP BY o.id ORDER BY o.created_at DESC LIMIT 500`,[req.organisation.id]);res.json(rows);});
router.patch("/org/:organisationId/store-orders/:orderId",requireOrganisation,permit("finance.manage"),async(req,res)=>{const status=String(req.body?.fulfilmentStatus||"");if(!["unfulfilled","fulfilled","cancelled"].includes(status))return res.status(400).json({message:"Choose a valid fulfilment status."});const {rows}=await pool.query("UPDATE kutumb_store_orders SET fulfilment_status=$1,updated_at=now() WHERE id=$2 AND organisation_id=$3 AND status='paid' RETURNING id,fulfilment_status",[status,Number(req.params.orderId),req.organisation.id]);if(!rows[0])return res.status(404).json({message:"Paid order not found"});res.json(rows[0]);});

router.post("/stores/:organisationSlug/checkout", async(req,res)=>{
  const name=String(req.body?.name||"").trim().slice(0,120),email=String(req.body?.email||"").trim().toLowerCase().slice(0,254);
  const items=Array.isArray(req.body?.items)?req.body.items.slice(0,30):[];
  if(name.length<2||!emailPattern.test(email)||!items.length)return res.status(400).json({message:"Enter your name, email and at least one product."});
  const client=await pool.connect();let orderId=null;
  try {
    await client.query("BEGIN");const {rows:[org]}=await client.query("SELECT id,slug FROM kutumb_organisations WHERE slug=$1 AND is_active=TRUE AND public_profile_enabled=TRUE AND verification_status='approved'",[req.params.organisationSlug]);
    if(!org){await client.query("ROLLBACK");return res.status(404).json({message:"Store not found"});}
    const quantities=new Map();for(const item of items){const id=Number(item.id),qty=Number(item.quantity);if(!Number.isSafeInteger(id)||id<1||!Number.isSafeInteger(qty)||qty<1||qty>50){await client.query("ROLLBACK");return res.status(400).json({message:"Invalid product quantity."});}quantities.set(id,(quantities.get(id)||0)+qty);}
    let total=0;const products=[];
    for(const [id,qty] of quantities){const {rows:[product]}=await client.query("SELECT * FROM kutumb_store_products WHERE id=$1 AND organisation_id=$2 AND status='published' FOR UPDATE",[id,org.id]);if(!product||Number(product.stock_on_hand)-Number(product.stock_reserved)<qty){await client.query("ROLLBACK");return res.status(409).json({message:"A product is unavailable or has insufficient stock."});}await client.query("UPDATE kutumb_store_products SET stock_reserved=stock_reserved+$1,updated_at=now() WHERE id=$2",[qty,id]);total+=Number(product.price)*qty;products.push({...product,quantity:qty});}
    const needsShipping=products.some(p=>p.requires_shipping);const shippingFee=needsShipping?Math.max(...products.filter(p=>p.requires_shipping).map(p=>Number(p.shipping_fee)||0)):0;total=Math.round(total*100)/100+shippingFee;
    const {rows:[order]}=await client.query("INSERT INTO kutumb_store_orders(organisation_id,buyer_name,buyer_email,total_amount) VALUES($1,$2,$3,$4) RETURNING id",[org.id,name,email,total]);orderId=order.id;
    for(const product of products)await client.query("INSERT INTO kutumb_store_order_items(order_id,product_id,product_name,quantity,unit_price) VALUES($1,$2,$3,$4,$5)",[order.id,product.id,product.name,product.quantity,product.price]);
    await client.query("COMMIT");
    const stripe=await getStripe();if(!stripe)throw new Error("Card checkout is not configured.");
    const baseUrl=await getPublicBaseUrl(req);const lineItems=products.map(p=>({price_data:{currency:"aud",unit_amount:Math.round(Number(p.price)*100),product_data:{name:p.name}},quantity:p.quantity}));if(needsShipping&&shippingFee>0)lineItems.push({price_data:{currency:"aud",unit_amount:Math.round(shippingFee*100),product_data:{name:"Shipping"}},quantity:1});const session=await stripe.checkout.sessions.create({mode:"payment",customer_email:email,
      line_items:lineItems,...(needsShipping?{shipping_address_collection:{allowed_countries:["AU"]}}:{}),
      metadata:{storeOrderId:String(order.id),organisationId:String(org.id)},payment_intent_data:{receipt_email:email,metadata:{storeOrderId:String(order.id),organisationId:String(org.id)}},success_url:`${baseUrl}/fundraising/store-return?session_id={CHECKOUT_SESSION_ID}`,cancel_url:`${baseUrl}/stores/${encodeURIComponent(org.slug)}`});
    await pool.query("UPDATE kutumb_store_orders SET stripe_session_id=$1,updated_at=now() WHERE id=$2",[session.id,order.id]);res.json({url:session.url});
  }catch(error){if(client){try{await client.query("ROLLBACK")}catch{}}if(orderId){await releaseStoreReservation(orderId,"cancelled").catch(()=>{});}console.error("STORE CHECKOUT ERROR:",error);res.status(error.message?.includes("not configured")?503:500).json({message:error.message||"Could not start checkout"});}
  finally{client.release();}
});

router.get("/checkout-status",async(req,res)=>{
  const id=String(req.query.session_id||"");if(!id.startsWith("cs_")||id.length>255)return res.status(400).json({message:"Invalid checkout session."});
  try{const stripe=await getStripe();if(!stripe)return res.status(503).json({message:"Payment verification is unavailable."});const session=await stripe.checkout.sessions.retrieve(id);
    const paid=session.payment_status==="paid"||(session.mode==="subscription"&&session.status==="complete"&&session.subscription);
    if(!paid)return res.json({status:session.status==="expired"?"expired":"pending"});
    if(session.metadata?.auctionId){const {rows:[auction]}=await pool.query("UPDATE kutumb_auction_items SET payment_status='paid',stripe_payment_intent=$1,winner_token_hash=NULL,winner_token_expires_at=NULL WHERE id=$2 AND stripe_session_id=$3 AND payment_status='due' RETURNING organisation_id,winning_amount,id",[session.payment_intent,Number(session.metadata.auctionId),id]);if(auction)await pool.query("INSERT INTO kutumb_settlement_ledger(organisation_id,entry_type,amount,source_type,source_id,provider_reference,note) VALUES($1,'auction_payment',$2,'auction_item',$3,$4,'Auction winning bid paid') ON CONFLICT(entry_type,source_type,source_id) DO NOTHING",[auction.organisation_id,auction.winning_amount,String(auction.id),session.payment_intent]);}
    if(session.metadata?.storeOrderId)await releaseStoreReservation(Number(session.metadata.storeOrderId),"paid",session.payment_intent,session.shipping_details||session.collected_information?.shipping_details||null);
    if(session.metadata?.membershipId){await pool.query("UPDATE kutumb_paid_memberships SET status='active',stripe_customer_id=$1,stripe_subscription_id=$2,updated_at=now() WHERE id=$3 AND stripe_session_id=$4",[session.customer,session.subscription,Number(session.metadata.membershipId),id]);}
    res.json({status:session.mode==="subscription"?"active":"paid"});
  }catch(error){console.error("FUNDRAISING PAYMENT STATUS ERROR:",error);res.status(500).json({message:"Could not verify payment"});}
});

async function releaseStoreReservation(orderId,status,paymentIntent=null,shippingDetails=null){
  const client=await pool.connect();try{await client.query("BEGIN");const {rows:[order]}=await client.query("SELECT id,organisation_id,total_amount,status,inventory_released_at FROM kutumb_store_orders WHERE id=$1 FOR UPDATE",[orderId]);if(!order||order.inventory_released_at){await client.query("COMMIT");return;}const {rows:items}=await client.query("SELECT product_id,quantity FROM kutumb_store_order_items WHERE order_id=$1",[orderId]);for(const item of items)await client.query("UPDATE kutumb_store_products SET stock_reserved=GREATEST(0,stock_reserved-$1),stock_on_hand=CASE WHEN $2='paid' THEN GREATEST(0,stock_on_hand-$1) ELSE stock_on_hand END,updated_at=now() WHERE id=$3",[item.quantity,status,item.product_id]);await client.query("UPDATE kutumb_store_orders SET status=$1,stripe_payment_intent=COALESCE($2,stripe_payment_intent),shipping_details=COALESCE($3,shipping_details),inventory_released_at=now(),updated_at=now() WHERE id=$4",[status,paymentIntent,shippingDetails?JSON.stringify(shippingDetails):null,orderId]);if(status==="paid")await client.query("INSERT INTO kutumb_settlement_ledger(organisation_id,entry_type,amount,source_type,source_id,provider_reference,note) VALUES($1,'store_payment',$2,'store_order',$3,$4,'Online store checkout paid') ON CONFLICT(entry_type,source_type,source_id) DO NOTHING",[order.organisation_id,order.total_amount,String(order.id),paymentIntent]);await client.query("COMMIT");}catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
}

router.get("/org/:organisationId/membership-tiers",requireOrganisation,permit("finance.view"),async(req,res)=>{const {rows}=await pool.query("SELECT * FROM kutumb_membership_tiers WHERE organisation_id=$1 ORDER BY amount",[req.organisation.id]);res.json(rows);});
router.post("/org/:organisationId/membership-tiers",requireOrganisation,permit("finance.manage"),async(req,res)=>{
  const name=String(req.body?.name||"").trim().slice(0,100),amount=Number(req.body?.amount),interval=String(req.body?.interval||"");if(name.length<2||!money(amount)||!(["month","year"].includes(interval)))return res.status(400).json({message:"Enter a tier name, positive amount and monthly or annual billing interval."});
  const slug=`${slugify(name).slice(0,60)||"tier"}-${crypto.randomBytes(3).toString("hex")}`;const {rows}=await pool.query("INSERT INTO kutumb_membership_tiers(organisation_id,name,slug,description,amount,billing_interval,status) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *",[req.organisation.id,name,slug,String(req.body?.description||"").trim().slice(0,1200)||null,amount,interval,req.body?.status==="published"?"published":"draft"]);res.status(201).json(rows[0]);
});
router.patch("/org/:organisationId/membership-tiers/:tierId",requireOrganisation,permit("finance.manage"),async(req,res)=>{const status=String(req.body?.status||"");if(!["draft","published","paused"].includes(status))return res.status(400).json({message:"Choose draft, published or paused."});const {rows}=await pool.query("UPDATE kutumb_membership_tiers SET status=$1 WHERE id=$2 AND organisation_id=$3 RETURNING id,status",[status,Number(req.params.tierId),req.organisation.id]);if(!rows[0])return res.status(404).json({message:"Membership tier not found"});res.json(rows[0]);});
router.get("/org/:organisationId/memberships",requireOrganisation,permit("finance.view"),async(req,res)=>{const {rows}=await pool.query("SELECT m.id,m.member_name,m.member_email,m.status,m.current_period_end,m.cancel_at_period_end,m.created_at,t.name tier_name,t.amount,t.billing_interval FROM kutumb_paid_memberships m JOIN kutumb_membership_tiers t ON t.id=m.tier_id WHERE m.organisation_id=$1 ORDER BY m.created_at DESC LIMIT 500",[req.organisation.id]);res.json(rows);});

const segmentKeys=new Set(["minimumLifetimeAmount","minimumDonationCount","donatedWithinDays","source"]);
function validateCriteria(input){if(!input||typeof input!=="object"||Array.isArray(input))return null;const out={};for(const [key,value] of Object.entries(input)){if(!segmentKeys.has(key))return null;if(key==="minimumLifetimeAmount"){if(!Number.isFinite(Number(value))||Number(value)<0||Number(value)>maxMoney)return null;out[key]=Number(value);}else if(key==="minimumDonationCount"){if(!Number.isSafeInteger(Number(value))||Number(value)<1||Number(value)>100000)return null;out[key]=Number(value);}else if(key==="donatedWithinDays"){if(!Number.isSafeInteger(Number(value))||Number(value)<1||Number(value)>3650)return null;out[key]=Number(value);}else {const text=String(value||"").trim();if(text.length>100)return null;out[key]=text;}}return out;}
function segmentSql(criteria){const checks=[];const params=[];const add=(sql,value)=>{params.push(value);checks.push(sql.replace("?",`$${params.length}`));};if(criteria.minimumLifetimeAmount!==undefined)add("COALESCE((SELECT sum(d.amount) FROM kutumb_donations d WHERE d.supporter_id=s.id AND d.organisation_id=s.organisation_id AND lower(d.payment_status)='paid'),0)>=?",criteria.minimumLifetimeAmount);if(criteria.minimumDonationCount!==undefined)add("(SELECT count(*) FROM kutumb_donations d WHERE d.supporter_id=s.id AND d.organisation_id=s.organisation_id AND lower(d.payment_status)='paid')>=?",criteria.minimumDonationCount);if(criteria.donatedWithinDays!==undefined)add("EXISTS(SELECT 1 FROM kutumb_donations d WHERE d.supporter_id=s.id AND d.organisation_id=s.organisation_id AND lower(d.payment_status)='paid' AND d.created_at>=now()-make_interval(days=>?))",criteria.donatedWithinDays);if(criteria.source)add("s.source=?",criteria.source);if(criteria.state)add("s.state=?",criteria.state);return {where:checks.length?checks.join(" AND "):"TRUE",params};}
async function segmentStats(orgId,criteria){const {where,params}=segmentSql(criteria);const {rows:[stats]}=await pool.query(`SELECT count(*)::int total,count(*) FILTER(WHERE s.email_consent=TRUE AND s.email_opt_out=FALSE)::int emailable FROM kutumb_supporters s WHERE s.organisation_id=$1 AND s.merged_into_id IS NULL AND ${where}`,[orgId,...params]);return stats;}
router.get("/org/:organisationId/segments",requireOrganisation,permit("supporters.view"),async(req,res)=>{try{const {rows}=await pool.query("SELECT id,name,criteria,created_at FROM kutumb_donor_segments WHERE organisation_id=$1 ORDER BY name",[req.organisation.id]);const segments=await Promise.all(rows.map(async s=>({...s,...await segmentStats(req.organisation.id,s.criteria||{})})));res.json(segments);}catch(error){console.error("SEGMENTS LIST ERROR:",error);res.status(500).json({message:"Could not load donor segments"});}});
router.post("/org/:organisationId/segments",requireOrganisation,permit("supporters.manage"),async(req,res)=>{const name=String(req.body?.name||"").trim().slice(0,100),criteria=validateCriteria(req.body?.criteria);if(name.length<2||!criteria)return res.status(400).json({message:"Enter a segment name and supported criteria."});try{const {rows}=await pool.query("INSERT INTO kutumb_donor_segments(organisation_id,name,criteria,created_by_admin_id) VALUES($1,$2,$3,$4) RETURNING *",[req.organisation.id,name,JSON.stringify(criteria),req.admin.id]);res.status(201).json({...rows[0],...await segmentStats(req.organisation.id,criteria)});}catch(error){if(error.code==="23505")return res.status(409).json({message:"A segment with that name already exists."});console.error("SEGMENT CREATE ERROR:",error);res.status(500).json({message:"Could not save donor segment"});}});
router.delete("/org/:organisationId/segments/:segmentId",requireOrganisation,permit("supporters.manage"),async(req,res)=>{const {rowCount}=await pool.query("DELETE FROM kutumb_donor_segments WHERE id=$1 AND organisation_id=$2",[Number(req.params.segmentId),req.organisation.id]);if(!rowCount)return res.status(404).json({message:"Segment not found"});res.status(204).end();});

router.get("/org/:organisationId/email-campaigns",requireOrganisation,permit("supporters.view"),async(req,res)=>{const {rows}=await pool.query("SELECT c.id,c.title,c.subject,c.status,c.send_at,c.sent_count,c.opened_count,c.clicked_count,c.failed_count,c.created_at,s.name segment_name FROM kutumb_email_campaigns c LEFT JOIN kutumb_donor_segments s ON s.id=c.segment_id WHERE c.organisation_id=$1 ORDER BY c.created_at DESC LIMIT 200",[req.organisation.id]);res.json(rows);});
router.post("/org/:organisationId/email-campaigns",requireOrganisation,permit("supporters.manage"),async(req,res)=>{
  const title=String(req.body?.title||"").trim().slice(0,120),subject=String(req.body?.subject||"").trim().slice(0,180),body=String(req.body?.body||"").trim().slice(0,12000),segmentId=req.body?.segmentId?Number(req.body.segmentId):null,sendAt=req.body?.sendAt?new Date(req.body.sendAt):null;
  if(title.length<2||subject.length<3||body.length<2||(req.body?.sendAt&&(!sendAt||!Number.isFinite(sendAt.getTime()))) )return res.status(400).json({message:"Enter a campaign name, subject, message and valid optional send time."});
  try{if(segmentId){const s=await pool.query("SELECT id FROM kutumb_donor_segments WHERE id=$1 AND organisation_id=$2",[segmentId,req.organisation.id]);if(!s.rows[0])return res.status(400).json({message:"Choose a donor segment from this organisation."});}
    if(sendAt){const {rows:[profile]}=await pool.query("SELECT legal_name,contact_email,address_line1,suburb,state,postcode FROM kutumb_organisations WHERE id=$1",[req.organisation.id]);if(!profile?.legal_name||!emailPattern.test(String(profile.contact_email||""))||![profile.address_line1,profile.suburb,profile.state,profile.postcode].every(value=>String(value||"").trim()))return res.status(400).json({message:"Add the organisation’s legal name, working contact email and postal address before scheduling email updates."});const emailBase=await getConfiguredPublicBaseUrl();if(!emailBase||!emailBase.startsWith("https://")||isLocalUrl(emailBase))return res.status(400).json({message:"Set a public HTTPS website address before scheduling email updates so unsubscribe links work."});}
    const status=sendAt?"scheduled":"draft";const {rows}=await pool.query("INSERT INTO kutumb_email_campaigns(organisation_id,segment_id,title,subject,body_text,status,send_at,created_by_admin_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",[req.organisation.id,segmentId,title,subject,body,status,sendAt,req.admin.id]);res.status(201).json(rows[0]);
  }catch(error){console.error("EMAIL CAMPAIGN CREATE ERROR:",error);res.status(500).json({message:"Could not save email campaign"});}
});
router.post("/org/:organisationId/email-campaigns/:campaignId/send",requireOrganisation,permit("supporters.manage"),async(req,res)=>{try{const {rows:[profile]}=await pool.query("SELECT legal_name,contact_email,address_line1,suburb,state,postcode FROM kutumb_organisations WHERE id=$1",[req.organisation.id]);if(!profile?.legal_name||!emailPattern.test(String(profile.contact_email||""))||![profile.address_line1,profile.suburb,profile.state,profile.postcode].every(value=>String(value||"").trim()))return res.status(400).json({message:"Add the organisation’s legal name, working contact email and postal address before sending email updates."});const emailBase=await getConfiguredPublicBaseUrl();if(!emailBase||!emailBase.startsWith("https://")||isLocalUrl(emailBase))return res.status(400).json({message:"Set a public HTTPS website address before sending email updates so unsubscribe links work."});const {rows}=await pool.query("UPDATE kutumb_email_campaigns SET status='scheduled',send_at=now(),updated_at=now() WHERE id=$1 AND organisation_id=$2 AND status='draft' RETURNING id",[Number(req.params.campaignId),req.organisation.id]);if(!rows[0])return res.status(409).json({message:"Only a draft campaign can be sent."});res.status(202).json({message:"Campaign queued. Only supporters with current email consent will receive it."});}catch(error){console.error("EMAIL CAMPAIGN QUEUE ERROR:",error);res.status(500).json({message:"Could not queue email campaign"});}});
router.post("/org/:organisationId/email-campaigns/:campaignId/cancel",requireOrganisation,permit("supporters.manage"),async(req,res)=>{const {rows}=await pool.query("UPDATE kutumb_email_campaigns SET status='cancelled',updated_at=now() WHERE id=$1 AND organisation_id=$2 AND status='scheduled' RETURNING id,status",[Number(req.params.campaignId),req.organisation.id]);if(!rows[0])return res.status(409).json({message:"Campaign is not waiting to be sent."});res.json(rows[0]);});

// A campaign can only be sent to currently consented, non-opted-out contacts.
async function processEmailCampaign(campaignId){
  const client=await pool.connect();let campaign;let recipients=[];
  try{await client.query("BEGIN");const {rows}=await client.query(`UPDATE kutumb_email_campaigns c SET status='sending',updated_at=now() FROM kutumb_organisations o WHERE c.id=$1 AND c.organisation_id=o.id AND c.status='scheduled' AND c.send_at<=now() RETURNING c.*,o.public_name,o.legal_name,o.abn,o.contact_email,o.address_line1,o.suburb,o.state,o.postcode`,[campaignId]);campaign=rows[0];if(!campaign){await client.query("ROLLBACK");return;}let query=`SELECT s.id,s.display_name,s.email FROM kutumb_supporters s WHERE s.organisation_id=$1 AND s.merged_into_id IS NULL AND s.email_consent=TRUE AND s.email_opt_out=FALSE AND s.email IS NOT NULL AND s.email<>''`;const params=[campaign.organisation_id];if(campaign.segment_id){const {rows:[segment]}=await client.query("SELECT criteria FROM kutumb_donor_segments WHERE id=$1 AND organisation_id=$2",[campaign.segment_id,campaign.organisation_id]);if(segment){const rules=segmentSql(segment.criteria||{});query+=` AND ${rules.where}`;params.push(...rules.params);}}
    const {rows:contacts}=await client.query(`${query} ORDER BY s.id LIMIT 10000`,params);recipients=contacts;
    for(const person of recipients)await client.query("INSERT INTO kutumb_email_campaign_recipients(campaign_id,supporter_id,tracking_token) VALUES($1,$2,$3) ON CONFLICT(campaign_id,supporter_id) DO NOTHING",[campaign.id,person.id,crypto.randomBytes(24).toString("base64url")]);
    await client.query("COMMIT");
  }catch(error){await client.query("ROLLBACK");console.error("EMAIL CAMPAIGN PREP ERROR:",error);return;}finally{client.release();}
  let sent=0,failed=0;
  const base=await getConfiguredPublicBaseUrl();
  if(!base||!base.startsWith("https://")||isLocalUrl(base)||!campaign.legal_name||!emailPattern.test(String(campaign.contact_email||""))||![campaign.address_line1,campaign.suburb,campaign.state,campaign.postcode].every(value=>String(value||"").trim())){
    await pool.query("UPDATE kutumb_email_campaign_recipients SET status='failed',error_code='sender_details_missing' WHERE campaign_id=$1 AND status='pending'",[campaign.id]);
    await pool.query("UPDATE kutumb_email_campaigns SET status='failed',failed_count=(SELECT count(*)::int FROM kutumb_email_campaign_recipients WHERE campaign_id=$1 AND status='failed'),updated_at=now() WHERE id=$1",[campaign.id]);
    return;
  }
  for(const person of recipients){
    const {rows:[recipient]}=await pool.query("SELECT r.tracking_token,s.email,s.email_consent,s.email_opt_out FROM kutumb_email_campaign_recipients r JOIN kutumb_supporters s ON s.id=r.supporter_id AND s.organisation_id=$3 WHERE r.campaign_id=$1 AND r.supporter_id=$2 AND r.status='pending'",[campaign.id,person.id,campaign.organisation_id]);if(!recipient)continue;if(!recipient.email_consent||recipient.email_opt_out){await pool.query("UPDATE kutumb_email_campaign_recipients SET status='unsubscribed' WHERE campaign_id=$1 AND supporter_id=$2",[campaign.id,person.id]);continue;}
    const unsubscribe=jwt.sign({supporterId:person.id,organisationId:campaign.organisation_id},jwtSecret(),{expiresIn:"180d",audience:"email-unsubscribe"});
    const senderName=campaign.legal_name||campaign.public_name;const message=escapeHtml(campaign.body_text).replace(/(https:\/\/[^\s<]+)/g,(url)=>`<a href="${escapeHtml(base)}/api/fundraising-tools/click/${encodeURIComponent(recipient.tracking_token)}?url=${encodeURIComponent(url)}" rel="noreferrer">${url}</a>`);
    const html=`<div style="font-family:Arial,sans-serif;max-width:640px;margin:auto"><p>Hello ${escapeHtml(person.display_name||"there")},</p><div style="white-space:pre-wrap;line-height:1.6">${message}</div><hr><p style="font-size:12px;color:#666">Sent by ${escapeHtml(senderName)}${campaign.abn?` (ABN ${escapeHtml(campaign.abn)})`:""}${campaign.contact_email?` · <a href="mailto:${escapeHtml(campaign.contact_email)}">${escapeHtml(campaign.contact_email)}</a>`:""}. You received this update because you opted in. <a href="${escapeHtml(base)}/api/fundraising-tools/unsubscribe?token=${encodeURIComponent(unsubscribe)}">Unsubscribe</a></p><img width="1" height="1" alt="" src="${escapeHtml(base)}/api/fundraising-tools/track/${encodeURIComponent(recipient.tracking_token)}.gif"></div>`;
    const result=await sendTransactionalEmail({to:recipient.email,subject:campaign.subject,html});
    await pool.query("UPDATE kutumb_email_campaign_recipients SET status=$1,sent_at=CASE WHEN $1='sent' THEN now() ELSE sent_at END,error_code=$2 WHERE campaign_id=$3 AND supporter_id=$4",[result.sent?"sent":"failed",result.sent?null:String(result.error||"send_failed").slice(0,80),campaign.id,person.id]);
    if(result.sent)sent++;else failed++;
  }
  await pool.query("UPDATE kutumb_email_campaigns SET status=CASE WHEN $1=0 AND $2>0 THEN 'failed' ELSE 'sent' END,sent_count=$1,failed_count=$2,updated_at=now() WHERE id=$3",[sent,failed,campaign.id]);
}

export async function processDueFundraisingEmails(){
  try{const {rows}=await pool.query("SELECT id FROM kutumb_email_campaigns WHERE status='scheduled' AND send_at<=now() ORDER BY send_at LIMIT 10");for(const row of rows)await processEmailCampaign(row.id);}catch(error){console.error("SCHEDULED FUNDRAISING EMAIL ERROR:",error);}
}

export async function handleFundraisingStripeEvent(event){
  const session=event.data?.object;
    if(event.type==="checkout.session.completed"&&session?.payment_status==="paid"&&session.metadata?.auctionId){const {rows:[auction]}=await pool.query("UPDATE kutumb_auction_items SET payment_status='paid',stripe_payment_intent=$1,winner_token_hash=NULL,winner_token_expires_at=NULL WHERE id=$2 AND stripe_session_id=$3 AND payment_status='due' RETURNING organisation_id,winning_amount,id",[session.payment_intent,Number(session.metadata.auctionId),session.id]);if(auction)await pool.query("INSERT INTO kutumb_settlement_ledger(organisation_id,entry_type,amount,source_type,source_id,provider_reference,note) VALUES($1,'auction_payment',$2,'auction_item',$3,$4,'Auction winning bid paid') ON CONFLICT(entry_type,source_type,source_id) DO NOTHING",[auction.organisation_id,auction.winning_amount,String(auction.id),session.payment_intent]);}
    if(event.type==="checkout.session.completed"&&session?.payment_status==="paid"&&session.metadata?.storeOrderId){await releaseStoreReservation(Number(session.metadata.storeOrderId),"paid",session.payment_intent,session.shipping_details||session.collected_information?.shipping_details||null);}
    if(event.type==="checkout.session.expired"&&session?.metadata?.storeOrderId){await releaseStoreReservation(Number(session.metadata.storeOrderId),"expired");}
    if(event.type==="checkout.session.completed"&&session?.metadata?.membershipId&&(session.payment_status==="paid"||session.payment_status==="no_payment_required")){await pool.query("UPDATE kutumb_paid_memberships SET status='active',stripe_customer_id=$1,stripe_subscription_id=$2,updated_at=now() WHERE id=$3 AND stripe_session_id=$4",[session.customer,session.subscription,Number(session.metadata.membershipId),session.id]);}
    if(["customer.subscription.updated","customer.subscription.deleted"].includes(event.type)&&session?.metadata?.membershipId){const status=session.status==="active"?"active":session.status==="past_due"?"past_due":session.status==="canceled"?"cancelled":"pending";await pool.query("UPDATE kutumb_paid_memberships SET status=$1,cancel_at_period_end=$2,current_period_end=to_timestamp($3),updated_at=now() WHERE id=$4",[status,session.cancel_at_period_end===true,session.current_period_end||0,Number(session.metadata.membershipId)]);}
    if(event.type==="invoice.paid"){const subscriptionId=session.subscription||session.parent?.subscription_details?.subscription;if(subscriptionId){const {rows:[membership]}=await pool.query("UPDATE kutumb_paid_memberships SET status='active',current_period_end=to_timestamp($1),updated_at=now() WHERE stripe_subscription_id=$2 RETURNING id,organisation_id",[session.lines?.data?.[0]?.period?.end||0,subscriptionId]);if(membership&&Number(session.amount_paid)>0)await pool.query("INSERT INTO kutumb_settlement_ledger(organisation_id,entry_type,amount,source_type,source_id,provider_reference,note) VALUES($1,'membership_payment',$2,'membership_invoice',$3,$4,'Recurring membership payment received') ON CONFLICT(entry_type,source_type,source_id) DO NOTHING",[membership.organisation_id,Number(session.amount_paid)/100,String(session.id),session.payment_intent||null]);}}
    if(event.type==="invoice.payment_failed"){const subscriptionId=session.subscription||session.parent?.subscription_details?.subscription;if(subscriptionId)await pool.query("UPDATE kutumb_paid_memberships SET status='past_due',updated_at=now() WHERE stripe_subscription_id=$1 AND status<>'cancelled'",[subscriptionId]);}
    if(event.type==="charge.refunded"&&session.refunded===true){const paymentIntent=typeof session.payment_intent==="string"?session.payment_intent:session.payment_intent?.id;const refundAmount=-Number(session.amount_refunded||0)/100;if(paymentIntent&&refundAmount<0){const {rows:[auction]}=await pool.query("UPDATE kutumb_auction_items SET payment_status='refunded' WHERE stripe_payment_intent=$1 AND payment_status='paid' RETURNING id,organisation_id",[paymentIntent]);if(auction)await pool.query("INSERT INTO kutumb_settlement_ledger(organisation_id,entry_type,amount,source_type,source_id,provider_reference,note) VALUES($1,'auction_refund',$2,'auction_item',$3,$4,'Auction checkout refunded') ON CONFLICT(entry_type,source_type,source_id) DO NOTHING",[auction.organisation_id,refundAmount,String(auction.id),paymentIntent]);const {rows:[order]}=await pool.query("UPDATE kutumb_store_orders SET status='refunded',updated_at=now() WHERE stripe_payment_intent=$1 AND status='paid' RETURNING id,organisation_id",[paymentIntent]);if(order)await pool.query("INSERT INTO kutumb_settlement_ledger(organisation_id,entry_type,amount,source_type,source_id,provider_reference,note) VALUES($1,'store_refund',$2,'store_order',$3,$4,'Store order refunded') ON CONFLICT(entry_type,source_type,source_id) DO NOTHING",[order.organisation_id,refundAmount,String(order.id),paymentIntent]);}}
}

export default router;
