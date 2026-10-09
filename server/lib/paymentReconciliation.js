// server/lib/paymentReconciliation.js
//
// Matches registrations for one event against the credit transactions in
// an uploaded bank statement. This is the same reconciliation logic used
// to manually reconcile the Utsav 2026 spreadsheet, ported to JS so it can
// run from the "Upload Bank Statement" button on the Event Registration
// page for every event, automatically.
//
// The bank reference text is messy — it's whatever free-text description
// the *payer* typed into their own banking app, often with spaces
// stripped and several fields run together (e.g.
// "MRS SNEHA PATELSneha Patel Utsav reSneha Patel Uts"). Matching is
// therefore done on a normalized (uppercased, non-alphanumeric-stripped)
// version of that text, from most to least reliable signal:
//
//   1. Registration number quoted in the reference           → High
//   2. Membership number quoted in the reference              → High
//   3. Registrant's email name quoted in the reference         → High
//   4. Full registrant name found in the reference             → High
//   5. Full name found allowing ~80% spelling similarity        → Medium
//   6. One distinctive (non-common) name part found             → Medium
//   7. A name truncated to its first 4+ letters, only accepted
//      when the paid amount exactly equals the fee due           → Low
//
// Common surnames (Kumar, Singh, Sharma, Patel, Gupta, Kaur, Rao, Devi,
// Das) are never accepted as the sole match, and name fragments under 4
// letters are ignored, so a short token doesn't coincidentally match
// inside an unrelated longer word (e.g. "Kar" inside "Shankar").
//
// A transaction is used for at most one registration. Donation-flavoured
// credits (mentions of flood/relief/disaster with no event wording) are
// pulled out before matching and never assigned to a registration.

const TITLES = new Set(["MR", "MRS", "MS", "DR", "MISS", "FM", "THE"]);
const COMMON_SURNAMES = new Set([
  "KUMAR", "SINGH", "DEVI", "KAUR", "SHARMA", "GUPTA", "PATEL", "RAO",
  "DAS", "DASS", "PRASAD", "BALA", "LAL", "KUMARI", "MAHESH", "SHANKAR",
]);

const DONATION_RE = /NEPAL|FLOOD|DISASTER|RELIEF|DONAT/;
const EVENT_WORDS_RE = /UTSAV|USTAV|FESTIVAL|KUTUMB|TICKET|REGISTRAT|EVENT|MEMBER|SEP|SUND/;

export function normalize(s) {
  return String(s ?? "")
    .normalize("NFKD")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function tokenize(name) {
  return String(name ?? "")
    .toUpperCase()
    .split(/[^A-Z]+/)
    .filter((w) => w.length >= 3 && !TITLES.has(w));
}

// Levenshtein similarity ratio in [0, 1], same idea as Python's
// difflib.SequenceMatcher.ratio() — used to absorb small spelling
// differences between the form and the bank text (e.g. Shveta / Shweta).
function similarityRatio(a, b) {
  if (a === b) return 1;
  const la = a.length, lb = b.length;
  if (la === 0 || lb === 0) return 0;
  const dp = Array.from({ length: la + 1 }, () => new Array(lb + 1).fill(0));
  for (let i = 0; i <= la; i++) dp[i][0] = i;
  for (let j = 0; j <= lb; j++) dp[0][j] = j;
  for (let i = 1; i <= la; i++) {
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  const dist = dp[la][lb];
  return 1 - dist / Math.max(la, lb);
}

function fuzzyIn(token, flat, threshold = 0.8) {
  if (!token) return 0;
  if (flat.includes(token)) return 1;
  const n = token.length;
  let best = 0;
  for (const L of [n - 1, n, n + 1]) {
    if (L < 4) continue;
    for (let i = 0; i <= Math.max(0, flat.length - L); i++) {
      const r = similarityRatio(token, flat.slice(i, i + L));
      if (r > best) best = r;
    }
  }
  return best >= threshold ? best : 0;
}

function classifyTransaction(details) {
  const raw = String(details ?? "").toUpperCase();
  const isDonation = DONATION_RE.test(raw) && !EVENT_WORDS_RE.test(raw);
  const hasEventWords = EVENT_WORDS_RE.test(raw);
  return { raw, flat: normalize(raw), isDonation, hasEventWords };
}

/**
 * Score how well one registration matches one transaction.
 * @returns {{score:number, confidence:'High'|'Medium'|'Low', reason:string}}
 */
function scoreMatch(reg, txn) {
  const flat = txn.flat;

  const regNoHit = registrationNumberIn(reg.registrationNumber, txn);
  if (regNoHit) {
    // An event-prefixed number is unique across all events, so it outranks
    // an old plain number (which exists once per event).
    return {
      score: regNoHit === "prefixed" ? 110 : 100,
      confidence: "High",
      reason: `Registration no. ${reg.registrationNumber} in bank reference`,
    };
  }

  const memNo = reg.membershipNumber ? String(reg.membershipNumber).trim() : "";
  if (memNo && flat.includes(normalize(memNo))) {
    return { score: 95, confidence: "High", reason: `Membership no. ${memNo} in bank reference` };
  }

  const emailLocal = normalize(String(reg.email || "").split("@")[0]);
  if (emailLocal.length > 7 && flat.includes(emailLocal)) {
    return { score: 90, confidence: "High", reason: "Email name in bank reference" };
  }

  const tokens = tokenize(reg.name);
  if (tokens.length === 0) return { score: 0, confidence: "", reason: "" };

  const exact = tokens.filter((w) => flat.includes(w));
  const fz = {};
  for (const w of tokens) fz[w] = fuzzyIn(w, flat);

  if (tokens.length >= 2 && flat.includes(tokens.join(""))) {
    return { score: 88, confidence: "High", reason: "Full name matches payer/reference" };
  }
  if (tokens.length >= 2 && tokens.every((w) => fz[w])) {
    return exact.length === tokens.length
      ? { score: 88, confidence: "High", reason: "Full name matches payer/reference" }
      : { score: 80, confidence: "Medium", reason: "Name matches (spelling variant in bank reference)" };
  }
  if (exact.length >= 2) {
    return { score: 85, confidence: "Medium", reason: "Name parts match reference" };
  }
  if (exact.length === 1) {
    const w = exact[0];
    if (w.length < 4) return { score: 0, confidence: "", reason: "" };
    if (COMMON_SURNAMES.has(w)) {
      return { score: 50, confidence: "Low", reason: `Common surname '${titleCase(w)}' only` };
    }
    return { score: 70, confidence: "Medium", reason: `Name '${titleCase(w)}' matches reference` };
  }
  for (const w of tokens) {
    if (w.length >= 5 && flat.includes(w.slice(0, 4))) {
      return { score: 65, confidence: "Low", reason: `Name truncated in bank reference ('${titleCase(w.slice(0, 4))}…')` };
    }
    if (fz[w] && !COMMON_SURNAMES.has(w)) {
      return { score: 60, confidence: "Low", reason: `Approximate name match ('${titleCase(w)}')` };
    }
  }
  return { score: 0, confidence: "", reason: "" };
}

// Event-prefixed numbers (UTS26-R0012) are unique across events: match them
// on the normalized text, however the payer spaced or hyphenated them.
// Old plain numbers (R0012) exist in EVERY event, so they only count when
// they stand on their own — not as the tail of another event's prefixed
// number ("UTS26-R0012" must not match another event's plain "R0012").
function registrationNumberIn(registrationNumber, txn) {
  const raw = String(registrationNumber || "").trim().toUpperCase();
  if (!raw) return null;
  const norm = normalize(raw);
  if (raw.includes("-")) {
    return new RegExp(`${norm}(?!\\d)`).test(txn.flat) ? "prefixed" : null;
  }
  // Plain R0012: must stand alone — not glued to other letters/digits, and
  // not following an event code such as "UTS26 " / "IYD26-" (that's another
  // event's prefixed number, typed with a space or hyphen).
  const digits = raw.replace(/^R/, "");
  const re = new RegExp(`(?<![A-Z0-9-])(?<![A-Z]{3}\\d{2}[A-Z]?[\\s\\-_./]{1,3})R[\\s-]?${digits}(?!\\d)`);
  return re.test(txn.raw) ? "plain" : null;
}

function titleCase(w) {
  return w.charAt(0) + w.slice(1).toLowerCase();
}

/**
 * @param {Array} registrations - rows shaped like the kutumb_event_registrations table (camelCase), each needs: id/email, name, fee, registrationNumber, membershipNumber
 * @param {Array<{date:Date|null, amount:number, details:string}>} transactions
 * @returns {{
 *   allocations: Array<{ registration: any, transaction: any, score:number, confidence:string, reason:string }>,
 *   unmatchedCredits: Array<{ transaction: any, classification: string }>,
 * }}
 */
export function reconcile(registrations, transactions) {
  const txns = transactions.map((t, idx) => ({ ...t, idx, ...classifyTransaction(t.details) }));
  const eligibleTxns = txns.filter((t) => !t.isDonation);

  const candidates = [];
  for (const reg of registrations) {
    for (const txn of eligibleTxns) {
      const { score, confidence, reason } = scoreMatch(reg, txn);
      if (score === 0) continue;

      const fee = Number(reg.fee) || 0;
      // After a coupon part-payment the registrant only transfers the
      // BALANCE (fee − coupon), so that is also an exact, expected amount.
      const alreadyPaid = Number(reg.paymentAmount) || 0;
      const balanceDue = Math.round((fee - alreadyPaid) * 100) / 100;
      const amountOk = txn.amount === fee || (alreadyPaid > 0 && balanceDue > 0 && txn.amount === balanceDue);
      const accept =
        score >= 88 ||
        (score >= 70 && (amountOk || txn.hasEventWords)) ||
        (score >= 50 && amountOk);
      if (!accept) continue;

      const bonus = amountOk ? 12 : txn.amount > fee ? 5 : 0;
      candidates.push({ reg, txn, score, confidence, reason, total: score + bonus, amountOk });
    }
  }

  candidates.sort((a, b) => b.total - a.total || b.score - a.score);

  // Only a transaction is exclusive here — a registration CAN legitimately
  // receive more than one small transfer (e.g. a member who paid in two
  // instalments), so those are aggregated by the caller rather than capped
  // at one match per registration.
  const usedTxn = new Set();
  const allocations = [];
  for (const c of candidates) {
    if (usedTxn.has(c.txn.idx)) continue;
    usedTxn.add(c.txn.idx);
    allocations.push({
      registration: c.reg,
      transaction: c.txn,
      score: c.score,
      confidence: c.confidence,
      reason: c.reason,
    });
  }

  const unmatchedCredits = txns
    .filter((t) => !usedTxn.has(t.idx))
    .map((t) => ({
      transaction: t,
      classification: t.isDonation ? "Donation" : t.hasEventWords ? "Unidentified (event-related)" : "Unidentified",
    }));

  return { allocations, unmatchedCredits };
}

/**
 * Collapses per-transaction allocations down to one entry per registration
 * (summing amounts, taking the earliest date, and keeping the strongest
 * match's confidence/reason as the headline one, with any others appended).
 * @param {Array} allocations - as returned by reconcile()
 * @param {(reg:any)=>string} keyFn - stable identity for a registration (e.g. by id or email)
 */
export function groupAllocationsByRegistration(allocations, keyFn) {
  const groups = new Map();
  for (const a of allocations) {
    const key = keyFn(a.registration);
    if (!groups.has(key)) {
      groups.set(key, { registration: a.registration, matches: [] });
    }
    groups.get(key).matches.push(a);
  }

  const result = new Map();
  for (const [key, { registration, matches }] of groups) {
    matches.sort((a, b) => b.score - a.score);
    const totalAmount = matches.reduce((sum, m) => sum + m.transaction.amount, 0);
    const dates = matches.map((m) => m.transaction.date).filter(Boolean);
    const earliestDate = dates.length ? new Date(Math.min(...dates.map((d) => d.getTime()))) : null;
    const reasons = matches.map((m) => m.reason).join(" | ");
    const bankReferences = matches.map((m) => m.transaction.raw).join(" | ");

    result.set(key, {
      registration,
      amount: totalAmount,
      date: earliestDate,
      confidence: matches[0].confidence,
      reason: reasons,
      bankReference: bankReferences,
      matchCount: matches.length,
    });
  }
  return result;
}
