// server/lib/openfeedSync.js
//
// Pulls new NAB credits from openfeed into the bank ledger and reconciles
// them against every event with unpaid registrations — on demand ("Sync
// from Bank" / "Sync now") and automatically every 4 hours (openfeed
// refreshes banking data about every 4 hours, so more often gains nothing).

import { pool } from "../db/pool.js";
import { getSetting, setSetting } from "./settings.js";
import { fetchTransactions } from "./openfeedClient.js";
import { storeCredits, reconcileOpenEvents } from "./bankLedger.js";

const LOCK = "kutumb_openfeed_sync";
let timer = null;
let reconcileTimer = null;

async function storeLines(lines) {
  let inserted = 0;
  for (const l of lines) {
    // Upsert the bank's data but never touch an admin's event tag/notes.
    const { rows } = await pool.query(
      `INSERT INTO kutumb_bank_statement_lines
         (id, source, account_id, txn_date, posted_at, amount, description, reference, merchant_name, transaction_type)
       VALUES ($1, 'openfeed', $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (id) DO UPDATE SET
         txn_date = EXCLUDED.txn_date, posted_at = EXCLUDED.posted_at, amount = EXCLUDED.amount,
         description = EXCLUDED.description, reference = EXCLUDED.reference,
         merchant_name = EXCLUDED.merchant_name, transaction_type = EXCLUDED.transaction_type
       RETURNING (xmax = 0) AS inserted`,
      [l.id, l.accountId, l.txnDate, l.postedAt, l.amount, l.description, l.reference, l.merchantName, l.transactionType]
    );
    if (rows[0]?.inserted) inserted++;
  }
  return inserted;
}

/**
 * @param {{ admin?: any, days?: number, onlyUpcoming?: boolean }} opts
 *   onlyUpcoming — reconcile only events still on the Upcoming Events list
 *   (used by the automatic runs); manual syncs reconcile every open event.
 */
export async function syncOpenfeed({ admin = null, days, onlyUpcoming = false } = {}) {
  const client = await pool.connect();
  let locked = false;
  try {
    locked = (await client.query("SELECT pg_try_advisory_lock(hashtext($1)) AS ok", [LOCK])).rows[0].ok;
    if (!locked) return { skipped: true, message: "A bank sync is already running." };

    // First sync: pull a year of history so the bank dashboard has something to show.
    const { rows: have } = await pool.query("SELECT 1 FROM kutumb_bank_statement_lines LIMIT 1");
    const { lines, credits, oldest } = await fetchTransactions({ days: days || (have.length ? undefined : 365) });
    const newLines = await storeLines(lines);
    const newCredits = await storeCredits(credits, "openfeed");
    const result = await reconcileOpenEvents({
      sourceLabel: `NAB via openfeed (${oldest} onwards)`,
      admin: admin || { name: "openfeed auto-sync" },
      onlyUpcoming,
    });
    const summary = {
      at: new Date().toISOString(),
      linesRead: lines.length,
      newLines,
      creditsRead: credits.length,
      newCredits,
      events: result.events,
      unmatched: result.unmatched.length,
      message: `${lines.length} transaction(s) read from NAB since ${oldest} (${newLines} new; ${credits.length} credit(s), ${newCredits} new). ${result.message}`,
    };
    await setSetting("openfeed_last_sync", JSON.stringify(summary), false);
    return summary;
  } catch (err) {
    await setSetting(
      "openfeed_last_sync",
      JSON.stringify({ at: new Date().toISOString(), error: err.message }),
      false
    ).catch(() => {});
    throw err;
  } finally {
    if (locked) await client.query("SELECT pg_advisory_unlock(hashtext($1))", [LOCK]).catch(() => {});
    client.release();
  }
}

export function startOpenfeedAutoSync() {
  if (timer) clearInterval(timer);
  const tick = async () => {
    try {
      if ((await getSetting("openfeed_auto_sync")) === "false") return;
      if (!(await getSetting("openfeed_refresh_token")) || !(await getSetting("openfeed_grant_id"))) return;
      const r = await syncOpenfeed({ onlyUpcoming: true });
      if (!r.skipped) console.log("🏦 openfeed auto-sync:", r.message);
    } catch (err) {
      console.error("openfeed auto-sync failed:", err.message);
    }
  };
  timer = setInterval(tick, 4 * 3_600_000);
  timer.unref?.();
  setTimeout(tick, 2 * 60_000).unref?.();

  // Every hour, re-check stored-but-unmatched bank credits against UPCOMING
  // events with pending payments — catches a transfer that arrived before
  // the person registered, or a registration edited after the last sync.
  if (reconcileTimer) clearInterval(reconcileTimer);
  reconcileTimer = setInterval(async () => {
    try {
      if ((await getSetting("auto_reconcile_upcoming")) === "false") return;
      const r = await reconcileOpenEvents({
        sourceLabel: "Automatic check of stored bank credits",
        admin: { name: "Auto-reconcile" },
        onlyUpcoming: true,
      });
      if (r.events.length) console.log("🔁 auto-reconcile:", r.message);
    } catch (err) {
      console.error("auto-reconcile failed:", err.message);
    }
  }, 3_600_000);
  reconcileTimer.unref?.();
}
