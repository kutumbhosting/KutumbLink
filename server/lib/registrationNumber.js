/**
 * Event registration numbers.
 *
 * Format: <EVENT CODE>-R<seq>, e.g. UTS26-R0012 for the 12th registration
 * of "Utsav 2026". The code makes every registration number unique across
 * ALL events, so a bank reference like "UTS26-R0012" can only ever match
 * one registration — even when one bank account (and one bank feed or
 * statement) receives money for several events at once.
 *
 * Registrations created before this change keep their old plain R0001
 * numbers (people may already have paid quoting them). The sequence simply
 * continues: an event with R0001..R0040 gets UTS26-R0041 next.
 */

const STOP_WORDS = new Set(["KUTUMB", "THE", "AND", "OF", "FOR", "A", "AN", "IN", "ON", "AT", "WITH", "EVENT"]);

/** "Utsav 2026" → "UTS", "International Yoga Day" → "IYD", "Musical Evening" → "MUE" */
function lettersFor(eventName) {
  const words = String(eventName || "")
    .toUpperCase()
    .replace(/[^A-Z\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !STOP_WORDS.has(w));
  if (words.length === 0) return "EVT";
  if (words.length === 1) return words[0].slice(0, 3).padEnd(3, "X");

  let code = words.slice(0, 3).map((w) => w[0]).join("");
  // Two-word names: take one extra letter from the first word so codes stay 3 letters.
  if (code.length < 3) code = words[0].slice(0, 1 + (3 - code.length)) + code.slice(1);
  return code.slice(0, 3);
}

/**
 * @param {string} eventName
 * @param {string|number} eventYear
 * @param {Set<string>} takenCodes codes already used by OTHER events
 */
export function deriveEventCode(eventName, eventYear, takenCodes = new Set()) {
  const yy = String(eventYear || "").replace(/\D/g, "").slice(-2).padStart(2, "0");
  const base = `${lettersFor(eventName)}${yy}`;
  if (!takenCodes.has(base)) return base;
  // Two different events with the same code in the same year: UTS26B, UTS26C, ...
  for (const suffix of "BCDEFGHJKLMNPQRSTUVWXYZ") {
    if (!takenCodes.has(base + suffix)) return base + suffix;
  }
  return `${base}${Date.now() % 1000}`;
}

/** Event code part of a registration number, or null for old plain "R0001" numbers. */
export function eventCodeOf(registrationNumber) {
  const m = String(registrationNumber || "").match(/^([A-Z0-9]+)-R\d+$/);
  return m ? m[1] : null;
}

/**
 * @param {Array<{registrationNumber?: string}>} existingRegistrations this event's registrations
 * @param {string} [eventCode] from deriveEventCode(); omit for the old plain format
 */
export function getNextRegistrationNumber(existingRegistrations, eventCode) {
  let maxSeq = 0;
  for (const reg of existingRegistrations) {
    const m = String(reg?.registrationNumber || "").match(/(?:^|-)R(\d+)$/);
    if (!m) continue;
    const seq = parseInt(m[1], 10);
    if (!isNaN(seq) && seq > maxSeq) maxSeq = seq;
  }
  const seqPart = `R${String(maxSeq + 1).padStart(4, "0")}`;
  return eventCode ? `${eventCode}-${seqPart}` : seqPart;
}

/**
 * Works out the code for an event: reuses the one its registrations already
 * carry, otherwise derives a new one that no other event is using.
 * `client` is a pg client/pool.
 */
export async function resolveEventCode(client, eventName, eventYear) {
  const { rows } = await client.query(
    `SELECT DISTINCT event_name, event_year, split_part(registration_number, '-', 1) AS code
       FROM kutumb_event_registrations
      WHERE registration_number LIKE '%-R%'`
  );
  const own = rows.find((r) => r.event_name === eventName && String(r.event_year) === String(eventYear));
  if (own?.code) return own.code;
  // First prefixed registration for this event: serialise code allocation
  // (transaction-scoped lock) so two new events can't grab the same code.
  await client.query("SELECT pg_advisory_xact_lock(hashtext('kutumb_event_code_alloc'))");
  const { rows: fresh } = await client.query(
    `SELECT DISTINCT split_part(registration_number, '-', 1) AS code
       FROM kutumb_event_registrations
      WHERE registration_number LIKE '%-R%' AND NOT (event_name = $1 AND event_year = $2)`,
    [eventName, String(eventYear)]
  );
  rows.splice(0, rows.length, ...fresh);
  const taken = new Set(rows.map((r) => r.code));
  return deriveEventCode(eventName, eventYear, taken);
}
