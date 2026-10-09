const MONTHS = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
};

function monthIndex(name) {
  return MONTHS[name?.trim().toLowerCase()];
}

/**
 * Best-effort parse of the *end* of an event's date string - used to decide
 * whether an event has finished and should move to Past Events.
 * Returns a Date, or null if the string can't be confidently parsed
 * (in which case the event is left alone / treated as still upcoming).
 */
export function parseEventEndDate(dateStr) {
  if (!dateStr || typeof dateStr !== "string") return null;
  const s = dateStr.trim();

  // "April 11-15, 2026" (day range within one month)
  let m = s.match(/^([A-Za-z]+)\s+(\d{1,2})\s*-\s*(\d{1,2})\s*,\s*(\d{4})$/);
  if (m) {
    const month = monthIndex(m[1]);
    if (month === undefined) return null;
    return new Date(Number(m[4]), month, Number(m[3]), 23, 59, 59, 999);
  }

  // "September, 2026" (month + year only - no specific day)
  m = s.match(/^([A-Za-z]+)\s*,\s*(\d{4})$/);
  if (m) {
    const month = monthIndex(m[1]);
    if (month === undefined) return null;
    // last day of that month
    return new Date(Number(m[2]), month + 1, 0, 23, 59, 59, 999);
  }

  // "May 9, 2026" or any other format Date can parse natively
  const parsed = new Date(s);
  if (!isNaN(parsed.getTime())) {
    parsed.setHours(23, 59, 59, 999);
    return parsed;
  }

  return null;
}

/**
 * Best-effort parse of the *start* of an event's date string - used as the
 * sort key for Past Events (most recent first).
 * Returns a Date, or null if unparseable.
 */
export function parseEventStartDate(dateStr) {
  if (!dateStr || typeof dateStr !== "string") return null;
  const s = dateStr.trim();

  // "April 11-15, 2026"
  let m = s.match(/^([A-Za-z]+)\s+(\d{1,2})\s*-\s*(\d{1,2})\s*,\s*(\d{4})$/);
  if (m) {
    const month = monthIndex(m[1]);
    if (month === undefined) return null;
    return new Date(Number(m[4]), month, Number(m[2]), 0, 0, 0, 0);
  }

  // "September, 2026"
  m = s.match(/^([A-Za-z]+)\s*,\s*(\d{4})$/);
  if (m) {
    const month = monthIndex(m[1]);
    if (month === undefined) return null;
    return new Date(Number(m[2]), month, 1, 0, 0, 0, 0);
  }

  const parsed = new Date(s);
  if (!isNaN(parsed.getTime())) return parsed;

  return null;
}

/** True once "now" is after the event's best-effort end date. */
export function isEventPast(dateStr, now = new Date()) {
  const end = parseEventEndDate(dateStr);
  return !!end && end.getTime() < now.getTime();
}

/**
 * Returns a NEW array of past events sorted descending (most recent event
 * first). Events whose date can't be parsed are pushed to the bottom,
 * in their original relative order.
 */
export function sortPastEventsDescending(events) {
  if (!Array.isArray(events)) return [];

  const withKeys = events.map((event, index) => ({
    event,
    index,
    key: parseEventStartDate(event.date),
  }));

  withKeys.sort((a, b) => {
    if (a.key && b.key) return b.key.getTime() - a.key.getTime();
    if (a.key && !b.key) return -1; // dated events before undated ones
    if (!a.key && b.key) return 1;
    return a.index - b.index; // preserve original order among undated events
  });

  return withKeys.map((w) => w.event);
}
