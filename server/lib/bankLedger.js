// server/lib/bankLedger.js
//
// The bank-credit ledger (kutumb_bank_transactions) shared by every way
// transactions come in: live openfeed NAB feed, statement files dropped in Google
// Drive, and the manual "Upload Bank Statement" button.
//
// Statement rows have no bank-side id, so each gets a deterministic one from
// its date, amount, description and how many identical rows came before it
// in the same file. Two overlapping statements (e.g. 1–30 Sep, then
// 15 Sep–15 Oct) therefore produce the same ids for the same credits and a
// credit is only ever stored — and matched — once.

import crypto from "crypto";
import { pool } from "../db/pool.js";
import { reconcile } from "./paymentReconciliation.js";
import { runReconciliation, dbRowToRegistration } from "./reconciliationRun.js";
import { parseEventStartDate } from "./eventDates.js";

function dayKey(date) {
  if (!date) return "nodate";
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return "nodate";
  // Local calendar day — statements are dated in Sydney time.
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Adds a stable `id` to each statement transaction. */
export function withStatementIds(transactions) {
  const seen = new Map();
  return transactions.map((t) => {
    const base = `${dayKey(t.date)}|${Number(t.amount).toFixed(2)}|${String(t.details || "").replace(/\s+/g, " ").trim().toUpperCase()}`;
    const n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    const id = "stmt_" + crypto.createHash("sha256").update(`${base}|${n}`).digest("hex").slice(0, 32);
    return { ...t, id };
  });
}

/**
 * Stores credits (each must have an id). Returns how many were new.
 * @param {Array<{id:string, date:Date|null, amount:number, details:string, accountId?:string}>} txns
 */
const squash = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/**
 * The same bank credit can arrive twice through different routes (e.g. the
 * live openfeed feed AND a statement dropped in the Drive folder) with
 * different ids. Treat it as the same credit when another source already
 * holds one with the same amount, a date within 2 days, and matching
 * description text — so it can never be matched to a second registration.
 */
async function existsFromOtherSource(t, source) {
  const { rows } = await pool.query(
    `SELECT description FROM kutumb_bank_transactions
      WHERE source <> $1 AND amount = $2
        AND ($3::timestamptz IS NULL OR post_date IS NULL OR abs(extract(epoch FROM post_date - $3::timestamptz)) <= 2 * 86400)`,
    [source, t.amount, t.date]
  );
  const mine = squash(t.details);
  if (!mine) return false;
  return rows.some((r) => {
    const other = squash(r.description);
    if (!other) return false;
    const a = mine.slice(0, 12);
    const b = other.slice(0, 12);
    return other.includes(a) || mine.includes(b);
  });
}

export async function storeCredits(txns, source) {
  let inserted = 0;
  for (const t of txns) {
    if (await existsFromOtherSource(t, source)) continue;
    const { rowCount } = await pool.query(
      `INSERT INTO kutumb_bank_transactions (id, source, account_id, post_date, amount, description)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO NOTHING`,
      [t.id, source, t.accountId || null, t.date, t.amount, t.details]
    );
    inserted += rowCount;
  }
  return inserted;
}

export async function markAllocations(allocations, eventName, eventYear) {
  for (const a of allocations) {
    if (!a.transaction?.id) continue;
    await pool.query(
      `UPDATE kutumb_bank_transactions
          SET allocated_registration_id = $1, allocated_event_name = $2, allocated_event_year = $3,
              allocated_at = now(), match_confidence = $4, match_reason = $5
        WHERE id = $6 AND allocated_registration_id IS NULL`,
      [a.registration.id, eventName, eventYear, a.confidence, a.reason, a.transaction.id]
    );
  }
}

/**
 * Reconciles every unallocated credit in the ledger against every event that
 * still has unpaid registrations — in ONE matching pass, so a credit goes to
 * the registration it matches best across all events (a family registered
 * for two events can't have one transfer claimed by the wrong one). Then
 * applies the result event by event through the normal runReconciliation(),
 * which updates statuses, emails tickets and saves a report per event.
 */
/**
 * (lower(title), year) of events on the Upcoming Events list that haven't
 * finished more than `graceDays` ago (events without a parseable date count
 * as upcoming).
 */
async function upcomingEventKeys(graceDays = 7) {
  const { rows } = await pool.query("SELECT title, date_text FROM kutumb_upcoming_events");
  const cutoff = Date.now() - graceDays * 86_400_000;
  const keys = new Set();
  for (const e of rows) {
    const start = parseEventStartDate(e.date_text);
    const year = start ? String(start.getFullYear()) : String(e.date_text || "").match(/\d{4}/)?.[0];
    if (start && start.getTime() < cutoff) continue;
    if (year) keys.add(`${String(e.title).toLowerCase()}\u0000${year}`);
  }
  return keys;
}

export async function reconcileOpenEvents({ sourceLabel, admin, onlyUpcoming = false }) {
  const { rows: allEvents } = await pool.query(
    `SELECT event_name, event_year, MIN(created_at) AS first_reg
       FROM kutumb_event_registrations
      GROUP BY event_name, event_year
     HAVING bool_or(fee > 0 AND payment_status <> 'Paid' AND registration_status <> 'cancelled')`
  );
  let events = allEvents;
  if (onlyUpcoming) {
    const keys = await upcomingEventKeys();
    events = allEvents.filter((e) => keys.has(`${String(e.event_name).toLowerCase()}\u0000${e.event_year}`));
  }
  if (events.length === 0) {
    return {
      events: [],
      unmatched: [],
      message: onlyUpcoming ? "No upcoming events have unpaid registrations." : "No events have unpaid registrations.",
    };
  }

  const earliest = new Date(Math.min(...events.map((e) => new Date(e.first_reg).getTime())) - 86400000);
  const { rows: credits } = await pool.query(
    `SELECT id, post_date, amount, description FROM kutumb_bank_transactions
      WHERE allocated_registration_id IS NULL AND (post_date IS NULL OR post_date >= $1)
      ORDER BY post_date`,
    [earliest]
  );
  const transactions = credits.map((r) => ({
    id: r.id,
    date: r.post_date ? new Date(r.post_date) : null,
    amount: Number(r.amount),
    details: r.description || "",
  }));
  if (transactions.length === 0) {
    return { events: [], unmatched: [], message: "No unmatched bank credits to reconcile." };
  }

  const { rows: regRows } = await pool.query(
    `SELECT r.* FROM kutumb_event_registrations r
      WHERE (r.event_name, r.event_year) IN (SELECT * FROM unnest($1::text[], $2::text[]))
        AND r.registration_status <> 'cancelled'`,
    [events.map((e) => e.event_name), events.map((e) => String(e.event_year))]
  );
  const registrations = regRows.map(dbRowToRegistration);

  const { allocations } = reconcile(registrations, transactions);

  // Which credits go to which event.
  const byEvent = new Map();
  for (const a of allocations) {
    const key = `${a.registration.eventName}\u0000${a.registration.eventYear}`;
    if (!byEvent.has(key)) byEvent.set(key, []);
    byEvent.get(key).push(transactions.find((t) => t.id === a.transaction.id));
  }

  const results = [];
  for (const [key, txns] of byEvent) {
    const [eventName, eventYear] = key.split("\u0000");
    const { allocations: applied, ...result } = await runReconciliation({
      eventName,
      eventYear,
      transactions: txns,
      sourceLabel,
      admin,
    });
    await markAllocations(applied, eventName, eventYear);
    results.push({
      eventName,
      eventYear,
      reconciliationId: result.reconciliationId,
      newlyMatched: result.summary.newlyMatched,
      partialPayments: result.summary.partialPayments,
      creditsMatched: applied.length,
      amountMatched: applied.reduce((s, a) => s + a.transaction.amount, 0),
    });
  }

  const allocatedIds = new Set(allocations.map((a) => a.transaction.id));
  const unmatched = transactions.filter((t) => !allocatedIds.has(t.id));
  const matchedCount = results.reduce((s, r) => s + r.creditsMatched, 0);
  return {
    events: results,
    unmatched,
    message:
      `${matchedCount} credit(s) matched across ${results.length} event(s); ` +
      `${unmatched.length} credit(s) left unmatched (kept for the next run).`,
  };
}
