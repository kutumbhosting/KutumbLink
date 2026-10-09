// Temporary check-in login codes — see the kutumb_checkin_codes table
// comment in server/db/schema.sql for the overall design.

import { pool } from "../db/pool.js";
import { parseEventEndDate } from "./eventDates.js";

// Deliberately excludes visually-ambiguous characters (0/O, 1/I/L) since
// these are read off a phone screen or an email by a volunteer at the door,
// often re-typed by hand.
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

function randomCode(length = 6) {
  let out = "";
  for (let i = 0; i < length; i++) out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return out;
}

/** End-of-event-day, falling back to "23:59 tonight" if the date string can't be parsed. */
function computeExpiry(eventDateText) {
  const parsed = parseEventEndDate(eventDateText);
  if (parsed) return parsed;
  const fallback = new Date();
  fallback.setHours(23, 59, 59, 999);
  return fallback;
}

/**
 * Generates 5 fresh single-use login codes for one event, replacing any
 * still-active codes already issued for that same event (so re-clicking the
 * button doesn't silently pile up old codes alongside new ones — the
 * previous batch simply stops working the moment a new batch is generated).
 */
export async function generateCheckinCodes({ eventName, eventYear, eventDateText, createdBy }) {
  const expiresAt = computeExpiry(eventDateText);

  await pool.query(
    `DELETE FROM kutumb_checkin_codes WHERE event_name = $1 AND COALESCE(event_year, '') = COALESCE($2, '')`,
    [eventName, eventYear || null]
  );

  const codes = [];
  for (let i = 0; i < 5; i++) {
    // Retry on the (very rare) chance of a collision with an existing code
    // for a different event, since `code` is UNIQUE across the whole table.
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = randomCode();
      try {
        await pool.query(
          `INSERT INTO kutumb_checkin_codes (code, event_name, event_year, event_date_text, expires_at, created_by)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [code, eventName, eventYear || null, eventDateText || null, expiresAt, createdBy || null]
        );
        codes.push(code);
        break;
      } catch (err) {
        if (err.code === "23505" /* unique_violation */ && attempt < 4) continue; // try another code
        throw err;
      }
    }
  }

  return { codes, expiresAt };
}

export const MAX_VOLUNTEER_NAME_LENGTH = 60;

/**
 * Redeems a single-use code for a named volunteer. Returns:
 *   - { error: "name" }          — name missing/too short/too long
 *   - null                       — no such code (never existed, or already cleaned up)
 *   - { expired: true }          — existed but is past its expiry (deleted as a side effect)
 *   - { used: true, usedBy }     — code was already used by someone
 *   - { row }                    — success; the code is now burned and tied to `name`
 *
 * The "is it unused?" check and the write are ONE conditional UPDATE
 * (... WHERE used_at IS NULL), so two people typing the same code at the same
 * moment can never both get in — Postgres serialises the row update and only
 * one UPDATE matches.
 */
export async function redeemCheckinCode(code, name) {
  const normalized = String(code || "").trim().toUpperCase();
  if (!normalized) return null;

  const cleanName = String(name || "").replace(/\s+/g, " ").trim();
  if (cleanName.length < 2 || cleanName.length > MAX_VOLUNTEER_NAME_LENGTH) return { error: "name" };

  const { rows } = await pool.query("SELECT * FROM kutumb_checkin_codes WHERE code = $1", [normalized]);
  const existing = rows[0];
  if (!existing) return null;

  if (new Date(existing.expires_at).getTime() <= Date.now()) {
    await pool.query("DELETE FROM kutumb_checkin_codes WHERE id = $1", [existing.id]);
    return { expired: true };
  }

  const { rows: claimed } = await pool.query(
    `UPDATE kutumb_checkin_codes
     SET used_at = now(), used_by_name = $2, last_used_at = now()
     WHERE id = $1 AND used_at IS NULL
     RETURNING *`,
    [existing.id, cleanName]
  );
  if (!claimed[0]) return { used: true, usedBy: existing.used_by_name };
  return { row: claimed[0] };
}

/** Deletes every code whose expiry has already passed. Safe to call often. */
export async function cleanupExpiredCheckinCodes() {
  const { rowCount } = await pool.query("DELETE FROM kutumb_checkin_codes WHERE expires_at < now()");
  return rowCount;
}

/**
 * Lists every currently-issued batch of codes (one row per event/year the
 * codes were generated for), most recently generated first. All 5 codes in
 * a batch share the same event_name + event_year + expires_at, so grouping
 * on those also gives us a natural "generated at" timestamp (the earliest
 * created_at in the batch — in practice all 5 land within milliseconds of
 * each other).
 */
export async function listCheckinCodeBatches() {
  const { rows } = await pool.query(
    `SELECT event_name, event_year, event_date_text, expires_at,
            MIN(created_at) AS generated_at,
            array_agg(code ORDER BY code) AS codes,
            json_agg(json_build_object('code', code, 'used_at', used_at, 'used_by_name', used_by_name) ORDER BY code) AS code_details
     FROM kutumb_checkin_codes
     GROUP BY event_name, event_year, event_date_text, expires_at
     ORDER BY MIN(created_at) DESC`
  );
  return rows;
}

/**
 * Changes the expiry date/time for every code in one batch — e.g. an event
 * ran later than expected and the door volunteers still need their codes.
 * Returns the number of codes updated (0 means no such batch).
 */
export async function updateCheckinCodeExpiry({ eventName, eventYear, expiresAt }) {
  const { rowCount } = await pool.query(
    `UPDATE kutumb_checkin_codes SET expires_at = $3
     WHERE event_name = $1 AND COALESCE(event_year, '') = COALESCE($2, '')`,
    [eventName, eventYear || null, expiresAt]
  );
  return rowCount;
}

/**
 * Deletes every code in one batch immediately — e.g. an event was cancelled
 * or the codes were shared somewhere they shouldn't have been. Returns the
 * number of codes deleted.
 */
export async function deleteCheckinCodeBatch({ eventName, eventYear }) {
  const { rowCount } = await pool.query(
    `DELETE FROM kutumb_checkin_codes WHERE event_name = $1 AND COALESCE(event_year, '') = COALESCE($2, '')`,
    [eventName, eventYear || null]
  );
  return rowCount;
}
