// server/lib/registrationScheduler.js
//
// Automatic registration emails, checked every 10 minutes and acted on once
// the configured hour (default 10:00 Sydney time) has passed each day:
//
//   • Payment reminder — on the reminder days (default Mon & Thu), to every
//     registration still awaiting payment (paid events only), while the event
//     is more than 6 days away. Not sent to anyone who registered < 24h ago.
//   • Final reminder — 6 days before the event, to those still unpaid,
//     saying when the registration will be cancelled.
//   • Auto-cancel — 5 days before the event, registrations still unpaid are
//     cancelled (spots released) and the registrant is emailed. This includes
//     registrations part-paid ONLY by coupon (the coupon value lapses; the
//     final reminder warns them first). Just before
//     cancelling, every stored bank credit is reconciled once more so a
//     transfer that has already arrived is never missed. NOT auto-cancelled
//     (listed for an admin instead):
//       – part-payments with real money received (card / bank / PayPal /
//         Square) — never auto-cancelled,
//       – people who said they paid by bank transfer that isn't matched yet
//         (unless the setting to cancel those too is on),
//       – anyone who never got the final reminder (e.g. registered in the
//         last 6 days, or email was down) — nobody is cancelled unwarned.
//   • Coupon part-payment thank-you — when a coupon covered only part of
//     the fee and the balance still hasn't been paid ~30 min later (i.e. the
//     registrant left the payment window), one email thanks them for the part
//     payment and asks for the balance by card or bank transfer. Checked on
//     every tick, not held back until the daily hour.
//   • Welcome — the day before the event, to every CONFIRMED registration
//     (paid and free events alike), with their QR tickets attached again.
//
// Every email is recorded in kutumb_registration_notifications only once it
// has actually been sent, so nothing goes twice and a mail outage is simply
// retried on the next check. A Postgres advisory lock stops two servers
// sharing the database (e.g. a test and the live site) doubling up.

import { pool } from "../db/pool.js";
import { getSetting, setSetting } from "./settings.js";
import { parseEventStartDate } from "./eventDates.js";
import { getConfiguredPublicBaseUrl } from "./publicUrl.js";
import {
  sendPaymentReminderEmail,
  sendRegistrationCancelledEmail,
  sendEventWelcomeEmail,
  sendAdminAlertEmail,
  sendCouponPartPaymentEmail,
} from "./mailer.js";
import { buildTicketsPdfForRegistration } from "./tickets.js";
import { reconcileOpenEvents } from "./bankLedger.js";
import { cleanupExpiredCheckinCodes } from "./checkinCodes.js";

export const CANCELLED_MESSAGE =
  "This registration was cancelled because payment wasn't received in time. " +
  "If you think this is a mistake, please contact Kutumb; if spots are still available you're welcome to register again.";

const TZ = "Australia/Sydney";
const DAY_MS = 86_400_000;
const WEEKDAYS = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
const LOCK_KEY = "kutumb_registration_scheduler";
const COUPON_LOCK_KEY = "kutumb_coupon_part_payment_emails";

let timer = null;
let checkinCodeTimer = null;
let lastRun = null;

/* ── Sydney calendar helpers ─────────────────────────────────────────── */

function sydneyParts(date = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-AU", {
      timeZone: TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
      weekday: "short",
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value])
  );
  return {
    y: Number(parts.year),
    m: Number(parts.month),
    d: Number(parts.day),
    hour: Number(parts.hour),
    weekday: WEEKDAYS[String(parts.weekday).slice(0, 3).toLowerCase()],
  };
}
const dayNumber = (y, m, d) => Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
const keyOf = ({ y, m, d }) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
function fromDayNumber(n) {
  const dt = new Date(n * DAY_MS);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}
function prettyDay(n) {
  const { y, m, d } = fromDayNumber(n);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-AU", {
    weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
  });
}

/* ── Settings ────────────────────────────────────────────────────────── */

async function loadConfig() {
  const num = async (key, def, min, max) => {
    const raw = await getSetting(key);
    if (raw === null || raw === undefined || String(raw).trim() === "") return def;
    const n = Number(raw);
    return Number.isInteger(n) && n >= min && n <= max ? n : def;
  };
  const flag = async (key) => ((await getSetting(key)) ?? "true") !== "false";
  const remindersOn = await flag("reg_reminders_enabled");
  const cancelOn = await flag("reg_autocancel_enabled");
  const welcomeOn = await flag("reg_welcome_enabled");
  const daysRaw = (await getSetting("reg_reminder_days")) || "mon,thu";
  const reminderDays = new Set(
    daysRaw.split(/[\s,;]+/).map((d) => WEEKDAYS[d.slice(0, 3).toLowerCase()]).filter((d) => d !== undefined)
  );
  const finalDays = await num("reg_final_days_before", 6, 2, 60);
  let cancelDays = await num("reg_cancel_days_before", 5, 1, 59);
  if (cancelDays >= finalDays) cancelDays = finalDays - 1;
  return {
    enabled: remindersOn || cancelOn || welcomeOn,
    remindersOn,
    cancelOn,
    welcomeOn,
    reminderDays,
    hour: await num("reg_email_hour", 10, 0, 23),
    finalDays,
    cancelDays,
    cancelClaimed: (await getSetting("reg_cancel_claimed_transfers")) === "true",
  };
}

/* ── Data ────────────────────────────────────────────────────────────── */

const MONTH_ONLY = /^[A-Za-z]+\s*,?\s*\d{4}$/;

async function upcomingEvents(todayN) {
  const { rows } = await pool.query("SELECT * FROM kutumb_upcoming_events");
  const out = [];
  const skipped = [];
  for (const e of rows) {
    const text = String(e.date_text || "").trim();
    const start = MONTH_ONLY.test(text) ? null : parseEventStartDate(text);
    if (!start) {
      skipped.push({ title: e.title, reason: `date "${text || "(none)"}" has no specific day` });
      continue;
    }
    const eventN = dayNumber(start.getFullYear(), start.getMonth() + 1, start.getDate());
    const daysUntil = eventN - todayN;
    if (daysUntil < 0) continue;
    out.push({ ...e, eventN, daysUntil, eventYear: String(start.getFullYear()) });
  }
  return { events: out, skipped };
}

async function alreadySent(registrationId, kind, periodKey = "") {
  const { rows } = await pool.query(
    "SELECT 1 FROM kutumb_registration_notifications WHERE registration_id = $1 AND kind = $2 AND period_key = $3",
    [registrationId, kind, periodKey]
  );
  return rows.length > 0;
}
async function sentAt(registrationId, kind, periodKey = null) {
  const { rows } = await pool.query(
    `SELECT sent_at FROM kutumb_registration_notifications
      WHERE registration_id = $1 AND kind = $2 AND ($3::text IS NULL OR period_key = $3)
      ORDER BY sent_at LIMIT 1`,
    [registrationId, kind, periodKey]
  );
  return rows[0]?.sent_at ? new Date(rows[0].sent_at) : null;
}
async function markSent(registrationId, kind, periodKey = "", at = new Date()) {
  await pool.query(
    `INSERT INTO kutumb_registration_notifications (registration_id, kind, period_key, sent_at)
     VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
    [registrationId, kind, periodKey, at]
  );
}

function regSummary(r, e, extra = {}) {
  return {
    id: r.id,
    event: `${e.title}`,
    registrationNumber: r.registration_number,
    name: r.name,
    email: r.email,
    amountDue: Math.max((Number(r.fee) || 0) - (Number(r.payment_amount) || 0), 0),
    ...extra,
  };
}

function noteFor(claimed, couponOnlyPartial, couponPaid) {
  const notes = [];
  if (couponOnlyPartial) notes.push(`coupon $${couponPaid.toFixed(2)} part-paid`);
  if (claimed) notes.push("said they paid by transfer");
  return notes.length ? { note: notes.join("; ") } : {};
}

/* ── Coupon part-payment thank-you ───────────────────────────────────── */

/**
 * A coupon that covers only part of the fee is redeemed straight away, and
 * the registrant is shown the balance to pay by card / bank transfer. If
 * they leave the payment window without paying it, this sends ONE email
 * thanking them for the part payment and asking for the balance.
 *
 * "Left the payment window" is detected as: the balance is still unpaid
 * `delayMinutes` after the coupon was redeemed (a browser can't reliably
 * report that a tab was closed). Coupons redeemed more than 7 days ago are
 * ignored, so switching this on doesn't email old registrations.
 */
export async function runCouponPartPaymentEmails({ dryRun = false, now = new Date() } = {}) {
  const out = { sent: [], failed: [] };
  if (((await getSetting("reg_coupon_partial_email_enabled")) ?? "true") === "false") return out;
  const rawDelay = Number(await getSetting("reg_coupon_partial_email_delay_min"));
  const delayMinutes = Number.isInteger(rawDelay) && rawDelay >= 5 && rawDelay <= 1440 ? rawDelay : 30;

  const lockClient = await pool.connect();
  let locked = false;
  try {
    const { rows: lk } = await lockClient.query("SELECT pg_try_advisory_lock(hashtext($1)) AS ok", [COUPON_LOCK_KEY]);
    locked = lk[0].ok;
    if (!locked) return out;

    const { rows } = await pool.query(
      `SELECT r.*, c.last_redeemed_at
         FROM kutumb_event_registrations r
         JOIN LATERAL (
           SELECT max(redeemed_at) AS last_redeemed_at
             FROM kutumb_event_coupons WHERE redeemed_by_registration_id = r.id
         ) c ON c.last_redeemed_at IS NOT NULL
        WHERE r.registration_status = 'pending_payment'
          AND r.payment_status <> 'Paid'
          AND COALESCE(r.coupon_amount, 0) > 0
          AND COALESCE(r.payment_amount, 0) < COALESCE(r.fee, 0)
          AND COALESCE(r.payment_amount, 0) <= COALESCE(r.coupon_amount, 0)
          AND c.last_redeemed_at <= $1::timestamptz - make_interval(mins => $2)
          AND c.last_redeemed_at >= $1::timestamptz - interval '7 days'
          AND NOT EXISTS (
            SELECT 1 FROM kutumb_registration_notifications n
             WHERE n.registration_id = r.id AND n.kind = 'coupon_part_payment'
          )`,
      [now.toISOString(), delayMinutes]
    );
    if (!rows.length) return out;

    const baseUrl = await getConfiguredPublicBaseUrl();
    for (const r of rows) {
      const { rows: ev } = await pool.query(
        "SELECT date_text, time_text, location FROM kutumb_upcoming_events WHERE lower(title) = lower($1) LIMIT 1",
        [r.event_name]
      );
      const fee = Number(r.fee) || 0;
      const paid = Number(r.payment_amount) || 0;
      const amountDue = Math.max(fee - paid, 0);
      const item = { id: r.id, event: r.event_name, registrationNumber: r.registration_number, name: r.name, email: r.email, amountDue };
      if (dryRun) {
        out.sent.push(item);
        continue;
      }
      const sent = await sendCouponPartPaymentEmail({
        to: r.email,
        name: r.name,
        eventName: r.event_name,
        eventDate: ev[0]?.date_text,
        eventTime: ev[0]?.time_text,
        location: ev[0]?.location,
        registrationNumber: r.registration_number,
        totalFee: fee,
        couponAmount: Number(r.coupon_amount) || paid,
        couponCode: r.coupon_code,
        amountDue,
        payUrl: baseUrl && r.pay_token ? `${baseUrl}/pay/${r.pay_token}` : null,
      });
      if (sent.sent) {
        await markSent(r.id, "coupon_part_payment", "", now);
        out.sent.push(item);
      } else out.failed.push({ ...item, error: sent.error });
    }
    return out;
  } finally {
    if (locked) await lockClient.query("SELECT pg_advisory_unlock(hashtext($1))", [COUPON_LOCK_KEY]).catch(() => {});
    lockClient.release();
  }
}

/* ── The run ─────────────────────────────────────────────────────────── */

/**
 * @param {{ dryRun?: boolean, now?: Date, force?: boolean }} opts
 *   dryRun: work out what WOULD happen, send/change nothing.
 *   force:  ignore the "not before hour X" rule (admin "Run now").
 */
export async function runRegistrationEmails({ dryRun = false, now = new Date(), force = false } = {}) {
  const cfg = await loadConfig();
  const syd = sydneyParts(now);
  const todayN = dayNumber(syd.y, syd.m, syd.d);
  const todayKey = keyOf(syd);
  const result = {
    at: now.toISOString(),
    sydneyDate: todayKey,
    dryRun,
    reminders: [],
    finals: [],
    cancelled: [],
    welcomes: [],
    needsReview: [],
    failed: [],
    skippedEvents: [],
    note: null,
  };

  if (!cfg.enabled && !dryRun) {
    result.note = "All automatic registration emails are switched off.";
    return result;
  }
  if (!force && syd.hour < cfg.hour) {
    result.note = `Waiting until ${cfg.hour}:00 Sydney time.`;
    return result;
  }

  // One server at a time (session lock on a dedicated connection).
  const lockClient = await pool.connect();
  let locked = false;
  try {
    const { rows } = await lockClient.query("SELECT pg_try_advisory_lock(hashtext($1)) AS ok", [LOCK_KEY]);
    locked = rows[0].ok;
    if (!locked) {
      result.note = "Another server is running the registration emails right now.";
      return result;
    }

    const baseUrl = await getConfiguredPublicBaseUrl();
    const { events, skipped } = await upcomingEvents(todayN);
    result.skippedEvents = skipped;

    const cancelCandidates = [];

    for (const e of events) {
      const { rows: regs } = await pool.query(
        `SELECT * FROM kutumb_event_registrations
          WHERE lower(event_name) = lower($1) AND event_year = $2 AND registration_status <> 'cancelled'
          ORDER BY created_at`,
        [e.title, e.eventYear]
      );
      // Master switch AND the event's own tick.
      const evReminders = cfg.remindersOn && e.auto_reminders !== false;
      const evCancel = cfg.cancelOn && e.auto_cancel === true;
      const evWelcome = cfg.welcomeOn && e.auto_welcome !== false;
      if (!evReminders && !evCancel && !evWelcome) continue;
      const eventDate = e.date_text;
      const finalDayN = e.eventN - cfg.finalDays;
      const cancelDayN = e.eventN - cfg.cancelDays;

      for (const r of regs) {
        const fee = Number(r.fee) || 0;
        const paid = Number(r.payment_amount) || 0;
        const amountDue = Math.max(fee - paid, 0);
        const pending = r.registration_status === "pending_payment" && fee > 0 && r.payment_status !== "Paid" && amountDue > 0;
        const created = new Date(r.created_at);
        const createdN = (() => {
          const p = sydneyParts(created);
          return dayNumber(p.y, p.m, p.d);
        })();
        const couponPaid = Number(r.coupon_amount) || 0;
        const partial = paid > 0 && paid < fee;
        // Part-paid ONLY by coupon (no card/bank/PayPal/Square money on file):
        // treated like an unpaid registration — reminded, then auto-cancelled
        // (coupon lapses) — instead of being parked for admin review.
        const couponOnlyPartial = partial && couponPaid > 0 && paid <= couponPaid + 0.001 && !r.payment_match_confidence;
        const claimed = !!r.bank_transferred && !r.payment_match_confidence && (paid === 0 || couponOnlyPartial);
        // Any part payment: the reminder shows fee / paid / balance.
        const couponPart = Math.min(couponPaid, paid);
        const couponInfo = partial
          ? { couponAmount: couponPart, otherPaid: Math.round((paid - couponPart) * 100) / 100, totalFee: fee }
          : {};
        const payUrl = baseUrl && r.pay_token ? `${baseUrl}/pay/${r.pay_token}` : null;
        const common = {
          to: r.email,
          name: r.name,
          eventName: e.title,
          eventDate,
          eventTime: e.time_text,
          location: e.location,
          registrationNumber: r.registration_number,
        };

        // ── Welcome (confirmed, day before; same-morning catch-up) ──
        if (r.registration_status === "confirmed" && (e.daysUntil === 1 || (e.daysUntil === 0 && syd.hour < 14))) {
          if (evWelcome && !(await alreadySent(r.id, "welcome"))) {
            const item = regSummary(r, e);
            if (dryRun) result.welcomes.push(item);
            else {
              let pdf = null;
              try {
                pdf = await buildTicketsPdfForRegistration(r, eventDate);
              } catch (err) {
                console.error(`Welcome tickets PDF failed for ${r.id}:`, err.message);
              }
              const sent = await sendEventWelcomeEmail({
                ...common,
                peopleCount: 1 + (Number(r.adults) || 0) + (Number(r.children) || 0),
                ticketsPdfBuffer: pdf,
                when: e.daysUntil === 0 ? "today" : "tomorrow",
              });
              if (sent.sent) {
                await markSent(r.id, "welcome", "", now);
                result.welcomes.push(item);
              } else result.failed.push({ ...item, kind: "welcome", error: sent.error });
            }
          }
          continue;
        }

        if (!pending) continue;
        if (!evReminders && !evCancel) continue;

        // ── Regular reminder (event more than finalDays away) ──
        if (e.daysUntil > cfg.finalDays) {
          if (evReminders && cfg.reminderDays.has(syd.weekday) && now - created >= DAY_MS && !(await alreadySent(r.id, "payment_reminder", todayKey))) {
            const item = regSummary(r, e, noteFor(claimed, couponOnlyPartial, couponPaid));
            if (dryRun) result.reminders.push(item);
            else {
              const sent = await sendPaymentReminderEmail({ ...common, ...couponInfo, amountDue, payUrl, claimedTransfer: claimed });
              if (sent.sent) {
                await markSent(r.id, "payment_reminder", todayKey, now);
                result.reminders.push(item);
              } else result.failed.push({ ...item, kind: "payment_reminder", error: sent.error });
            }
          }
          continue;
        }

        // Registered after the final-reminder date: never auto-cancelled.
        // Flag for an admin once the cancellation date is reached (and
        // they've had a day to pay), rather than the moment they register.
        if (createdN >= finalDayN) {
          if (evCancel && e.daysUntil <= cfg.cancelDays && now - created >= DAY_MS && !(await alreadySent(r.id, "flagged_review"))) {
            result.needsReview.push(regSummary(r, e, { reason: "registered in the final week and still unpaid — not cancelled" }));
          }
          continue;
        }

        // The final reminder carries the cancellation date only when this
        // event auto-cancels. If auto-cancel is switched on after a plain
        // final reminder went out, a second one WITH the date is sent first
        // — nobody is cancelled without being told when.
        const finalKey = evCancel ? "with-cancel" : "";
        const finalAt = evCancel
          ? await sentAt(r.id, "final_reminder", "with-cancel")
          : await sentAt(r.id, "final_reminder");

        // ── Final reminder ──
        if (!finalAt) {
          if (e.daysUntil >= 1) {
            const item = regSummary(r, e, noteFor(claimed, couponOnlyPartial, couponPaid));
            if (dryRun) result.finals.push(item);
            else {
              const sent = await sendPaymentReminderEmail({
                ...common,
                ...couponInfo,
                // Warn that the coupon part payment lapses on cancellation.
                couponWillLapse: couponOnlyPartial && evCancel,
                amountDue,
                payUrl,
                final: true,
                // If the final reminder is going out late, cancellation moves
                // to the next day so everyone gets at least a day's notice.
                cancelOn: evCancel ? prettyDay(Math.max(cancelDayN, todayN + 1)) : null,
                claimedTransfer: claimed,
              });
              if (sent.sent) {
                await markSent(r.id, "final_reminder", finalKey, now);
                result.finals.push(item);
              } else result.failed.push({ ...item, kind: "final_reminder", error: sent.error });
            }
          }
          continue;
        }

        // ── Auto-cancel ──
        if (evCancel && e.daysUntil <= cfg.cancelDays && e.daysUntil >= 1 && now - finalAt >= 20 * 3_600_000) {
          if ((partial && !couponOnlyPartial) || (claimed && !cfg.cancelClaimed)) {
            if (!(await alreadySent(r.id, "flagged_review"))) {
              result.needsReview.push(
                regSummary(r, e, {
                  reason: partial && !couponOnlyPartial
                    ? `part-paid ($${paid.toFixed(2)} of $${fee.toFixed(2)}) — not cancelled`
                    : "said they paid by bank transfer, not matched yet — not cancelled",
                })
              );
            }
            continue;
          }
          cancelCandidates.push({
            r, e, common,
            couponLapsedAmount: couponOnlyPartial ? couponPaid : 0,
            item: regSummary(r, e, couponOnlyPartial ? { note: `coupon $${couponPaid.toFixed(2)} lapsed` } : {}),
          });
        }
      }
    }

    // ── Cancel (after one last reconciliation of stored bank credits) ──
    if (cancelCandidates.length) {
      if (dryRun) {
        result.cancelled.push(...cancelCandidates.map((c) => c.item));
      } else {
        try {
          await reconcileOpenEvents({ sourceLabel: "Before auto-cancelling unpaid registrations", admin: { name: "Registration scheduler" } });
        } catch (err) {
          console.error("Pre-cancel reconciliation failed:", err.message);
        }
        for (const c of cancelCandidates) {
          const { rows } = await pool.query(
            `UPDATE kutumb_event_registrations
                SET registration_status = 'cancelled', cancelled_at = now(),
                    cancel_reason = 'Payment not received by the cancellation date (automatic)'
              WHERE id = $1 AND registration_status = 'pending_payment' AND payment_status <> 'Paid'
                AND (
                  COALESCE(payment_amount, 0) = 0
                  -- coupon-only part payment: nothing but coupon value on file
                  OR (COALESCE(coupon_amount, 0) > 0
                      AND COALESCE(payment_amount, 0) <= COALESCE(coupon_amount, 0)
                      AND payment_match_confidence IS NULL)
                )
              RETURNING id`,
            [c.r.id]
          );
          if (!rows.length) continue; // paid (or changed) in the meantime
          await markSent(c.r.id, "cancelled", "", now);
          result.cancelled.push(c.item);
          const sent = await sendRegistrationCancelledEmail({
            ...c.common,
            couponLapsedAmount: c.couponLapsedAmount,
            registerUrl: baseUrl ? `${baseUrl}/events` : null,
          });
          if (!sent.sent) result.failed.push({ ...c.item, kind: "cancelled", error: sent.error });
        }
      }
    }

    // ── Tell the admin mailbox about cancellations and anything to review ──
    if (!dryRun && (result.cancelled.length || result.needsReview.length)) {
      const lines = [];
      if (result.cancelled.length) {
        lines.push("Cancelled (payment not received):");
        for (const c of result.cancelled) lines.push(`  • ${c.event} — ${c.registrationNumber || ""} ${c.name} <${c.email}> ($${c.amountDue.toFixed(2)} due)${c.note ? ` — ${c.note}` : ""}`);
        lines.push("");
      }
      if (result.needsReview.length) {
        lines.push("Please review (NOT cancelled automatically):");
        for (const c of result.needsReview) lines.push(`  • ${c.event} — ${c.registrationNumber || ""} ${c.name} <${c.email}>: ${c.reason}`);
      }
      const alert = await sendAdminAlertEmail({ subject: "Registration payments — automatic actions", message: lines.join("\n") }).catch(
        (err) => ({ sent: false, error: err.message })
      );
      // Only stop re-flagging once the admin has actually been told.
      if (alert?.sent) for (const c of result.needsReview) await markSent(c.id, "flagged_review", "", now);
    }

    return result;
  } finally {
    if (locked) await lockClient.query("SELECT pg_advisory_unlock(hashtext($1))", [LOCK_KEY]).catch(() => {});
    lockClient.release();
    if (!dryRun) {
      lastRun = result;
      const didSomething =
        result.reminders.length || result.finals.length || result.cancelled.length || result.welcomes.length || result.failed.length;
      if (didSomething) await setSetting("reg_emails_last_run", JSON.stringify(result), false).catch(() => {});
    }
  }
}

/** Upcoming events (incl. ones the scheduler has to skip) with their ticks and counts. */
export async function listEventsForEmails(now = new Date()) {
  const syd = sydneyParts(now);
  const todayN = dayNumber(syd.y, syd.m, syd.d);
  const { rows } = await pool.query("SELECT * FROM kutumb_upcoming_events ORDER BY id");
  const out = [];
  for (const e of rows) {
    const text = String(e.date_text || "").trim();
    const start = MONTH_ONLY.test(text) ? null : parseEventStartDate(text);
    const eventN = start ? dayNumber(start.getFullYear(), start.getMonth() + 1, start.getDate()) : null;
    if (eventN !== null && eventN < todayN) continue; // already happened
    const eventYear = start ? String(start.getFullYear()) : String(text.match(/\d{4}/)?.[0] || "");
    const { rows: counts } = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE registration_status = 'pending_payment' AND fee > 0 AND payment_status <> 'Paid')::int AS unpaid,
         COUNT(*) FILTER (WHERE registration_status = 'confirmed')::int AS confirmed,
         COUNT(*) FILTER (WHERE registration_status = 'cancelled')::int AS cancelled
       FROM kutumb_event_registrations WHERE lower(event_name) = lower($1) AND event_year = $2`,
      [e.title, eventYear]
    );
    out.push({
      id: e.id,
      title: e.title,
      dateText: e.date_text,
      daysUntil: eventN === null ? null : eventN - todayN,
      schedulable: eventN !== null,
      paidEvent: Number(e.member_fee) > 0 || Number(e.non_member_fee) > 0,
      autoReminders: e.auto_reminders !== false,
      autoCancel: e.auto_cancel === true,
      autoWelcome: e.auto_welcome !== false,
      ...counts[0],
    });
  }
  return out.sort((a, b) => (a.daysUntil ?? 1e9) - (b.daysUntil ?? 1e9));
}

export async function getSchedulerStatus() {
  let lastActivity = null;
  try {
    const raw = await getSetting("reg_emails_last_run");
    lastActivity = raw ? JSON.parse(raw) : null;
  } catch {
    /* ignore */
  }
  const { rows } = await pool.query(
    `SELECT kind, COUNT(*)::int AS n FROM kutumb_registration_notifications
      WHERE sent_at > now() - interval '30 days' GROUP BY kind`
  );
  return {
    lastCheck: lastRun ? { at: lastRun.at, note: lastRun.note } : null,
    lastActivity,
    last30Days: Object.fromEntries(rows.map((r) => [r.kind, r.n])),
    config: await loadConfig().then((c) => ({ ...c, reminderDays: [...c.reminderDays] })),
  };
}

export function startRegistrationScheduler() {
  if (timer) clearInterval(timer);
  const tick = () => {
    runCouponPartPaymentEmails().catch((err) => console.error("Coupon part-payment email error:", err.message));
    runRegistrationEmails().catch((err) => console.error("Registration email scheduler error:", err.message));
  };
  timer = setInterval(tick, 10 * 60_000);
  timer.unref?.();
  setTimeout(tick, 60_000).unref?.();
  console.log("⏰ Registration emails: reminders, auto-cancel and day-before welcome and coupon part-payment emails checked every 10 min");

  // Temporary check-in login codes (see server/lib/checkinCodes.js) are also
  // lazily deleted the moment an expired one is actually tried, but that
  // only catches codes someone still attempts to use. This sweep runs on
  // its own, much tighter cadence so a batch's row disappears from the
  // database within a minute of its expiry, not up to 10 minutes later —
  // matching the admin table, which hides expired rows client-side the
  // moment the clock runs out.
  if (checkinCodeTimer) clearInterval(checkinCodeTimer);
  const checkinTick = () => {
    cleanupExpiredCheckinCodes().catch((err) => console.error("Check-in code cleanup error:", err.message));
  };
  checkinCodeTimer = setInterval(checkinTick, 60_000);
  checkinCodeTimer.unref?.();
  setTimeout(checkinTick, 5_000).unref?.();
}
