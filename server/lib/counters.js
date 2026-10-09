/**
 * Generates the next membership number in the format YYNNNN
 *   YY   = last 2 digits of the calendar year in which the member registers
 *   NNNN = zero-padded sequence number for that year
 *
 * Examples:
 *   1st member registered in 2026  -> 260001
 *   221st member registered in 2027 -> 270221
 *
 * This is computed LIVE from the current members list every time - it is
 * simply (highest existing number for that year) + 1. There is no separate
 * persisted counter, so if the highest-numbered member for a year is ever
 * deleted, that number becomes available again for the next registration
 * instead of being permanently burned.
 */
export function getNextMembershipNumber(members, registeredAt = new Date()) {
  const fullYear = registeredAt.getFullYear();
  const yy = String(fullYear).slice(-2);

  let maxSeq = 0;
  for (const member of members) {
    const num = member?.membershipNumber;
    if (typeof num !== "string" || num.length !== 6 || !num.startsWith(yy)) continue;

    const seq = parseInt(num.slice(2), 10);
    if (!isNaN(seq) && seq > maxSeq) maxSeq = seq;
  }

  const nextSeq = maxSeq + 1;
  return `${yy}${String(nextSeq).padStart(4, "0")}`;
}
