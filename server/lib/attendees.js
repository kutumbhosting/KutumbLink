import crypto from "crypto";
import { pool } from "../db/pool.js";

/**
 * Creates one kutumb_registration_attendees row per individual person on a
 * registration — the primary registrant, each additional adult, each
 * under-5 child and each 5+ child — each with its own opaque QR token.
 *
 * Safe to call more than once for the same registration (e.g. if an admin
 * later edits the headcount) — it always replaces the previous set rather
 * than appending, so the attendee list never drifts out of sync with the
 * registration's adult/children counts. Any already-checked-in attendee
 * whose category still exists in the new counts is preserved (matched by
 * position within its category) so editing a registration never silently
 * un-checks someone who has already arrived.
 */
export async function syncRegistrationAttendees(client, registration) {
  const {
    id: registrationId,
    organisation_id: organisationId,
    event_name: eventName,
    event_year: eventYear,
    name,
    adults,
    children_under5: childrenUnder5,
    children_5plus: children5Plus,
    adult_names: adultNames,
    children_under5_names: childrenUnder5Names,
    children_5plus_names: children5PlusNames,
  } = registration;

  const { rows: existing } = await client.query(
    "SELECT * FROM kutumb_registration_attendees WHERE registration_id = $1 ORDER BY id",
    [registrationId]
  );

  const byCategory = { primary_adult: [], adult: [], child_under5: [], child_5plus: [] };
  for (const row of existing) {
    (byCategory[row.category] || byCategory.adult).push(row);
  }

  // adult_names / children_*_names come back from Postgres as parsed JSON
  // arrays already (jsonb), but guard against a stringified or missing
  // value too — older rows created before these columns existed will have
  // none of this, and should fall back to the old generic labels exactly
  // as before.
  const asNameArray = (v) => {
    if (Array.isArray(v)) return v;
    if (typeof v === "string") {
      try {
        const parsed = JSON.parse(v);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    return [];
  };
  const adultNameList = asNameArray(adultNames);
  const childrenUnder5NameList = asNameArray(childrenUnder5Names);
  const children5PlusNameList = asNameArray(children5PlusNames);

  const desired = [];
  desired.push({ category: "primary_adult", name: name || "Primary Registrant" });
  for (let i = 1; i <= Number(adults || 0); i++) {
    const givenName = adultNameList[i - 1]?.trim();
    desired.push({ category: "adult", name: givenName || `Additional Adult ${i}` });
  }
  for (let i = 1; i <= Number(childrenUnder5 || 0); i++) {
    const givenName = childrenUnder5NameList[i - 1]?.trim();
    desired.push({ category: "child_under5", name: givenName || `Child ${i} (Under 5)` });
  }
  for (let i = 1; i <= Number(children5Plus || 0); i++) {
    const givenName = children5PlusNameList[i - 1]?.trim();
    desired.push({ category: "child_5plus", name: givenName || `Child ${i} (5+)` });
  }

  const keepIds = new Set();
  const created = [];
  const cursor = { primary_adult: 0, adult: 0, child_under5: 0, child_5plus: 0 };

  for (const d of desired) {
    const pool_ = byCategory[d.category] || [];
    const idx = cursor[d.category]++;
    const reuse = pool_[idx];
    if (reuse) {
      keepIds.add(reuse.id);
      // Keep the existing name if it was custom-edited; otherwise refresh it.
      if (!reuse.name || /^(Primary Registrant|Additional Adult|Child)/.test(reuse.name)) {
        await client.query("UPDATE kutumb_registration_attendees SET name = $1 WHERE id = $2", [d.name, reuse.id]);
      }
    } else {
      const qrToken = crypto.randomBytes(16).toString("hex");
      const { rows } = await client.query(
        `INSERT INTO kutumb_registration_attendees (registration_id, event_name, event_year, name, category, qr_token, organisation_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [registrationId, eventName, eventYear, d.name, d.category, qrToken, organisationId || 1]
      );
      created.push(rows[0]);
      keepIds.add(rows[0].id);
    }
  }

  // Remove any surplus attendees left over from a reduced headcount
  // (e.g. adults count was edited down) — never removes anyone already
  // checked in, so an edit can't silently erase someone's checked-in visit.
  const toRemove = existing.filter((row) => !keepIds.has(row.id) && !row.checked_in_at);
  if (toRemove.length > 0) {
    await client.query(
      "DELETE FROM kutumb_registration_attendees WHERE id = ANY($1)",
      [toRemove.map((r) => r.id)]
    );
  }

  const { rows: final } = await client.query(
    "SELECT * FROM kutumb_registration_attendees WHERE registration_id = $1 ORDER BY id",
    [registrationId]
  );
  return final;
}

export async function getAttendeesForRegistration(registrationId) {
  const { rows } = await pool.query(
    "SELECT * FROM kutumb_registration_attendees WHERE registration_id = $1 ORDER BY id",
    [registrationId]
  );
  return rows;
}
