import { Router } from "express";
import crypto from "crypto";
import { pool } from "../db/pool.js";
import { requireAdmin } from "../lib/auth.js";
import { getStripe } from "../lib/stripeClient.js";
import { handleFundraisingStripeEvent } from "./fundraisingTools.routes.js";
import { getSetting } from "../lib/settings.js";
import { getPublicBaseUrl } from "../lib/publicUrl.js";
import { logAudit } from "../lib/audit.js";
import { slugify } from "../lib/slugify.js";
import { findDonationPaymentByReference, markDonationPaymentPaid } from "../lib/donationPayments.js";
import { findPaymentByReference, markPaymentPaid } from "../lib/registrationPayments.js";
import { sendTicketOrderTickets } from "../lib/tickets.js";
import { parseEventStartDate } from "../lib/eventDates.js";

const router = Router();

async function confirmPaidTicketOrder(orderId, paymentIntent) {
  const client = await pool.connect();
  let confirmedOrder = null;
  try {
    await client.query("BEGIN");
    const { rows } = await client.query("UPDATE kutumb_orders SET status='paid',stripe_payment_intent=$2 WHERE id=$1 AND status='pending' RETURNING *", [orderId, paymentIntent || null]);
    confirmedOrder = rows[0] || null;
    if (!confirmedOrder) { await client.query("COMMIT"); return null; }
    if (Number(confirmedOrder.total_cents) > 0) {
      await client.query(
        `INSERT INTO kutumb_settlement_ledger (organisation_id,entry_type,amount,source_type,source_id,provider_reference,note)
         VALUES ($1,'ticket_payment',$2,'ticket_order',$3,$4,'Ticket payment received into the Kutumb account')
         ON CONFLICT (entry_type,source_type,source_id) DO NOTHING`,
        [confirmedOrder.organisation_id || 1, Number(confirmedOrder.total_cents) / 100, String(confirmedOrder.id), paymentIntent || null]
      );
    }
    const { rows: items } = await client.query("SELECT * FROM kutumb_order_items WHERE order_id=$1", [orderId]);
    for (const item of items) {
      for (let n = 0; n < item.quantity; n++) {
        await client.query("INSERT INTO kutumb_attendees(order_item_id,event_id,name,email,qr_token,organisation_id) VALUES($1,$2,$3,$4,$5,$6)",
          [item.id, confirmedOrder.event_id, confirmedOrder.buyer_name, confirmedOrder.buyer_email, crypto.randomBytes(16).toString("hex"), confirmedOrder.organisation_id || 1]);
      }
    }
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; }
  finally { client.release(); }
  await sendTicketOrderTickets(orderId);
  return confirmedOrder;
}

// Ticket types are keyed by a plain slug (eventId), not a foreign key to
// kutumb_upcoming_events — this looks the real event row back up by
// matching its slugified title, so we can enforce "ticket type seats can't
// add up to more than the event's total capacity".
async function findEventBySlug(eventId) {
  const { rows } = await pool.query("SELECT * FROM kutumb_upcoming_events");
  return rows.find((e) => slugify(e.title) === eventId) || null;
}

async function getAllocatedSeats(eventId, excludeTicketTypeId = null) {
  const { rows } = await pool.query(
    excludeTicketTypeId
      ? "SELECT COALESCE(SUM(quantity_total),0) AS total FROM kutumb_ticket_types WHERE event_id = $1 AND id != $2"
      : "SELECT COALESCE(SUM(quantity_total),0) AS total FROM kutumb_ticket_types WHERE event_id = $1",
    excludeTicketTypeId ? [eventId, excludeTicketTypeId] : [eventId]
  );
  return Number(rows[0].total);
}

/* ============================================================
   PUBLIC: Stripe publishable key for the storefront's Stripe.js SDK.
   Safe to expose — the publishable key is designed to be public (it's
   embedded in every Stripe.js page load on any site that uses it). The
   secret key never leaves the server.
   ============================================================ */
router.get("/config", async (req, res) => {
  const publishableKey = await getSetting("stripe_publishable_key");
  res.json({ publishableKey: publishableKey || null });
});

/* ============================================================
   ADMIN: manage ticket types, view orders/waitlist for an event
   ============================================================ */
router.get("/admin/:eventId/ticket-types", requireAdmin, async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM kutumb_ticket_types WHERE event_id = $1 ORDER BY id", [req.params.eventId]);
  const event = await findEventBySlug(req.params.eventId);
  const allocated = rows.reduce((sum, tt) => sum + tt.quantity_total, 0);
  res.json({
    ticketTypes: rows,
    capacity: event ? Number(event.capacity) : null,
    allocated,
    remaining: event ? Math.max(Number(event.capacity) - allocated, 0) : null,
  });
});

router.post("/admin/:eventId/ticket-types", requireAdmin, async (req, res) => {
  const { name, description, priceCents, quantityTotal, salesStartAt, salesEndAt, earlyBirdPriceCents, earlyBirdEndAt, isPrivate, minPerOrder, maxPerOrder, pricingMode, minimumPriceCents, maximumPriceCents, groupMinQuantity, groupPriceCents } = req.body;
  if (!name?.trim()) return res.status(400).json({ message: "Ticket type name is required" });

  const start = salesStartAt ? new Date(salesStartAt) : null;
  const end = salesEndAt ? new Date(salesEndAt) : null;
  const earlyEnd = earlyBirdEndAt ? new Date(earlyBirdEndAt) : null;
  if ((start && Number.isNaN(start.getTime())) || (end && Number.isNaN(end.getTime())) || (earlyEnd && Number.isNaN(earlyEnd.getTime()))) {
    return res.status(400).json({ message: "Sales dates must be valid dates" });
  }
  if (start && end && start >= end) return res.status(400).json({ message: "Ticket sales must end after they start" });
  if (earlyBirdPriceCents != null && (Number(earlyBirdPriceCents) < 0 || Number(earlyBirdPriceCents) > Number(priceCents) || !earlyEnd)) {
    return res.status(400).json({ message: "Early bird price must be between $0 and the regular price" });
  }
  if (pricingMode && !["fixed", "pay_what_you_feel"].includes(pricingMode)) return res.status(400).json({ message: "Choose a valid ticket price option" });
  if (pricingMode === "pay_what_you_feel" && (!Number.isInteger(Number(minimumPriceCents)) || Number(minimumPriceCents) < 0 || (maximumPriceCents != null && Number(maximumPriceCents) < Number(minimumPriceCents)))) {
    return res.status(400).json({ message: "Enter a valid minimum and maximum amount" });
  }
  if (groupMinQuantity != null && groupMinQuantity !== "" && (!Number.isInteger(Number(groupMinQuantity)) || Number(groupMinQuantity) < 2 || groupPriceCents == null || Number(groupPriceCents) < 0 || !Number.isFinite(Number(groupPriceCents)))) {
    return res.status(400).json({ message: "Group pricing needs a minimum size of 2 and a valid price" });
  }

  const qty = Number(quantityTotal) || 0;
  if (!Number.isInteger(qty) || qty < 0 || !Number.isFinite(Number(priceCents)) || Number(priceCents) < 0) {
    return res.status(400).json({ message: "Ticket price and capacity must be valid non-negative amounts" });
  }
  const event = await findEventBySlug(req.params.eventId);
  if (event && qty > 0) {
    const allocated = await getAllocatedSeats(req.params.eventId);
    const capacity = Number(event.capacity);
    if (capacity > 0 && allocated + qty > capacity) {
      return res.status(400).json({
        message: `This would allocate ${allocated + qty} seats, but the event's total capacity is ${capacity} (${capacity - allocated} remaining). Ticket type seats can't add up to more than the event capacity.`,
      });
    }
  }

  const { rows } = await pool.query(
    `INSERT INTO kutumb_ticket_types
      (event_id,name,description,price_cents,quantity_total,sales_start_at,sales_end_at,early_bird_price_cents,early_bird_end_at,is_private,min_per_order,max_per_order,pricing_mode,minimum_price_cents,maximum_price_cents,group_min_quantity,group_price_cents)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`,
    [req.params.eventId, name.trim(), description || null, Number(priceCents) || 0, qty, start, end,
      earlyBirdPriceCents == null || earlyBirdPriceCents === "" ? null : Number(earlyBirdPriceCents), earlyEnd,
      Boolean(isPrivate), Math.max(1, Number(minPerOrder) || 1), Math.max(1, Number(maxPerOrder) || 10),
      pricingMode || "fixed", Number(minimumPriceCents) || 0, maximumPriceCents == null || maximumPriceCents === "" ? null : Number(maximumPriceCents),
      groupMinQuantity ? Number(groupMinQuantity) : null, groupMinQuantity ? Math.round(Number(groupPriceCents)) : null]
  );
  await logAudit(req.admin, "ticket_type.create", req.params.eventId, { name });
  res.status(201).json(rows[0]);
});

router.put("/admin/ticket-types/:id", requireAdmin, async (req, res) => {
  const { name, description, priceCents, quantityTotal } = req.body;

  const { rows: existingRows } = await pool.query("SELECT * FROM kutumb_ticket_types WHERE id = $1", [req.params.id]);
  const existing = existingRows[0];
  if (!existing) return res.status(404).json({ message: "Ticket type not found" });

  if (quantityTotal !== undefined) {
    const qty = Number(quantityTotal) || 0;
    const event = await findEventBySlug(existing.event_id);
    if (event && qty > 0) {
      const allocated = await getAllocatedSeats(existing.event_id, existing.id);
      const capacity = Number(event.capacity);
      if (capacity > 0 && allocated + qty > capacity) {
        return res.status(400).json({
          message: `This would allocate ${allocated + qty} seats, but the event's total capacity is ${capacity} (${capacity - allocated} remaining across other ticket types).`,
        });
      }
    }
  }

  const { rows } = await pool.query(
    `UPDATE kutumb_ticket_types SET name = COALESCE($1,name), description = COALESCE($2,description),
      price_cents = COALESCE($3,price_cents), quantity_total = COALESCE($4,quantity_total)
      WHERE id = $5 RETURNING *`,
    [name, description, priceCents, quantityTotal, req.params.id]
  );
  await logAudit(req.admin, "ticket_type.update", rows[0]?.event_id, { id: req.params.id });
  res.json(rows[0]);
});

router.delete("/admin/ticket-types/:id", requireAdmin, async (req, res) => {
  const { rows } = await pool.query("SELECT event_id FROM kutumb_ticket_types WHERE id = $1", [req.params.id]);
  await pool.query("DELETE FROM kutumb_ticket_types WHERE id = $1", [req.params.id]);
  await logAudit(req.admin, "ticket_type.delete", rows[0]?.event_id, { id: req.params.id });
  res.json({ message: "Ticket type deleted" });
});

router.get("/admin/:eventId/orders", requireAdmin, async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM kutumb_orders WHERE event_id = $1 ORDER BY created_at DESC", [req.params.eventId]);
  res.json(rows);
});

router.get("/admin/:eventId/waitlist", requireAdmin, async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM kutumb_waitlist WHERE event_id = $1 ORDER BY created_at ASC", [req.params.eventId]);
  res.json(rows);
});

router.post("/admin/waitlist/:id/notify", requireAdmin, async (req, res) => {
  const { rows } = await pool.query("UPDATE kutumb_waitlist SET notified_at = now() WHERE id = $1 RETURNING *", [req.params.id]);
  await logAudit(req.admin, "waitlist.notify", rows[0]?.event_id, { id: req.params.id });
  res.json(rows[0]);
});

/* ============================================================
   PUBLIC: browse ticket types, checkout, waitlist
   ============================================================ */
router.get("/:eventId/ticket-types", async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id,name,description,
       CASE WHEN early_bird_price_cents IS NOT NULL AND (early_bird_end_at IS NULL OR early_bird_end_at > now()) THEN early_bird_price_cents ELSE price_cents END AS price_cents,
       currency,quantity_total,quantity_sold,min_per_order,max_per_order,sales_start_at,sales_end_at,
       pricing_mode,minimum_price_cents,maximum_price_cents,group_min_quantity,group_price_cents
     FROM kutumb_ticket_types
     WHERE event_id=$1 AND (NOT is_private OR EXISTS (
       SELECT 1 FROM kutumb_event_codes c WHERE c.event_id=$1 AND c.code_type='access' AND c.active=TRUE
         AND lower(c.code)=lower($2) AND (c.valid_from IS NULL OR c.valid_from <= now()) AND (c.valid_until IS NULL OR c.valid_until > now())
     ))
       AND (sales_start_at IS NULL OR sales_start_at <= now()) AND (sales_end_at IS NULL OR sales_end_at > now())
     ORDER BY price_cents ASC`,
    [req.params.eventId, String(req.query.accessCode || "")]
  );
  res.json(rows);
});

router.get("/:eventId/codes/check", async (req, res) => {
  const code = String(req.query.code || "").trim();
  if (!code) return res.status(400).json({ message: "Enter a code" });
  const { rows } = await pool.query(
    `SELECT code_type,discount_type,discount_value FROM kutumb_event_codes
     WHERE event_id=$1 AND lower(code)=lower($2) AND active=TRUE
       AND (valid_from IS NULL OR valid_from <= now()) AND (valid_until IS NULL OR valid_until > now())
       AND (max_redemptions IS NULL OR redemption_count < max_redemptions)`,
    [req.params.eventId, code]
  );
  if (!rows[0]) return res.status(404).json({ message: "That code is not valid for this event" });
  res.json({ valid: true, type: rows[0].code_type, discountType: rows[0].discount_type, discountValue: rows[0].discount_value });
});

router.get("/admin/:eventId/codes", requireAdmin, async (req, res) => {
  const { rows } = await pool.query("SELECT id,code,code_type,discount_type,discount_value,max_redemptions,redemption_count,valid_from,valid_until,active FROM kutumb_event_codes WHERE event_id=$1 ORDER BY created_at DESC", [req.params.eventId]);
  res.json(rows);
});

router.post("/admin/:eventId/codes", requireAdmin, async (req, res) => {
  const { code, type = "discount", discountType = "percent", discountValue, maxRedemptions, validFrom, validUntil } = req.body || {};
  const value = Number(discountValue);
  if (!String(code || "").trim() || !["discount","access"].includes(type)) return res.status(400).json({ message: "A code and valid code type are required" });
  if (type === "discount" && (!(["percent","fixed"].includes(discountType)) || !(value > 0) || (discountType === "percent" && value > 100))) {
    return res.status(400).json({ message: "Enter a valid discount amount" });
  }
  try {
    const event = await findEventBySlug(req.params.eventId);
    const { rows } = await pool.query(
      `INSERT INTO kutumb_event_codes(event_id,organisation_id,code,code_type,discount_type,discount_value,max_redemptions,valid_from,valid_until,created_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id,code,code_type,discount_type,discount_value,max_redemptions,redemption_count,valid_from,valid_until,active`,
      [req.params.eventId,event?.organisation_id || 1,String(code).trim(),type,type === "discount" ? discountType : null,type === "discount" ? value : null,
        maxRedemptions ? Math.max(1, Number(maxRedemptions)) : null,validFrom || null,validUntil || null,req.admin?.id || null]
    );
    await logAudit(req.admin,"event_code.create",req.params.eventId,{ type, code: String(code).trim() });
    res.status(201).json(rows[0]);
  } catch (error) {
    if (error.code === "23505") return res.status(409).json({ message: "That code already exists for this event" });
    throw error;
  }
});

router.delete("/admin/codes/:id", requireAdmin, async (req,res) => {
  const { rows } = await pool.query("UPDATE kutumb_event_codes SET active=FALSE WHERE id=$1 RETURNING event_id",[req.params.id]);
  if (!rows[0]) return res.status(404).json({message:"Code not found"});
  await logAudit(req.admin,"event_code.disable",rows[0].event_id,{id:req.params.id});
  res.json({disabled:true});
});

router.post("/:eventId/waitlist", async (req, res) => {
  const { name, email, phone, ticketTypeId, requestedQty } = req.body;
  if (!name?.trim() || !email?.trim()) return res.status(400).json({ message: "Name and email are required" });
  const event = await findEventBySlug(req.params.eventId);
  if (!event) return res.status(404).json({ message: "Event not found" });
  const { rows } = await pool.query(
    `INSERT INTO kutumb_waitlist (event_id, ticket_type_id, name, email, phone, requested_qty, organisation_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [req.params.eventId, ticketTypeId || null, name.trim(), email.trim(), phone || null, Number(requestedQty) || 1, event.organisation_id || 1]
  );
  res.status(201).json(rows[0]);
});

// Auto-provisions a single "General" ticket type for an event the first
// time it's needed, using the price the caller supplies (only used on
// creation — once it exists, its stored price is authoritative, so a
// buyer can never influence the price after the fact). This is what lets
// registration-triggered payments work for events that never had ticket
// types manually configured by an admin.
async function ensureGeneralTicketType(client, eventId, priceCents, organisationId = 1) {
  const { rows: existing } = await client.query(
    "SELECT * FROM kutumb_ticket_types WHERE event_id = $1 AND name = 'General' LIMIT 1",
    [eventId]
  );
  if (existing.length > 0) return existing[0];

  const event = await findEventBySlug(eventId);
  const quantityTotal = event ? Number(event.capacity) || 0 : 0;

  const { rows: inserted } = await client.query(
    `INSERT INTO kutumb_ticket_types (event_id, name, description, price_cents, quantity_total, organisation_id)
     VALUES ($1, 'General', 'Standard registration fee', $2, $3, $4) RETURNING *`,
    [eventId, Math.round(Number(priceCents) || 0), quantityTotal, event?.organisation_id || organisationId]
  );
  return inserted[0];
}

/* Checkout — this is where real capacity safety matters, so it runs inside
   a single Postgres transaction with row locks (SELECT ... FOR UPDATE) on
   the ticket types being purchased. That guarantees two simultaneous
   buyers can never both grab the last ticket, without needing any
   in-process file-locking trick (this is the DB doing what it's for). */
router.post("/:eventId/checkout", async (req, res) => {
  const client = await pool.connect();
  try {
    const { buyerName, buyerEmail, buyerPhone, items, registrationId, accessCode, discountCode } = req.body;
    if (!buyerName?.trim() || !buyerEmail?.trim() || !items?.length) {
      return res.status(400).json({ message: "buyerName, buyerEmail and items are required" });
    }
    if (items.some((item) => !Number.isInteger(Number(item.quantity)) || Number(item.quantity) < 0)) {
      return res.status(400).json({ message: "Ticket quantities must be whole numbers" });
    }

    await client.query("BEGIN");

    const eventOwner = await findEventBySlug(req.params.eventId);
    const organisationId = eventOwner?.organisation_id || 1;
    if (eventOwner?.id) await client.query("SELECT id FROM kutumb_upcoming_events WHERE id=$1 FOR UPDATE", [eventOwner.id]);
    const requestedTicketCount = items.reduce((sum, item) => sum + Math.max(0, Math.floor(Number(item.quantity) || 0)), 0);
    if (eventOwner && Number(eventOwner.capacity) > 0) {
      const { rows: currentTicketRows } = await client.query("SELECT COALESCE(SUM(quantity_sold),0)::int AS count FROM kutumb_ticket_types WHERE event_id=$1", [req.params.eventId]);
      const parsedEventDate = parseEventStartDate(eventOwner.date_text);
      const eventYear = parsedEventDate ? String(parsedEventDate.getFullYear()) : "unknown";
      const { rows: registrationRows } = await client.query(
        "SELECT COALESCE(SUM(1+COALESCE(adults,0)+COALESCE(children,0)),0)::int AS count FROM kutumb_event_registrations WHERE lower(event_name)=lower($1) AND event_year=$2 AND registration_status <> 'cancelled'",
        [eventOwner.title, eventYear]
      );
      const occupied = Number(currentTicketRows[0]?.count || 0) + Number(registrationRows[0]?.count || 0);
      if (occupied + requestedTicketCount > Number(eventOwner.capacity)) {
        await client.query("ROLLBACK");
        return res.status(409).json({ message: "Only " + Math.max(0, Number(eventOwner.capacity) - occupied) + " places remain for this event", soldOut: true });
      }
    }

    let accessRecord = null;
    if (String(accessCode || "").trim()) {
      const { rows } = await client.query(
        `SELECT * FROM kutumb_event_codes WHERE event_id=$1 AND lower(code)=lower($2) AND code_type='access' AND active=TRUE
         AND (valid_from IS NULL OR valid_from <= now()) AND (valid_until IS NULL OR valid_until > now())
         AND (max_redemptions IS NULL OR redemption_count < max_redemptions) FOR UPDATE`,
        [req.params.eventId, String(accessCode).trim()]
      );
      accessRecord = rows[0] || null;
    }
    let discountRecord = null;
    if (String(discountCode || "").trim()) {
      const { rows } = await client.query(
        `SELECT * FROM kutumb_event_codes WHERE event_id=$1 AND lower(code)=lower($2) AND code_type='discount' AND active=TRUE
         AND (valid_from IS NULL OR valid_from <= now()) AND (valid_until IS NULL OR valid_until > now())
         AND (max_redemptions IS NULL OR redemption_count < max_redemptions) FOR UPDATE`,
        [req.params.eventId, String(discountCode).trim()]
      );
      discountRecord = rows[0] || null;
      if (!discountRecord) {
        await client.query("ROLLBACK");
        return res.status(400).json({ message: "That discount code is not valid for this event" });
      }
    }

    let subtotal = 0;
    const orderItemsToInsert = [];
    const lineItems = [];

    for (const item of items) {
      const qty = Number(item.quantity) || 0;
      if (qty < 1) continue;

      // "general" is a sentinel meaning "no admin-configured ticket type
      // exists yet — create the standard one now" rather than a real id.
      let ticketTypeId = item.ticketTypeId;
      if (ticketTypeId === "general") {
        const general = await ensureGeneralTicketType(client, req.params.eventId, item.generalPriceCents, organisationId);
        ticketTypeId = general.id;
      }

      const { rows } = await client.query(
        "SELECT * FROM kutumb_ticket_types WHERE id = $1 AND event_id = $2 FOR UPDATE",
        [ticketTypeId, req.params.eventId]
      );
      const tt = rows[0];
      if (!tt) {
        await client.query("ROLLBACK");
        return res.status(400).json({ message: "Invalid ticket type" });
      }
      const now = Date.now();
      if (tt.sales_start_at && new Date(tt.sales_start_at).getTime() > now) {
        await client.query("ROLLBACK");
        return res.status(409).json({ message: `Sales for \"${tt.name}\" haven't opened yet` });
      }
      if (tt.sales_end_at && new Date(tt.sales_end_at).getTime() <= now) {
        await client.query("ROLLBACK");
        return res.status(409).json({ message: `Sales for \"${tt.name}\" have closed` });
      }
      if (tt.is_private && !accessRecord) {
        await client.query("ROLLBACK");
        return res.status(403).json({ message: `Enter the event access code to book \"${tt.name}\"` });
      }
      if (qty < Number(tt.min_per_order || 1) || qty > Number(tt.max_per_order || 10)) {
        await client.query("ROLLBACK");
        return res.status(400).json({ message: `Choose between ${tt.min_per_order || 1} and ${tt.max_per_order || 10} tickets for \"${tt.name}\"` });
      }
      if (tt.quantity_total > 0 && tt.quantity_sold + qty > tt.quantity_total) {
        await client.query("ROLLBACK");
        return res.status(409).json({ message: `Sold out: "${tt.name}" doesn't have ${qty} spots left. Join the waitlist instead?`, soldOut: true, ticketTypeId: tt.id });
      }

      let unitPriceCents = tt.early_bird_price_cents != null && (!tt.early_bird_end_at || new Date(tt.early_bird_end_at).getTime() > now)
        ? Number(tt.early_bird_price_cents) : Number(tt.price_cents);
      if (tt.pricing_mode === "pay_what_you_feel") {
        const chosenPrice = Number(item.unitPriceCents);
        if (!Number.isInteger(chosenPrice) || chosenPrice < Number(tt.minimum_price_cents || 0) || (tt.maximum_price_cents != null && chosenPrice > Number(tt.maximum_price_cents))) {
          await client.query("ROLLBACK");
          return res.status(400).json({ message: "Choose an amount within this ticket's allowed range" });
        }
        unitPriceCents = chosenPrice;
      } else if (tt.group_min_quantity && qty >= Number(tt.group_min_quantity) && tt.group_price_cents != null) {
        unitPriceCents = Number(tt.group_price_cents);
      }
      subtotal += unitPriceCents * qty;
      orderItemsToInsert.push({ ticketTypeId: tt.id, quantity: qty, unitPriceCents, name: tt.name, currency: tt.currency });
    }

    if (orderItemsToInsert.length === 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ message: "No tickets selected" });
    }

    const discountCents = discountRecord
      ? Math.min(subtotal, discountRecord.discount_type === "percent"
        ? Math.round(subtotal * Number(discountRecord.discount_value) / 100)
        : Math.round(Number(discountRecord.discount_value) * 100))
      : 0;
    const totalCents = Math.max(0, subtotal - discountCents);
    if (accessRecord) await client.query("UPDATE kutumb_event_codes SET redemption_count=redemption_count+1 WHERE id=$1", [accessRecord.id]);
    if (discountRecord) await client.query("UPDATE kutumb_event_codes SET redemption_count=redemption_count+1 WHERE id=$1", [discountRecord.id]);

    // Free tickets: confirm immediately inside the same transaction.
    if (subtotal === 0 || totalCents === 0) {
      const orderRes = await client.query(
        `INSERT INTO kutumb_orders (event_id, buyer_name, buyer_email, buyer_phone, status, subtotal_cents, total_cents, registration_id, organisation_id, discount_code, discount_cents)
         VALUES ($1,$2,$3,$4,'paid',$5,$6,$7,$8,$9,$10) RETURNING id`,
        [req.params.eventId, buyerName.trim(), buyerEmail.trim(), buyerPhone || null, subtotal, totalCents, registrationId || null, organisationId, discountRecord?.code || null, discountCents]
      );
      const orderId = orderRes.rows[0].id;
      await insertItemsAndAttendees(client, orderId, req.params.eventId, orderItemsToInsert, buyerName.trim(), buyerEmail.trim(), organisationId);
      await markRegistrationPaid(client, registrationId, "card", null);
      await client.query("COMMIT");
      sendTicketOrderTickets(orderId).catch((err) => console.error("Ticket email error:", err));
      return res.status(201).json({ free: true, orderId, discountCents });
    }

    // Paid tickets: reserve the inventory now (inside this transaction) and
    // create the Stripe session — inventory is committed either way; if the
    // buyer abandons checkout we simply have an order stuck at "pending"
    // (visible to admin), rather than ever risking overselling.
    const orderRes = await client.query(
      `INSERT INTO kutumb_orders (event_id, buyer_name, buyer_email, buyer_phone, status, subtotal_cents, total_cents, registration_id, organisation_id, discount_code, discount_cents)
       VALUES ($1,$2,$3,$4,'pending',$5,$6,$7,$8,$9,$10) RETURNING id`,
      [req.params.eventId, buyerName.trim(), buyerEmail.trim(), buyerPhone || null, subtotal, totalCents, registrationId || null, organisationId, discountRecord?.code || null, discountCents]
    );
    const orderId = orderRes.rows[0].id;
    for (const oi of orderItemsToInsert) {
      await client.query(
        "INSERT INTO kutumb_order_items (order_id, ticket_type_id, quantity, unit_price_cents, organisation_id) VALUES ($1,$2,$3,$4,$5)",
        [orderId, oi.ticketTypeId, oi.quantity, oi.unitPriceCents, organisationId]
      );
      await client.query("UPDATE kutumb_ticket_types SET quantity_sold = quantity_sold + $1 WHERE id = $2", [oi.quantity, oi.ticketTypeId]);
    }

    const stripe = await getStripe();
    if (!stripe) {
      await client.query("ROLLBACK");
      return res.status(503).json({ message: "Payments aren't configured yet. Ask the admin to add a Stripe secret key in the Admin Console." });
    }

    const baseUrl = await getPublicBaseUrl(req);
    for (const oi of orderItemsToInsert) {
      lineItems.push({ price_data: { currency: (oi.currency || "AUD").toLowerCase(), product_data: { name: oi.name }, unit_amount: oi.unitPriceCents }, quantity: oi.quantity });
    }
    if (discountCents > 0) {
      // Stripe supports coupon/promotion codes, but the event code has already
      // been validated and reserved in our transaction. Use one exact-value
      // checkout line to prevent trusting a client-supplied subtotal.
      lineItems.length = 0;
      lineItems.push({ price_data: { currency: "aud", product_data: { name: `Event tickets${discountRecord ? ` (${discountRecord.code})` : ""}` }, unit_amount: totalCents }, quantity: 1 });
    }
    // Stripe-hosted Checkout (not Embedded Checkout) — the browser is sent
    // to a page Stripe fully owns and hosts, then back to /checkout/return
    // once payment completes. The client opens that URL in a popup sized
    // and positioned to match the dialog it was launched from (same
    // pattern as Card/Square on the Donate dialog — see checkoutPopup.ts),
    // rather than this page rendering the card fields itself, and rather
    // than Embedded Checkout's own return_url navigating the whole tab
    // away. {CHECKOUT_SESSION_ID} is a literal placeholder Stripe
    // substitutes itself.
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: buyerEmail.trim(),
      line_items: lineItems,
      success_url: `${baseUrl}/checkout/return?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/checkout/return?session_id={CHECKOUT_SESSION_ID}&cancelled=1`,
      metadata: { orderId: String(orderId), eventId: req.params.eventId, registrationId: registrationId ? String(registrationId) : "" },
    });
    await client.query("UPDATE kutumb_orders SET stripe_session_id = $1 WHERE id = $2", [session.id, orderId]);

    await client.query("COMMIT");
    res.status(201).json({ url: session.url, orderId, sessionId: session.id });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("CHECKOUT ERROR:", err);
    res.status(500).json({ message: "Could not start checkout" });
  } finally {
    client.release();
  }
});

// When a Stripe (or free) checkout was started FROM the Event Registration
// flow (i.e. registrationId was supplied), this is what actually closes the
// loop that used to be missing: it flips that registration's own
// payment_status/registration_status once payment is confirmed, using the
// authoritative Stripe payment_intent status (via the webhook or
// session-status fallback below) rather than ever trusting the browser
// alone. A registration paid by card never shows the fee as owing again.
async function markRegistrationPaid(client, registrationId, paymentMethod, stripePaymentIntent) {
  if (!registrationId) return;
  await client.query(
    `UPDATE kutumb_event_registrations SET
       payment_status = 'Paid',
       registration_status = 'confirmed',
       payment_method = $1,
       payment_amount = fee,
       payment_date = now(),
       transaction_number = COALESCE(transaction_number, $2)
     WHERE id = $3`,
    [paymentMethod, stripePaymentIntent || null, registrationId]
  );
}

async function insertItemsAndAttendees(client, orderId, eventId, items, buyerName, buyerEmail, organisationId = 1) {
  for (const oi of items) {
    const { rows } = await client.query(
      "INSERT INTO kutumb_order_items (order_id, ticket_type_id, quantity, unit_price_cents, organisation_id) VALUES ($1,$2,$3,$4,$5) RETURNING id",
      [orderId, oi.ticketTypeId, oi.quantity, oi.unitPriceCents, organisationId]
    );
    const orderItemId = rows[0].id;
    await client.query("UPDATE kutumb_ticket_types SET quantity_sold = quantity_sold + $1 WHERE id = $2", [oi.quantity, oi.ticketTypeId]);
    for (let n = 0; n < oi.quantity; n++) {
      const qrToken = crypto.randomBytes(16).toString("hex");
      await client.query(
        "INSERT INTO kutumb_attendees (order_item_id, event_id, name, email, qr_token, organisation_id) VALUES ($1,$2,$3,$4,$5,$6)",
        [orderItemId, eventId, buyerName, buyerEmail, qrToken, organisationId]
      );
    }
  }
}

/* Stripe webhook — mounted with express.raw() in server.js so the signature
   can be verified. Confirms payment and issues QR attendee tickets. */
export async function stripeWebhookHandler(req, res) {
  const stripe = await getStripe();
  const webhookSecret = await getSetting("stripe_webhook_secret");
  if (!stripe || !webhookSecret) return res.status(503).send("Stripe not configured");

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers["stripe-signature"], webhookSecret);
  } catch (err) {
    console.error("WEBHOOK SIGNATURE ERROR:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const orderId = Number(session.metadata?.orderId);
    const eventId = session.metadata?.eventId;
    const registrationId = session.metadata?.registrationId ? Number(session.metadata.registrationId) : null;
    if (orderId) {
      const order = await confirmPaidTicketOrder(orderId, session.payment_intent);
      if (order) {
        // Authoritative confirmation from Stripe itself (not the browser
        // returning to /checkout/return) — this is what actually confirms
        // a registration's payment per the "check payment status before
        // confirming" requirement.
        await markRegistrationPaid(pool, registrationId || order.registration_id, "card", session.payment_intent);
      }
    } else if (session.metadata?.donationId) {
      // A donation paid by card doesn't go through kutumb_orders at all —
      // find its own payment-attempt row (recorded when the checkout
      // session was created) and confirm it directly.
      const donationRecord = await findDonationPaymentByReference("card", session.id);
      if (donationRecord) {
        await markDonationPaymentPaid(donationRecord.id, session.payment_status, session.payment_intent);
      }
    } else if (session.metadata?.registrationId) {
      // A registration's fee paid by card via the dedicated
      // /api/events/registration/:id/checkout-card endpoint — also doesn't
      // go through kutumb_orders. Same registrationPayments.js path
      // Square/PayPal already use, so it gets the same partial-payment
      // handling, confirmation email, and ticket email for free.
      const paymentRecord = await findPaymentByReference("card", session.id);
      if (paymentRecord) {
        await markPaymentPaid(paymentRecord.id, session.payment_status, session.payment_intent);
      }
    }
  }

  // The same signed endpoint also confirms auction, store and recurring
  // membership payments, keeping one Stripe signing secret for the platform.
  try {
    await handleFundraisingStripeEvent(event);
  } catch (error) {
    console.error("FUNDRAISING WEBHOOK PROCESS ERROR:", error);
    return res.status(500).send("Could not process fundraising payment event");
  }

  res.json({ received: true });
}

// Used by the /checkout/return page: Stripe sends the browser back here
// with ?session_id=... after Embedded Checkout completes. We look up our
// own order by that Stripe session id (webhook usually marks it paid
// first, but we also double-check directly with Stripe in case the
// webhook hasn't landed yet) and report a simple status back.
router.get("/session-status", async (req, res) => {
  const { session_id } = req.query;
  if (!session_id) return res.status(400).json({ message: "session_id is required" });

  try {
    const { rows } = await pool.query("SELECT * FROM kutumb_orders WHERE stripe_session_id = $1", [session_id]);
    const order = rows[0];
    if (!order) return res.status(404).json({ message: "Order not found" });

    if (order.status !== "paid") {
      // Webhook may not have arrived yet — ask Stripe directly as a fallback.
      const stripe = await getStripe();
      if (stripe) {
        const session = await stripe.checkout.sessions.retrieve(session_id);
        if (session.payment_status === "paid") {
          const paidOrder = await confirmPaidTicketOrder(order.id, session.payment_intent);
          if (paidOrder) await markRegistrationPaid(pool, paidOrder.registration_id, "card", session.payment_intent);
          order.status = "paid";
        }
      }
    }

    res.json({ status: order.status, orderId: order.id, eventId: order.event_id, totalCents: order.total_cents });
  } catch (err) {
    console.error("SESSION STATUS ERROR:", err);
    res.status(500).json({ message: "Could not check payment status" });
  }
});

router.post("/admin/orders/:id/refund", requireAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query("SELECT * FROM kutumb_orders WHERE id=$1 FOR UPDATE", [req.params.id]);
    const order = rows[0];
    if (!order) { await client.query("ROLLBACK"); return res.status(404).json({ message: "Order not found" }); }
    if (order.status !== "paid") { await client.query("ROLLBACK"); return res.status(409).json({ message: "Only paid orders can be refunded" }); }
    const checked = await client.query("SELECT 1 FROM kutumb_attendees a JOIN kutumb_order_items oi ON oi.id=a.order_item_id WHERE oi.order_id=$1 AND a.checked_in_at IS NOT NULL LIMIT 1", [order.id]);
    if (checked.rowCount) { await client.query("ROLLBACK"); return res.status(409).json({ message: "This order includes a checked-in attendee and cannot be refunded from this screen" }); }

    let providerReference = null;
    if (order.stripe_payment_intent) {
      const stripe = await getStripe();
      if (!stripe) { await client.query("ROLLBACK"); return res.status(503).json({ message: "Stripe is not configured" }); }
      const refund = await stripe.refunds.create({ payment_intent: order.stripe_payment_intent, reason: "requested_by_customer" }, { idempotencyKey: `kutumblink-order-refund-${order.id}` });
      providerReference = refund.id;
    }
    await client.query("UPDATE kutumb_orders SET status='refunded' WHERE id=$1", [order.id]);
    if (Number(order.total_cents) > 0) {
      await client.query(
        `INSERT INTO kutumb_settlement_ledger (organisation_id,entry_type,amount,source_type,source_id,provider_reference,note,recorded_by_admin_id)
         VALUES ($1,'ticket_refund',$2,'ticket_order',$3,$4,'Ticket refund returned from the Kutumb account',$5)
         ON CONFLICT (entry_type,source_type,source_id) DO NOTHING`,
        [order.organisation_id || 1, -Number(order.total_cents) / 100, String(order.id), providerReference, req.admin?.id || null]
      );
    }
    await client.query("UPDATE kutumb_attendees a SET ticket_status='refunded' FROM kutumb_order_items oi WHERE oi.id=a.order_item_id AND oi.order_id=$1", [order.id]);
    await client.query("UPDATE kutumb_ticket_types tt SET quantity_sold=GREATEST(0,tt.quantity_sold-oi.quantity) FROM kutumb_order_items oi WHERE oi.ticket_type_id=tt.id AND oi.order_id=$1", [order.id]);
    await client.query("INSERT INTO kutumb_ticket_refunds(order_id,amount_cents,provider_reference,reason,processed_by) VALUES($1,$2,$3,$4,$5)", [order.id, Number(order.total_cents) || 0, providerReference, String(req.body?.reason || "Full order refund").slice(0, 500), req.admin?.id || null]);
    await client.query("COMMIT");
    await logAudit(req.admin, "ticket_order.refund", order.event_id, { orderId: order.id, amountCents: order.total_cents, providerReference });
    res.json({ refunded: true, orderId: order.id, amountCents: Number(order.total_cents) || 0 });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("TICKET REFUND ERROR:", error);
    res.status(500).json({ message: "Could not refund this order" });
  } finally { client.release(); }
});

router.get("/order/:id", async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM kutumb_orders WHERE id = $1", [req.params.id]);
  if (!rows[0]) return res.status(404).json({ message: "Order not found" });
  const items = await pool.query(
    `SELECT oi.*, tt.name AS ticket_type_name FROM kutumb_order_items oi
     JOIN kutumb_ticket_types tt ON tt.id = oi.ticket_type_id WHERE oi.order_id = $1`,
    [req.params.id]
  );
  const attendees = await pool.query(
    `SELECT a.* FROM kutumb_attendees a JOIN kutumb_order_items oi ON oi.id = a.order_item_id WHERE oi.order_id = $1`,
    [req.params.id]
  );
  res.json({ ...rows[0], items: items.rows, attendees: attendees.rows });
});

export default router;
